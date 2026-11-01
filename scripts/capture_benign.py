"""Export measurements from the explicitly controlled, isolated local Mininet run.

Only run when the lab runs its supplied ICMP/64-Kbit UDP workload unchanged.
These are operator-labeled benign measurements, not predictions used as labels.
"""

import csv, json, hashlib
from pathlib import Path
from datetime import datetime, timezone
import psycopg

root = Path(__file__).resolve().parents[1]
env = dict(
    line.split("=", 1)
    for line in (root / ".env.local-stack").read_text().splitlines()
    if "=" in line
)
out = root / "backend/data/local-benign-capture.csv"
with psycopg.connect(
    f"postgresql://sentinel:{env['LOCAL_DB_PASSWORD']}@127.0.0.1:55432/sentinel_local"
) as c:
    c.execute("SET TRANSACTION READ ONLY")
    rows = c.execute("""SELECT packet_rate,byte_rate,bytes::float/packets,duration_seconds,protocol FROM sentinel.flows
 WHERE collector_id='local-independent-lab' AND source_ip<<inet '10.77.0.0/24' AND destination_ip<<inet '10.77.0.0/24'
 AND protocol IN (1,17) AND interval_seconds BETWEEN 25 AND 35 ORDER BY id""").fetchall()
if len(rows) < 50:
    raise ValueError("Wait for at least 50 actual measured windows")
with out.open("w") as h:
    w = csv.writer(h)
    w.writerow(
        [
            "packet_rate",
            "byte_rate",
            "mean_packet_size",
            "duration_seconds",
            "protocol",
            "label",
            "group_id",
        ]
    )
    for r in rows:
        w.writerow([*r, 0, "controlled-local-capture-20261101"])
out.with_suffix(".provenance.json").write_text(
    json.dumps(
        {
            "source": "Actual independent local Mininet run, three switches and three hosts; provided ICMP and two bounded 64-Kbit/s UDP workloads only",
            "label": 0,
            "label_authority": "Controlled workload configuration, not model predictions",
            "rows": len(rows),
            "captured_before": datetime.now(timezone.utc).isoformat(),
            "sha256": hashlib.sha256(out.read_bytes()).hexdigest(),
            "limitations": "Benign adaptation capture only. Restarted later run reserved for live verification; not production traffic.",
        },
        indent=2,
    )
)
print("Exported", len(rows), "actual controlled benign windows")
