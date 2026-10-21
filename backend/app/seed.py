"""Gera dados de demonstração realistas: 120 dias de consumo, compras e transferências.

Uso local:  uv run python -m app.seed
"""

from __future__ import annotations

import contextlib
import logging
import random
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from decimal import ROUND_HALF_UP, Decimal

from sqlalchemy import func, select
from sqlalchemy.orm import Session

from app.core.database import SessionLocal
from app.core.errors import InsufficientStockError
from app.core.security import hash_password
from app.models import (
    Category,
    Product,
    PurchaseOrder,
    PurchaseOrderStatus,
    Role,
    Supplier,
    User,
    Warehouse,
)
from app.models.base import set_clock
from app.schemas.purchasing import PurchaseOrderItemIn, ReceiveItem
from app.services import alerts, inventory, purchasing
from app.services.analytics import local_tz
from app.services.settings_store import GeneralSettings, save_general_settings

logger = logging.getLogger(__name__)
DAYS = 120

DEMO_USERS = [
    ("Ana Administradora", "admin@demo.com", Role.ADMIN),
    ("Gustavo Gerente", "gerente@demo.com", Role.MANAGER),
    ("Olívia Operadora", "operador@demo.com", Role.OPERATOR),
    ("Vítor Visitante", "leitura@demo.com", Role.VIEWER),
]
DEMO_PASSWORD = "demo1234"

CATEGORIES = ["Escritório", "Informática", "Limpeza", "Ferramentas", "EPI", "Elétrica"]
WAREHOUSES = [
    ("ALM", "Almoxarifado Central", "Depósito principal"),
    ("TI", "Sala de TI", "Peças e periféricos de informática"),
    ("OFI", "Oficina", "Ferramentas e materiais de manutenção"),
]
# nome, documento, contato, prazo de entrega (dias)
SUPPLIERS = [
    ("Distribuidora Horizonte Ltda", "12.345.678/0001-90", "Marcos", 5),
    ("TecnoParts Informática", "23.456.789/0001-01", "Juliana", 10),
    ("LimpaBem Produtos de Limpeza", "34.567.890/0001-12", "Rita", 3),
    ("Ferragens Aurora", "45.678.901/0001-23", "Paulo", 7),
    ("Segura EPI Equipamentos", "56.789.012/0001-34", "Cláudia", 12),
]


@dataclass
class Spec:
    sku: str
    name: str
    category: str
    supplier: int
    warehouse: str
    unit: str
    cost: float
    price: float
    min_stock: int
    daily: float  # consumo médio diário
    intermittent: bool = False
    trend: float = 0.0  # variação relativa do consumo ao longo do período


