"""RC-9 regression: ``session.exec(select(SomeModel.column)).all()`` returns a
flat list of scalars, NOT a list of single-element tuples. The Stage 5 RI
sweep originally tuple-destructured the result (``for (id,) in rows``) and
raised ``ValueError: too many values to unpack`` because each element was
already a plain string. This test pins the SQLModel scalar-return contract."""

from __future__ import annotations

from sqlmodel import Session, select

from persona_generator.db import engine_for, init_db
from persona_generator.models import Cast


def test_select_single_column_returns_scalars(temp_data_root):
    slug = "test_select"
    init_db(slug)
    engine = engine_for(slug)
    with Session(engine) as session:
        session.add(Cast(cast_id="a", display_name="A", signal_tier="p0", role_brief=""))
        session.add(Cast(cast_id="b", display_name="B", signal_tier="p1", role_brief=""))
        session.commit()

    with Session(engine) as session:
        ids = session.exec(select(Cast.cast_id)).all()

    assert sorted(ids) == ["a", "b"]
    # The whole point of the regression: each element is a string, not a 1-tuple.
    assert all(isinstance(x, str) for x in ids), (
        f"expected list[str], got element types: {[type(x).__name__ for x in ids]}"
    )
