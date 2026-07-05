"""Stage 9b deterministic assembly walk.

Builds a small fixture in an in-memory persona DB (storylines, declared_moments,
noise_effects, validation_log, planned_artifacts) and verifies the emitted
ideal_digests/morning_NN.json shape:
  - failed validations are excluded
  - corrected rationales / priorities override the originals
  - SHIFTED moments end up on their new target morning
  - CANCELED moments drop out
  - decoys appear in expected_suppressions
  - lifecycle_history records each transition
"""

import json
from datetime import date

from sqlmodel import Session

from persona_generator.db import engine_for, init_db, persona_dir
from persona_generator.models import (
    DeclaredMoment,
    MomentSupportingArtifact,
    NoiseEffect,
    NoiseEvent,
    PlannedArtifact,
    Storyline,
    ValidationLog,
)
from persona_generator.stages.stage_09b_assembly import run_stage_09b


SLUG = "test_assembly"


def _seed(temp_data_root):
    init_db(SLUG)
    with Session(engine_for(SLUG)) as session:
        session.add(Storyline(storyline_id="raise", display_name="Series A", arc_path="x"))
        session.commit()
    with Session(engine_for(SLUG)) as session:
        # An ordinary moment that should pass.
        session.add(
            DeclaredMoment(
                moment_id="m_pass",
                storyline_id="raise",
                target_morning="2026-05-21",  # Day 33
                section="urgent_todo",
                priority="P1",
                action_class="reply_short",
                rationale="Reply to Mary on diligence Q.",
            )
        )
        session.add(MomentSupportingArtifact(moment_id="m_pass", artifact_id="e_mary_q"))
        # A moment that should be SHIFTED from Day 30 to Day 33 via noise effect.
        session.add(
            DeclaredMoment(
                moment_id="m_shifted",
                storyline_id="raise",
                target_morning="2026-05-18",  # Day 30 originally
                section="decisions_approvals",
                priority="P0",
                action_class="decide",
                rationale="IC outcome decision.",
            )
        )
        # A moment that should be CANCELED.
        session.add(
            DeclaredMoment(
                moment_id="m_canceled",
                storyline_id="raise",
                target_morning="2026-05-21",
                section="urgent_todo",
                priority="P2",
                action_class="track",
                rationale="Backup arc; never surfaces.",
            )
        )
        # A moment that fails validation.
        session.add(
            DeclaredMoment(
                moment_id="m_fail",
                storyline_id="raise",
                target_morning="2026-05-21",
                section="urgent_todo",
                priority="P2",
                action_class="reply_short",
                rationale="Stale rationale.",
            )
        )
        # A moment that gets corrected.
        session.add(
            DeclaredMoment(
                moment_id="m_correct",
                storyline_id="raise",
                target_morning="2026-05-21",
                section="urgent_todo",
                priority="P0",
                action_class="reply_short",
                rationale="Original wrong-deadline rationale.",
            )
        )
        session.commit()

    with Session(engine_for(SLUG)) as session:
        session.add(
            NoiseEvent(
                noise_id="n_ic_pushed",
                storyline_id="raise",
                occurrence_date="2026-05-15",
            )
        )
        session.add(
            NoiseEvent(
                noise_id="n_cancel",
                storyline_id="raise",
                occurrence_date="2026-05-10",
            )
        )
        session.commit()

    with Session(engine_for(SLUG)) as session:
        session.add(
            NoiseEffect(
                noise_id="n_ic_pushed",
                target_moment_id="m_shifted",
                effect_kind="SHIFTED",
                effective_from="2026-05-15",
                new_target_morning="2026-05-21",
            )
        )
        session.add(
            NoiseEffect(
                noise_id="n_cancel",
                target_moment_id="m_canceled",
                effect_kind="CANCELED",
                effective_from="2026-05-10",
            )
        )
        session.commit()

    with Session(engine_for(SLUG)) as session:
        session.add(
            ValidationLog(
                moment_id="m_pass",
                status="pass",
                justification="Matches msg_mary.",
                validated_at="2026-05-21T07:00:00Z",
            )
        )
        session.add(
            ValidationLog(
                moment_id="m_shifted",
                status="pass",
                justification="IC moved per noise event.",
                validated_at="2026-05-21T07:00:00Z",
            )
        )
        # m_canceled has no validation row (it's filtered before validation)
        session.add(
            ValidationLog(
                moment_id="m_fail",
                status="fail",
                justification="action already taken",
                reason="action already taken on day 31",
                severity="major",
                validated_at="2026-05-21T07:00:00Z",
            )
        )
        session.add(
            ValidationLog(
                moment_id="m_correct",
                status="correct",
                justification="deadline is EOW, not today",
                corrected_rationale="Reply by Friday EOW, not today.",
                corrected_priority="P2",
                validated_at="2026-05-21T07:00:00Z",
            )
        )
        # Decoy that should appear as expected suppression on morning 33
        session.add(
            PlannedArtifact(
                artifact_id="d_stratechery",
                storyline_id="raise",
                target_render_date="2026-05-20",
                kind="email",
                content_sketch="Stratechery weekly",
                is_decoy=1,
            )
        )
        session.commit()


