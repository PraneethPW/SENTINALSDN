from copy import deepcopy

from collector.agent import CounterTracker


def entry(packets=100, byte_count=10000, duration=10):
    return {
        "match": {"ipv4_src": "10.0.0.1", "ipv4_dst": "10.0.0.2", "ip_proto": 6, "tcp_dst": 443},
        "packet_count": packets,
        "byte_count": byte_count,
        "duration_sec": duration,
        "duration_nsec": 0,
        "cookie": 0,
        "table_id": 0,
        "priority": 100,
        "actions": ["OUTPUT:2"],
    }


def test_first_counter_is_baseline_not_traffic():
    tracker = CounterTracker()
    assert tracker.window("1", entry(), 10, "2026-01-01T00:00:00Z") is None
    window = tracker.window("1", entry(150, 15000, 15), 15, "2026-01-01T00:00:05Z")
    assert window["packets"] == 50
    assert window["bytes"] == 5000
    assert window["interval_seconds"] == 5


def test_counter_reset_does_not_make_negative_rates():
    tracker = CounterTracker()
    tracker.window("1", entry(), 10, "")
    assert tracker.window("1", entry(5, 500, 1), 15, "") is None
    assert tracker.window("1", entry(15, 1500, 6), 20, "")["packets"] == 10


def test_drop_and_wildcard_entries_are_not_telemetry():
    tracker = CounterTracker()
    blocked = entry()
    blocked["actions"] = []
    assert tracker.window("1", blocked, 10, "") is None
    wildcard = entry()
    wildcard["match"]["ipv4_src"] = "10.0.0.0/24"
    assert tracker.window("1", wildcard, 10, "") is None


def test_reinstalled_flow_resets_baseline_even_if_counters_increase():
    tracker = CounterTracker()
    tracker.window("1", entry(), 10, "")
    assert tracker.window("1", entry(150, 15000, 2), 15, "") is None


def test_distinct_match_entries_have_separate_counters():
    tracker = CounterTracker()
    tracker.window("1", entry(), 10, "")
    other = deepcopy(entry(150, 15000, 15))
    other["match"]["tcp_dst"] = 80
    assert tracker.window("1", other, 15, "") is None
