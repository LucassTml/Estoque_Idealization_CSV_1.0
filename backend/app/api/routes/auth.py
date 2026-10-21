from __future__ import annotations

from datetime import timedelta
from typing import Annotated

from fastapi import APIRouter, Cookie, Depends, HTTPException, Request, Response, status
from fastapi.security import OAuth2PasswordRequestForm
from sqlalchemy import func, select

from app.api.deps import DB, CurrentUser, client_ip
from app.core.config import get_settings
from app.core.errors import BusinessRuleError, ConflictError, PermissionDeniedError
from app.core.security import (
    create_access_token,
    hash_password,
    hash_refresh_token,
    login_rate_limiter,
    new_refresh_token,
    verify_password,
)
from app.models import RefreshToken, Role, User
from app.models.base import utcnow
from app.schemas.auth import (
    LoginRequest,
    ProfileUpdate,
    SessionResponse,
    SetupRequest,
    SetupStatus,
    TokenResponse,
    UserOut,
)
from app.services import audit

router = APIRouter(prefix="/auth", tags=["Autenticação"])

REFRESH_COOKIE = "refresh_token"
COOKIE_PATH = "/api/v1/auth"


def _set_refresh_cookie(response: Response, token: str) -> None:
    settings = get_settings()
    response.set_cookie(
        REFRESH_COOKIE,
        token,
        max_age=settings.refresh_token_expire_days * 86400,
        httponly=True,
        secure=settings.environment == "production",
        samesite="lax",
        path=COOKIE_PATH,
    )


def _issue_session(db: DB, user: User, request: Request, response: Response) -> SessionResponse:
    settings = get_settings()
    token, token_hash = new_refresh_token()
    db.add(
        RefreshToken(
            user_id=user.id,
            token_hash=token_hash,
            expires_at=utcnow() + timedelta(days=settings.refresh_token_expire_days),
            user_agent=(request.headers.get("user-agent") or "")[:255],
        )
    )
    _set_refresh_cookie(response, token)
    access, expires_in = create_access_token(user.id, user.role.value)
    return SessionResponse(
        access_token=access, expires_in=expires_in, user=UserOut.model_validate(user)
    )


def _authenticate(db: DB, email: str, password: str, request: Request) -> User:
    key = f"{client_ip(request)}:{email.lower()}"
    if login_rate_limiter.is_blocked(key):
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Muitas tentativas. Aguarde alguns minutos e tente novamente.",
        )
    user = db.scalar(select(User).where(func.lower(User.email) == email.lower()))
    if user is None or not verify_password(password, user.password_hash):
        login_rate_limiter.register_failure(key)
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED, detail="E-mail ou senha incorretos."
        )
    if not user.is_active:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Usuário desativado.")
    login_rate_limiter.reset(key)
    user.last_login_at = utcnow()
    audit.record(
        db,
        user=user,
        action="login",
        entity_type="user",
        entity_id=user.id,
        summary=f"Login de {user.email}",
        ip_address=client_ip(request),
    )
    return user


@router.get("/setup-status", response_model=SetupStatus)
def setup_status(db: DB) -> SetupStatus:
    """Indica se ainda não existe nenhum usuário (primeira execução)."""
    has_users = db.scalar(select(func.count()).select_from(User)) or 0
    return SetupStatus(needs_setup=has_users == 0, demo_mode=get_settings().demo_mode)


@router.post("/setup", response_model=SessionResponse, status_code=status.HTTP_201_CREATED)
def setup(payload: SetupRequest, db: DB, request: Request, response: Response) -> SessionResponse:
    """Cria o primeiro administrador. Só funciona enquanto não houver usuários."""
    if db.scalar(select(func.count()).select_from(User)):
        raise PermissionDeniedError("O sistema já foi configurado.")
    user = User(
        name=payload.name,
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        role=Role.ADMIN,
    )
    db.add(user)
    db.flush()
    audit.record(
        db,
        user=user,
        action="setup",
        entity_type="user",
        entity_id=user.id,
        summary="Configuração inicial: administrador criado",
        ip_address=client_ip(request),
    )
    session = _issue_session(db, user, request, response)
    db.commit()
    return session


@router.post("/login", response_model=SessionResponse)
def login(payload: LoginRequest, db: DB, request: Request, response: Response) -> SessionResponse:
    user = _authenticate(db, payload.email, payload.password, request)
    session = _issue_session(db, user, request, response)
    db.commit()
    return session


@router.post("/token", response_model=TokenResponse, include_in_schema=True)
def token(
    form: Annotated[OAuth2PasswordRequestForm, Depends()], db: DB, request: Request
) -> TokenResponse:
    """Fluxo OAuth2 *password* (usado pelo botão **Authorize** do Swagger)."""
    user = _authenticate(db, form.username, form.password, request)
    db.commit()
    access, expires_in = create_access_token(user.id, user.role.value)
    return TokenResponse(access_token=access, expires_in=expires_in)


@router.post("/refresh", response_model=SessionResponse)
def refresh(
    db: DB,
    request: Request,
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> SessionResponse:
    """Troca o refresh token (cookie httpOnly) por um novo par de tokens (rotação)."""
    invalid = HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Sessão expirada.")
    if not refresh_token:
        raise invalid
    stored = db.scalar(
        select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(refresh_token))
    )
    if stored is None:
        raise invalid
    if stored.revoked_at is not None:
        # Reuso de um token já rotacionado: possível roubo. Revoga todas as sessões do usuário.
        for other in stored.user.refresh_tokens:
            other.revoked_at = other.revoked_at or utcnow()
        db.commit()
        raise invalid
    if stored.expires_at < utcnow() or not stored.user.is_active:
        raise invalid
    stored.revoked_at = utcnow()
    session = _issue_session(db, stored.user, request, response)
    db.commit()
    return session


@router.post("/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(
    db: DB,
    response: Response,
    refresh_token: Annotated[str | None, Cookie(alias=REFRESH_COOKIE)] = None,
) -> None:
    if refresh_token:
        stored = db.scalar(
            select(RefreshToken).where(RefreshToken.token_hash == hash_refresh_token(refresh_token))
        )
        if stored and stored.revoked_at is None:
            stored.revoked_at = utcnow()
            db.commit()
    response.delete_cookie(REFRESH_COOKIE, path=COOKIE_PATH)


@router.get("/me", response_model=UserOut)
def me(user: CurrentUser) -> User:
    return user


@router.patch("/me", response_model=UserOut)
def update_me(payload: ProfileUpdate, user: CurrentUser, db: DB, request: Request) -> User:
    if payload.name:
        user.name = payload.name
    if payload.new_password:
        if user.is_demo and get_settings().demo_mode:
            raise PermissionDeniedError("Contas de demonstração não podem trocar a senha.")
        if not payload.current_password or not verify_password(
            payload.current_password, user.password_hash
        ):
            raise BusinessRuleError("Senha atual incorreta.", code="wrong_password")
        if payload.new_password == payload.current_password:
            raise ConflictError("A nova senha deve ser diferente da atual.")
        user.password_hash = hash_password(payload.new_password)
        for session in user.refresh_tokens:
            session.revoked_at = session.revoked_at or utcnow()
        audit.record(
            db,
            user=user,
            action="password_change",
            entity_type="user",
            entity_id=user.id,
            summary="Senha alterada",
            ip_address=client_ip(request),
        )
    db.commit()
    return user
