# Model weights

Place the independently trained Ultralytics checkpoints here:

- `best.pt`: IDs 0–7 for Caries, Infection, Impacted, BDC/BDR, Fractured,
  Healthy, Deep Caries, and Periapical Lesion.
- `yolo26n.pt`: IDs 0–5 for Caries, Infection, Impacted, BDC/BDR, Fractured,
  and Healthy.

The backend loads both files separately and validates their actual class maps.
An incompatible file is rejected with its actual mapping and an error; it is
not used as a fallback. If only one valid checkpoint is available, predictions
from that checkpoint are marked as partial and retain their source model.

Both files are excluded from Git.
