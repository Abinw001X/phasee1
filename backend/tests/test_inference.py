import unittest
from pathlib import Path

from PIL import Image

from services.inference import DentalInference


class Value:
    def __init__(self, value):
        self.value = value

    def item(self):
        return self.value


class FakeBox:
    def __init__(self, class_id, confidence, coordinates):
        self.cls = Value(class_id)
        self.conf = Value(confidence)
        self.xyxy = [self]
        self.coordinates = coordinates

    def tolist(self):
        return self.coordinates


class FakePrediction:
    def __init__(self, boxes):
        self.boxes = boxes


class FakeModel:
    def __init__(self, boxes):
        self.boxes = boxes

    def predict(self, **_kwargs):
        return [FakePrediction(self.boxes)]


class InferenceTests(unittest.TestCase):
    def setUp(self):
        self.inference = DentalInference(Path("models"))
        self.inference.models = {
            "8-class": FakeModel(
                [
                    FakeBox(0, 0.9, [10, 10, 110, 110]),
                    FakeBox(0, 0.8, [200, 200, 280, 280]),
                    FakeBox(1, 0.7, [20, 20, 90, 90]),
                    FakeBox(6, 0.65, [120, 120, 180, 180]),
                    FakeBox(7, 0.6, [120, 200, 180, 260]),
                ]
            ),
            "6-class": FakeModel(
                [
                    FakeBox(0, 0.95, [12, 12, 112, 112]),
                    FakeBox(2, 0.85, [20, 20, 90, 90]),
                    FakeBox(5, 0.99, [300, 300, 350, 350]),
                ]
            ),
        }

    def test_predict_merges_only_same_class_and_orders_healthy_last(self):
        result = self.inference.predict(Image.new("RGB", (400, 400), "black"))
        findings = result["detections"]

        merged = [item for item in findings if item["source_model"] == "both"]
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["confidence"], 0.95)
        self.assertEqual(merged[0]["source_models"], ["8-class", "6-class"])
        self.assertEqual(
            {item["class_name"] for item in findings if item["bbox"]["x_min"] == 20},
            {"Infection", "Impacted"},
        )
        eight_only = {
            item["class_id"]: item
            for item in findings
            if item["class_id"] in (6, 7)
        }
        self.assertEqual(eight_only[6]["class_name"], "Deep Caries")
        self.assertEqual(eight_only[7]["class_name"], "Periapical Lesion")
        self.assertEqual(eight_only[6]["source_model"], "8-class")
        self.assertEqual(eight_only[7]["source_model"], "8-class")
        self.assertEqual(
            [item["class_name"] for item in findings[-1:]],
            ["Healthy"],
        )
        self.assertTrue(all(item["tooth_number"] is None for item in findings))
        self.assertEqual(result["total_detections"], 7)
        self.assertEqual(result["class_counts"][0], 2)
        self.assertEqual(result["class_counts"][1], 1)
        self.assertEqual(result["class_counts"][2], 1)
        self.assertEqual(result["class_counts"][5], 1)
        self.assertEqual(result["class_counts"][6], 1)
        self.assertEqual(result["class_counts"][7], 1)
        self.assertTrue(result["annotated_bytes"].startswith(b"\x89PNG\r\n\x1a\n"))

    def test_merge_does_not_combine_different_class_ids(self):
        first = {
            "class_id": 0,
            "class_name": "Caries",
            "confidence": 0.8,
            "bbox": {"x_min": 0, "y_min": 0, "x_max": 10, "y_max": 10},
            "source_models": ["8-class"],
            "source_model": "8-class",
            "tooth_number": None,
        }
        second = {
            **first,
            "class_id": 1,
            "class_name": "Infection",
            "source_models": ["6-class"],
            "source_model": "6-class",
        }
        self.assertEqual(self.inference._merge([first, second]), [first, second])

    def test_merge_requires_configured_overlap_threshold(self):
        first = {
            "class_id": 0,
            "class_name": "Caries",
            "confidence": 0.8,
            "bbox": {"x_min": 0, "y_min": 0, "x_max": 10, "y_max": 10},
            "source_models": ["8-class"],
            "source_model": "8-class",
            "tooth_number": None,
        }
        second = {
            **first,
            "confidence": 0.9,
            "bbox": {"x_min": 5, "y_min": 0, "x_max": 15, "y_max": 10},
            "source_models": ["6-class"],
            "source_model": "6-class",
        }
        self.assertEqual(len(self.inference._merge([first, second])), 2)


if __name__ == "__main__":
    unittest.main()
