"""Read-only evaluation of the verified detector on a bundled public test partition."""

import asyncio
import csv
import gzip
import hashlib
import io
import json
import logging
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

import numpy as np
from fastapi import APIRouter, HTTPException

from app.config import settings
from app.detector import FEATURES, detector

router = APIRouter(prefix="/api/benchmark", tags=["benchmark"])
logger = logging.getLogger(__name__)
run_lock = asyncio.Lock()


@lru_cache(maxsize=2)
def load_partition(path: Path, dataset_sha256: str, rows: int, groups: int, window_seconds: int):
    manifest = json.loads(path.with_name("benchmark.json").read_text())
    archive = path.with_name("benchmark.csv.gz").read_bytes()
    if (
        hashlib.sha256(archive).hexdigest() != manifest["archive_sha256"]
        or dataset_sha256 != manifest["dataset_sha256"]
        or manifest["rows"] != rows
        or manifest["groups"] != groups
        or manifest["window_seconds"] != window_seconds
    ):
        raise ValueError("Benchmark does not match the trained model")
    with gzip.open(io.BytesIO(archive), mode="rt", newline="") as handle:
        reader = csv.DictReader(handle)
        if reader.fieldnames != ["window_id", *FEATURES, "label"]:
            raise ValueError("Benchmark feature schema does not match the detector")
        records = list(reader)
    identifiers = [int(record["window_id"]) for record in records]
    labels = [int(record["label"]) for record in records]
    matrix = np.array([[float(record[feature]) for feature in FEATURES] for record in records])
    if (
        len(records) != rows
        or len(set(identifiers)) != rows
        or set(labels) != {0, 1}
        or not np.isfinite(matrix).all()
        or (matrix < 0).any()
        or not np.isin(matrix[:, 4], [1, 6, 17]).all()
    ):
        raise ValueError("Invalid benchmark window data")
    matrix.setflags(write=False)
    return manifest, identifiers, labels, matrix


def evaluate():
    if detector.model is None:
        raise HTTPException(503, "The benchmark requires a verified detector. Check the model configuration.")
    metadata = detector.metadata
    try:
        dataset, identifiers, labels, matrix = load_partition(
            settings().model_path,
            metadata["dataset_sha256"],
            metadata["test_rows"],
            metadata["test_groups"],
            metadata["window_seconds"],
        )
    except (OSError, ValueError, KeyError):
        logger.exception("Benchmark partition did not pass validation")
        raise HTTPException(503, "The installed model has no matching benchmark partition.") from None

    start = time.perf_counter()
    scores = detector.attack_scores(matrix)
    inference_ms = (time.perf_counter() - start) * 1000
    if not np.isfinite(scores).all() or (scores < 0).any() or (scores > 1).any():
        logger.error("Detector returned invalid benchmark scores")
        raise HTTPException(503, "The installed model returned invalid scores.")
    return {
        "id": str(uuid4()),
        "completed_at": datetime.now(timezone.utc),
        "inference_ms": round(inference_ms, 1),
        "model": {
            "version": metadata["version"],
            "algorithm": metadata["algorithm"],
            "sha256": metadata["sha256"],
            "threshold": settings().detection_threshold,
        },
        "dataset": dataset,
        "features": FEATURES,
        "windows": list(zip(identifiers, labels, scores.tolist(), *matrix.T.tolist())),
    }


@router.post("/run")
async def run_benchmark():
    # Admission control keeps public runs from competing with one another for CPU.
    if run_lock.locked():
        raise HTTPException(429, "Another benchmark is running. Try again in a moment.", {"Retry-After": "2"})
    async with run_lock:
        return await asyncio.to_thread(evaluate)
