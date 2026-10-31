import io
from datetime import datetime, timezone
from xml.sax.saxutils import escape

from PIL import Image as PillowImage
from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Image, Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from services.inference import CLASS_NAMES

INK = colors.HexColor("#172b3a")
ACCENT = colors.HexColor("#11869a")
PALE = colors.HexColor("#eef4f6")
DISCLAIMER = (
    "AI-generated findings are for assistance only and are not a diagnosis. "
    "A qualified dental professional must review the original image and all results."
)


def scaled_image(data: bytes, max_width: float, max_height: float) -> Image:
    with PillowImage.open(io.BytesIO(data)) as source:
        width, height = source.size
    scale = min(max_width / width, max_height / height)
    return Image(io.BytesIO(data), width * scale, height * scale)


def table_style() -> TableStyle:
    return TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), INK),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("FONTSIZE", (0, 0), (-1, -1), 7.5),
            ("GRID", (0, 0), (-1, -1), 0.35, colors.HexColor("#ccd8de")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, PALE]),
            ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
            ("LEFTPADDING", (0, 0), (-1, -1), 5),
            ("RIGHTPADDING", (0, 0), (-1, -1), 5),
            ("TOPPADDING", (0, 0), (-1, -1), 4),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
        ]
    )


def create_report(
    analysis: dict, original: bytes, annotated: bytes, model_info: dict
) -> bytes:
    output = io.BytesIO()
    margin = 0.55 * inch
    document = SimpleDocTemplate(
        output,
        pagesize=letter,
        leftMargin=margin,
        rightMargin=margin,
        topMargin=0.6 * inch,
        bottomMargin=0.65 * inch,
        title="Dental AI Analysis Report",
        author="Dental AI Workstation",
    )
    styles = getSampleStyleSheet()
    styles.add(
        ParagraphStyle(
            "DentalTitle",
            parent=styles["Title"],
            textColor=INK,
            fontSize=19,
            leading=23,
            alignment=TA_CENTER,
            spaceAfter=6,
        )
    )
    styles.add(
        ParagraphStyle(
            "DentalSection",
            parent=styles["Heading2"],
            textColor=INK,
            fontSize=11,
            leading=14,
            spaceBefore=10,
            spaceAfter=5,
        )
    )
    styles.add(ParagraphStyle("DentalSmall", parent=styles["BodyText"], fontSize=8, leading=11))

    counts = analysis["class_counts"]
    story = [
        Paragraph("Dental AI Analysis Report", styles["DentalTitle"]),
        Paragraph(
            f"Generated {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')} "
            f"&nbsp; · &nbsp; {escape(analysis['filename'])}",
            styles["DentalSmall"],
        ),
        Spacer(1, 10),
    ]
    pictures = Table(
        [[scaled_image(original, 3.45 * inch, 2.2 * inch),
          scaled_image(annotated, 3.45 * inch, 2.2 * inch)]],
        colWidths=[3.6 * inch, 3.6 * inch],
        hAlign="CENTER",
    )
    pictures.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, -1), PALE),
                ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#cbd8de")),
                ("INNERGRID", (0, 0), (-1, -1), 0.5, colors.white),
                ("ALIGN", (0, 0), (-1, -1), "CENTER"),
                ("VALIGN", (0, 0), (-1, -1), "MIDDLE"),
                ("TOPPADDING", (0, 0), (-1, -1), 6),
                ("BOTTOMPADDING", (0, 0), (-1, -1), 6),
            ]
        )
    )
    story.extend(
        [
            pictures,
            Table(
                [["Original radiograph", "Model annotation"]],
                colWidths=[3.6 * inch, 3.6 * inch],
                style=TableStyle([("ALIGN", (0, 0), (-1, -1), "CENTER"), ("FONTSIZE", (0, 0), (-1, -1), 8)]),
            ),
            Paragraph("Analysis summary", styles["DentalSection"]),
            Paragraph(
                f"Detections: <b>{analysis['total_detections']}</b> &nbsp; · &nbsp; "
                f"Distinct classes: <b>{analysis['distinct_classes']}</b> &nbsp; · &nbsp; "
                f"Image: <b>{analysis['image_width']} × {analysis['image_height']} px</b> "
                f"&nbsp; · &nbsp; Inference: <b>{analysis['inference_ms']:.2f} ms</b>",
                styles["DentalSmall"],
            ),
            Paragraph("Class summary", styles["DentalSection"]),
        ]
    )
    summary_rows = [["ID", "Exact class name", "Count"]]
    for class_id, class_name in CLASS_NAMES.items():
        summary_rows.append(
            [str(class_id), class_name, str(counts.get(class_id, counts.get(str(class_id), 0)))]
        )
    summary = Table(summary_rows, colWidths=[0.5 * inch, 3.2 * inch, 0.65 * inch], repeatRows=1)
    summary.setStyle(table_style())
    story.extend([summary, Paragraph("Detection details", styles["DentalSection"])])

    rows = [
        [
            "#",
            "ID",
            "Exact class",
            "Confidence",
            "Source",
            "Tooth (FDI)",
            "X-min",
            "Y-min",
            "X-max",
            "Y-max",
        ]
    ]
    for detection in analysis["detections"]:
        box = detection["bbox"]
        rows.append(
            [
                str(detection["index"]),
                str(detection["class_id"]),
                detection["class_name"],
                f"{detection['confidence'] * 100:.1f}%",
                detection.get("source_model", "unknown"),
                str(detection.get("tooth_number") or "—"),
                *(f"{box[key]:.1f}" for key in ("x_min", "y_min", "x_max", "y_max")),
            ]
        )
    if len(rows) == 1:
        rows.append(["—", "—", "No detections returned.", "—", "—", "—", "—", "—", "—", "—"])
    details = Table(
        rows,
        colWidths=[
            0.3 * inch,
            0.35 * inch,
            1.3 * inch,
            0.65 * inch,
            0.65 * inch,
            0.65 * inch,
            0.55 * inch,
            0.55 * inch,
            0.55 * inch,
            0.55 * inch,
        ],
        repeatRows=1,
    )
    details.setStyle(table_style())
    model_lines = [
        f"Overall status: {model_info.get('status', 'unknown')}",
    ]
    for source, model in model_info.get("models", {}).items():
        mapping = ", ".join(
            f"{class_id}: {name}" for class_id, name in model.get("class_names", {}).items()
        )
        model_lines.append(
            f"{source} ({model.get('model_path', 'unknown')}): "
            f"{model.get('status', 'unknown')} · Classes: {mapping or 'unavailable'}"
        )
        if model.get("error"):
            model_lines.append(f"{source} error: {model['error']}")
    model_text = escape(" · ".join(model_lines))
    story.extend(
        [
            details,
            Paragraph("Model information", styles["DentalSection"]),
            Paragraph(model_text, styles["DentalSmall"]),
            Spacer(1, 8),
            Paragraph(f"<b>Clinical review notice.</b> {DISCLAIMER}", styles["DentalSmall"]),
        ]
    )

    def add_page_number(canvas, doc) -> None:
        canvas.saveState()
        canvas.setStrokeColor(colors.HexColor("#d6e0e5"))
        canvas.line(margin, 0.45 * inch, letter[0] - margin, 0.45 * inch)
        canvas.setFont("Helvetica", 8)
        canvas.setFillColor(colors.HexColor("#627480"))
        canvas.drawString(margin, 0.28 * inch, "Dental AI Workstation · For professional review")
        canvas.drawRightString(letter[0] - margin, 0.28 * inch, f"Page {doc.page}")
        canvas.restoreState()

    document.build(story, onFirstPage=add_page_number, onLaterPages=add_page_number)
    return output.getvalue()
