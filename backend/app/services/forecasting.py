"""Previsão de demanda e sugestão de reposição.

Escolhe o método conforme o padrão de consumo do produto:

* **Holt amortecido** (suavização exponencial dupla com tendência amortecida) para demanda
  regular — captura nível e tendência sem extrapolar crescimentos indefinidamente.
* **Croston/SBA** (Syntetos–Boylan) para demanda intermitente (muitos dias sem saída),
  caso comum em almoxarifados, onde médias simples subestimam ou superestimam muito.

Com a demanda diária prevista calculamos:
  estoque de segurança = z(nível de serviço) × σ(erro diário) × √(lead time)
  ponto de pedido      = demanda diária × lead time + estoque de segurança
  sugestão de compra   = demanda até (lead time + horizonte) + segurança − (saldo + pedidos em aberto)
"""

from __future__ import annotations

import math
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from decimal import Decimal
from statistics import NormalDist
from typing import Any

from sqlalchemy import func, select
from sqlalchemy.orm import Session, joinedload

from app.models import (
    MovementType,
    Product,
    PurchaseOrder,
    PurchaseOrderItem,
    PurchaseOrderStatus,
    StockMovement,
)
from app.models.base import utcnow
from app.services.analytics import local_date, local_tz
from app.services.settings_store import get_general_settings

HISTORY_DAYS = 120
DEFAULT_LEAD_TIME = 7
COUNTABLE_UNITS = {"UN", "PC", "CX", "PCT", "KIT", "PAR", "RL", "FD", "SC", "GL", "CJ"}
INTERMITTENT_THRESHOLD = 0.5  # fração de dias sem demanda a partir da qual usamos Croston


@dataclass
class ForecastResult:
    method: str
    daily_rate: float  # demanda média diária prevista
    sigma: float  # desvio-padrão do erro de previsão de 1 dia
    forecast: list[float]  # previsão dia a dia para o horizonte


def damped_holt(
    series: list[float], horizon: int, alpha: float = 0.3, beta: float = 0.1, phi: float = 0.9
) -> ForecastResult:
    level, trend = series[0], 0.0
    errors: list[float] = []
    for value in series[1:]:
        predicted = level + phi * trend
        errors.append(value - predicted)
        new_level = alpha * value + (1 - alpha) * predicted
        trend = beta * (new_level - level) + (1 - beta) * phi * trend
        level = new_level
    forecast = []
    damp = 0.0
    for h in range(1, horizon + 1):
        damp += phi**h
        forecast.append(max(level + damp * trend, 0.0))
    daily = sum(forecast) / horizon if horizon else 0.0
    return ForecastResult("holt_amortecido", daily, _rmse(errors), forecast)


def croston_sba(series: list[float], horizon: int, alpha: float = 0.15) -> ForecastResult:
    demands = [(i, v) for i, v in enumerate(series) if v > 0]
    if not demands:
        return ForecastResult("sem_demanda", 0.0, 0.0, [0.0] * horizon)
    # Inicialização pela média do histórico (tamanho médio e intervalo médio entre demandas):
    # começar com intervalo = 1 superestima muito a taxa quando há poucas ocorrências.
    size = sum(v for _, v in demands) / len(demands)
    interval = len(series) / len(demands)
    last_index = demands[0][0]
    errors: list[float] = []
    for i in range(last_index + 1, len(series)):
        rate = size / interval
        errors.append(series[i] - rate)
        if series[i] > 0:
            size = alpha * series[i] + (1 - alpha) * size
            interval = alpha * (i - last_index) + (1 - alpha) * interval
            last_index = i
    daily = (1 - alpha / 2) * size / interval  # correção de viés de Syntetos–Boylan
    return ForecastResult("croston_sba", daily, _rmse(errors), [daily] * horizon)


def _rmse(errors: list[float]) -> float:
    if not errors:
        return 0.0
    return math.sqrt(sum(e * e for e in errors) / len(errors))


def forecast_series(series: list[float], horizon: int) -> ForecastResult:
    active_days = next((i for i, v in enumerate(series) if v > 0), None)
    if active_days is None:
        return ForecastResult("sem_demanda", 0.0, 0.0, [0.0] * horizon)
    trimmed = series[active_days:]  # ignora o período antes da primeira saída
    if len(trimmed) < 7:
        daily = sum(trimmed) / len(trimmed)
        return ForecastResult("media_simples", daily, daily, [daily] * horizon)
    zero_share = sum(1 for v in trimmed if v == 0) / len(trimmed)
    if zero_share >= INTERMITTENT_THRESHOLD:
        return croston_sba(trimmed, horizon)
    return damped_holt(trimmed, horizon)


def daily_demand(
    db: Session, product_ids: list[int] | None = None, days: int = HISTORY_DAYS
) -> dict[int, list[float]]:
    """Série diária de saídas (consumo) por produto, do dia mais antigo para hoje."""
    today = local_date(utcnow())
    start = today - timedelta(days=days - 1)
    since = datetime.combine(start, datetime.min.time(), tzinfo=local_tz())
    stmt = select(StockMovement.product_id, StockMovement.quantity, StockMovement.created_at).where(
        StockMovement.type == MovementType.EXIT, StockMovement.created_at >= since
    )
    if product_ids is not None:
        stmt = stmt.where(StockMovement.product_id.in_(product_ids))
    series: dict[int, list[float]] = defaultdict(lambda: [0.0] * days)
    for product_id, quantity, created_at in db.execute(stmt):
        index = (local_date(created_at) - start).days
        if 0 <= index < days:
            series[product_id][index] += float(-quantity)
    return series


