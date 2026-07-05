"""FastAPI app factory.

Each persona is served by its own emulator instance. The app is constructed
with the persona slug at startup; all routes read from
``data/personas/<slug>/persona.db``.
"""

from __future__ import annotations

from fastapi import FastAPI

from .mail import router as mail_router
from .calendar import router as calendar_router
from .notes import router as notes_router


def build_app(slug: str) -> FastAPI:
    app = FastAPI(
        title=f"service-emulator: {slug}",
        version="0.1.0",
        description=(
            "Read-only emulator over the persona-generator's SQLite DB for "
            f"persona '{slug}'. All endpoints accept an `as_of` ISO 8601 "
            "query param to filter artifacts to those with synthetic "
            "timestamps ≤ as_of (default: end of window)."
        ),
    )
    # Stash slug on app state so routes can read it without re-passing.
    app.state.slug = slug

    app.include_router(mail_router, prefix="/mail", tags=["mail"])
    app.include_router(calendar_router, prefix="/calendar", tags=["calendar"])
    app.include_router(notes_router, prefix="/notes", tags=["notes"])

    @app.get("/", tags=["meta"])
    def root():
        return {
            "slug": slug,
            "services": ["mail", "calendar", "notes"],
            "as_of_default": "2026-05-23T23:59:59-07:00",
            "as_of_format": "ISO 8601 with TZ offset (or YYYY-MM-DD for end-of-day Pacific)",
        }

    return app
