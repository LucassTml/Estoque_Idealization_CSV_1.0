"""Modelos de resposta dos indicadores (documentam a API e geram os tipos do frontend)."""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel


class SeriesPoint(BaseModel):
    date: str
    in_value: float
    out_value: float
    in_qty: float
    out_qty: float


class NameValue(BaseModel):
    name: str
    value: float


class WarehouseValue(BaseModel):
    code: str
    name: str
    value: float


class TopExit(BaseModel):
    product_id: int
    sku: str
    name: str
    quantity: float


class DashboardOut(BaseModel):
    active_products: int
    stock_value: float
    below_min_count: int
    out_of_stock_count: int
    open_purchase_orders: int
    open_purchase_value: float
    movements_period: int
    period_days: int
    series: list[SeriesPoint]
    value_by_category: list[NameValue]
    value_by_warehouse: list[WarehouseValue]
    top_exits: list[TopExit]


class AbcItem(BaseModel):
    product_id: int
    sku: str
    name: str
    category: str | None
    quantity: float
    value: float
    share: float
    cumulative_share: float
    abc_class: Literal["A", "B", "C"]


class AbcClassSummary(BaseModel):
    count: int
    value: float


class AbcOut(BaseModel):
    period_days: int
    total_value: float
    summary: dict[str, AbcClassSummary]
    items: list[AbcItem]


class TurnoverItem(BaseModel):
    product_id: int
    sku: str
    name: str
    unit: str
    consumed: float
    average_stock: float
    current_stock: float
    turnover: float | None
    coverage_days: float | None
    stock_value: float


class ReplenishmentItem(BaseModel):
    product_id: int
    sku: str
    name: str
    unit: str
    supplier_id: int | None
    supplier_name: str | None
    method: str
    avg_daily_demand: float
    forecast_total: float
    horizon_days: int
    current_stock: float
    on_order: float
    min_stock: float
    lead_time_days: int
    safety_stock: float
    reorder_point: float
    suggested_quantity: float
    unit_cost: float
    estimated_cost: float
    days_until_stockout: float | None
    stockout_date: str | None


class DailyPoint(BaseModel):
    date: str
    quantity: float


class ForecastOut(ReplenishmentItem):
    history: list[DailyPoint]
    forecast: list[DailyPoint]


class AlertCount(BaseModel):
    unread: int
    open: int


class AssistantStatus(BaseModel):
    enabled: bool
    model: str | None
