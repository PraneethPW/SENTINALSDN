"""Train from measured, labeled SDN window data. Never downloads or generates traffic."""

import argparse
import csv
import hashlib
import json
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import average_precision_score, classification_report, confusion_matrix, roc_auc_score
from sklearn.model_selection import GroupShuffleSplit

from app.detector import FEATURES


def train(dataset: Path, output: Path):
    with dataset.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    if len(rows) < 100:
        raise ValueError(
            "At least 100 measured windows are required; more independent captures are recommended"
        )
    required = set(FEATURES + ["label", "group_id"])
    if not required.issubset(rows[0]):
        raise ValueError(f"CSV must include: {sorted(required)}")
    x = np.array([[float(row[name]) for name in FEATURES] for row in rows])
    y = np.array([int(row["label"]) for row in rows])
    groups = np.array([row["group_id"] for row in rows])
    if not np.isfinite(x).all() or (x < 0).any() or set(y) != {0, 1}:
        raise ValueError("Features must be finite and nonnegative; labels must contain both 0 and 1")
    if len(set(groups)) < 5 or any(not group.strip() for group in groups):
        raise ValueError("Provide at least five nonempty group IDs to separate related flow observations")
    # Hold out entire groups, never random windows from the same flow family.
    split = GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42)
    train_ids, test_ids = next(split.split(x, y, groups))
    if set(y[train_ids]) != {0, 1} or set(y[test_ids]) != {0, 1}:
        raise ValueError("Both partitions need benign and attack captures; provide a more diverse dataset")
    model = RandomForestClassifier(
        n_estimators=240,
        max_depth=18,
        min_samples_leaf=3,
        class_weight="balanced_subsample",
        random_state=42,
        n_jobs=-1,
    )
    model.fit(x[train_ids], y[train_ids])
    probabilities = model.predict_proba(x[test_ids])[:, 1]
    predictions = (probabilities >= 0.9).astype(int)
    metadata = {
        "version": datetime.now(timezone.utc).strftime("rf-%Y%m%dT%H%M%SZ"),
        "algorithm": "Random Forest",
        "features": FEATURES,
        "sklearn_version": sklearn.__version__,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "dataset_sha256": hashlib.sha256(dataset.read_bytes()).hexdigest(),
        "rows": len(rows),
        "training_rows": len(train_ids),
        "test_rows": len(test_ids),
        "split": "group holdout, 25% test, seed 42",
        "evaluation_threshold": 0.9,
        "training_groups": len(set(groups[train_ids])),
        "test_groups": len(set(groups[test_ids])),
        "roc_auc": float(roc_auc_score(y[test_ids], probabilities)),
        "average_precision": float(average_precision_score(y[test_ids], probabilities)),
        "classification_report": classification_report(
            y[test_ids], predictions, output_dict=True, zero_division=0
        ),
        "confusion_matrix": confusion_matrix(y[test_ids], predictions).tolist(),
        "feature_importance": dict(zip(FEATURES, model.feature_importances_.tolist())),
        "limitations": "Holdout metrics apply only to this dataset. Validate on your deployment network before mitigation.",
    }
    provenance_path = dataset.with_suffix(".provenance.json")
    if provenance_path.exists():
        metadata["dataset"] = json.loads(provenance_path.read_text())
        metadata["window_seconds"] = metadata["dataset"]["window_seconds"]
        metadata["limitations"] += " " + metadata["dataset"]["limitations"]
    output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(model, output, compress=3)
    output.with_suffix(".json").write_text(json.dumps(metadata, indent=2))
    print(json.dumps(metadata, indent=2))
    print(f"MODEL_SHA256={hashlib.sha256(output.read_bytes()).hexdigest()}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--output", type=Path, default=Path("artifacts/model.joblib"))
    args = parser.parse_args()
    train(args.dataset, args.output)
