"""Service-emulator CLI.

  service-emulator serve <slug> [--host HOST] [--port PORT]
  service-emulator replay <slug> --webhook-url URL [--speedup N]
  service-emulator fire <slug> --webhook-url URL --after-iso T1 --through-iso T2

The ``serve`` command runs the REST (FastAPI/Uvicorn) frontend.
The ``replay`` command runs the webhook publisher across the synthetic window.
The ``fire`` command fires events in a specific time slice (useful for testing).
"""

from __future__ import annotations

import asyncio
from pathlib import Path

import typer
import uvicorn

from persona_generator.db import data_root

from .clock import DEFAULT_AS_OF_ISO, WINDOW_START_ISO
from .mcp.server import run_stdio_server
from .rest.app import build_app
from .rest.webhooks import WebhookConfig, fire_events_through, replay_window

app = typer.Typer(no_args_is_help=True, help="Service emulator CLI: REST + webhook publisher over a persona-generator SQLite DB.")


def _check_db(slug: str) -> None:
    db_path = data_root() / slug / "persona.db"
    if not db_path.exists():
        typer.echo(f"[error] no persona.db at {db_path}. Run `persona-gen generate run {slug}` first.", err=True)
        raise typer.Exit(code=1)


@app.command("serve")
def serve(
    slug: str = typer.Argument(..., help="Persona slug; reads data/personas/<slug>/persona.db"),
    host: str = typer.Option("127.0.0.1", "--host"),
    port: int = typer.Option(8000, "--port"),
):
    """Run the REST emulator (mail / calendar / notes) for one persona."""
    _check_db(slug)
    fastapi_app = build_app(slug)
    uvicorn.run(fastapi_app, host=host, port=port, log_level="info")


@app.command("replay")
def replay(
    slug: str = typer.Argument(..., help="Persona slug"),
    webhook_url: str = typer.Option(..., "--webhook-url", help="POST events here"),
    secret: str = typer.Option(None, "--secret", help="X-Webhook-Secret header value"),
    speedup: float = typer.Option(3600.0, "--speedup", help="Synthetic seconds per real second (default 3600 = 1 hr/sec)"),
    start_iso: str = typer.Option(WINDOW_START_ISO, "--start-iso"),
    end_iso: str = typer.Option(DEFAULT_AS_OF_ISO, "--end-iso"),
):
    """Walk the synthetic window in accelerated real time, POSTing events as they cross the clock."""
    _check_db(slug)
    config = WebhookConfig(url=webhook_url, secret=secret)
    totals = asyncio.run(
        replay_window(slug, config, start_iso=start_iso, end_iso=end_iso, speedup=speedup)
    )
    typer.echo(f"[replay] total={totals['total']} sent={totals['sent']} failed={totals['failed']}")


@app.command("fire")
def fire(
    slug: str = typer.Argument(..., help="Persona slug"),
    webhook_url: str = typer.Option(..., "--webhook-url"),
    after_iso: str = typer.Option(..., "--after-iso", help="Lower bound (exclusive)"),
    through_iso: str = typer.Option(..., "--through-iso", help="Upper bound (inclusive)"),
    secret: str = typer.Option(None, "--secret"),
):
    """Fire all events with after_iso < ts ≤ through_iso."""
    _check_db(slug)
    config = WebhookConfig(url=webhook_url, secret=secret)
    totals = asyncio.run(
        fire_events_through(slug, config, after_iso=after_iso, through_iso=through_iso)
    )
    typer.echo(f"[fire] total={totals['total']} sent={totals['sent']} failed={totals['failed']}")


@app.command("mcp")
def mcp(slug: str = typer.Argument(..., help="Persona slug")):
    """Run the MCP server (stdio transport). Use this from an MCP-capable client like Claude Code."""
    _check_db(slug)
    asyncio.run(run_stdio_server(slug))


def main() -> None:
    app()


if __name__ == "__main__":
    main()
