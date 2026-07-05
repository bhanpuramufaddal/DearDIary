/**
 * AppConfig — parsed shape of ~/digest/config.jsonc.
 * See design/10-config.md for the full schema, defaults, and validation rules.
 */

export type TunnelKind = 'ngrok' | 'external';
export type AgentRole = 'mind' | 'diary' | 'cold_start';

export interface EventSourceConfig {
  id: string;
  kind: string;
  [extra: string]: unknown;
}

export interface McpServerConfig {
  id: string;
  command: string;
  env?: Record<string, string>;
}

export interface WebhookConfig {
  public_url: string;
  bind_host: string;
  bind_port: number;
  tunnel?: {
    kind: TunnelKind;
    authtoken_env?: string;
    domain?: string;
  };
}

export interface ScheduleConfig {
  diary_times: string[]; // HH:MM in the principal's timezone
}

export interface ClaudeCodeConfig {
  executable: string;
  extra_flags?: string[];
}

export interface ModelConfig {
  mind_agent: string;
  diary_agent: string;
  cold_start_agent: string;
  execution_agent: string;
}

export interface McpRuntimeConfig {
  cache_ttl_minutes: number;
}

export interface AppConfig {
  timezone: string;
  digest_dir: string;
  event_sources: EventSourceConfig[];
  mcp_servers: McpServerConfig[];
  agent_mcp_access: Record<AgentRole, string[]>;
  webhook: WebhookConfig;
  schedule: ScheduleConfig;
  claude_code: ClaudeCodeConfig;
  model: ModelConfig;
  api_key_env: string;
  mcp: McpRuntimeConfig;
  log_dir: string;
}
