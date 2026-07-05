"""CLI entrypoint: `persona-gen new` / `generate`.

Phase A wires only Stage 0 into ``generate``. Later phases extend the graph.
"""

from __future__ import annotations

import hashlib
import re
import sys
from pathlib import Path
from typing import Any

import typer
import yaml
from sqlmodel import Session, select

from .db import data_root, engine_for, init_db, persona_dir
from .graph import build_pipeline
from .models import Persona
from .stages.stage_00_spec import (
    WINDOW_END,
    WINDOW_START,
    derive_seed_hex,
    run_stage_00,
)

app = typer.Typer(no_args_is_help=True, help="Persona generator CLI.")
generate_app = typer.Typer(no_args_is_help=True, help="Run the generation pipeline.")
app.add_typer(generate_app, name="generate")


def _repo_root() -> Path:
    return Path(__file__).resolve().parents[3]


def _personas_yaml_dir() -> Path:
    p = _repo_root() / "personas"
    p.mkdir(parents=True, exist_ok=True)
    return p


def _derive_slug(prompt_text: str) -> tuple[str, str | None]:
    """Pull a 'First Last' pattern from the prompt; fallback to prompt-hash.

    Returns (slug, display_name_hint).
    """
    m = re.search(r"\b([A-Z][a-z]+)\s+([A-Z][a-z]+)\b", prompt_text)
    if m:
        first, last = m.group(1), m.group(2)
        slug = f"{first.lower()}_{last.lower()}"
        return slug, f"{first} {last}"
    short = hashlib.sha256(prompt_text.encode("utf-8")).hexdigest()[:10]
    return f"persona_{short}", None


@app.command("new")
def new(prompt: str = typer.Argument(..., help="Free-form persona description.")):
    """Create a persona seed (Stage 0). Idempotent: warns and exits 0 if already present."""
    slug, name_hint = _derive_slug(prompt)
    yaml_path = _personas_yaml_dir() / f"{slug}.yaml"

    init_db(slug)
    with Session(engine_for(slug)) as session:
        existing = session.exec(select(Persona).where(Persona.slug == slug)).first()
        already_complete = existing is not None and yaml_path.exists()

    if already_complete:
        typer.echo(f"[skip] {slug}: already exists (yaml + DB row). Use `generate {slug} --from-stage 0` to re-run.")
        raise typer.Exit(code=0)

    typer.echo(f"[stage_00] slug={slug} seed_hex={derive_seed_hex(prompt)} window={WINDOW_START}..{WINDOW_END}")
    update = run_stage_00(slug=slug, prompt_text=prompt, name_hint=name_hint)
    if update.get("errors"):
        for err in update["errors"]:
            typer.echo(f"[error] {err.get('stage')}: {err.get('message')}", err=True)
        raise typer.Exit(code=1)

    typer.echo(f"[ok] {slug}: yaml + persona row + persona_origin.md written.")


@generate_app.command("run")
def generate_run(
    slug: str = typer.Argument(..., help="Persona slug (matches personas/<slug>.yaml)."),
    from_stage: int | None = typer.Option(None, "--from-stage", help="Jump to stage N (clears completed_stages from N onward)."),
    resume: bool = typer.Option(False, "--resume", help="Pick up from the LangGraph checkpoint."),
):
    """Run the pipeline for one persona."""
    yaml_path = _personas_yaml_dir() / f"{slug}.yaml"
    if not yaml_path.exists():
        typer.echo(f"[error] no persona yaml at {yaml_path}. Run `persona-gen new \"<prompt>\"` first.", err=True)
        raise typer.Exit(code=1)
    meta = yaml.safe_load(yaml_path.read_text(encoding="utf-8"))

    initial_state: dict[str, Any] = {
        "persona_slug": slug,
        "persona_name": meta.get("name"),
        "prompt_text": meta["prompt_text"],
        "working_dir": persona_dir(slug),
        "window_start_date": meta.get("window_start_date", WINDOW_START),
        "window_end_date": meta.get("window_end_date", WINDOW_END),
        "completed_stages": [],
        "stage_outputs": {},
        "errors": [],
    }

    init_db(slug)
    graph, saver_ctx = build_pipeline(slug)
    with saver_ctx as saver:
        compiled = graph.compile(checkpointer=saver)
        config = {"configurable": {"thread_id": slug}}
        final_state = compiled.invoke(initial_state, config=config)

    if final_state.get("errors"):
        typer.echo("[error] pipeline reported failures:", err=True)
        for err in final_state["errors"]:
            typer.echo(f"  {err.get('stage')}: {err.get('message')}", err=True)
        raise typer.Exit(code=1)

    typer.echo(f"[ok] generate {slug}: completed stages = {final_state.get('completed_stages', [])}")


@generate_app.command("all")
def generate_all():
    """Run `generate run` for every persona yaml on disk."""
    yamls = sorted(_personas_yaml_dir().glob("*.yaml"))
    if not yamls:
        typer.echo("[skip] no personas/*.yaml files found.", err=True)
        raise typer.Exit(code=1)
    for y in yamls:
        slug = y.stem
        typer.echo(f"\n=== {slug} ===")
        generate_run(slug=slug, from_stage=None, resume=False)


@app.command("inspect")
def inspect(
    slug: str,
    table: str | None = typer.Option(None, "--table", help="Table to query (default: list tables)."),
    limit: int = typer.Option(20, "--limit"),
):
    """Quick read-only query against persona.db."""
    import sqlite3

    path = data_root() / slug / "persona.db"
    if not path.exists():
        typer.echo(f"[error] no DB at {path}", err=True)
        raise typer.Exit(code=1)
    conn = sqlite3.connect(str(path))
    try:
        if table:
            for row in conn.execute(f"SELECT * FROM {table} LIMIT {limit}"):
                typer.echo(row)
        else:
            for row in conn.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"):
                typer.echo(row[0])
    finally:
        conn.close()


def main() -> None:
    app()


if __name__ == "__main__":
    main()
