import os
import time
from pathlib import Path
from typing import Any

import cv2
import numpy as np
from PIL import Image

CLASS_NAMES = {
    0: "Caries",
    1: "Infection",
    2: "Impacted",
    3: "BDC/BDR",
    4: "Fractured",
    5: "Healthy",
    6: "Deep Caries",
    7: "Periapical Lesion",
}
SIX_CLASS_NAMES = {class_id: CLASS_NAMES[class_id] for class_id in range(6)}
MODEL_CONFIG = {
    "8-class": {
        "filename": "best.pt",
        "expected_names": CLASS_NAMES,
    },
    "6-class": {
        "filename": "yolo26n.pt",
        "expected_names": SIX_CLASS_NAMES,
    },
}
BOX_COLORS = {
    "8-class": (255, 150, 45),
    "6-class": (55, 210, 255),
}
HEALTHY_CLASS_ID = 5


def normalize_names(raw_names: Any) -> dict[int, str] | None:
    if isinstance(raw_names, dict):
        try:
            return {int(key): str(value) for key, value in raw_names.items()}
        except (TypeError, ValueError):
            return None
    if isinstance(raw_names, (list, tuple)):
        return {index: str(value) for index, value in enumerate(raw_names)}
    return None


def box_iou(first: dict, second: dict) -> float:
    left = max(first["x_min"], second["x_min"])
    top = max(first["y_min"], second["y_min"])
    right = min(first["x_max"], second["x_max"])
    bottom = min(first["y_max"], second["y_max"])
    intersection = max(0.0, right - left) * max(0.0, bottom - top)
    first_area = max(0.0, first["x_max"] - first["x_min"]) * max(
        0.0, first["y_max"] - first["y_min"]
    )
    second_area = max(0.0, second["x_max"] - second["x_min"]) * max(
        0.0, second["y_max"] - second["y_min"]
    )
    union = first_area + second_area - intersection
    return intersection / union if union else 0.0


