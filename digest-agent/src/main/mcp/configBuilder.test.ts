import { describe, it, expect } from 'vitest';
import { buildMcpConfig } from './configBuilder.js';
import type { AppConfig } from '@shared/types/config.js';

const baseConfig = (): AppConfig => ({
  timezone: 'UTC',
  digest_dir: '/tmp/digest',
  event_sources: [],
  mcp_servers: [
    { id: 'gmail-mcp', command: 'uvx gmail-mcp --account avery@x.com' },
    { id: 'gcal-mcp', command: 'uvx gcal-mcp --calendar primary' },
    { id: 'persona-emulator-mcp', command: 'node /opt/persona-emulator/mcp.js' },
  ],
  agent_mcp_access: {
    mind: ['gmail-mcp', 'gcal-mcp', 'persona-emulator-mcp'],
    diary: ['gmail-mcp', 'gcal-mcp', 'persona-emulator-mcp'],
    cold_start: [],
  },
  webhook: {
    public_url: 'x',
    bind_host: '127.0.0.1',
    bind_port: 8731,
    tunnel: { kind: 'external' },
  },
  schedule: { diary_times: [] },
  claude_code: { executable: 'claude', extra_flags: [] },
  model: { mind_agent: 'a', diary_agent: 'b', cold_start_agent: 'c', execution_agent: 'd' },
  api_key_env: 'X',
  mcp: { cache_ttl_minutes: 5 },
  log_dir: '/tmp/logs',
});

const builderOpts = {
  substrateServerPath: '/dist/main/mcp/substrate/server.js',
  dbPath: '/tmp/digest/digest.db',
  digestDir: '/tmp/digest',
  nodeExecutable: '/Applications/Electron.app/.../Electron',
  nodeExecutableEnv: { ELECTRON_RUN_AS_NODE: '1' },
};

describe('buildMcpConfig', () => {
  it('includes the substrate-mind server + every mind-allowed external MCP', () => {
    const cfg = buildMcpConfig('mind', baseConfig(), builderOpts);
    expect(Object.keys(cfg.mcpServers).sort()).toEqual([
      'digest-substrate',
      'gcal-mcp',
      'gmail-mcp',
      'persona-emulator-mcp',
    ]);

    const sub = cfg.mcpServers['digest-substrate']!;
    expect(sub.command).toBe('/Applications/Electron.app/.../Electron');
    expect(sub.args).toEqual([
      '/dist/main/mcp/substrate/server.js',
      '--role=mind',
      '--db=/tmp/digest/digest.db',
      '--digest-dir=/tmp/digest',
    ]);
    expect(sub.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });
  });

  it('diary role gets substrate-diary scoping', () => {
    const cfg = buildMcpConfig('diary', baseConfig(), builderOpts);
    expect(cfg.mcpServers['digest-substrate']?.args).toContain('--role=diary');
  });

  it('cold-start role gets substrate-cold-start and NO external MCPs', () => {
    const cfg = buildMcpConfig('cold-start', baseConfig(), builderOpts);
    expect(Object.keys(cfg.mcpServers)).toEqual(['digest-substrate']);
    expect(cfg.mcpServers['digest-substrate']?.args).toContain('--role=cold-start');
  });

  it('execution role gets ALL external MCPs but NO substrate server', () => {
    const cfg = buildMcpConfig('execution', baseConfig(), builderOpts);
    expect(cfg.mcpServers['digest-substrate']).toBeUndefined();
    expect(Object.keys(cfg.mcpServers).sort()).toEqual([
      'gcal-mcp',
      'gmail-mcp',
      'persona-emulator-mcp',
    ]);
  });

  it('parses external MCP commands into command + args', () => {
    const cfg = buildMcpConfig('mind', baseConfig(), builderOpts);
    expect(cfg.mcpServers['gmail-mcp']).toEqual({
      command: 'uvx',
      args: ['gmail-mcp', '--account', 'avery@x.com'],
    });
  });

  it('skips an allowlisted server id that is not in mcp_servers (no throw)', () => {
    const cfg = baseConfig();
    cfg.agent_mcp_access.mind = ['gmail-mcp', 'no-such-server'];
    const out = buildMcpConfig('mind', cfg, builderOpts);
    expect(Object.keys(out.mcpServers)).toContain('gmail-mcp');
    expect(Object.keys(out.mcpServers)).not.toContain('no-such-server');
  });

  describe('persona-services injection (test mode)', () => {
    const psOpts = {
      ...builderOpts,
      clockAnchor: '2026-04-29T07:00:00-07:00',
      personaServices: {
        emailServerPath: '/dist/main/mcp/personaEmail/server.js',
        calendarServerPath: '/dist/main/mcp/personaCalendar/server.js',
        notesServerPath: '/dist/main/mcp/personaNotes/server.js',
        personaDbPath: '/myrico/data/personas/avery_chen/persona.db',
      },
    };

    it('adds the three persona-* MCPs to cold-start, diary, and mind when personaServices is set', () => {
      for (const role of ['cold-start', 'diary', 'mind'] as const) {
        const cfg = buildMcpConfig(role, baseConfig(), psOpts);
        expect(cfg.mcpServers['persona-email']).toBeDefined();
        expect(cfg.mcpServers['persona-calendar']).toBeDefined();
        expect(cfg.mcpServers['persona-notes']).toBeDefined();
      }
    });

    it('forwards --persona-db and --clock-anchor to each persona-* MCP', () => {
      const cfg = buildMcpConfig('cold-start', baseConfig(), psOpts);
      const email = cfg.mcpServers['persona-email']!;
      expect(email.command).toBe('/Applications/Electron.app/.../Electron');
      expect(email.args).toEqual([
        '/dist/main/mcp/personaEmail/server.js',
        '--persona-db=/myrico/data/personas/avery_chen/persona.db',
        '--clock-anchor=2026-04-29T07:00:00-07:00',
      ]);
      expect(email.env).toEqual({ ELECTRON_RUN_AS_NODE: '1' });

      const cal = cfg.mcpServers['persona-calendar']!;
      expect(cal.args[0]).toBe('/dist/main/mcp/personaCalendar/server.js');
      const notes = cfg.mcpServers['persona-notes']!;
      expect(notes.args[0]).toBe('/dist/main/mcp/personaNotes/server.js');
    });

    it('does NOT add persona-* MCPs for execution role', () => {
      const cfg = buildMcpConfig('execution', baseConfig(), psOpts);
      expect(cfg.mcpServers['persona-email']).toBeUndefined();
      expect(cfg.mcpServers['persona-calendar']).toBeUndefined();
      expect(cfg.mcpServers['persona-notes']).toBeUndefined();
    });

    it('does NOT add persona-* MCPs when personaServices is omitted (production)', () => {
      const cfg = buildMcpConfig('cold-start', baseConfig(), builderOpts);
      expect(cfg.mcpServers['persona-email']).toBeUndefined();
      expect(cfg.mcpServers['persona-calendar']).toBeUndefined();
      expect(cfg.mcpServers['persona-notes']).toBeUndefined();
    });
  });
});
