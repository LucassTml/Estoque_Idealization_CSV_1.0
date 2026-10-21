"""Assistente de estoque com IA (Claude + tool use).

O modelo não acessa o banco diretamente: ele chama ferramentas *somente leitura* definidas aqui,
que reutilizam os mesmos serviços da API (analytics, forecasting...). Assim as respostas são
baseadas em dados reais e o assistente não tem como alterar nada.
"""

from __future__ import annotations

import json
import logging
from datetime import timedelta
from decimal import Decimal
from typing import Any

import anthropic
from pydantic import BaseModel, Field, ValidationError, field_validator
from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, joinedload

from app.core.config import get_settings
from app.core.errors import AppError, ServiceUnavailableError
from app.models import (
    Category,
    MovementType,
    Product,
    PurchaseOrder,
    PurchaseOrderStatus,
    StockMovement,
    Warehouse,
)
from app.models.base import utcnow
from app.services import analytics, forecasting
from app.services.analytics import local_date
from app.services.settings_store import get_general_settings

logger = logging.getLogger(__name__)

MAX_TOOL_ROUNDS = 8
FALLBACK_BETA = "server-side-fallback-2026-07-01"

# Prompt de sistema fixo (sem data ou nomes variáveis) para aproveitar o cache de prompt.
SYSTEM_PROMPT = """Você é o assistente de estoque do sistema Estoque Idealization.
Responda sempre em português do Brasil, de forma direta e útil para quem gerencia um almoxarifado.

Regras:
- Use as ferramentas para obter qualquer número (saldos, valores, consumo, previsões). Nunca invente dados.
- Você só consulta dados. Se o usuário pedir para cadastrar, movimentar ou alterar algo, explique em qual tela do sistema ele faz isso (Produtos, Movimentações, Compras, Reposição, Relatórios, Etiquetas, Scanner).
- Valores monetários em reais (R$ 1.234,56). Quantidades com a unidade do produto.
- Seja conciso: comece pela resposta, depois os detalhes. Use listas ou tabelas Markdown curtas quando ajudar.
- Ao falar de previsão, diga o método (Holt amortecido para consumo regular, Croston/SBA para consumo intermitente) e que é uma estimativa baseada no histórico de saídas.
- Se uma pergunta for ambígua (por exemplo, um produto com nome parecido com vários), mostre as opções encontradas.
- Se não houver dados suficientes, diga isso claramente."""


# ----- Definição das ferramentas -------------------------------------------------------------------