def test_morning_payload_filters_fail_and_canceled(temp_data_root):
    _seed(temp_data_root)
    result = run_stage_09b(slug=SLUG)
    assert "stage_09b_assembly" in result["completed_stages"]

    digest_dir = persona_dir(SLUG) / "ideal_digests"
    morning_33 = digest_dir / "morning_33.json"
    assert morning_33.exists()

    payload = json.loads(morning_33.read_text())
    moment_ids = [item["moment_id"] for item in payload["items"]]

    assert "m_pass" in moment_ids
    assert "m_shifted" in moment_ids  # SHIFTED to this morning
    assert "m_correct" in moment_ids  # corrected, still appears
    assert "m_canceled" not in moment_ids
    assert "m_fail" not in moment_ids


def test_corrected_rationale_overrides_original(temp_data_root):
    _seed(temp_data_root)
    run_stage_09b(slug=SLUG)
    morning_33 = persona_dir(SLUG) / "ideal_digests" / "morning_33.json"
    payload = json.loads(morning_33.read_text())
    corrected = next(it for it in payload["items"] if it["moment_id"] == "m_correct")
    assert corrected["rationale"] == "Reply by Friday EOW, not today."
    assert corrected["priority"] == "P2"  # overridden
    assert corrected["validation_status"] == "correct"


def test_lifecycle_history_present_for_shifted(temp_data_root):
    _seed(temp_data_root)
    run_stage_09b(slug=SLUG)
    morning_33 = persona_dir(SLUG) / "ideal_digests" / "morning_33.json"
    payload = json.loads(morning_33.read_text())
    shifted = next(it for it in payload["items"] if it["moment_id"] == "m_shifted")
    states = [h["state"] for h in shifted["lifecycle_history"]]
    assert states == ["DECLARED", "SHIFTED"]
    assert shifted["lifecycle_history"][1]["new_target"] == "2026-05-21"
    assert shifted["lifecycle_history"][1]["by"] == "n_ic_pushed"


def test_expected_suppressions_include_decoy(temp_data_root):
    _seed(temp_data_root)
    run_stage_09b(slug=SLUG)
    morning_33 = persona_dir(SLUG) / "ideal_digests" / "morning_33.json"
    payload = json.loads(morning_33.read_text())
    suppressed_ids = [s["artifact_id"] for s in payload["expected_suppressions"]]
    # decoy rendered 2026-05-20 (Day 32) — should appear in morning 33's suppressions
    # (cutoff is 2 days back)
    assert "d_stratechery" in suppressed_ids


def test_thirty_morning_files_written(temp_data_root):
    _seed(temp_data_root)
    run_stage_09b(slug=SLUG)
    digest_dir = persona_dir(SLUG) / "ideal_digests"
    files = sorted(digest_dir.glob("morning_*.json"))
    assert len(files) == 30  # Days 6 through 35
    assert files[0].name == "morning_06.json"
    assert files[-1].name == "morning_35.json"
