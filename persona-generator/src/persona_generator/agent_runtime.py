"""Wrapper around claude-agent-sdk's `query()`.

`run_agent(...)` hosts one ReAct agent loop for one stage. It:
  - Builds an in-process MCP server from the caller's structured tools.
  - Sets cwd to ``data/personas/<slug>/``.
  - Logs every assistant turn + tool call to JSONL (one file per run) and
    INSERTs rows into ``agent_runs`` / ``agent_tool_calls`` for observability.
  - On the agent's terminal turn, invokes ``verifier(slug)`` to check expected
    outputs. Returns ``RunResult`` with success/failure + missing-outputs list.

This file's surface is intentionally narrow. Per-stage code does NOT touch the
SDK directly; it constructs typed tools (via @tool) and hands them in.
"""

from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, Iterable

import anyio
from claude_agent_sdk import (
    AssistantMessage,
    ClaudeAgentOptions,
    ResultMessage,
    SdkMcpTool,
    SystemMessage,
    TextBlock,
    ToolUseBlock,
    UserMessage,
    create_sdk_mcp_server,
    query,
)
from sqlmodel import Session

from .db import engine_for, persona_dir
from .models import AgentRun, AgentToolCall, LlmCall

DEFAULT_MODEL = "claude-opus-4-7"
HAIKU_MODEL = "claude-haiku-4-5-20251001"  # used by artifact-rendering stages (7, 8)

# Single global cap. Functions as an infinite-loop safety guard, not a budget
# the agent has to optimize against. Per-stage overrides are forbidden — every
# stage inherits this. If a stage genuinely approaches this number something
# is wrong with the prompt or the tool design, not the cap.
MAX_TURNS_DEFAULT = 1000


@dataclass
class RunResult:
    run_id: str
    success: bool
    missing_outputs: list[str] = field(default_factory=list)
    error: str | None = None


def _iso_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def run_agent(
    *,
    stage_id: str,
    slug: str,
    system_prompt: str,
    user_prompt: str,
    structured_tools: Iterable[SdkMcpTool[Any]] = (),
    allowed_file_tools: Iterable[str] = (),
    verifier: Callable[[str], tuple[bool, list[str]]] | None = None,
    max_turns: int = MAX_TURNS_DEFAULT,
    model: str = DEFAULT_MODEL,
) -> RunResult:
    """Run a single agent invocation for one stage. Synchronous wrapper."""
    return anyio.run(
        _run_agent_async,
        stage_id,
        slug,
        system_prompt,
        user_prompt,
        tuple(structured_tools),
        tuple(allowed_file_tools),
        verifier,
        max_turns,
        model,
    )


