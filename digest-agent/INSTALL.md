# Installing Digest

Digest is a Mac app that watches your inbox and calendar in the background and composes a personal diary you read instead of triaging directly. Two diary ticks per day, plus a Claude Code `/digest_run` command to compose one on demand.

This guide is for trial principals. It assumes you have a recent macOS, Homebrew, and Anthropic API access.

---

## 1. One-time prerequisites

- **Claude Code CLI** — `claude` on your `PATH`. Verify with `claude --version`.
- **Anthropic API key** — export it before launching Digest:
  ```sh
  export ANTHROPIC_API_KEY="sk-ant-…"
  ```
  Add the line to `~/.zshrc` (or `~/.bash_profile`) so it persists.
- **ngrok account (free)** — sign up at ngrok.com, copy your authtoken from `Tunnels → Authtokens`, and set:
  ```sh
  export NGROK_AUTHTOKEN="…"
  ```
  Digest manages ngrok for you — you don't need to run `ngrok` manually.

## 2. Install Digest

Double-click the `Digest Agent.dmg` you received, drag the app to Applications. The first launch walks you through:

1. Your timezone (auto-detected; correct if wrong)
2. When the diary should recompose (defaults to 6:00; add a second time like 21:00 for end-of-day)
3. Tunnel choice (keep ngrok unless you have your own reverse proxy)
4. Model choices (defaults are good — Opus for the diary, Sonnet for the rest)

On finish, Digest writes `~/digest/config.jsonc` and is ready.

## 3. Tell it about you

Drop a `profile.md` into `~/digest/`. A short biography is enough:

```markdown
# Avery

I run a 6-person SaaS startup in Berkeley. Cofounder is Marcus Webb.
Top-of-mind right now: closing the seed round, finalizing the cap table,
shipping the v2 onboarding flow.

Calendar-blocked Tue/Thu mornings for deep work.
Slack/Email triage twice a day, not in between.
```

Save the file. Digest notices the change (within ~2 seconds), spawns a cold-start
agent that reads `profile.md`, and seeds the substrate with anchors for the
people and projects you mentioned. Open the Inspector window (tray → Inspector)
to watch this happen.

## 4. Connect event sources

In the tray menu choose Settings, scroll to **MCP servers**, and add the integrations
you want. Common ones:

| MCP server id | What it does |
|---------------|--------------|
| `gmail-mcp`   | Reads your Gmail (event source = webhook for new mail) |
| `gcal-mcp`    | Reads your Google Calendar |
| `slack-mcp`   | Reads Slack channels you grant access to |

Each MCP server is its own subprocess; Digest spawns it on demand. Save and
restart Digest to pick up new MCPs.

## 5. Read your diary

Tray → "Today's diary" — opens the journal-styled window. Six template kinds:

- **Email draft** — pre-composed reply you can send or tweak
- **Calendar block** — decisions about scheduling
- **Doc tile** — documents the agent wants you to read
- **Choose one** — forced multi-choice when the agent isn't sure
- **Free-text reply** — open-ended composition

Click Send / Accept / etc. and the execution agent acts on the world. The
marginalia glyph in the left margin updates ("acted" check, "closed" dash,
"dismissed" X).

Add comments inline. Add bottom-of-page notes. The mind agent processes both.

## 6. Use Claude Code with `/digest`

Add Digest's surface MCP to your Claude Code config. In `~/.claude/mcp.json`:

```json
{
  "mcpServers": {
    "digest": {
      "command": "/Applications/Digest Agent.app/Contents/MacOS/Digest Agent",
      "args": [
        "/Applications/Digest Agent.app/Contents/Resources/app.asar/dist/main/mcp/surface/server.js",
        "--db=/Users/YOU/digest/digest.db",
        "--digest-dir=/Users/YOU/digest"
      ],
      "env": { "ELECTRON_RUN_AS_NODE": "1" }
    }
  }
}
```

Then in any Claude Code session: `/digest_run` composes a fresh diary now and
returns the JSON. `/digest_get` returns today's diary without recomposing.

## 7. Troubleshooting

- **Tunnel down** — the tray title shows `Digest⚠`. Choose "Restart tunnel" from
  the menu. Check `NGROK_AUTHTOKEN` is set.
- **Nothing in the diary** — make sure `profile.md` exists and a diary time is
  set in the future; or open Claude Code and run `/digest_run`.
- **MCP server missing** — Settings → MCP servers — verify the command and that
  the binary is on PATH.
- **Reset everything** — quit, delete `~/digest/`, relaunch. The onboarding
  wizard runs again. Your config + memory are gone.

## What lives where

- `~/digest/config.jsonc` — your settings (edit through Settings or directly)
- `~/digest/profile.md` — your bio; changes trigger a cold-start
- `~/digest/digest.db` — SQLite database with the cognitive substrate + diary
- `~/digest/logs/` — agent invocation logs (useful for debugging)
- `~/digest/<role>-agent.md` (optional) — overrides for the bundled agent prompts