SPECS = [
    Spec(
        "ESC-PAP-A4",
        "Papel sulfite A4 75g (500 folhas)",
        "Escritório",
        0,
        "ALM",
        "PCT",
        21.9,
        32.0,
        40,
        4.2,
        trend=0.15,
    ),
    Spec(
        "ESC-CAN-AZ", "Caneta esferográfica azul", "Escritório", 0, "ALM", "UN", 0.95, 2.2, 120, 9.0
    ),
    Spec(
        "ESC-CAN-PT", "Caneta esferográfica preta", "Escritório", 0, "ALM", "UN", 0.95, 2.2, 80, 5.5
    ),
    Spec(
        "ESC-GRA-266",
        "Grampos 26/6 (caixa com 5000)",
        "Escritório",
        0,
        "ALM",
        "CX",
        6.4,
        11.0,
        10,
        0.6,
    ),
    Spec("ESC-BLC-ADS", "Bloco adesivo 76x76mm", "Escritório", 0, "ALM", "UN", 4.1, 7.5, 30, 1.8),
    Spec(
        "ESC-PST-SUS",
        "Pasta suspensa marmorizada",
        "Escritório",
        0,
        "ALM",
        "UN",
        2.3,
        4.9,
        50,
        1.2,
        intermittent=True,
    ),
    Spec(
        "ESC-TON-PRT",
        "Toner laser preto compatível",
        "Escritório",
        1,
        "TI",
        "UN",
        89.0,
        149.0,
        6,
        0.35,
        intermittent=True,
    ),
    Spec("INF-MOU-USB", "Mouse óptico USB", "Informática", 1, "TI", "UN", 24.5, 49.9, 10, 0.55),
    Spec("INF-TEC-ABN", "Teclado USB ABNT2", "Informática", 1, "TI", "UN", 42.0, 79.9, 8, 0.4),
    Spec("INF-HDM-2M", "Cabo HDMI 2 metros", "Informática", 1, "TI", "UN", 15.8, 34.9, 12, 0.45),
    Spec(
        "INF-CAB-C6",
        "Cabo de rede Cat6",
        "Informática",
        1,
        "TI",
        "M",
        2.1,
        4.5,
        150,
        6.0,
        intermittent=True,
    ),
    Spec(
        "INF-SSD-480",
        "SSD SATA 480 GB",
        "Informática",
        1,
        "TI",
        "UN",
        189.0,
        299.0,
        4,
        0.18,
        intermittent=True,
    ),
    Spec(
        "INF-RAM-8G",
        "Memória RAM 8 GB DDR4",
        "Informática",
        1,
        "TI",
        "UN",
        129.0,
        219.0,
        4,
        0.15,
        intermittent=True,
    ),
    Spec(
        "INF-MON-24",
        "Monitor LED 24 polegadas",
        "Informática",
        1,
        "TI",
        "UN",
        649.0,
        999.0,
        2,
        0.07,
        intermittent=True,
    ),
    Spec(
        "INF-HST-USB",
        "Headset USB com microfone",
        "Informática",
        1,
        "TI",
        "UN",
        79.0,
        139.0,
        6,
        0.3,
        trend=0.6,
    ),
    Spec("INF-PEN-64", "Pendrive 64 GB", "Informática", 1, "TI", "UN", 32.0, 59.9, 10, 0.5),
    Spec("LIM-DET-500", "Detergente neutro 500 ml", "Limpeza", 2, "ALM", "UN", 2.6, 4.5, 48, 3.2),
    Spec(
        "LIM-ALC-70",
        "Álcool 70% 1 litro",
        "Limpeza",
        2,
        "ALM",
        "UN",
        8.9,
        14.9,
        36,
        2.6,
        trend=-0.2,
    ),
    Spec(
        "LIM-PTO-FD",
        "Papel toalha interfolhado (fardo)",
        "Limpeza",
        2,
        "ALM",
        "FD",
        54.0,
        79.0,
        15,
        1.1,
    ),
    Spec(
        "LIM-SAC-100",
        "Saco de lixo 100 L (pacote com 100)",
        "Limpeza",
        2,
        "ALM",
        "PCT",
        39.0,
        62.0,
        10,
        0.7,
    ),
    Spec("LIM-DSF-2L", "Desinfetante 2 litros", "Limpeza", 2, "ALM", "UN", 7.4, 12.9, 24, 1.5),
    Spec(
        "FER-CHV-PHI",
        "Chave Phillips 1/4 x 6",
        "Ferramentas",
        3,
        "OFI",
        "UN",
        12.5,
        24.0,
        5,
        0.12,
        intermittent=True,
    ),
    Spec(
        "FER-FIT-ISO",
        "Fita isolante 19 mm x 20 m",
        "Ferramentas",
        3,
        "OFI",
        "UN",
        5.8,
        10.9,
        20,
        0.9,
    ),
    Spec(
        "FER-BRC-6",
        "Broca para concreto 6 mm",
        "Ferramentas",
        3,
        "OFI",
        "UN",
        6.9,
        13.5,
        10,
        0.35,
        intermittent=True,
    ),
    Spec(
        "FER-FUR-IMP",
        "Furadeira de impacto 650 W",
        "Ferramentas",
        3,
        "OFI",
        "UN",
        289.0,
        449.0,
        1,
        0.03,
        intermittent=True,
    ),
    Spec(
        "EPI-LUV-NIT", "Luva nitrílica (caixa com 100)", "EPI", 4, "ALM", "CX", 38.0, 59.0, 12, 0.8
    ),
    Spec("EPI-MSK-PFF2", "Máscara PFF2", "EPI", 4, "ALM", "UN", 2.9, 6.5, 100, 6.5, trend=-0.3),
    Spec("EPI-OCU-PRO", "Óculos de proteção incolor", "EPI", 4, "OFI", "UN", 9.8, 18.9, 10, 0.3),
    Spec("EPI-PRT-AUR", "Protetor auricular tipo plug", "EPI", 4, "OFI", "PAR", 1.6, 3.9, 60, 2.4),
    Spec(
        "ELE-PIL-AA",
        "Pilha alcalina AA (pacote com 4)",
        "Elétrica",
        3,
        "ALM",
        "PCT",
        14.9,
        24.9,
        15,
        0.9,
    ),
    Spec("ELE-LAM-9W", "Lâmpada LED bulbo 9 W", "Elétrica", 3, "OFI", "UN", 7.2, 13.9, 20, 0.6),
    Spec(
        "ELE-EXT-5M",
        "Extensão elétrica 5 metros",
        "Elétrica",
        3,
        "OFI",
        "UN",
        34.0,
        59.0,
        4,
        0.1,
        intermittent=True,
    ),
]


