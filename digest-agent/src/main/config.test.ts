import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { tmpdir, homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { configExists, loadConfig, saveConfig } from './config.js';
import type { AppConfig } from '@shared/types/config.js';

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'digest-config-test-'));
});

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true });
});

describe('loadConfig', () => {
  it('returns defaults when no config file exists', () => {
    const cfg = loadConfig({ path: join(tmp, 'no-such.jsonc') });
    expect(cfg.webhook.tunnel?.kind).toBe('ngrok'); // default for new installs
    expect(cfg.log_dir).toBe(join(homedir(), 'digest', 'logs'));
  });

  it('re-derives log_dir when digest_dir is overridden in config', () => {
    const path = join(tmp, 'config.jsonc');
    writeFileSync(
      path,
      // Comment + trailing comma — exercises JSONC parsing.
      `{
        // override the digest dir
        "digest_dir": "/custom/digest/dir",
      }`,
    );
    const cfg = loadConfig({ path });
    expect(cfg.digest_dir).toBe('/custom/digest/dir');
    expect(cfg.log_dir).toBe('/custom/digest/dir/logs'); // re-derived
  });

  it('respects an explicit log_dir override in config (does not auto-derive)', () => {
    const path = join(tmp, 'config.jsonc');
    writeFileSync(
      path,
      `{
        "digest_dir": "/custom/dir",
        "log_dir": "/elsewhere/logs"
      }`,
    );
    const cfg = loadConfig({ path });
    expect(cfg.log_dir).toBe('/elsewhere/logs');
  });

  it('arrays in user config replace defaults (do not deep-merge)', () => {
    const path = join(tmp, 'config.jsonc');
    writeFileSync(
      path,
      `{
        "event_sources": [
          { "id": "inbox-gmail", "kind": "gmail-webhook", "account": "x@y.com" }
        ]
      }`,
    );
    const cfg = loadConfig({ path });
    expect(cfg.event_sources).toHaveLength(1);
    expect(cfg.event_sources[0]).toMatchObject({ id: 'inbox-gmail', kind: 'gmail-webhook' });
  });

  it('throws a clear error on malformed JSONC', () => {
    const path = join(tmp, 'config.jsonc');
    writeFileSync(path, '{ "timezone": "America/Los_Angeles", ;; }');
    expect(() => loadConfig({ path })).toThrow(/config\.jsonc/);
  });
});

describe('saveConfig + configExists', () => {
  it('atomically writes a valid config and is readable back as the same object', () => {
    const path = join(tmp, 'sub', 'config.jsonc');
    expect(configExists({ path })).toBe(false);
    const cfg = loadConfig({ path: join(tmp, 'absent.jsonc') });
    cfg.timezone = 'America/Los_Angeles';
    cfg.schedule.diary_times = ['06:00', '21:30'];
    saveConfig(cfg, { path });
    expect(configExists({ path })).toBe(true);
    expect(existsSync(path)).toBe(true);
    const reread = loadConfig({ path });
    expect(reread.timezone).toBe('America/Los_Angeles');
    expect(reread.schedule.diary_times).toEqual(['06:00', '21:30']);
    // No temp files left behind from the atomic-rename step.
    expect(readFileSync(path, 'utf-8').trim().startsWith('{')).toBe(true);
  });

  it('refuses to save an invalid config', () => {
    const path = join(tmp, 'config.jsonc');
    const broken = { foo: 'bar' } as unknown as AppConfig;
    expect(() => saveConfig(broken, { path })).toThrow(/refused to save/);
    expect(existsSync(path)).toBe(false);
  });
});
