from __future__ import annotations

import math
from decimal import Decimal
from typing import Annotated

from pydantic import BaseModel, ConfigDict, Field, PlainSerializer

# Decimais trafegam como número no JSON (o padrão do Pydantic é string).
Num = Annotated[Decimal, PlainSerializer(float, return_type=float, when_used="json")]
Qty = Annotated[
    Decimal,
    Field(max_digits=14, decimal_places=3),
    PlainSerializer(float, return_type=float, when_used="json"),
]
PositiveQty = Annotated[
    Decimal,
    Field(gt=0, max_digits=14, decimal_places=3),
    PlainSerializer(float, return_type=float, when_used="json"),
]
Money = Annotated[
    Decimal,
    Field(ge=0, max_digits=14, decimal_places=4),
    PlainSerializer(float, return_type=float, when_used="json"),
]


class ORMModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)


class Page[T](BaseModel):
    items: list[T]
    total: int
    page: int
    page_size: int
    pages: int

    @classmethod
    def build(cls, items: list[T], total: int, page: int, page_size: int) -> Page[T]:
        return cls(
            items=items,
            total=total,
            page=page,
            page_size=page_size,
            pages=max(1, math.ceil(total / page_size)) if page_size else 1,
        )


class Message(BaseModel):
    detail: str


class IdName(ORMModel):
    id: int
    name: str
