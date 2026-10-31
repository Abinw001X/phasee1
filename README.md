# Dentlink AI Workstation

A local dental imaging application with a React/Vite interface, a FastAPI YOLO
inference service, downloadable analysis reports, and an independent browser
STL viewer.

## Start the application

From the project root, run:

```sh
npm run dev
```

The root npm script runs `start.sh`. It checks for Node.js 20+ and Python
3.11+, uses the project `.venv`, and installs dependencies only if needed.
It starts the existing Vite frontend on port 5173 and FastAPI/Uvicorn on port
8000. Vite forwards `/api` requests to FastAPI. Open <http://localhost:5173>;
the API health check is at <http://localhost:8000/api/health>. Press Ctrl+C
to stop both services.

The launcher prefers Python 3.13, then 3.12 and 3.11, before trying another
compatible Python 3 installation.

## Model checkpoints

The backend loads both checkpoints independently:

```text
backend/models/best.pt
backend/models/yolo26n.pt
```

`best.pt` must have this 8-class mapping:

| ID | Class |
| --- | --- |
| 0 | Caries |
| 1 | Infection |
| 2 | Impacted |
| 3 | BDC/BDR |
| 4 | Fractured |
| 5 | Healthy |
| 6 | Deep Caries |
| 7 | Periapical Lesion |

`yolo26n.pt` must have IDs 0–5 matching the first six classes above. Each
checkpoint's actual Ultralytics class mapping is checked at startup and exposed
by `/api/health` and `/api/model-info`. An invalid or incompatible checkpoint
is reported by its own model status and is never replaced by another file. If
only one checkpoint is compatible, the API can return explicitly labeled
partial results from that model; the response and UI identify the unavailable
model. With the supplied stock COCO `yolo26n.pt`, only the valid 8-class model
is available until a compatible 6-class dental checkpoint replaces it.

The checkpoints are excluded from Git. Inference and merge thresholds can be
set with `YOLO_CONFIDENCE`, `YOLO_IOU`, and `YOLO_MERGE_IOU`, respectively.
OpenCV annotations are returned in the existing base64 PNG `annotated_image`
field.

## Manual startup

Terminal 1 (from the project root):

```sh
python3.13 -m venv .venv
.venv/bin/python -m pip install -r backend/requirements.txt
.venv/bin/python -m uvicorn main:app --app-dir backend --host 0.0.0.0 --port 8000
```

Terminal 2 (from the project root):

```sh
cd frontend
npm install
npm run dev
```

## API endpoints

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Backend and model readiness |
| `GET` | `/api/model-info` | Class mapping, thresholds, and model status |
| `POST` | `/api/analyze` | Analyze an uploaded PNG/JPG/JPEG (`file` multipart field) |
| `POST` | `/api/report` | Download a PDF for an analysis (`analysis_id`) |

Set `YOLO_CONFIDENCE`, `YOLO_IOU`, `YOLO_MERGE_IOU`, `MAX_UPLOAD_MB`, and
`CORS_ORIGINS` in the backend environment to override local defaults. The
Vite development proxy forwards `/api` to port 8000. For a separately hosted
API, set `VITE_API_BASE_URL`.

The STL viewport only renders uploaded `.stl` geometry; it is independent of
X-ray analysis and does not diagnose or align the mesh. No tooth detector or
validated tooth-localization/numbering method is included, so the optional
`tooth_number` field remains null. Reliable FDI numbering would require a
validated tooth-localization model for the relevant radiograph types and a
validated mapping from localized tooth positions to FDI numbers; disease-box
positions or detection order are not sufficient. AI-generated findings are
assistive and must be reviewed by a qualified dental professional. No clinical
validation or accuracy comparison is implied by combining model outputs.
# phasee1
