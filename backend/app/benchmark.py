"""Read-only evaluation of the verified detector on public and uploaded SDN windows."""

import asyncio
import csv
import gzip
import hashlib
import io
import json
import logging
import math
import time
from datetime import datetime, timezone
from functools import lru_cache
from pathlib import Path
from uuid import uuid4

import numpy as np
from fastapi import APIRouter, HTTPException, Request

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


MAX_CSV_BYTES = 1_000_000
MAX_CSV_ROWS = 5_000
PROTOCOLS = {"icmp": 1, "tcp": 6, "udp": 17, "1": 1, "6": 6, "17": 17}
LABELS = {"0": 0, "1": 1, "benign": 0, "attack": 1}
FEATURE_BOUNDS = [(1e-12, 1e13), (1e-12, 1e16), (1, 1e15), (0, 1e9)]


def model_metadata():
    if detector.model is None:
        raise HTTPException(503, "Evaluation requires a verified detector. Check the model configuration.")
    return detector.metadata


def model_info(metadata):
    return {
        "version": metadata["version"],
        "algorithm": metadata["algorithm"],
        "sha256": metadata["sha256"],
        "threshold": settings().detection_threshold,
    }


def public_partition(metadata):
    try:
        return load_partition(
            settings().model_path,
            metadata["dataset_sha256"],
            metadata["test_rows"],
            metadata["test_groups"],
            metadata["window_seconds"],
        )
    except (OSError, ValueError, KeyError):
        logger.exception("Benchmark partition did not pass validation")
        raise HTTPException(503, "The installed model has no matching benchmark partition.") from None


@router.get("/reference")
async def reference():
    """Reference metrics come from the installed artifact at its recorded evaluation threshold."""
    metadata = model_metadata()
    dataset, *_ = await asyncio.to_thread(public_partition, metadata)
    return {
        "model": model_info(metadata) | {"threshold": metadata["evaluation_threshold"]},
        "dataset": dataset,
        "features": FEATURES,
        "confusion_matrix": metadata["confusion_matrix"],
        "roc_auc": metadata["roc_auc"],
        "average_precision": metadata["average_precision"],
    }


def score_windows(dataset, identifiers, labels, matrix, metadata):
    start = time.perf_counter()
    scores = detector.attack_scores(matrix)
    inference_ms = (time.perf_counter() - start) * 1000
    if not np.isfinite(scores).all() or (scores < 0).any() or (scores > 1).any():
        logger.error("Detector returned invalid evaluation scores")
        raise HTTPException(503, "The installed model returned invalid scores.")
    return {
        "id": str(uuid4()),
        "completed_at": datetime.now(timezone.utc),
        "inference_ms": round(inference_ms, 1),
        "model": model_info(metadata),
        "dataset": dataset,
        "features": FEATURES,
        "windows": list(zip(identifiers, labels, scores.tolist(), *matrix.T.tolist())),
    }


def evaluate():
    metadata = model_metadata()
    dataset, identifiers, labels, matrix = public_partition(metadata)
    return score_windows(dataset | {"kind": "public"}, identifiers, labels, matrix, metadata)


def read_upload(content: bytes, window_seconds: int):
    try:
        text = content.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise HTTPException(422, "Save the dataset as a UTF-8 CSV and try again.") from None
    reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
    identifiers, labels, features = [], [], []
    try:
        headers = [name.strip().lower() for name in reader.fieldnames or []]
        if len(headers) != len(set(headers)) or len(headers) > 64 or any(not name for name in headers):
            raise HTTPException(422, "Use at most 64 uniquely named CSV columns.")
        missing = [feature for feature in FEATURES if feature not in headers]
        if missing:
            raise HTTPException(422, f"Missing required columns: {', '.join(missing)}.")
        reader.fieldnames = headers
        for row in reader:
            line = reader.line_num
            if len(features) >= MAX_CSV_ROWS:
                raise HTTPException(413, f"Upload up to {MAX_CSV_ROWS:,} flow windows at a time.")
            if None in row or any(value is None for value in row.values()):
                raise HTTPException(422, f"CSV line {line} does not match the header column count.")
            values = []
            for name, (minimum, maximum) in zip(FEATURES, FEATURE_BOUNDS):
                try:
                    value = float(row[name])
                    if not math.isfinite(value) or not minimum <= value <= maximum:
                        raise ValueError
                except ValueError:
                    raise HTTPException(422, f"CSV line {line} has an invalid {name} value.") from None
                values.append(value)
            protocol = PROTOCOLS.get(row["protocol"].strip().lower())
            if protocol is None:
                raise HTTPException(422, f"CSV line {line} must use ICMP (1), TCP (6), or UDP (17).")
            if "interval_seconds" in row:
                try:
                    interval = float(row["interval_seconds"])
                    if not math.isfinite(interval) or abs(interval - window_seconds) > 5:
                        raise ValueError
                except ValueError:
                    raise HTTPException(
                        422, f"CSV line {line} needs an interval within 5 seconds of {window_seconds}."
                    ) from None
            label = row.get("label", "").strip().lower()
            if label and label not in LABELS:
                raise HTTPException(422, f"CSV line {line} needs a label of 0, 1, benign, attack, or blank.")
            identifiers.append(line)
            labels.append(LABELS.get(label))
            features.append(values + [protocol])
    except csv.Error:
        raise HTTPException(422, f"Check the CSV formatting near line {max(1, reader.line_num)}.") from None
    if not features:
        raise HTTPException(422, "Add at least one flow window to the CSV.")
    return identifiers, labels, np.array(features)


def evaluate_upload(content: bytes):
    metadata = model_metadata()
    window_seconds = metadata.get("window_seconds")
    if not window_seconds:
        raise HTTPException(503, "The installed model has no sampling interval for dataset evaluation.")
    identifiers, labels, matrix = read_upload(content, window_seconds)
    dataset = {
        "kind": "upload",
        "dataset_sha256": hashlib.sha256(content).hexdigest(),
        "rows": len(identifiers),
        "window_seconds": window_seconds,
    }
    return score_windows(dataset, identifiers, labels, matrix, metadata)


async def run_exclusive(function, *args):
    # Admission control keeps public evaluations from competing with one another for CPU.
    if run_lock.locked():
        raise HTTPException(429, "Another evaluation is running. Try again in a moment.", {"Retry-After": "2"})
    async with run_lock:
        return await asyncio.to_thread(function, *args)


@router.post("/run")
async def run_benchmark():
    return await run_exclusive(evaluate)


@router.post("/upload")
async def run_upload(request: Request):
    if request.headers.get("content-type", "").split(";", 1)[0].strip().lower() != "text/csv":
        raise HTTPException(415, "Upload a CSV with Content-Type text/csv.")
    content = bytearray()
    async for chunk in request.stream():
        if len(content) + len(chunk) > MAX_CSV_BYTES:
            raise HTTPException(413, "Upload a CSV of up to 1 MB.")
        content.extend(chunk)
    return await run_exclusive(evaluate_upload, bytes(content))
