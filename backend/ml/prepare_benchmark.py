"""Build the portable benchmark from the same prepared public data as the model."""

import argparse
import csv
import gzip
import hashlib
import io
import json
from pathlib import Path

import numpy as np

from app.detector import FEATURES
from ml.partitions import public_partitions


def prepare(dataset: Path, model_metadata: Path):
    model = json.loads(model_metadata.read_text())
    dataset_sha256 = hashlib.sha256(dataset.read_bytes()).hexdigest()
    if dataset_sha256 != model["dataset_sha256"] or model["features"] != FEATURES:
        raise ValueError("Prepared dataset or feature schema differs from the trained model")
    with dataset.open(newline="") as handle:
        rows = list(csv.DictReader(handle))
    groups = np.array([row["group_id"] for row in rows])
    labels = np.array([int(row["label"]) for row in rows])
    fit, validation, test = public_partitions(np.zeros(len(rows)), labels, groups)
    test_groups = set(groups[test])
    if (
        len(test) != model["test_rows"]
        or len(test_groups) != model["test_groups"]
        or test_groups & set(groups[np.concatenate([fit, validation])])
    ):
        raise ValueError("The group-disjoint test partition does not match model metadata")
    output = io.StringIO(newline="")
    fields = ["window_id", *FEATURES, "label"]
    writer = csv.DictWriter(output, fieldnames=fields, lineterminator="\n")
    writer.writeheader()
    for index in test:
        row = rows[index]
        writer.writerow({name: row[name] for name in fields[1:]} | {"window_id": int(index) + 1})

    compressed = io.BytesIO()
    with gzip.GzipFile(fileobj=compressed, filename="", mode="wb", mtime=0) as handle:
        handle.write(output.getvalue().encode())
    archive = compressed.getvalue()
    model_metadata.with_name("benchmark.csv.gz").write_bytes(archive)
    manifest = {
        "archive_sha256": hashlib.sha256(archive).hexdigest(),
        "dataset_sha256": dataset_sha256,
        "rows": len(test),
        "groups": len(test_groups),
        "window_seconds": model["window_seconds"],
        "split": model["split"],
        "source": {key: model["dataset"][key] for key in ("title", "authors", "doi", "url", "license", "license_url")},
    }
    model_metadata.with_name("benchmark.json").write_text(json.dumps(manifest, indent=2) + "\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--model-metadata", type=Path, default=Path("artifacts/model.json"))
    args = parser.parse_args()
    prepare(args.dataset, args.model_metadata)
