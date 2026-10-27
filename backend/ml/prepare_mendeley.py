"""Download the CC BY 4.0 publisher archive and map measured 30-second SDN windows."""

import argparse
import csv
import hashlib
import io
import json
import math
from collections import Counter
from pathlib import Path
from zipfile import ZipFile

import httpx

from app.detector import FEATURES

SOURCE = "https://data.mendeley.com/datasets/jxpfjc64kr/1"
DOWNLOAD = "https://data.mendeley.com/public-api/zip/jxpfjc64kr/download/1"


def prepare(root: Path):
    raw = root / "raw"
    raw.mkdir(parents=True, exist_ok=True)
    archive = raw / "mendeley-sdn.zip"
    if not archive.exists():
        with httpx.Client(follow_redirects=True, timeout=120) as client:
            response = client.get(DOWNLOAD)
            response.raise_for_status()
            archive.write_bytes(response.content)
    with ZipFile(archive) as zip_file:
        name = next(n for n in zip_file.namelist() if n.endswith("dataset_sdn.csv"))
        content = zip_file.read(name)
    (raw / "dataset_sdn.csv").write_bytes(content)
    counts = Counter()
    seen = set()
    output = root / "windows.csv"
    with output.open("w", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=FEATURES + ["label", "group_id"])
        writer.writeheader()
        for row in csv.DictReader(io.StringIO(content.decode("utf-8-sig"))):
            counts["source_rows"] += 1
            try:
                packets, byte_count = float(row["pktperflow"]), float(row["byteperflow"])
                duration = float(row["dur"]) + float(row["dur_nsec"]) / 1e9
                protocol = {"ICMP": 1, "TCP": 6, "UDP": 17}[row["Protocol"]]
                label = int(row["label"])
                values = [packets / 30, byte_count / 30, byte_count / packets, duration, protocol]
                if (
                    packets <= 0
                    or byte_count < packets
                    or duration < 0
                    or label not in (0, 1)
                    or not all(math.isfinite(v) for v in values)
                ):
                    raise ValueError("Invalid measured window")
            except (ValueError, KeyError, ZeroDivisionError):
                counts["invalid_or_idle_rows_removed"] += 1
                continue
            # The same flow observation is repeated by port-stat joins. Keep one copy.
            identity = (row["dt"], row["switch"], row["src"], row["dst"], row["Protocol"], *values, label)
            if identity in seen:
                counts["duplicate_observations_removed"] += 1
                continue
            seen.add(identity)
            # No original capture IDs are supplied. Group both directions of an endpoint pair
            # across every switch and time, so a flow family cannot cross train/test.
            family = "|".join(sorted([row["src"], row["dst"]]) + [row["Protocol"]])
            group = hashlib.sha256(family.encode()).hexdigest()[:20]
            writer.writerow(dict(zip(FEATURES, values)) | {"label": label, "group_id": group})
            counts["accepted_rows"] += 1
            counts[f"label_{label}"] += 1
    provenance = {
        "title": "DDOS attack SDN Dataset",
        "authors": ["Nisha Ahuja", "Gaurav Singal", "Debajyoti Mukhopadhyay"],
        "doi": "10.17632/jxpfjc64kr.1",
        "url": SOURCE,
        "download_url": DOWNLOAD,
        "license": "CC BY 4.0",
        "license_url": "https://creativecommons.org/licenses/by/4.0/",
        "raw_sha256": hashlib.sha256(content).hexdigest(),
        "prepared_sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "window_seconds": 30,
        "grouping": "bidirectional endpoint pair + protocol, across all switches and times",
        "feature_mapping": {
            "packet_rate": "pktperflow / 30",
            "byte_rate": "byteperflow / 30",
            "mean_packet_size": "byteperflow / pktperflow",
            "duration_seconds": "dur + dur_nsec / 1e9",
            "protocol": "ICMP=1, TCP=6, UDP=17",
        },
        "cleaning_counts": dict(counts),
        "limitations": "Measured traffic from a published Mininet lab, not a production network. Original capture IDs absent; endpoint-family grouping is a proxy, not an independent-capture evaluation. Historical rows are never inserted into live telemetry.",
    }
    output.with_suffix(".provenance.json").write_text(json.dumps(provenance, indent=2))
    print(json.dumps(provenance, indent=2))


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--directory", type=Path, default=Path("data"))
    prepare(parser.parse_args().directory)
