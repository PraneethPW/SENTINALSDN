from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from app.detector import Detector, features
from app.schemas import Flow


def sample(**changes):
    return {
        "observed_at": datetime.now(timezone.utc),
        "switch_id": "1",
        "source_ip": "10.0.0.1",
        "destination_ip": "10.0.0.2",
        "protocol": 6,
        "destination_port": 443,
        "packets": 100,
        "bytes": 10000,
        "interval_seconds": 5,
        "duration_seconds": 60,
    } | changes


@pytest.mark.parametrize(
    "changes",
    [
        {"interval_seconds": 0},
        {"interval_seconds": float("nan")},
        {"packets": -1},
        {"source_ip": "127.0.0.0/8"},
        {"protocol": 999},
        {"bytes": 50},
        {"observed_at": datetime.now(timezone.utc) + timedelta(minutes=10)},
        {"observed_at": datetime.now()},
        {"protocol": 1},
    ],
)
def test_invalid_measurements_rejected(changes):
    with pytest.raises(ValidationError):
        Flow(**sample(**changes))


def test_feature_contract_uses_window_deltas():
    assert features(Flow(**sample())) == [20, 2000, 100, 60, 6]


def test_no_model_never_claims_benign_or_attack():
    assert Detector().predict([Flow(**sample())]) == [("unclassified", None)]


def test_production_rejects_disabled_database_tls():
    from app.config import Settings

    with pytest.raises(ValidationError):
        Settings(
            _env_file=None,
            environment="production",
            database_url="postgresql://test@host/db?sslmode=disable",
            collector_token="x" * 40,
            cors_origins="https://sentinel.example",
        )
