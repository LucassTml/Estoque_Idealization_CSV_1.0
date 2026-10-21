from enum import StrEnum


class Role(StrEnum):
    ADMIN = "admin"
    MANAGER = "manager"
    OPERATOR = "operator"
    VIEWER = "viewer"

    @property
    def level(self) -> int:
        return _ROLE_LEVEL[self]


_ROLE_LEVEL = {Role.VIEWER: 0, Role.OPERATOR: 1, Role.MANAGER: 2, Role.ADMIN: 3}


class MovementType(StrEnum):
    ENTRY = "entry"  # entrada avulsa (doação, devolução, produção...)
    EXIT = "exit"  # saída / consumo / venda
    TRANSFER_OUT = "transfer_out"
    TRANSFER_IN = "transfer_in"
    ADJUSTMENT = "adjustment"  # ajuste de inventário (contagem física)
    RECEIPT = "receipt"  # recebimento de pedido de compra


class PurchaseOrderStatus(StrEnum):
    DRAFT = "draft"
    ORDERED = "ordered"
    PARTIALLY_RECEIVED = "partially_received"
    RECEIVED = "received"
    CANCELLED = "cancelled"


class AlertKind(StrEnum):
    LOW_STOCK = "low_stock"
    OUT_OF_STOCK = "out_of_stock"
