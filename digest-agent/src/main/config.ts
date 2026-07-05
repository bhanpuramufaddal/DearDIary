/**
 * Config loader.
 *
 * Reads ~/digest/config.jsonc (or $DIGEST_CONFIG / --config <path>), strips
 * JSONC comments, validates against the zod schema, returns AppConfig with
 * defaults filled in.
 *
 * The schema in src/shared/schemas/index.ts is the canonical contract. This
 * loader is the only place that turns text on disk into an AppConfig.
 */

import { existsSync, readFileSync, mkdirSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname } from 'node:path';
import { parse as parseJsonc, type ParseError, printParseErrorCode } from 'jsonc-parser';
import { appConfigSchema } from '@shared/schemas/index.js';
import type { AppConfig } from '@shared/types/config.js';

const DEFAULT_CONFIG: AppConfig = {
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  digest_dir: join(homedir(), 'digest'),
  event_sources: [],
  mcp_servers: [],
  agent_mcp_access: { mind: [], diary: [], cold_start: [] },
  webhook: {
    // public_url is overwritten by the onboarding flow (Phase 12) once ngrok
    // announces a real public URL. Until then, the placeholder is benign:
    // tunnel manager handles announcement; webhook server doesn't read public_url.
    public_url: 'https://example.ngrok-free.app/webhook',
    bind_host: '127.0.0.1',
    bind_port: 8731,
    // Default for new installs is ngrok (per design/10-config.md + design/08).
    // External (Cloudflare Tunnel, Tailscale Funnel, reverse proxy) is opt-in.
    tunnel: { kind: 'ngrok', authtoken_env: 'NGROK_AUTHTOKEN' },
  },
  schedule: { diary_times: ['06:00'] },
  claude_code: { executable: 'claude', extra_flags: [] },
  model: {
    mind_agent: 'claude-sonnet-4-6',
    // Sonnet composes the diary fast enough to stay inside the timeout; opus
    // blew the 30-min budget mid-survey on dense days. Bump back to opus here
    // if composition quality regresses.
    diary_agent: 'claude-sonnet-4-6',
    // Opus timed out at the 25-min cold-start budget mid-scan; sonnet finishes
    // in time. Bump to opus if cold-start synthesis quality regresses.
    cold_start_agent: 'claude-sonnet-4-6',
    execution_agent: 'claude-sonnet-4-6',
  },
  api_key_env: 'ANTHROPIC_API_KEY',
  mcp: { cache_ttl_minutes: 5 },
  log_dir: join(homedir(), 'digest', 'logs'),
};

export interface ConfigLoadOptions {
  /** Override the config path; otherwise looked up in standard locations. */
  path?: string;
  /** Strict mode rejects unknown fields. Default: false (forwards-compatible). */
  strict?: boolean;
}

export function defaultConfigPath(): string {
  return process.env['DIGEST_CONFIG'] ?? join(homedir(), 'digest', 'config.jsonc');
}

/**
 * Load and validate config. If the file is absent, returns DEFAULT_CONFIG —
 * the onboarding flow (Phase 12) writes a real config on first run.
 */
export function loadConfig(opts: ConfigLoadOptions = {}): AppConfig {
  const path = opts.path ?? defaultConfigPath();
  if (!existsSync(path)) return DEFAULT_CONFIG;

  const text = readFileSync(path, 'utf-8');
  const errors: ParseError[] = [];
  const parsed = parseJsonc(text, errors, { allowTrailingComma: true });
  if (errors.length > 0) {
    const summary = errors
      .map((e) => `${printParseErrorCode(e.error)} at offset ${e.offset}`)
      .join('; ');
    throw new Error(`config.jsonc parse failed at ${path}: ${summary}`);
  }

  // Merge with defaults so missing fields don't blow up the schema.
  const merged = deepMerge(DEFAULT_CONFIG as unknown as Record<string, unknown>, parsed ?? {});

  const result = appConfigSchema.safeParse(merged);
  if (!result.success) {
    throw new Error(`config.jsonc invalid at ${path}: ${result.error.message}`);
  }
  return deriveDirs(result.data as AppConfig);
}

/**
 * Derive paths that hang off `digest_dir` so that overriding `digest_dir`
 * (via env var or onboarding) automatically relocates `log_dir`.
 *
 * Only applied when the field still looks like the bare default (~/digest/...).
 * If the user has explicitly overridden `log_dir` in config.jsonc, we respect
 * that — they get what they wrote.
 */
function deriveDirs(cfg: AppConfig): AppConfig {
  const defaultLogDir = join(homedir(), 'digest', 'logs');
  if (cfg.log_dir === defaultLogDir) {
    return { ...cfg, log_dir: join(cfg.digest_dir, 'logs') };
  }
  return cfg;
}

/**
 * Validate + atomically persist a config object to disk. Used by the Settings
 * form (Phase 12) and the onboarding wizard. Writes to a sibling temp file
 * and renames, so partial writes can't corrupt the existing config.
 */
export function saveConfig(cfg: AppConfig, opts: { path?: string } = {}): void {
  const result = appConfigSchema.safeParse(cfg);
  if (!result.success) {
    throw new Error(`refused to save invalid config: ${result.error.message}`);
  }
  const path = opts.path ?? defaultConfigPath();
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp.${process.pid}`;
  // Pretty-printed JSON is valid JSONC; comments from the original file are
  // not preserved (the form editor is the source of truth from now on).
  writeFileSync(tmp, JSON.stringify(result.data, null, 2));
  renameSync(tmp, path);
}

/** Whether a config file currently exists at the default (or override) location. */
export function configExists(opts: { path?: string } = {}): boolean {
  return existsSync(opts.path ?? defaultConfigPath());
}

function deepMerge(
  base: Record<string, unknown>,
  overlay: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    const baseValue = base[key];
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      baseValue &&
      typeof baseValue === 'object' &&
      !Array.isArray(baseValue)
    ) {
      out[key] = deepMerge(
        baseValue as Record<string, unknown>,
        value as Record<string, unknown>,
      );
    } else {
      out[key] = value;
    }
  }
  return out;
}