def open_order_quantities(db: Session) -> dict[int, float]:
    rows = db.execute(
        select(
            PurchaseOrderItem.product_id,
            func.sum(PurchaseOrderItem.quantity_ordered - PurchaseOrderItem.quantity_received),
        )
        .join(PurchaseOrder, PurchaseOrder.id == PurchaseOrderItem.purchase_order_id)
        .where(
            PurchaseOrder.status.in_(
                [PurchaseOrderStatus.ORDERED, PurchaseOrderStatus.PARTIALLY_RECEIVED]
            )
        )
        .group_by(PurchaseOrderItem.product_id)
    ).all()
    return {pid: float(qty or 0) for pid, qty in rows}


def _round_quantity(value: float, unit: str) -> float:
    if value <= 0:
        return 0.0
    if unit.upper() in COUNTABLE_UNITS:
        return float(math.ceil(value - 1e-9))
    return round(value, 3)


def plan_product(
    product: Product,
    series: list[float],
    *,
    on_order: float,
    horizon: int,
    service_level: float,
) -> dict[str, Any]:
    result = forecast_series(series, horizon)
    lead_time = product.supplier.lead_time_days if product.supplier else DEFAULT_LEAD_TIME
    stock = float(product.total_stock)
    minimum = float(product.min_stock or 0)
    z = NormalDist().inv_cdf(service_level)
    safety = z * result.sigma * math.sqrt(max(lead_time, 1))
    reorder_point = result.daily_rate * lead_time + safety
    position = stock + on_order
    trigger = max(reorder_point, minimum)

    needed = result.daily_rate * (lead_time + horizon) + safety - position
    if position <= minimum:
        needed = max(needed, minimum - position + result.daily_rate * lead_time)
    if product.max_stock is not None:
        needed = min(needed, float(product.max_stock) - position)
    suggested = _round_quantity(needed, product.unit) if position <= trigger else 0.0

    days_left = stock / result.daily_rate if result.daily_rate > 0 else None
    today = local_date(utcnow())
    return {
        "product_id": product.id,
        "sku": product.sku,
        "name": product.name,
        "unit": product.unit,
        "supplier_id": product.supplier_id,
        "supplier_name": product.supplier.name if product.supplier else None,
        "method": result.method,
        "avg_daily_demand": round(result.daily_rate, 4),
        "forecast_total": round(sum(result.forecast), 3),
        "horizon_days": horizon,
        "current_stock": stock,
        "on_order": on_order,
        "min_stock": minimum,
        "lead_time_days": lead_time,
        "safety_stock": round(safety, 3),
        "reorder_point": round(reorder_point, 3),
        "suggested_quantity": suggested,
        "unit_cost": float(product.cost_price),
        "estimated_cost": round(suggested * float(product.cost_price), 2),
        "days_until_stockout": round(days_left, 1) if days_left is not None else None,
        "stockout_date": (today + timedelta(days=int(days_left))).isoformat()
        if days_left is not None and days_left < 3650
        else None,
        "_forecast": result.forecast,
    }


def product_forecast(db: Session, product: Product, history_days: int = 60) -> dict[str, Any]:
    general = get_general_settings(db)
    series = daily_demand(db, [product.id]).get(product.id, [0.0] * HISTORY_DAYS)
    plan = plan_product(
        product,
        series,
        on_order=open_order_quantities(db).get(product.id, 0.0),
        horizon=general.forecast_horizon_days,
        service_level=general.service_level,
    )
    forecast = plan.pop("_forecast")
    today = local_date(utcnow())
    history_start = today - timedelta(days=history_days - 1)
    plan["history"] = [
        {"date": (history_start + timedelta(days=i)).isoformat(), "quantity": q}
        for i, q in enumerate(series[-history_days:])
    ]
    plan["forecast"] = [
        {"date": (today + timedelta(days=i + 1)).isoformat(), "quantity": round(q, 3)}
        for i, q in enumerate(forecast)
    ]
    return plan


def replenishment_suggestions(db: Session, *, only_needed: bool = True) -> list[dict[str, Any]]:
    general = get_general_settings(db)
    products = db.scalars(
        select(Product)
        .options(joinedload(Product.stock_levels), joinedload(Product.supplier))
        .where(Product.is_active.is_(True))
    ).unique()
    demand = daily_demand(db)
    on_order = open_order_quantities(db)
    plans = []
    for product in products:
        plan = plan_product(
            product,
            demand.get(product.id, [0.0] * HISTORY_DAYS),
            on_order=on_order.get(product.id, 0.0),
            horizon=general.forecast_horizon_days,
            service_level=general.service_level,
        )
        plan.pop("_forecast")
        if only_needed and plan["suggested_quantity"] <= 0:
            continue
        plans.append(plan)
    plans.sort(
        key=lambda p: (
            p["days_until_stockout"] if p["days_until_stockout"] is not None else math.inf,
            -p["estimated_cost"],
        )
    )
    return plans


def history_dates(days: int) -> list[date]:
    today = local_date(utcnow())
    return [today - timedelta(days=days - 1 - i) for i in range(days)]


def as_decimal(value: float) -> Decimal:
    return Decimal(str(value))
