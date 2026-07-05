"""REST mail routes: as_of filter, attachment fetch, thread list."""

from fastapi.testclient import TestClient

from service_emulator.rest.app import build_app


def test_list_filters_by_as_of(seeded_db):
    client = TestClient(build_app(seeded_db))
    # at 04:00 on Apr 24, only the decoy (sent 03:00) is visible
    r = client.get("/mail/messages", params={"as_of": "2026-04-24T04:00:00-07:00"})
    assert r.status_code == 200
    body = r.json()
    ids = [m["message_id"] for m in body["messages"]]
    assert ids == ["<decoy@x>"]


def test_list_all_at_window_end(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/mail/messages")
    body = r.json()
    assert body["count"] == 3


def test_decoy_filter(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/mail/messages", params={"decoy": True})
    body = r.json()
    assert body["count"] == 1
    assert body["messages"][0]["is_decoy"] is True


def test_get_message_returns_rfc822(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/mail/messages/<late@x>")
    assert r.status_code == 200
    assert "message/rfc822" in r.headers["content-type"]
    body = r.text
    assert "Subject: Re: Q1 metrics" in body
    assert "X-Synth-Artifact-ID: a3" in body
    # attachment present
    assert "q1_metrics.csv" in body


def test_get_message_404_when_not_yet_visible(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/mail/messages/<late@x>", params={"as_of": "2026-04-24T12:00:00-07:00"})
    assert r.status_code == 404


def test_get_attachment_bytes(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/mail/messages/<late@x>/attachments/att1")
    assert r.status_code == 200
    assert r.headers["content-type"] == "text/csv; charset=utf-8" or r.headers["content-type"].startswith("text/csv")
    assert b"1100000" in r.content
