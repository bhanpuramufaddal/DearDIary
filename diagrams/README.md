# Myrico — Architecture Diagrams

Five executive-friendly diagrams for presenting the project. They tell one continuous story:

1. **First we generate a synthetic person.**
2. **Then we serve their life through a clock-controlled service.**
3. **Then an agent reads them and writes a morning brief.**
4. **Here's what happens to a single email along the way.**
5. **And here's the agent's memory — the part that actually matters.**

Each diagram is one [Excalidraw](https://excalidraw.com) `.excalidraw` file plus a rendered `.png`. Open the `.excalidraw` in [excalidraw.com](https://excalidraw.com) (drag-and-drop or File → Open) to edit; view the `.png` directly on GitHub.

| # | Diagram | What it shows |
|---|---|---|
| 1 | [`01-persona-generator-architecture`](01-persona-generator-architecture.png) | **Persona generator** — one paragraph in, 35 days of synthetic life out. A 7-station factory line with concrete output stats from the avery_chen reference dataset. |
| 2 | [`02-emulator-architecture`](02-emulator-architecture.png) | **Service emulator** — a clock-dial-as-knob metaphor. Turn the dial to any moment in the window; the agent sees exactly what would be visible at that time. |
| 3 | [`03-digest-agent-architecture`](03-digest-agent-architecture.png) | **Digest agent** — three small agents (Watcher, Morning Briefer, Setup Helper) share one notebook. Real-time bookkeeping all day + once-a-day deliberation at sunrise. |
| 4 | [`04-digest-agent-email-timeline`](04-digest-agent-email-timeline.png) | **One email's journey** — Mary sends Avery an email at Mon 4:47 PM. Three lanes (World · Watcher · Notebook) show what happens to it across the night until it surfaces in Avery's Tue 7:30 AM brief. |
| 5 | [`05-digest-agent-memory`](05-digest-agent-memory.png) | **The agent's memory** — five kinds of memory (Anchors · Entities · Predictions · Reminders · Plays) and the five transitions between them. Memory isn't flat; each kind has a different job. |

## Quick recommendation for a presentation

If you have 3 minutes: show **#1 → #2 → #5**. The persona generator (so they understand the inputs), the emulator (so they understand the framing), and the memory diagram (so they understand the agent's actual idea — triage-built memory).

If you have 10 minutes: show all five in order. The story is naturally cumulative — by #4 the audience already knows enough to follow the email's trip end-to-end, and #5 zooms back out to the conceptual core.

## Editing

To edit any diagram:

1. Open [excalidraw.com](https://excalidraw.com)
2. File → Open → pick the `.excalidraw` file
3. Edit
4. File → Save As → overwrite the file (keep the `.excalidraw` extension)
5. Re-render to PNG (see below)

## Re-rendering to PNG

The diagrams render via a small helper that ships with the `excalidraw-diagram` skill:

```bash
cd ~/.claude/skills/excalidraw-diagram/references
uv run python render_excalidraw.py /path/to/your/diagram.excalidraw
# writes /path/to/your/diagram.png next to it
```

## Notes on style

- The diagrams use a hand-drawn (`roughness: 1`) feel — friendlier for non-technical audiences than the crisper engineering style.
- Color encodes meaning: **green** = committed/output, **orange** = input/raw event, **purple** = AI agent or prediction, **blue** = system component or stable structure, **yellow** = callout / lessons-learned / coordination notes.
- No technical jargon in any label: no "MCP", "REST", "stdio", "WAL mode". The lowest-level term that appears is "REST" on diagram #2, and only because the three pipes coming out of the emulator are legitimately three different transports — paired with plain-English explanations.
