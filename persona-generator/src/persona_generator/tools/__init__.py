"""Structured-output tools the agents call.

Each tool is built by a small factory that closes over the persona slug, since
the per-persona SQLite location is determined by it. Pattern:

    from persona_generator.tools.persona_spec import build_write_persona_spec
    tool = build_write_persona_spec(slug="avery_chen")
    # `tool` is an SdkMcpTool[...] usable in claude-agent-sdk
"""
