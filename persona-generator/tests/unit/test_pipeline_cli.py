"""CLI argument parsing + slug derivation."""

from persona_generator.pipeline import _derive_slug


def test_derive_slug_from_name():
    slug, name = _derive_slug("Avery Chen runs Tessera.")
    assert slug == "avery_chen"
    assert name == "Avery Chen"


def test_derive_slug_fallback():
    slug, name = _derive_slug("a generic prompt with no proper name")
    assert slug.startswith("persona_")
    assert name is None


def test_derive_slug_deterministic_fallback():
    slug_a, _ = _derive_slug("generic prompt")
    slug_b, _ = _derive_slug("generic prompt")
    assert slug_a == slug_b
