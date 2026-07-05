"""Calendar replay + as_of filtering."""

from fastapi.testclient import TestClient

from service_emulator.rest.app import build_app


def test_initial_events_visible_before_any_ops(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/calendar/events", params={"as_of": "2026-04-23T12:00:00-07:00"})
    body = r.json()
    # Both initial events present, neither modified
    times = {ev["event_id"]: ev["start_iso"] for ev in body["events"]}
    assert times["e_standup"] == "2026-04-20T10:00:00-07:00"
    assert times["e_board"] == "2026-05-14T10:00:00-07:00"


def test_move_op_applied(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/calendar/events", params={"as_of": "2026-04-24T12:00:00-07:00"})
    body = r.json()
    standup = next(ev for ev in body["events"] if ev["event_id"] == "e_standup")
    assert standup["start_iso"] == "2026-04-24T11:00:00-07:00"
    assert standup["sequence"] >= 1


def test_cancel_op_filters_by_default(seeded_db):
    client = TestClient(build_app(seeded_db))
    # After Apr 25 cancel, e_board is gone by default
    r = client.get("/calendar/events", params={"as_of": "2026-04-26T00:00:00-07:00"})
    body = r.json()
    ids = [ev["event_id"] for ev in body["events"]]
    assert "e_board" not in ids
    # but visible with include_cancelled
    r = client.get("/calendar/events", params={"as_of": "2026-04-26T00:00:00-07:00", "include_cancelled": True})
    body = r.json()
    cancelled = next(ev for ev in body["events"] if ev["event_id"] == "e_board")
    assert cancelled["status"] == "CANCELLED"


def test_ics_renders(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/calendar/ics")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/calendar")
    body = r.text
    assert "BEGIN:VCALENDAR" in body
    assert "BEGIN:VEVENT" in body
    assert "STATUS:CANCELLED" in body
