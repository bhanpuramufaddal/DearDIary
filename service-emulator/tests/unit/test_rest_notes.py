"""Notes REST: list + get markdown."""

from fastapi.testclient import TestClient

from service_emulator.rest.app import build_app


def test_list_notes(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/notes")
    body = r.json()
    assert body["count"] == 1
    assert body["notes"][0]["note_id"] == "n1"


def test_get_note_markdown_has_frontmatter(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/notes/n1")
    assert r.status_code == 200
    assert r.headers["content-type"].startswith("text/markdown")
    body = r.text
    assert body.startswith("---")
    assert "x_synth_storyline: s1" in body
    assert "dataroom — Mary 4 views" in body


def test_get_note_404_when_not_visible(seeded_db):
    client = TestClient(build_app(seeded_db))
    r = client.get("/notes/n1", params={"as_of": "2026-04-24T05:00:00-07:00"})
    assert r.status_code == 404
