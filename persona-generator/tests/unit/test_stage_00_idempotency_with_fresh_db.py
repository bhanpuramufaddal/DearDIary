"""RC-9 regression: ``stage_00_spec._already_complete`` runs BEFORE the
orchestrator's ``init_db`` does on the first invocation for a new persona. The
function must therefore initialize the DB itself before querying, and return
``False`` (not raise) on a slug whose persona.db file does not yet exist."""

from __future__ import annotations

from persona_generator.db import persona_dir
from persona_generator.stages.stage_00_spec import _already_complete


def test_already_complete_returns_false_without_raising_on_fresh_slug(temp_data_root):
    slug = "nonexistent_slug"
    # No init_db() call here. The function must handle this itself.
    assert _already_complete(slug) is False
    # And init_db should have been invoked as a side effect (persona.db now exists).
    db_path = persona_dir(slug) / "persona.db"
    assert db_path.exists(), (
        "_already_complete is expected to call init_db internally so the "
        "verifier has somewhere to query — persona.db should exist after the call."
    )
