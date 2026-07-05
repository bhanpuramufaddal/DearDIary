#!/usr/bin/env bash
# Launch digest-agent in persona-emulator test mode.
#
# Loads .env.testmode (in the repo root) and runs `npm start`. The script
# refuses to run if the configured persona DB hasn't been generated yet
# so the failure mode is "obvious cause" instead of "obscure crash deep in boot".
#
# Usage:   npm run start:test
#   or:    bash scripts/start-test.sh

set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
cd "$ROOT"

if [ ! -f .env.testmode ]; then
  echo "[start-test] missing .env.testmode in $ROOT" >&2
  exit 1
fi

set -a
# Layered env loading, lowest precedence first (set -a → last-wins):
#   1. ../.env (myrico monorepo shared: LANGFUSE_* + ANTHROPIC_API_KEY)
#   2. ./.env  (per-project override, if it exists)
#   3. .env.testmode (test-only — highest precedence)
if [ -f ../.env ]; then
  # shellcheck disable=SC1091
  source ../.env
fi
if [ -f .env ]; then
  # shellcheck disable=SC1091
  source .env
fi
# shellcheck disable=SC1091
source .env.testmode
set +a

if [ -z "${DIGEST_TEST_PERSONA:-}" ]; then
  echo "[start-test] DIGEST_TEST_PERSONA not set in .env.testmode" >&2
  exit 1
fi

PERSONA_DB="$ROOT/../data/personas/$DIGEST_TEST_PERSONA/persona.db"
if [ ! -f "$PERSONA_DB" ]; then
  echo "[start-test] persona DB not found: $PERSONA_DB" >&2
  echo "[start-test] generate it first:" >&2
  echo "  cd ../persona-generator && uv run persona-gen generate run $DIGEST_TEST_PERSONA" >&2
  exit 1
fi

# Seed the sandbox profile.md from the persona's profile so the cold-start agent
# can seed the _principal anchor on boot. Without this, the principal anchor
# never exists in test mode (cold-start only fires on profile.md changes).
PERSONA_PROFILE="$ROOT/../data/personas/$DIGEST_TEST_PERSONA/profile.md"
if [ -f "$PERSONA_PROFILE" ]; then
  mkdir -p "$DIGEST_DIR"
  cp "$PERSONA_PROFILE" "$DIGEST_DIR/profile.md"
  echo "[start-test] seeded $DIGEST_DIR/profile.md from $PERSONA_PROFILE"
else
  echo "[start-test] WARNING: $PERSONA_PROFILE not found — _principal anchor will not seed." >&2
fi

if [ -z "${ANTHROPIC_API_KEY:-}" ]; then
  echo "[start-test] WARNING: ANTHROPIC_API_KEY is not set — mind dispatcher will fail to spawn Claude Code." >&2
fi

echo "[start-test] persona=$DIGEST_TEST_PERSONA rate=${DIGEST_TEST_PERSONA_RATE:-5/sec} clock_start=${DIGEST_TEST_CLOCK_START}"
exec npm start
