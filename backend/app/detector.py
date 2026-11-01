import hashlib
import json
import logging

import joblib
import numpy as np

from app.config import settings
from app.schemas import Flow

FEATURES = ["packet_rate", "byte_rate", "mean_packet_size", "duration_seconds", "protocol"]
logger = logging.getLogger(__name__)


def features(flow: Flow) -> list[float]:
    return [
        flow.packets / flow.interval_seconds,
        flow.bytes / flow.interval_seconds,
        flow.bytes / flow.packets,
        flow.duration_seconds,
        float(flow.protocol),
    ]


class Detector:
    def __init__(self):
        self.model = None
        self.metadata = None
        self.error = "No trained model installed"

    def load(self):
        self.model = None
        self.metadata = None
        self.error = "No trained model installed"
        config = settings()
        path = config.model_path
        if not path.exists():
            return
        actual_hash = hashlib.sha256(path.read_bytes()).hexdigest()
        if not config.model_sha256 or actual_hash != config.model_sha256:
            self.error = "Model SHA-256 missing or mismatched; model was not loaded"
            return
        # Only operator-installed artifacts whose SHA-256 is trusted are deserialized.
        try:
            metadata = json.loads(path.with_suffix(".json").read_text())
            if metadata["features"] != FEATURES:
                raise ValueError("Model feature schema is incompatible")
            self.model = joblib.load(path)
            if list(self.model.classes_) != [0, 1]:
                raise ValueError("Expected benign=0, attack=1")
            self.metadata = metadata | {"sha256": actual_hash}
            self.error = None
        except Exception:
            logger.exception("Model failed validation")
            self.model = None
            self.error = "Model failed validation; inspect backend logs"

    def predict(self, flows: list[Flow]):
        if self.model is None:
            return [("unclassified", None) for _ in flows]
        if not flows:
            return []
        probabilities = self.model.predict_proba(np.array([features(flow) for flow in flows]))[:, 1]
        window = self.metadata.get("window_seconds")
        return [
            ("unclassified", None)
            if window and abs(flow.interval_seconds - window) > 5
            else ("attack" if p >= settings().detection_threshold else "benign", float(p))
            for flow, p in zip(flows, probabilities)
        ]

    def status(self):
        return {
            "ready": self.model is not None,
            "error": self.error,
            "metadata": self.metadata,
            "threshold": settings().detection_threshold,
            "features": FEATURES,
        }


detector = Detector()