class DentalInference:
    def __init__(self, models_dir: Path) -> None:
        self.models_dir = models_dir.resolve()
        self.models: dict[str, Any | None] = {source: None for source in MODEL_CONFIG}
        self.model_names: dict[str, dict[int, str]] = {
            source: {} for source in MODEL_CONFIG
        }
        self.errors: dict[str, str | None] = {source: None for source in MODEL_CONFIG}
        self.confidence = float(os.getenv("YOLO_CONFIDENCE", "0.25"))
        self.iou = float(os.getenv("YOLO_IOU", "0.45"))
        self.merge_iou = float(os.getenv("YOLO_MERGE_IOU", "0.5"))
        if any(not 0 <= value <= 1 for value in (self.confidence, self.iou, self.merge_iou)):
            raise ValueError(
                "YOLO_CONFIDENCE, YOLO_IOU, and YOLO_MERGE_IOU must be between 0 and 1."
            )

    @property
    def available(self) -> bool:
        return any(model is not None for model in self.models.values())

    @property
    def complete(self) -> bool:
        return all(model is not None for model in self.models.values())

    def status(self) -> dict:
        model_status = {}
        for source, config in MODEL_CONFIG.items():
            model_status[source] = {
                "status": "ready" if self.models[source] is not None else "unavailable",
                "available": self.models[source] is not None,
                "model_file": config["filename"],
                "model_path": f"backend/models/{config['filename']}",
                "class_names": self.model_names[source],
                "class_ids": list(self.model_names[source]),
                "error": self.errors[source],
            }
        return {
            "status": "ready" if self.complete else "partial" if self.available else "unavailable",
            "available": self.available,
            "complete": self.complete,
            "model_file": "best.pt",
            "model_path": "backend/models/best.pt",
            "models": model_status,
            "error": "; ".join(
                f"{source}: {error}"
                for source, error in self.errors.items()
                if error is not None
            )
            or None,
        }

    def load(self) -> None:
        for source, config in MODEL_CONFIG.items():
            path = self.models_dir / config["filename"]
            self.models[source] = None
            self.model_names[source] = {}
            self.errors[source] = None
            if not path.is_file():
                self.errors[source] = (
                    f"Model file is missing: backend/models/{config['filename']}."
                )
                continue
            try:
                from ultralytics import YOLO

                candidate = YOLO(str(path), task="detect")
                actual = normalize_names(candidate.names)
                if actual is None:
                    self.errors[source] = (
                        f"Checkpoint backend/models/{config['filename']} does not "
                        "provide a supported class-name mapping."
                    )
                    continue
                self.model_names[source] = actual
                expected = config["expected_names"]
                if actual != expected:
                    differences = [
                        f"{class_id}: expected {name!r}, got {actual.get(class_id)!r}"
                        for class_id, name in expected.items()
                        if actual.get(class_id) != name
                    ]
                    extras = sorted(set(actual) - set(expected))
                    if extras:
                        examples = ", ".join(map(str, extras[:5]))
                        differences.append(
                            f"{len(extras)} unexpected class IDs (for example: {examples})"
                        )
                    self.errors[source] = (
                        f"Checkpoint class mapping is incompatible; "
                        + "; ".join(differences)
                    )
                    continue
                self.models[source] = candidate
            except Exception as exc:
                self.errors[source] = (
                    f"Could not load backend/models/{config['filename']} "
                    f"({type(exc).__name__}). Verify it is a valid Ultralytics "
                    "YOLO detection checkpoint."
                )

    def _predict_model(self, source: str, image: Image.Image) -> list[dict]:
        model = self.models[source]
        if model is None:
            return []
        predictions = model.predict(
            source=image,
            conf=self.confidence,
            iou=self.iou,
            verbose=False,
        )
        if not predictions:
            raise RuntimeError(f"The {source} model returned no prediction result.")

        names = MODEL_CONFIG[source]["expected_names"]
        detections = []
        boxes = predictions[0].boxes
        if boxes is not None:
            for box in boxes:
                class_id = int(box.cls.item())
                if class_id not in names:
                    raise RuntimeError(
                        f"The {source} model returned unexpected class ID {class_id}."
                    )
                x_min, y_min, x_max, y_max = map(float, box.xyxy[0].tolist())
                detections.append(
                    {
                        "class_id": class_id,
                        "class_name": names[class_id],
                        "confidence": float(box.conf.item()),
                        "bbox": {
                            "x_min": x_min,
                            "y_min": y_min,
                            "x_max": x_max,
                            "y_max": y_max,
                        },
                        "source_models": [source],
                        "source_model": source,
                        "tooth_number": None,
                    }
                )
        return detections

    def _merge(self, detections: list[dict]) -> list[dict]:
        by_source = {
            source: [item for item in detections if item["source_model"] == source]
            for source in MODEL_CONFIG
        }
        candidates = []
        for first_index, first in enumerate(by_source["8-class"]):
            for second_index, second in enumerate(by_source["6-class"]):
                if (
                    first["class_id"] != second["class_id"]
                    or first["class_name"] != second["class_name"]
                ):
                    continue
                overlap = box_iou(first["bbox"], second["bbox"])
                if overlap >= self.merge_iou:
                    candidates.append(
                        (
                            overlap,
                            max(first["confidence"], second["confidence"]),
                            first_index,
                            second_index,
                        )
                    )

        matched_8 = set()
        matched_6 = set()
        merged = []
        for _, _, first_index, second_index in sorted(candidates, reverse=True):
            if first_index in matched_8 or second_index in matched_6:
                continue
            first = by_source["8-class"][first_index]
            second = by_source["6-class"][second_index]
            kept = dict(
                first if first["confidence"] >= second["confidence"] else second
            )
            kept["source_models"] = ["8-class", "6-class"]
            kept["source_model"] = "both"
            merged.append(kept)
            matched_8.add(first_index)
            matched_6.add(second_index)

        merged.extend(
            item
            for index, item in enumerate(by_source["8-class"])
            if index not in matched_8
        )
        merged.extend(
            item
            for index, item in enumerate(by_source["6-class"])
            if index not in matched_6
        )
        return merged

    def _annotate(self, image: Image.Image, detections: list[dict]) -> bytes:
        rgb = np.asarray(image.convert("RGB"))
        canvas = cv2.cvtColor(rgb, cv2.COLOR_RGB2BGR)
        height, width = canvas.shape[:2]
        thickness = max(2, round(min(width, height) / 350))
        font_scale = max(0.45, min(width, height) / 1100)
        font_thickness = max(1, round(font_scale * 2))
        padding = max(4, round(font_scale * 8))

        for detection in detections:
            box = detection["bbox"]
            x_min = max(0, min(width - 1, round(box["x_min"])))
            y_min = max(0, min(height - 1, round(box["y_min"])))
            x_max = max(0, min(width - 1, round(box["x_max"])))
            y_max = max(0, min(height - 1, round(box["y_max"])))
            sources = detection["source_models"]
            colors = [BOX_COLORS[source] for source in sources]
            for offset, color in enumerate(colors):
                inset = offset * thickness
                cv2.rectangle(
                    canvas,
                    (x_min + inset, y_min + inset),
                    (max(x_min + inset, x_max - inset), max(y_min + inset, y_max - inset)),
                    color,
                    thickness,
                )

            source_label = detection["source_model"]
            label = (
                f'{detection["class_name"]} '
                f'{detection["confidence"] * 100:.1f}% [{source_label}]'
            )
            (text_width, text_height), baseline = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, font_thickness
            )
            if y_min >= text_height + padding * 2 + baseline:
                label_top = y_min - text_height - padding * 2 - baseline
                text_y = y_min - padding
                label_bottom = y_min
            else:
                label_top = y_min
                text_y = min(height - baseline - 1, y_min + text_height + padding)
                label_bottom = min(height - 1, text_y + baseline + padding)
            cv2.rectangle(
                canvas,
                (x_min, label_top),
                (
                    min(width - 1, x_min + text_width + padding * 2),
                    label_bottom,
                ),
                colors[0],
                thickness=cv2.FILLED,
            )
            cv2.putText(
                canvas,
                label,
                (x_min + padding, text_y),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                (12, 20, 25),
                font_thickness,
                cv2.LINE_AA,
            )

        legend_y = max(8, round(height * 0.015))
        legend_x = max(8, round(width * 0.015))
        legend_items = [
            ("8-class", [BOX_COLORS["8-class"]]),
            ("6-class", [BOX_COLORS["6-class"]]),
            ("both", [BOX_COLORS["8-class"], BOX_COLORS["6-class"]]),
        ]
        for label, colors in legend_items:
            (text_width, text_height), _ = cv2.getTextSize(
                label, cv2.FONT_HERSHEY_SIMPLEX, font_scale, font_thickness
            )
            for color_index, color in enumerate(colors):
                left = legend_x + text_height * color_index // len(colors)
                right = legend_x + text_height * (color_index + 1) // len(colors)
                cv2.rectangle(
                    canvas,
                    (left, legend_y),
                    (right, legend_y + text_height),
                    color,
                    cv2.FILLED,
                )
            cv2.putText(
                canvas,
                label,
                (legend_x + text_height + padding, legend_y + text_height),
                cv2.FONT_HERSHEY_SIMPLEX,
                font_scale,
                (255, 255, 255),
                font_thickness,
                cv2.LINE_AA,
            )
            legend_x += text_height + padding * 2 + text_width + padding * 3

        encoded, buffer = cv2.imencode(".png", canvas)
        if not encoded:
            raise RuntimeError("OpenCV could not encode the annotated image.")
        return buffer.tobytes()

    def predict(self, image: Image.Image) -> dict:
        if not self.available:
            raise RuntimeError(self.status()["error"] or "No compatible YOLO model is available.")
        started = time.perf_counter()
        detections = []
        for source in MODEL_CONFIG:
            detections.extend(self._predict_model(source, image))
        detections = self._merge(detections)
        detections.sort(
            key=lambda item: (
                item["class_id"] == HEALTHY_CLASS_ID,
                -item["confidence"],
            )
        )
        for index, detection in enumerate(detections, start=1):
            detection["index"] = index

        counts = {class_id: 0 for class_id in CLASS_NAMES}
        for detection in detections:
            counts[detection["class_id"]] += 1
        inference_ms = round((time.perf_counter() - started) * 1000, 2)
        return {
            "detections": detections,
            "total_detections": len(detections),
            "distinct_classes": sum(count > 0 for count in counts.values()),
            "class_counts": counts,
            "inference_ms": inference_ms,
            "annotated_bytes": self._annotate(image, detections),
            "model_status": self.status()["status"],
            "model_errors": {
                source: error for source, error in self.errors.items() if error is not None
            },
            "merge_iou_threshold": self.merge_iou,
        }