def _ean13(rng: random.Random) -> str:
    digits = [7, 8, 9] + [rng.randint(0, 9) for _ in range(9)]
    total = sum(d * (3 if i % 2 else 1) for i, d in enumerate(digits))
    return "".join(map(str, digits)) + str((10 - total % 10) % 10)


def _at(day: datetime, rng: random.Random) -> datetime:
    """Horário comercial aleatório (8h–18h no fuso local) convertido para UTC."""
    local = datetime.combine(day.date(), time(8), tzinfo=local_tz()) + timedelta(
        minutes=rng.randint(0, 600)
    )
    return local.astimezone(UTC)


def _qty(value: float, unit: str) -> Decimal:
    if unit in {"M"}:
        return Decimal(str(round(value, 1)))
    return Decimal(max(round(value), 0))


def ensure_demo_users(db: Session) -> list[User]:
    users = []
    for name, email, role in DEMO_USERS:
        user = db.scalar(select(User).where(User.email == email))
        if user is None:
            user = User(
                name=name,
                email=email,
                password_hash=hash_password(DEMO_PASSWORD),
                role=role,
                is_demo=True,
            )
            db.add(user)
        users.append(user)
    db.flush()
    return users


def seed_demo(seed: int = 42) -> None:
    rng = random.Random(seed)
    alerts.set_dispatch_enabled(False)
    today = datetime.now(local_tz()).replace(hour=0, minute=0, second=0, microsecond=0)
    start = today - timedelta(days=DAYS)
    try:
        with SessionLocal() as db:
            users = ensure_demo_users(db)
            manager, operator = users[1], users[2]
            save_general_settings(db, GeneralSettings(company_name="Idealization Demo S.A."))

            set_clock(_at(start, rng))
            categories = {name: Category(name=name) for name in CATEGORIES}
            warehouses = {
                code: Warehouse(code=code, name=name, description=desc)
                for code, name, desc in WAREHOUSES
            }
            suppliers = [
                Supplier(
                    name=name,
                    document=doc,
                    contact_name=contact,
                    email=f"vendas{i + 1}@fornecedor-exemplo.com.br",
                    phone=f"(81) 3{rng.randint(100, 999)}-{rng.randint(1000, 9999)}",
                    lead_time_days=lead,
                )
                for i, (name, doc, contact, lead) in enumerate(SUPPLIERS)
            ]
            db.add_all([*categories.values(), *warehouses.values(), *suppliers])
            db.flush()

            products: dict[str, Product] = {}
            for spec in SPECS:
                product = Product(
                    sku=spec.sku,
                    barcode=_ean13(rng),
                    name=spec.name,
                    unit=spec.unit,
                    category_id=categories[spec.category].id,
                    supplier_id=suppliers[spec.supplier].id,
                    sale_price=Decimal(str(spec.price)),
                    min_stock=Decimal(spec.min_stock),
                    max_stock=Decimal(spec.min_stock * 6) if spec.min_stock >= 4 else None,
                )
                db.add(product)
                products[spec.sku] = product
            db.flush()

            # Estoque inicial
            for spec in SPECS:
                initial = max(spec.min_stock * 2, spec.daily * 25)
                inventory.register_entry(
                    db,
                    product_id=products[spec.sku].id,
                    warehouse_id=warehouses[spec.warehouse].id,
                    quantity=_qty(initial, spec.unit) or Decimal(1),
                    unit_cost=Decimal(str(spec.cost)),
                    user=manager,
                    reference="Saldo inicial",
                )
            db.commit()

            pending: list[tuple[datetime, PurchaseOrder]] = []
            for day_index in range(1, DAYS + 1):
                day = start + timedelta(days=day_index)
                weekend = day.weekday() >= 5
                progress = day_index / DAYS

                # Recebimentos previstos para hoje
                for arrival, order in [p for p in pending if p[0].date() <= day.date()]:
                    pending.remove((arrival, order))
                    if day_index == DAYS and rng.random() < 0.5:
                        pending.append((arrival + timedelta(days=3), order))
                        continue
                    set_clock(_at(day, rng))
                    db.refresh(order)
                    partial = rng.random() < 0.12 and order.status == PurchaseOrderStatus.ORDERED
                    receipts = []
                    for item in order.items:
                        qty = item.quantity_pending
                        if partial:
                            qty = (qty * Decimal("0.6")).quantize(
                                Decimal(1), rounding=ROUND_HALF_UP
                            )
                        if qty > 0:
                            cost = item.unit_cost * Decimal(str(round(rng.uniform(0.97, 1.05), 3)))
                            receipts.append(
                                ReceiveItem(
                                    item_id=item.id,
                                    quantity=qty,
                                    unit_cost=cost.quantize(Decimal("0.01")),
                                )
                            )
                    if receipts:
                        purchasing.receive_order(
                            db, order, receipts, user=operator, notes="NF recebida"
                        )
                    if order.status == PurchaseOrderStatus.PARTIALLY_RECEIVED:
                        pending.append((day + timedelta(days=rng.randint(2, 5)), order))

                # Consumo do dia
                for spec in SPECS:
                    product = products[spec.sku]
                    rate = (
                        spec.daily
                        * (1 + spec.trend * (progress - 0.5))
                        * (0.25 if weekend else 1.15)
                    )
                    if spec.intermittent:
                        happens = rng.random() < min(0.9, rate / max(spec.daily * 3, 0.5) + 0.05)
                        value = rng.uniform(1, max(2, spec.daily * 4)) if happens else 0
                    else:
                        value = max(0.0, rng.gauss(rate, rate * 0.45))
                    quantity = _qty(value, spec.unit)
                    if quantity <= 0:
                        continue
                    warehouse = warehouses[spec.warehouse]
                    available = inventory.total_quantity(db, product.id)
                    quantity = min(quantity, available)
                    if quantity <= 0:
                        continue
                    set_clock(_at(day, rng))
                    try:
                        inventory.register_exit(
                            db,
                            product_id=product.id,
                            warehouse_id=warehouse.id,
                            quantity=quantity,
                            user=operator,
                            reference=rng.choice(
                                ["Requisição", "Requisição", "Manutenção", "Setor adm.", "Projeto"]
                            ),
                        )
                    except InsufficientStockError:
                        continue

                # Transferências ocasionais do almoxarifado para a oficina
                if not weekend and rng.random() < 0.15:
                    spec = rng.choice([s for s in SPECS if s.warehouse == "ALM"])
                    product = products[spec.sku]
                    qty = _qty(max(1, spec.daily * 2), spec.unit)
                    set_clock(_at(day, rng))
                    with contextlib.suppress(InsufficientStockError):
                        inventory.transfer(
                            db,
                            product_id=product.id,
                            from_warehouse_id=warehouses["ALM"].id,
                            to_warehouse_id=warehouses["OFI"].id,
                            quantity=qty,
                            user=operator,
                            notes="Abastecimento da oficina",
                        )

                # Ajustes de inventário mensais
                if day_index % 30 == 0:
                    for spec in rng.sample(SPECS, 3):
                        level = inventory._locked_level(
                            db, products[spec.sku].id, warehouses[spec.warehouse].id
                        )
                        counted = max(level.quantity + rng.choice([-2, -1, 1]), Decimal(0))
                        set_clock(_at(day, rng))
                        inventory.adjust(
                            db,
                            product_id=products[spec.sku].id,
                            warehouse_id=warehouses[spec.warehouse].id,
                            counted_quantity=counted,
                            user=manager,
                            notes="Contagem cíclica mensal",
                        )

                # Política de reposição: pede quando saldo + pedidos em aberto ≤ mínimo
                if not weekend:
                    on_order: dict[int, Decimal] = {}
                    for _, order in pending:
                        for item in order.items:
                            on_order[item.product_id] = (
                                on_order.get(item.product_id, Decimal(0)) + item.quantity_pending
                            )
                    # Um pedido por fornecedor e depósito de destino
                    to_order: dict[tuple[int, str], list[PurchaseOrderItemIn]] = {}
                    for spec in SPECS:
                        product = products[spec.sku]
                        position = inventory.total_quantity(db, product.id) + on_order.get(
                            product.id, Decimal(0)
                        )
                        if position <= spec.min_stock and rng.random() < 0.8:
                            qty = _qty(max(spec.min_stock * 1.5, spec.daily * 30), spec.unit)
                            to_order.setdefault((spec.supplier, spec.warehouse), []).append(
                                PurchaseOrderItemIn(
                                    product_id=product.id,
                                    quantity_ordered=qty,
                                    unit_cost=Decimal(str(spec.cost)),
                                )
                            )
                    for (supplier_index, warehouse_code), items in to_order.items():
                        supplier = suppliers[supplier_index]
                        set_clock(_at(day, rng))
                        order = purchasing.create_order(
                            db,
                            supplier_id=supplier.id,
                            warehouse_id=warehouses[warehouse_code].id,
                            items=items,
                            user=manager,
                            expected_date=(day + timedelta(days=supplier.lead_time_days)).date(),
                        )
                        purchasing.submit_order(db, order)
                        arrival = day + timedelta(days=supplier.lead_time_days + rng.randint(-1, 3))
                        pending.append((arrival, order))
                db.commit()

            # Alguns pedidos em rascunho e um cancelado para a tela de compras
            set_clock(_at(today, rng))
            draft = purchasing.create_order(
                db,
                supplier_id=suppliers[0].id,
                warehouse_id=warehouses["ALM"].id,
                items=[
                    PurchaseOrderItemIn(
                        product_id=products["ESC-BLC-ADS"].id,
                        quantity_ordered=Decimal(60),
                        unit_cost=Decimal("4.10"),
                    ),
                    PurchaseOrderItemIn(
                        product_id=products["ESC-PST-SUS"].id,
                        quantity_ordered=Decimal(100),
                        unit_cost=Decimal("2.30"),
                    ),
                ],
                user=manager,
                notes="Aguardando aprovação do orçamento.",
            )
            cancelled = purchasing.create_order(
                db,
                supplier_id=suppliers[3].id,
                warehouse_id=warehouses["OFI"].id,
                items=[
                    PurchaseOrderItemIn(
                        product_id=products["FER-FUR-IMP"].id,
                        quantity_ordered=Decimal(2),
                        unit_cost=Decimal("289"),
                    )
                ],
                user=manager,
            )
            purchasing.cancel_order(db, cancelled)
            db.commit()
            logger.info("Dados de demonstração criados (%s, %s)", draft.number, cancelled.number)
    finally:
        set_clock(None)
        alerts.set_dispatch_enabled(True)


def reset_demo() -> None:
    """Apaga todos os dados e gera a demonstração de novo (usado pelo cron do ambiente online)."""
    from sqlalchemy import delete

    from app.core.database import engine
    from app.models import Base

    with engine.begin() as connection:
        for table in reversed(Base.metadata.sorted_tables):
            connection.execute(delete(table))
    seed_demo()


def main() -> None:
    from app.bootstrap import run_migrations

    logging.basicConfig(level=logging.INFO)
    run_migrations()
    with SessionLocal() as db:
        if db.scalar(select(func.count()).select_from(Product)):
            logger.warning("O banco já tem produtos; nada foi gerado.")
            return
    seed_demo()
    print(f"Pronto! Entre com admin@demo.com / {DEMO_PASSWORD}")


if __name__ == "__main__":
    main()
