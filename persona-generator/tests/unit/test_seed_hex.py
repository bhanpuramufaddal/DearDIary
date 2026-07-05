"""Stage 0 seed_hex is deterministic on prompt text."""

from persona_generator.stages.stage_00_spec import derive_seed_hex


def test_same_prompt_same_seed_hex():
    p = "Avery Chen runs Tessera, a 12-person seed-stage B2B SaaS."
    assert derive_seed_hex(p) == derive_seed_hex(p)


def test_different_prompts_different_seed_hex():
    a = derive_seed_hex("Avery Chen runs Tessera.")
    b = derive_seed_hex("Vikram Mehta trades equities.")
    assert a != b


def test_seed_hex_is_16_chars():
    assert len(derive_seed_hex("anything")) == 16
