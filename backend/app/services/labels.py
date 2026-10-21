"""Etiquetas em PDF com código de barras Code 128 e QR Code, desenhados como vetores."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Literal

import segno
from barcode import Code128
from fpdf import FPDF

from app.models import Product
from app.services.reports import _latin1

Layout = Literal["a4-3x8", "a4-2x5"]


@dataclass(frozen=True)
class Sheet:
    cols: int
    rows: int
    label_w: float
    label_h: float
    margin_x: float
    margin_y: float
    gap_x: float
    gap_y: float


SHEETS: dict[str, Sheet] = {
    # 24 etiquetas 70 × 37 mm (padrão de folhas A4 adesivas)
    "a4-3x8": Sheet(3, 8, 70, 37, 0, 0.5, 0, 0),
    # 10 etiquetas 99 × 57 mm, para prateleiras
    "a4-2x5": Sheet(2, 5, 99, 57, 6, 6, 0, 0),
}


def _draw_code128(pdf: FPDF, data: str, x: float, y: float, w: float, h: float) -> None:
    modules = Code128(data).build()[0]
    module_w = w / len(modules)
    run_start = None
    for i, bit in enumerate(modules + "0"):
        if bit == "1" and run_start is None:
            run_start = i
        elif bit == "0" and run_start is not None:
            pdf.rect(x + run_start * module_w, y, (i - run_start) * module_w, h, style="F")
            run_start = None


def _draw_qr(pdf: FPDF, data: str, x: float, y: float, size: float) -> None:
    qr = segno.make(data, error="m", micro=False)
    matrix = [list(row) for row in qr.matrix_iter(scale=1, border=0)]
    cell = size / len(matrix)
    for r, row in enumerate(matrix):
        for c, dark in enumerate(row):
            if dark:
                # leve sobreposição evita linhas brancas entre os módulos em alguns visualizadores
                pdf.rect(x + c * cell, y + r * cell, cell + 0.02, cell + 0.02, style="F")


def _label(pdf: FPDF, product: Product, sheet: Sheet, x: float, y: float) -> None:
    pad = 3
    code = product.barcode or product.sku
    inner_w = sheet.label_w - 2 * pad
    qr_size = min(sheet.label_h - 2 * pad, inner_w * 0.32)
    text_w = inner_w - qr_size - 2

    pdf.set_xy(x + pad, y + pad)
    pdf.set_font("Helvetica", "B", 8 if sheet.label_h < 45 else 11)
    pdf.multi_cell(
        text_w,
        3.6 if sheet.label_h < 45 else 5,
        _latin1(product.name[:60]),
        max_line_height=4,
        align="L",
    )
    pdf.set_font("Helvetica", "", 7 if sheet.label_h < 45 else 9)
    pdf.set_x(x + pad)
    pdf.cell(text_w, 4, _latin1(f"SKU {product.sku}  |  {product.unit}"))

    bar_h = sheet.label_h * 0.28
    bar_y = y + sheet.label_h - pad - bar_h - 3
    _draw_code128(pdf, code, x + pad, bar_y, text_w, bar_h)
    pdf.set_font("Helvetica", "", 6.5)
    pdf.set_xy(x + pad, bar_y + bar_h + 0.3)
    pdf.cell(text_w, 2.8, _latin1(code), align="C")

    _draw_qr(
        pdf, code, x + sheet.label_w - pad - qr_size, y + (sheet.label_h - qr_size) / 2, qr_size
    )


def labels_pdf(products: list[Product], copies: int = 1, layout: Layout = "a4-3x8") -> bytes:
    sheet = SHEETS[layout]
    pdf = FPDF(unit="mm", format="A4")
    pdf.set_auto_page_break(False)
    pdf.set_fill_color(0, 0, 0)
    per_page = sheet.cols * sheet.rows
    queue = [p for p in products for _ in range(copies)]
    for index, product in enumerate(queue):
        slot = index % per_page
        if slot == 0:
            pdf.add_page()
        col, row = slot % sheet.cols, slot // sheet.cols
        x = sheet.margin_x + col * (sheet.label_w + sheet.gap_x)
        y = sheet.margin_y + row * (sheet.label_h + sheet.gap_y)
        _label(pdf, product, sheet, x, y)
    if not queue:
        pdf.add_page()
    return bytes(pdf.output())
