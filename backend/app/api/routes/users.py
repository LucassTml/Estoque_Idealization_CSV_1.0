from __future__ import annotations

from fastapi import APIRouter, Request, status
from sqlalchemy import func, select

from app.api.deps import DB, Admin, client_ip
from app.core.config import get_settings
from app.core.errors import BusinessRuleError, ConflictError, NotFoundError, PermissionDeniedError
from app.core.security import hash_password
from app.models import Role, User
from app.models.base import utcnow
from app.schemas.auth import UserCreate, UserOut, UserUpdate
from app.services import audit

router = APIRouter(prefix="/users", tags=["Usuários"])


@router.get("", response_model=list[UserOut])
def list_users(db: DB, _: Admin) -> list[User]:
    return list(db.scalars(select(User).order_by(User.name)))


@router.post("", response_model=UserOut, status_code=status.HTTP_201_CREATED)
def create_user(payload: UserCreate, db: DB, admin: Admin, request: Request) -> User:
    if db.scalar(select(User.id).where(func.lower(User.email) == payload.email.lower())):
        raise ConflictError("Já existe um usuário com este e-mail.")
    user = User(
        name=payload.name,
        email=payload.email.lower(),
        password_hash=hash_password(payload.password),
        role=payload.role,
    )
    db.add(user)
    db.flush()
    audit.record(
        db,
        user=admin,
        action="create",
        entity_type="user",
        entity_id=user.id,
        summary=f"Usuário {user.email} criado ({user.role.value})",
        ip_address=client_ip(request),
    )
    db.commit()
    return user


@router.patch("/{user_id}", response_model=UserOut)
def update_user(user_id: int, payload: UserUpdate, db: DB, admin: Admin, request: Request) -> User:
    user = db.get(User, user_id)
    if user is None:
        raise NotFoundError("Usuário não encontrado.")
    if user.is_demo and get_settings().demo_mode:
        raise PermissionDeniedError("Contas de demonstração não podem ser alteradas.")
    data = payload.model_dump(exclude_unset=True)
    if user.id == admin.id and (
        data.get("role", Role.ADMIN) != Role.ADMIN or data.get("is_active") is False
    ):
        raise BusinessRuleError("Você não pode remover o próprio acesso de administrador.")
    if user.role == Role.ADMIN and (
        data.get("role", Role.ADMIN) != Role.ADMIN or data.get("is_active") is False
    ):
        admins = db.scalar(
            select(func.count()).where(User.role == Role.ADMIN, User.is_active.is_(True))
        )
        if admins <= 1:
            raise BusinessRuleError("O sistema precisa de pelo menos um administrador ativo.")
    password = data.pop("password", None)
    changes = audit.diff(user, data)
    for field, value in data.items():
        setattr(user, field, value)
    if password:
        user.password_hash = hash_password(password)
        changes["password"] = {"from": "***", "to": "***"}
    if password or data.get("is_active") is False:
        for session in user.refresh_tokens:
            session.revoked_at = session.revoked_at or utcnow()
    audit.record(
        db,
        user=admin,
        action="update",
        entity_type="user",
        entity_id=user.id,
        summary=f"Usuário {user.email} alterado",
        changes=changes,
        ip_address=client_ip(request),
    )
    db.commit()
    return user