async def _run_agent_async(
    stage_id: str,
    slug: str,
    system_prompt: str,
    user_prompt: str,
    structured_tools: tuple[SdkMcpTool[Any], ...],
    allowed_file_tools: tuple[str, ...],
    verifier: Callable[[str], tuple[bool, list[str]]] | None,
    max_turns: int,
    model: str,
) -> RunResult:
    run_id = f"{stage_id}_{uuid.uuid4().hex[:12]}"
    started_at = _iso_now()
    cwd = persona_dir(slug)
    cwd.mkdir(parents=True, exist_ok=True)
    turn_log_dir = cwd / "agent_turns"
    turn_log_dir.mkdir(exist_ok=True)
    turn_log_path = turn_log_dir / f"{stage_id}_{run_id}.jsonl"

    # Insert the AgentRun row up front so partial runs are observable.
    engine = engine_for(slug)
    with Session(engine) as session:
        session.add(
            AgentRun(
                run_id=run_id,
                stage_id=stage_id,
                started_at=started_at,
                finished_at=None,
                success=None,
            )
        )
        session.commit()

    # Compose options
    server_name = f"{stage_id}_tools"
    mcp_server = (
        create_sdk_mcp_server(name=server_name, tools=list(structured_tools))
        if structured_tools
        else None
    )
    allowed_tool_names: list[str] = list(allowed_file_tools)
    for t in structured_tools:
        # SDK convention: mcp__<server>__<tool>
        allowed_tool_names.append(f"mcp__{server_name}__{t.name}")

    options = ClaudeAgentOptions(
        model=model,
        system_prompt=system_prompt,
        cwd=str(cwd),
        mcp_servers={server_name: mcp_server} if mcp_server else {},
        allowed_tools=allowed_tool_names,
        max_turns=max_turns,
        permission_mode="bypassPermissions",
    )

    log_fp = turn_log_path.open("w", encoding="utf-8")
    error: str | None = None
    tool_calls: list[dict[str, Any]] = []
    llm_calls: list[dict[str, Any]] = []

    try:
        async for message in query(prompt=user_prompt, options=options):
            entry = {
                "ts_iso": _iso_now(),
                "kind": type(message).__name__,
            }
            if isinstance(message, AssistantMessage):
                blocks_out: list[dict[str, Any]] = []
                for blk in message.content:
                    if isinstance(blk, TextBlock):
                        blocks_out.append({"type": "text", "text": blk.text})
                    elif isinstance(blk, ToolUseBlock):
                        blocks_out.append(
                            {
                                "type": "tool_use",
                                "name": blk.name,
                                "input": blk.input,
                                "id": blk.id,
                            }
                        )
                        tool_calls.append(
                            {
                                "ts_iso": entry["ts_iso"],
                                "tool_name": blk.name,
                                "args_json": json.dumps(blk.input, default=str),
                            }
                        )
                entry["content"] = blocks_out
            elif isinstance(message, UserMessage):
                entry["content"] = _serialize_user(message.content)
            elif isinstance(message, ResultMessage):
                entry["result_subtype"] = message.subtype
                entry["is_error"] = message.is_error
                if message.usage:
                    llm_calls.append(
                        {
                            "ts_iso": entry["ts_iso"],
                            "model": model,
                            "prompt_tokens": message.usage.get("input_tokens"),
                            "completion_tokens": message.usage.get("output_tokens"),
                            "cache_read_tokens": message.usage.get(
                                "cache_read_input_tokens"
                            ),
                            "cache_write_tokens": message.usage.get(
                                "cache_creation_input_tokens"
                            ),
                            "success": 0 if message.is_error else 1,
                        }
                    )
            elif isinstance(message, SystemMessage):
                entry["subtype"] = message.subtype
            log_fp.write(json.dumps(entry, default=str) + "\n")
            log_fp.flush()
    except Exception as exc:  # noqa: BLE001
        error = f"{type(exc).__name__}: {exc}"
    finally:
        log_fp.close()

    # Persist tool / LLM call rows for observability
    finished_at = _iso_now()
    with Session(engine) as session:
        for tc in tool_calls:
            session.add(
                AgentToolCall(
                    run_id=run_id,
                    ts_iso=tc["ts_iso"],
                    tool_name=tc["tool_name"],
                    args_json=tc["args_json"],
                )
            )
        for lc in llm_calls:
            session.add(
                LlmCall(
                    call_id=f"{run_id}_{uuid.uuid4().hex[:8]}",
                    run_id=run_id,
                    ts_iso=lc["ts_iso"],
                    model=lc["model"],
                    prompt_tokens=lc.get("prompt_tokens"),
                    completion_tokens=lc.get("completion_tokens"),
                    cache_read_tokens=lc.get("cache_read_tokens"),
                    cache_write_tokens=lc.get("cache_write_tokens"),
                    success=lc.get("success"),
                )
            )
        session.commit()

    # Run verifier (even if the SDK reported a terminal error — the agent may have
    # produced its outputs before the error fired; the on-disk state is authoritative).
    missing: list[str] = []
    if verifier is not None:
        try:
            ok, missing = verifier(slug)
        except Exception as exc:  # noqa: BLE001
            ok = False
            error = error or f"verifier crashed: {type(exc).__name__}: {exc}"
        else:
            if ok and error:
                # Outputs are correct on disk; downgrade the SDK error to a non-fatal note.
                error = f"sdk_warning: {error}"
    else:
        ok = error is None

    # Update the AgentRun row
    with Session(engine) as session:
        row = session.get(AgentRun, run_id)
        if row is not None:
            row.finished_at = finished_at
            row.success = 1 if ok else 0
            row.error = error
            session.add(row)
            session.commit()

    return RunResult(
        run_id=run_id,
        success=ok,
        missing_outputs=missing,
        error=error,
    )


def _serialize_user(content: Any) -> Any:
    """User messages from the SDK loop carry tool_result blocks. Reduce them to JSON-friendly shape."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        out = []
        for blk in content:
            if hasattr(blk, "content") and hasattr(blk, "tool_use_id"):
                out.append(
                    {
                        "type": "tool_result",
                        "tool_use_id": blk.tool_use_id,
                        "content": blk.content,
                    }
                )
            else:
                out.append(str(blk))
        return out
    return str(content)


def verify_file_exists(slug: str, *relpaths: str) -> tuple[bool, list[str]]:
    """Helper verifier: every relpath must exist under data/personas/<slug>/."""
    base = persona_dir(slug)
    missing = [str(p) for p in relpaths if not (base / p).exists()]
    return (not missing, missing)


