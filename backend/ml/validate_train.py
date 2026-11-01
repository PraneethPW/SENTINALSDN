"""Reproducible train/validation/test group separation; never tune on the test set."""

import csv
import hashlib
import json
from pathlib import Path
from datetime import datetime, timezone
import joblib
import numpy as np
import sklearn
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier, HistGradientBoostingClassifier
from sklearn.model_selection import GroupShuffleSplit, GroupKFold
from sklearn.base import clone
from sklearn.metrics import classification_report, confusion_matrix, roc_auc_score, average_precision_score
from app.detector import FEATURES


def score(y, p, t):
    tn, fp, fn, tp = confusion_matrix(y, p >= t).ravel()
    pr = tp / max(1, tp + fp)
    re = tp / max(1, tp + fn)
    return {
        "precision": float(pr),
        "recall": float(re),
        "f2": float(5 * pr * re / max(1e-12, 4 * pr + re)),
        "fpr": float(fp / max(1, fp + tn)),
        "confusion_matrix": [[int(tn), int(fp)], [int(fn), int(tp)]],
        "classification_report": classification_report(y, p >= t, output_dict=True, zero_division=0),
        "roc_auc": float(roc_auc_score(y, p)),
        "average_precision": float(average_precision_score(y, p)),
    }


def train(dataset, output, benign_capture=None):
    rows = list(csv.DictReader(dataset.open()))
    x = np.array([[float(r[f]) for f in FEATURES] for r in rows])
    y = np.array([int(r["label"]) for r in rows])
    g = np.array([r["group_id"] for r in rows])
    if not np.isfinite(x).all() or (x < 0).any():
        raise ValueError("Invalid features")
    outer, test = next(GroupShuffleSplit(n_splits=1, test_size=0.25, random_state=42).split(x, y, g))
    a, b = next(
        GroupShuffleSplit(n_splits=1, test_size=0.2, random_state=73).split(x[outer], y[outer], g[outer])
    )
    fit, val = outer[a], outer[b]
    assert not (set(g[fit]) & set(g[val]) or set(g[fit]) & set(g[test]) or set(g[val]) & set(g[test]))
    adaptation = None
    if benign_capture:
        observed = list(csv.DictReader(benign_capture.open()))
        if not observed or any(int(r["label"]) != 0 for r in observed):
            raise ValueError("Only explicitly labeled controlled benign captures are accepted")
        extra = np.array([[float(r[f]) for f in FEATURES] for r in observed])
        if not np.isfinite(extra).all() or (extra < 0).any():
            raise ValueError("Invalid adaptation features")
        start = len(x)
        x = np.vstack([x, extra])
        y = np.concatenate([y, np.zeros(len(extra), dtype=int)])
        g = np.concatenate([g, np.array([r["group_id"] for r in observed])])
        fit = np.concatenate([fit, np.arange(start, len(x))])
        adaptation = json.loads(benign_capture.with_suffix(".provenance.json").read_text())

    models = {
        "Random Forest": RandomForestClassifier(
            n_estimators=300,
            max_depth=20,
            min_samples_leaf=3,
            class_weight="balanced_subsample",
            random_state=42,
            n_jobs=-1,
        ),
        "Random Forest deep": RandomForestClassifier(
            n_estimators=400,
            max_depth=24,
            min_samples_leaf=1,
            class_weight="balanced_subsample",
            random_state=42,
            n_jobs=-1,
        ),
        "Extra Trees": ExtraTreesClassifier(
            n_estimators=400,
            max_depth=24,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
            n_jobs=-1,
        ),
        "Histogram Gradient Boosting": HistGradientBoostingClassifier(
            max_iter=220, max_depth=8, l2_regularization=1, class_weight="balanced", random_state=42
        ),
    }
    candidates = []
    for name, m in models.items():
        m.fit(x[fit], y[fit])
        p = m.predict_proba(x[val])[:, 1]
        for t in np.arange(0.5, 0.951, 0.025):
            s = score(y[val], p, t)
            candidates.append(
                {
                    "algorithm": name,
                    "threshold": round(float(t), 3),
                    "feasible": bool(s["precision"] >= 0.95 and s["fpr"] <= 0.03),
                    "metrics": s,
                }
            )
    chosen = max(candidates, key=lambda r: (r["feasible"], r["metrics"]["f2"], r["metrics"]["precision"]))
    m = models[chosen["algorithm"]]
    t = chosen["threshold"]
    # Model and threshold are now frozen; this is the first test evaluation.
    test_result = score(y[test], m.predict_proba(x[test])[:, 1], t)
    folds = []
    for a, b in GroupKFold(n_splits=5).split(x[fit], y[fit], g[fit]):
        fold = clone(m).fit(x[fit][a], y[fit][a])
        folds.append(score(y[fit][b], fold.predict_proba(x[fit][b])[:, 1], t))
    meta = {
        "version": datetime.now(timezone.utc).strftime("group-%Y%m%dT%H%M%SZ"),
        "algorithm": chosen["algorithm"],
        "features": FEATURES,
        "sklearn_version": sklearn.__version__,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "rows": len(x),
        "public_rows": len(rows),
        "adaptation": adaptation,
        "training_rows": len(fit),
        "validation_rows": len(val),
        "test_rows": len(test),
        "training_groups": len(set(g[fit])),
        "validation_groups": len(set(g[val])),
        "test_groups": len(set(g[test])),
        "dataset_sha256": hashlib.sha256(dataset.read_bytes()).hexdigest(),
        "evaluation_threshold": t,
        "window_seconds": 30,
        "selection": chosen,
        "cross_validation": folds,
        "split": "Disjoint bidirectional endpoint/protocol groups, test seed 42, validation seed 73",
        "dataset": json.loads(dataset.with_suffix(".provenance.json").read_text()),
        "feature_importance": dict(zip(FEATURES, getattr(m, "feature_importances_", np.zeros(5)).tolist())),
        "limitations": "Public Mininet data with controlled benign-lab adaptation. Group IDs proxy capture IDs; no independent deployment evaluation or probability calibration. Validation varies substantially by traffic family. Mitigation remains disabled pending network-specific validation.",
        **test_result,
    }
    meta["release_gate"] = {
        "passed": bool(
            test_result["precision"] >= 0.95 and test_result["recall"] >= 0.8 and test_result["fpr"] <= 0.03
        ),
        "criteria": "precision >= .95, recall >= .80, false-positive rate <= .03; fixed before testing",
    }
    if not meta["release_gate"]["passed"] and output.resolve() == Path("artifacts/model.joblib").resolve():
        raise ValueError(
            "Release gate failed; use a work/ candidate path to retain diagnostics without replacing the active artifact"
        )
    output.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(m, output, compress=3)
    output.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    output.with_name("validation-candidates.json").write_text(json.dumps(candidates, indent=2))
    print(
        json.dumps(
            {
                "algorithm": meta["algorithm"],
                "threshold": t,
                "validation": chosen["metrics"],
                "test": test_result,
                "gate": meta["release_gate"],
                "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    import argparse

    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument("dataset", type=Path)
    p.add_argument("--output", type=Path, required=True)
    p.add_argument("--benign-capture", type=Path)
    a = p.parse_args()
    train(a.dataset, a.output, a.benign_capture)
