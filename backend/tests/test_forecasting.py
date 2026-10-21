import math
from decimal import Decimal
from types import SimpleNamespace

import pytest

from app.services.forecasting import croston_sba, damped_holt, forecast_series, plan_product


def test_holt_on_constant_demand_converges_to_level() -> None:
    result = damped_holt([5.0] * 60, horizon=30)
    assert result.daily_rate == pytest.approx(5.0, rel=0.01)
    assert result.sigma == pytest.approx(0.0, abs=1e-9)


def test_holt_captures_growth_but_damps_it() -> None:
    series = [float(i) for i in range(1, 61)]  # cresce 1/dia
    result = damped_holt(series, horizon=30)
    assert result.forecast[0] > 59  # continua subindo
    increments = [b - a for a, b in zip(result.forecast, result.forecast[1:], strict=False)]
    assert increments[-1] < increments[0]  # tendência amortecida


def test_croston_estimates_intermittent_rate() -> None:
    # 3 unidades a cada 6 dias → taxa real 0,5/dia
    series = [3.0 if i % 6 == 0 else 0.0 for i in range(120)]
    result = croston_sba(series, horizon=10)
    assert result.method == "croston_sba"
    assert result.daily_rate == pytest.approx(0.5 * (1 - 0.15 / 2), rel=0.05)


def test_method_selection() -> None:
    assert forecast_series([0.0] * 30, 10).method == "sem_demanda"
    assert forecast_series([0.0] * 20 + [2.0, 3.0], 10).method == "media_simples"
    assert forecast_series([4.0, 5.0, 6.0] * 20, 10).method == "holt_amortecido"
    assert forecast_series([0, 0, 0, 5.0] * 20, 10).method == "croston_sba"


def _product(stock: float, minimum: float, unit: str = "UN", max_stock=None, lead=7):  # type: ignore[no-untyped-def]
    return SimpleNamespace(
        id=1,
        sku="X",
        name="X",
        unit=unit,
        supplier_id=1,
        supplier=SimpleNamespace(name="F", lead_time_days=lead),
        total_stock=Decimal(str(stock)),
        min_stock=Decimal(str(minimum)),
        max_stock=Decimal(str(max_stock)) if max_stock is not None else None,
        cost_price=Decimal("2.5"),
    )


def test_plan_suggests_purchase_below_reorder_point() -> None:
    plan = plan_product(_product(10, 5), [4.0] * 90, on_order=0, horizon=30, service_level=0.95)
    # consumo 4/dia, lead time 7 → ponto de pedido ≈ 28
    assert plan["reorder_point"] == pytest.approx(28, abs=0.5)
    assert plan["days_until_stockout"] == pytest.approx(2.5, abs=0.1)
    assert plan["suggested_quantity"] == math.ceil(4 * 37 - 10)  # sem variabilidade = sem segurança
    assert plan["estimated_cost"] == plan["suggested_quantity"] * 2.5


def test_plan_considers_open_orders_and_max_stock() -> None:
    covered = plan_product(
        _product(10, 5), [4.0] * 90, on_order=200, horizon=30, service_level=0.95
    )
    assert covered["suggested_quantity"] == 0

    capped = plan_product(
        _product(0, 5, max_stock=50), [4.0] * 90, on_order=0, horizon=30, service_level=0.95
    )
    assert capped["suggested_quantity"] == 50


def test_plan_without_history_uses_minimum() -> None:
    plan = plan_product(_product(2, 10), [0.0] * 90, on_order=0, horizon=30, service_level=0.95)
    assert plan["method"] == "sem_demanda"
    assert plan["suggested_quantity"] == 8
    assert plan["days_until_stockout"] is None


def test_fractional_units_are_not_rounded_up_to_integers() -> None:
    plan = plan_product(
        _product(0, 1.5, unit="KG"), [0.0] * 90, on_order=0, horizon=30, service_level=0.95
    )
    assert plan["suggested_quantity"] == 1.5
