import base64
import io
import logging
import os
import time
import uuid
from datetime import datetime, timezone
from pathlib import Path
from threading import Lock

from fastapi import FastAPI, File, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import Response
from PIL import Image, UnidentifiedImageError
from pydantic import BaseModel
from starlette.concurrency import run_in_threadpool

from services.inference import CLASS_NAMES, DentalInference
from services.pdf_report import create_report

logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
logger = logging.getLogger("dental-workstation")

BACKEND_DIR = Path(__file__).resolve().parent
MODELS_DIR = BACKEND_DIR / "models"
MAX_UPLOAD_BYTES = int(os.getenv("MAX_UPLOAD_MB", "20")) * 1024 * 1024
MAX_IMAGE_PIXELS = 40_000_000
ANALYSIS_TTL_SECONDS = 30 * 60
MAX_CACHED_ANALYSES = 8

app = FastAPI(title="Dental AI Workstation", version="1.0.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173"
        ).split(",")
        if origin.strip()
    ],
    allow_credentials=False,
    allow_methods=["GET", "POST"],
    allow_headers=["Content-Type"],
)

inference = DentalInference(MODELS_DIR)
analysis_records: dict[str, dict] = {}
records_lock = Lock()


@app.on_event("startup")
def load_model() -> None:
    inference.load()
    for source, model in inference.status()["models"].items():
        if model["available"]:
            logger.info("Loaded and verified %s checkpoint at %s", source, model["model_path"])
        else:
            logger.error("%s model unavailable: %s", source, model["error"])


@app.get("/api/health")
def health() -> dict:
    return {
        "status": "ok",
        "backend": "connected",
        "model": inference.status(),
    }


@app.get("/api/model-info")
def model_info() -> dict:
    return {
        **inference.status(),
        "class_names": CLASS_NAMES,
        "class_ids": list(CLASS_NAMES),
        "confidence_threshold": inference.confidence,
        "iou_threshold": inference.iou,
        "merge_iou_threshold": inference.merge_iou,
    }


def clean_filename(filename: str | None) -> str:
    return (filename or "xray").replace("\\", "/").rsplit("/", 1)[-1] or "xray"


async def decode_xray(upload: UploadFile) -> tuple[Image.Image, bytes, str]:
    filename = clean_filename(upload.filename)
    if Path(filename).suffix.lower() not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=415, detail="Upload a PNG, JPG, or JPEG image.")
    content = await upload.read(MAX_UPLOAD_BYTES + 1)
    if not content:
        raise HTTPException(status_code=400, detail="The uploaded image is empty.")
    if len(content) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail=f"Images must be smaller than {MAX_UPLOAD_BYTES // (1024 * 1024)} MB.",
        )
    try:
        with Image.open(io.BytesIO(content)) as source:
            source.verify()
        with Image.open(io.BytesIO(content)) as source:
            if source.width * source.height > MAX_IMAGE_PIXELS:
                raise HTTPException(
                    status_code=413, detail="Image dimensions exceed the 40-megapixel limit."
                )
            image = source.convert("RGB")
            image.load()
    except Image.DecompressionBombError as exc:
        raise HTTPException(status_code=413, detail="Image dimensions are unsafe to decode.") from exc
    except (UnidentifiedImageError, OSError, ValueError) as exc:
        raise HTTPException(
            status_code=400, detail="The uploaded file is not a readable image."
        ) from exc
    return image, content, filename


def prune_records(now: float) -> None:
    expired = [
        key
        for key, record in analysis_records.items()
        if now - record["created_at_epoch"] > ANALYSIS_TTL_SECONDS
    ]
    for key in expired:
        del analysis_records[key]
    while len(analysis_records) >= MAX_CACHED_ANALYSES:
        oldest_key = min(
            analysis_records,
            key=lambda key: analysis_records[key]["created_at_epoch"],
        )
        del analysis_records[oldest_key]


@app.post("/api/analyze")
async def analyze(file: UploadFile = File(...)) -> dict:
    try:
        image, original_bytes, filename = await decode_xray(file)
    finally:
        await file.close()
    if not inference.available:
        raise HTTPException(
            status_code=503,
            detail=inference.status()["error"] or "No compatible YOLO model is available.",
        )

    try:
        result = await run_in_threadpool(inference.predict, image)
    except Exception as exc:
        logger.exception("YOLO inference failed")
        raise HTTPException(
            status_code=500,
            detail=f"YOLO inference failed ({type(exc).__name__}). Check the backend log.",
        ) from exc

    annotated_bytes = result.pop("annotated_bytes")
    created_at = datetime.now(timezone.utc)
    analysis_id = uuid.uuid4().hex
    response = {
        "analysis_id": analysis_id,
        "filename": filename,
        "created_at": created_at.isoformat(),
        "image_width": image.width,
        "image_height": image.height,
        "class_names": CLASS_NAMES,
        "confidence_threshold": inference.confidence,
        "iou_threshold": inference.iou,
        **result,
        "annotated_image": "data:image/png;base64,"
        + base64.b64encode(annotated_bytes).decode("ascii"),
    }
    now = time.time()
    with records_lock:
        prune_records(now)
        analysis_records[analysis_id] = {
            "created_at_epoch": now,
            "analysis": response,
            "original": original_bytes,
            "annotated": annotated_bytes,
            "model": inference.status(),
        }
    return response


class ReportRequest(BaseModel):
    analysis_id: str


@app.post("/api/report")
def download_report(request: ReportRequest) -> Response:
    with records_lock:
        record = analysis_records.get(request.analysis_id)
        if record is not None and time.time() - record["created_at_epoch"] > ANALYSIS_TTL_SECONDS:
            del analysis_records[request.analysis_id]
            record = None
    if record is None:
        raise HTTPException(
            status_code=404,
            detail="Analysis not found or expired. Analyze this image again before generating a report.",
        )
    try:
        pdf = create_report(
            record["analysis"],
            record["original"],
            record["annotated"],
            record["model"],
        )
    except Exception as exc:
        logger.exception("PDF generation failed")
        raise HTTPException(
            status_code=500,
            detail=f"Could not create the report ({type(exc).__name__}). Check the backend log.",
        ) from exc
    return Response(
        content=pdf,
        media_type="application/pdf",
        headers={"Content-Disposition": 'attachment; filename="Dental_AI_Report.pdf"'},
    )
