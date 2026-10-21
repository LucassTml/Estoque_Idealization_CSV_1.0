"""Etiquetas, importação/exportação de planilhas."""

from __future__ import annotations

from dataclasses import asdict
from typing import Annotated, Any, Literal

from fastapi import APIRouter, File, Request, Response, UploadFile
from pydantic import BaseModel, Field
from sqlalchemy import select

from app.api.deps import DB, Manager, Viewer, client_ip
from app.core.errors import BusinessRuleError
from app.models import Product
from app.services import audit, importer, labels, reports
from app.services.reports import Column, Report

router = APIRouter(tags=["Etiquetas e planilhas"])

MAX_UPLOAD_BYTES = 5 * 1024 * 1024


class LabelsRequest(BaseModel):
    product_ids: list[int] = Field(min_length=1, max_length=500)
    copies: int = Field(default=1, ge=1, le=50)
    layout: Literal["a4-3x8", "a4-2x5"] = "a4-3x8"


class ImportResultOut(BaseModel):
    created: int
    updated: int
    skipped: int
    warehouses_created: int
    stock_entries: int
    errors: list[dict[str, Any]]


async def _read_upload(file: UploadFile) -> bytes:
    content = await file.read(MAX_UPLOAD_BYTES + 1)
    if len(content) > MAX_UPLOAD_BYTES:
        raise BusinessRuleError("Arquivo maior que 5 MB.")
    if not content:
        raise BusinessRuleError("Arquivo vazio.")
    return content


@router.post("/labels/pdf", response_class=Response)
def labels_pdf(payload: LabelsRequest, db: DB, _: Viewer) -> Response:
    products = list(
        db.scalars(
            select(Product).where(Product.id.in_(payload.product_ids)).order_by(Product.name)
        )
    )
    if not products:
        raise BusinessRuleError("Nenhum produto encontrado.")
    content = labels.labels_pdf(products, payload.copies, payload.layout)
    return Response(
        content,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="etiquetas.pdf"'},
    )


@router.post("/import/legacy-csv", response_model=ImportResultOut)
async def import_legacy(
    db: DB, user: Manager, request: Request, file: Annotated[UploadFile, File()]
) -> ImportResultOut:
    """Importa o `estoque.csv` da versão 1.0 (formato `nome;serial;setor`)."""
    content = await _read_upload(file)
    result = importer.import_legacy_csv(db, content, user)
    audit.record(
        db,
        user=user,
        action="import",
        entity_type="product",
        summary=f"Importação v1.0: {result.created} produtos, {result.skipped} ignorados",
        ip_address=client_ip(request),
    )
    db.commit()
    return ImportResultOut(**asdict(result))


@router.post("/import/products", response_model=ImportResultOut)
async def import_products(
    db: DB, user: Manager, request: Request, file: Annotated[UploadFile, File()]
) -> ImportResultOut:
    """Importa produtos de CSV (`;` ou `,`) ou Excel. Linhas com erro são ignoradas e listadas."""
    content = await _read_upload(file)
    result = importer.import_products(db, file.filename or "upload.csv", content, user)
    audit.record(
        db,
        user=user,
        action="import",
        entity_type="product",
        summary=f"Importação de planilha: {result.created} criados, {result.updated} atualizados",
        ip_address=client_ip(request),
    )
    db.commit()
    return ImportResultOut(**asdict(result))


@router.get("/import/template", response_class=Response)
def import_template(_: Viewer, format: Literal["xlsx", "csv"] = "xlsx") -> Response:
    example = {
        "sku": "CAN-AZ-001",
        "nome": "Caneta esferográfica azul",
        "codigo_barras": "7890000000017",
        "categoria": "Escritório",
        "fornecedor": "Papelaria Exemplo",
        "unidade": "UN",
        "custo": 1.25,
        "preco_venda": 2.5,
        "estoque_minimo": 50,
        "estoque_maximo": 500,
        "deposito": "Almoxarifado",
        "quantidade": 120,
    }
    report = Report(
        "Modelo de importação",
        [Column(h, h, "text") for h in importer.TEMPLATE_HEADERS],
        [example],
        subtitle="Preencha uma linha por produto. Apenas sku e nome são obrigatórios.",
    )
    content = reports.render(report, format)
    return Response(
        content,
        media_type=reports.MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="modelo-produtos.{format}"'},
    )


@router.get("/export/products", response_class=Response)
def export_products(db: DB, _: Viewer, format: Literal["xlsx", "csv"] = "xlsx") -> Response:
    rows = importer.export_products(db)
    columns = [
        Column("sku", "sku"),
        Column("nome", "nome"),
        Column("codigo_barras", "codigo_barras"),
        Column("categoria", "categoria"),
        Column("fornecedor", "fornecedor"),
        Column("unidade", "unidade"),
        Column("custo", "custo", "money"),
        Column("preco_venda", "preco_venda", "money"),
        Column("estoque_minimo", "estoque_minimo", "qty"),
        Column("estoque_maximo", "estoque_maximo", "qty"),
        Column("estoque_atual", "estoque_atual", "qty"),
        Column("ativo", "ativo"),
    ]
    content = reports.render(Report("Produtos", columns, rows), format)
    return Response(
        content,
        media_type=reports.MEDIA_TYPES[format],
        headers={"Content-Disposition": f'attachment; filename="produtos.{format}"'},
    )