TOOLS: list[dict[str, Any]] = [
    {
        "name": "search_products",
        "description": "Busca produtos por nome, SKU ou código de barras. Retorna saldo total, mínimo, custo médio e categoria. Use para localizar produtos antes de detalhar.",
        "input_schema": {
            "type": "object",
            "properties": {
                "query": {
                    "type": "string",
                    "description": "Texto a buscar (nome, SKU ou código de barras). Vazio lista todos.",
                },
                "category": {"type": "string", "description": "Filtra pelo nome da categoria."},
                "below_min_only": {
                    "type": "boolean",
                    "description": "Somente itens no mínimo ou abaixo.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Máximo de resultados (1-50).",
                    "default": 20,
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "get_product",
        "description": "Detalhes de um produto pelo SKU: saldo por depósito, fornecedor, últimas movimentações e previsão de demanda com sugestão de compra.",
        "input_schema": {
            "type": "object",
            "properties": {"sku": {"type": "string", "description": "SKU exato do produto."}},
            "required": ["sku"],
            "additionalProperties": False,
        },
    },
    {
        "name": "low_stock",
        "description": "Lista produtos ativos no estoque mínimo, abaixo dele ou zerados.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Máximo de itens (1-100).",
                    "default": 30,
                }
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "dashboard",
        "description": "Indicadores gerais: valor total em estoque, produtos ativos, itens abaixo do mínimo, zerados, pedidos de compra em aberto, valor por categoria e por depósito, produtos mais consumidos nos últimos 30 dias.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
    {
        "name": "replenishment",
        "description": "Sugestões de reposição calculadas pela previsão de demanda: o que comprar, quanto, custo estimado e em quantos dias o item acaba.",
        "input_schema": {
            "type": "object",
            "properties": {
                "limit": {
                    "type": "integer",
                    "description": "Máximo de itens (1-50).",
                    "default": 20,
                }
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "movements_summary",
        "description": "Resumo das movimentações em um período: totais por tipo, produtos com mais saídas e as movimentações mais recentes. Pode filtrar por SKU, depósito e tipo.",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Período em dias até hoje (1-365).",
                    "default": 30,
                },
                "sku": {"type": "string", "description": "Filtra por SKU."},
                "warehouse_code": {
                    "type": "string",
                    "description": "Filtra pelo código do depósito.",
                },
                "type": {
                    "type": "string",
                    "enum": [t.value for t in MovementType],
                    "description": "Filtra pelo tipo de movimentação.",
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "abc_curve",
        "description": "Curva ABC pelo valor consumido no período (A = 80% do valor, B = 15%, C = 5%).",
        "input_schema": {
            "type": "object",
            "properties": {
                "days": {
                    "type": "integer",
                    "description": "Período em dias (7-365).",
                    "default": 90,
                }
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "purchase_orders",
        "description": "Lista pedidos de compra com fornecedor, status, previsão de entrega e valor.",
        "input_schema": {
            "type": "object",
            "properties": {
                "status": {
                    "type": "string",
                    "enum": [s.value for s in PurchaseOrderStatus],
                    "description": "Filtra por status. Omitir = todos os não cancelados.",
                },
                "limit": {
                    "type": "integer",
                    "description": "Máximo de pedidos (1-50).",
                    "default": 20,
                },
            },
            "additionalProperties": False,
        },
    },
    {
        "name": "warehouses",
        "description": "Lista os depósitos/setores com quantidade de SKUs com saldo e valor armazenado.",
        "input_schema": {"type": "object", "properties": {}, "additionalProperties": False},
    },
]


class _Limit(BaseModel):
    limit: int = Field(default=20, ge=1, le=100)


class _Search(_Limit):
    query: str = ""
    category: str | None = None
    below_min_only: bool = False


class _Sku(BaseModel):
    sku: str = Field(min_length=1)

    @field_validator("sku")
    @classmethod
    def upper(cls, value: str) -> str:
        return value.strip().upper()


class _Movements(BaseModel):
    days: int = Field(default=30, ge=1, le=365)
    sku: str | None = None
    warehouse_code: str | None = None
    type: MovementType | None = None


class _Days(BaseModel):
    days: int = Field(default=90, ge=7, le=365)


class _Orders(_Limit):
    status: PurchaseOrderStatus | None = None


def _num(value: Decimal | float | None) -> float | None:
    return None if value is None else round(float(value), 4)


def _product_brief(p: Product) -> dict[str, Any]:
    return {
        "sku": p.sku,
        "name": p.name,
        "unit": p.unit,
        "category": p.category.name if p.category else None,
        "stock": _num(p.total_stock),
        "min_stock": _num(p.min_stock),
        "avg_cost": _num(p.cost_price),
        "stock_value": round(float(p.stock_value), 2),
        "below_min": p.is_below_min,
        "active": p.is_active,
    }


class InventoryTools:
    def __init__(self, db: Session) -> None:
        self.db = db

    def run(self, name: str, raw_input: dict[str, Any]) -> Any:
        handler = getattr(self, f"tool_{name}", None)
        if handler is None:
            raise ValueError(f"Ferramenta desconhecida: {name}")
        return handler(raw_input or {})

    def tool_search_products(self, data: dict[str, Any]) -> Any:
        args = _Search.model_validate(data)
        stmt = select(Product).options(
            joinedload(Product.category), joinedload(Product.stock_levels)
        )
        if args.query.strip():
            like = f"%{args.query.strip()}%"
            stmt = stmt.where(
                or_(Product.name.ilike(like), Product.sku.ilike(like), Product.barcode.ilike(like))
            )
        if args.category:
            stmt = stmt.join(Category, Category.id == Product.category_id).where(
                Category.name.ilike(f"%{args.category}%")
            )
        products = list(self.db.scalars(stmt.order_by(Product.name)).unique())
        if args.below_min_only:
            products = [p for p in products if p.is_below_min or p.total_stock <= 0]
        return {
            "total_found": len(products),
            "items": [_product_brief(p) for p in products[: args.limit]],
        }

    def tool_get_product(self, data: dict[str, Any]) -> Any:
        args = _Sku.model_validate(data)
        product = self.db.scalar(
            select(Product)
            .options(
                joinedload(Product.category),
                joinedload(Product.supplier),
                joinedload(Product.stock_levels),
            )
            .where(Product.sku == args.sku)
        )
        if product is None:
            return {
                "error": f"Nenhum produto com SKU {args.sku}. Use search_products para procurar."
            }
        movements = self.db.scalars(
            select(StockMovement)
            .options(joinedload(StockMovement.warehouse))
            .where(StockMovement.product_id == product.id)
            .order_by(StockMovement.created_at.desc())
            .limit(10)
        ).all()
        plan = forecasting.product_forecast(self.db, product, history_days=30)
        return {
            **_product_brief(product),
            "barcode": product.barcode,
            "sale_price": _num(product.sale_price),
            "max_stock": _num(product.max_stock),
            "supplier": product.supplier.name if product.supplier else None,
            "supplier_lead_time_days": product.supplier.lead_time_days
            if product.supplier
            else None,
            "stock_by_warehouse": [
                {"warehouse": level.warehouse.code, "quantity": _num(level.quantity)}
                for level in product.stock_levels
                if level.quantity != 0
            ],
            "recent_movements": [
                {
                    "date": local_date(m.created_at).isoformat(),
                    "type": m.type.value,
                    "warehouse": m.warehouse.code,
                    "quantity": _num(m.quantity),
                    "balance_after": _num(m.balance_after),
                    "reference": m.reference,
                }
                for m in movements
            ],
            "forecast": {k: v for k, v in plan.items() if k not in {"history", "forecast"}},
        }

    def tool_low_stock(self, data: dict[str, Any]) -> Any:
        args = _Limit.model_validate({"limit": data.get("limit", 30)})
        products = self.db.scalars(
            select(Product)
            .options(joinedload(Product.category), joinedload(Product.stock_levels))
            .where(Product.is_active.is_(True))
        ).unique()
        flagged = [p for p in products if p.is_below_min or p.total_stock <= 0]
        flagged.sort(key=lambda p: (p.total_stock > 0, float(p.total_stock - p.min_stock)))
        return {"total": len(flagged), "items": [_product_brief(p) for p in flagged[: args.limit]]}

    def tool_dashboard(self, _data: dict[str, Any]) -> Any:
        summary = analytics.dashboard_summary(self.db)
        summary.pop("series", None)
        return summary

    def tool_replenishment(self, data: dict[str, Any]) -> Any:
        args = _Limit.model_validate(data)
        items = forecasting.replenishment_suggestions(self.db)
        return {
            "total": len(items),
            "total_estimated_cost": round(sum(i["estimated_cost"] for i in items), 2),
            "items": items[: args.limit],
        }

    def tool_movements_summary(self, data: dict[str, Any]) -> Any:
        args = _Movements.model_validate(data)
        since = utcnow() - timedelta(days=args.days)
        filters = [StockMovement.created_at >= since]
        if args.sku:
            filters.append(Product.sku == args.sku.strip().upper())
        if args.warehouse_code:
            filters.append(Warehouse.code == args.warehouse_code.strip().upper())
        if args.type:
            filters.append(StockMovement.type == args.type)
        base = (
            select(StockMovement)
            .join(Product, Product.id == StockMovement.product_id)
            .join(Warehouse, Warehouse.id == StockMovement.warehouse_id)
            .where(*filters)
        )
        by_type = self.db.execute(
            select(StockMovement.type, func.count(), func.sum(StockMovement.quantity))
            .join(Product, Product.id == StockMovement.product_id)
            .join(Warehouse, Warehouse.id == StockMovement.warehouse_id)
            .where(*filters)
            .group_by(StockMovement.type)
        ).all()
        top_exits = self.db.execute(
            select(Product.sku, Product.name, func.sum(-StockMovement.quantity).label("qty"))
            .join(StockMovement, StockMovement.product_id == Product.id)
            .join(Warehouse, Warehouse.id == StockMovement.warehouse_id)
            .where(*filters, StockMovement.type == MovementType.EXIT)
            .group_by(Product.sku, Product.name)
            .order_by(func.sum(-StockMovement.quantity).desc())
            .limit(10)
        ).all()
        recent = self.db.scalars(
            base.options(joinedload(StockMovement.product), joinedload(StockMovement.warehouse))
            .order_by(StockMovement.created_at.desc())
            .limit(15)
        ).all()
        return {
            "period_days": args.days,
            "by_type": [
                {"type": t.value, "count": c, "net_quantity": _num(q)} for t, c, q in by_type
            ],
            "top_exits": [{"sku": s, "name": n, "quantity": _num(q)} for s, n, q in top_exits],
            "recent": [
                {
                    "date": local_date(m.created_at).isoformat(),
                    "type": m.type.value,
                    "sku": m.product.sku,
                    "warehouse": m.warehouse.code,
                    "quantity": _num(m.quantity),
                }
                for m in recent
            ],
        }

    def tool_abc_curve(self, data: dict[str, Any]) -> Any:
        args = _Days.model_validate(data)
        result = analytics.abc_curve(self.db, args.days)
        result["items"] = [i for i in result["items"] if i["value"] > 0][:25]
        return result

    def tool_purchase_orders(self, data: dict[str, Any]) -> Any:
        args = _Orders.model_validate(data)
        stmt = select(PurchaseOrder).options(
            joinedload(PurchaseOrder.supplier), joinedload(PurchaseOrder.items)
        )
        if args.status:
            stmt = stmt.where(PurchaseOrder.status == args.status)
        else:
            stmt = stmt.where(PurchaseOrder.status != PurchaseOrderStatus.CANCELLED)
        orders = self.db.scalars(
            stmt.order_by(PurchaseOrder.created_at.desc()).limit(args.limit)
        ).unique()
        today = local_date(utcnow())
        return [
            {
                "number": o.number,
                "supplier": o.supplier.name,
                "status": o.status.value,
                "expected_date": o.expected_date.isoformat() if o.expected_date else None,
                "overdue": bool(
                    o.expected_date
                    and o.expected_date < today
                    and o.status
                    in (PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED)
                ),
                "items": len(o.items),
                "total": round(float(o.total), 2),
            }
            for o in orders
        ]

    def tool_warehouses(self, _data: dict[str, Any]) -> Any:
        summary = analytics.dashboard_summary(self.db, days=1)
        values = {w["code"]: w["value"] for w in summary["value_by_warehouse"]}
        return [
            {
                "code": w.code,
                "name": w.name,
                "active": w.is_active,
                "stock_value": round(values.get(w.code, 0), 2),
            }
            for w in self.db.scalars(select(Warehouse).order_by(Warehouse.code))
        ]


# ----- Loop de conversa ----------------------------------------------------------------------------


class ChatTurn(BaseModel):
    role: str = Field(pattern="^(user|assistant)$")
    content: str = Field(min_length=1, max_length=4000)


class ChatRequest(BaseModel):
    messages: list[ChatTurn] = Field(min_length=1, max_length=30)


class ToolTrace(BaseModel):
    name: str
    input: dict[str, Any]
    ok: bool


class ChatResponse(BaseModel):
    reply: str
    tools_used: list[ToolTrace]
    model: str
    stop_reason: str | None


_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    settings = get_settings()
    if not settings.ai_enabled:
        raise ServiceUnavailableError(
            "Assistente desativado: defina ANTHROPIC_API_KEY para habilitar.", code="ai_disabled"
        )
    if _client is None:
        _client = anthropic.Anthropic(api_key=settings.anthropic_api_key, timeout=120.0)
    return _client


def chat(
    db: Session, request: ChatRequest, client: anthropic.Anthropic | None = None
) -> ChatResponse:
    settings = get_settings()
    client = client or _get_client()
    if request.messages[-1].role != "user":
        raise AppError("A última mensagem deve ser do usuário.", code="invalid_conversation")

    general = get_general_settings(db)
    context = (
        f"[Contexto: empresa {general.company_name}; hoje é "
        f"{local_date(utcnow()).strftime('%d/%m/%Y')}]"
    )
    messages: list[dict[str, Any]] = [
        {"role": turn.role, "content": turn.content} for turn in request.messages[:-1]
    ]
    messages.append(
        {
            "role": "user",
            "content": [
                {"type": "text", "text": context},
                {"type": "text", "text": request.messages[-1].content},
            ],
        }
    )

    tools = InventoryTools(db)
    trace: list[ToolTrace] = []
    response = None
    for _round in range(MAX_TOOL_ROUNDS + 1):
        try:
            response = client.beta.messages.create(
                model=settings.anthropic_model,
                max_tokens=16000,
                system=SYSTEM_PROMPT,
                tools=TOOLS,
                messages=messages,
                output_config={"effort": settings.anthropic_effort},
                cache_control={"type": "ephemeral"},
                betas=[FALLBACK_BETA],
                fallbacks="default",
            )
        except anthropic.AuthenticationError as exc:
            raise ServiceUnavailableError(
                "Chave da API do Claude inválida.", code="ai_auth"
            ) from exc
        except anthropic.RateLimitError as exc:
            raise ServiceUnavailableError(
                "Limite de uso da IA atingido. Tente de novo em instantes.", code="ai_rate_limited"
            ) from exc
        except anthropic.APIStatusError as exc:
            logger.warning("Erro da API Claude: %s", exc)
            raise ServiceUnavailableError(
                f"A IA respondeu com erro ({exc.status_code}).", code="ai_error"
            ) from exc
        except anthropic.APIConnectionError as exc:
            raise ServiceUnavailableError(
                "Sem conexão com a API do Claude.", code="ai_offline"
            ) from exc

        if response.stop_reason == "refusal":
            return ChatResponse(
                reply="Não posso ajudar com esse pedido. Tente reformular a pergunta sobre o estoque.",
                tools_used=trace,
                model=response.model,
                stop_reason=response.stop_reason,
            )
        if response.stop_reason != "tool_use":
            break

        # Histórico só cresce (append-only): devolvemos o conteúdo completo, inclusive thinking.
        messages.append({"role": "assistant", "content": response.content})
        results = []
        for block in response.content:
            if block.type != "tool_use":
                continue
            try:
                output = tools.run(block.name, dict(block.input))
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": json.dumps(output, ensure_ascii=False, default=str),
                    }
                )
                trace.append(ToolTrace(name=block.name, input=dict(block.input), ok=True))
            except (ValidationError, ValueError) as exc:
                results.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": block.id,
                        "content": f"Erro nos parâmetros: {exc}",
                        "is_error": True,
                    }
                )
                trace.append(ToolTrace(name=block.name, input=dict(block.input), ok=False))
        messages.append({"role": "user", "content": results})
    else:
        logger.warning("Assistente atingiu o limite de %s rodadas de ferramentas", MAX_TOOL_ROUNDS)

    assert response is not None
    reply = "\n\n".join(b.text for b in response.content if b.type == "text").strip()
    if response.stop_reason == "max_tokens":
        reply += "\n\n_(resposta interrompida por ser muito longa)_"
    return ChatResponse(
        reply=reply or "Não consegui gerar uma resposta. Tente perguntar de outra forma.",
        tools_used=trace,
        model=response.model,
        stop_reason=response.stop_reason,
    )
