/**
 * Settings — typed editor for ~/digest/config.jsonc.
 *
 * Loads the current config via IPC, renders a section-per-section form,
 * collects edits into a working copy, and saves through `digest:writeConfig`
 * (which validates via the zod schema before writing atomically).
 *
 * Form layout mirrors design/10-config.md's grouping: timezone, schedule,
 * webhook, MCPs + agent access, claude code, models, paths. Not every field
 * is exposed yet — niche knobs (api_key_env, mcp.cache_ttl_minutes) are still
 * edit-on-disk only. The form covers the 80% case.
 */

import './frame.css';
import type { AppConfig } from '@shared/types/config.js';

const root = document.getElementById('root')!;

interface Status {
  kind: 'idle' | 'dirty' | 'saving' | 'success' | 'error';
  message?: string;
}

let working: AppConfig | null = null;
let original: string = '';

const shell = document.createElement('div');
shell.className = 'settings';
root.appendChild(shell);

shell.appendChild(make('h1', { textContent: 'Settings' }));
shell.appendChild(
  make('p', {
    className: 'meta',
    textContent:
      'Edits validate against the schema before being written atomically to ~/digest/config.jsonc.',
  }),
);

const formEl = document.createElement('div');
shell.appendChild(formEl);

const bottomBar = document.createElement('div');
bottomBar.className = 'bottom-bar';
const statusEl = make('span', { className: 'status' });
const saveBtn = make('button', { textContent: 'Save changes' }) as HTMLButtonElement;
saveBtn.disabled = true;
const resetBtn = make('button', { textContent: 'Discard' }) as HTMLButtonElement;
resetBtn.className = 'ghost';
resetBtn.disabled = true;
bottomBar.appendChild(statusEl);
bottomBar.appendChild(resetBtn);
bottomBar.appendChild(saveBtn);
shell.appendChild(bottomBar);

saveBtn.addEventListener('click', () => void save());
resetBtn.addEventListener('click', () => void load());

void load();

function setStatus(s: Status): void {
  statusEl.className = `status${s.kind === 'error' ? ' error' : s.kind === 'success' ? ' success' : ''}`;
  statusEl.textContent =
    s.message ??
    (s.kind === 'dirty'
      ? 'unsaved changes'
      : s.kind === 'saving'
        ? 'saving…'
        : s.kind === 'success'
          ? 'saved'
          : '');
  saveBtn.disabled = s.kind === 'saving' || s.kind === 'idle' || s.kind === 'success';
  resetBtn.disabled = saveBtn.disabled;
}

async function load(): Promise<void> {
  try {
    const cfg = (await window.digest.readConfig()) as AppConfig;
    working = structuredClone(cfg);
    original = JSON.stringify(cfg);
    render();
    setStatus({ kind: 'idle' });
  } catch (err) {
    setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

function dirty(): void {
  if (!working) return;
  const eq = JSON.stringify(working) === original;
  setStatus(eq ? { kind: 'idle' } : { kind: 'dirty' });
}

async function save(): Promise<void> {
  if (!working) return;
  setStatus({ kind: 'saving' });
  try {
    await window.digest.writeConfig(working);
    original = JSON.stringify(working);
    setStatus({ kind: 'success', message: 'saved — some changes (tunnel kind, ports) require a restart' });
  } catch (err) {
    setStatus({ kind: 'error', message: err instanceof Error ? err.message : String(err) });
  }
}

function render(): void {
  if (!working) return;
  formEl.replaceChildren();
  formEl.appendChild(generalSection(working));
  formEl.appendChild(scheduleSection(working));
  formEl.appendChild(webhookSection(working));
  formEl.appendChild(modelsSection(working));
  formEl.appendChild(mcpSection(working));
  formEl.appendChild(claudeSection(working));
}

// ─── Sections ─────────────────────────────────────────────────────────────

function generalSection(cfg: AppConfig): HTMLElement {
  const s = section('General');
  s.appendChild(
    textField('Timezone', cfg.timezone, (v) => {
      cfg.timezone = v;
      dirty();
    }, 'IANA name, e.g. America/Los_Angeles'),
  );
  s.appendChild(
    textField('Digest directory', cfg.digest_dir, (v) => {
      cfg.digest_dir = v;
      dirty();
    }, 'Location of database, prompts, profile.md.'),
  );
  return s;
}

function scheduleSection(cfg: AppConfig): HTMLElement {
  const s = section('Diary schedule');
  const wrap = document.createElement('div');
  const hint = make('p', {
    className: 'hint',
    textContent:
      "Times of day (HH:MM, 24h, in the timezone above) when the diary recomposes automatically.",
  });
  wrap.appendChild(hint);
  const list = stringListEditor(cfg.schedule.diary_times, (v) => {
    cfg.schedule.diary_times = v;
    dirty();
  }, 'HH:MM');
  wrap.appendChild(list);
  s.appendChild(wrap);
  return s;
}

function webhookSection(cfg: AppConfig): HTMLElement {
  const s = section('Webhooks');
  // Default missing tunnel to ngrok so the form always has a selection.
  if (!cfg.webhook.tunnel) cfg.webhook.tunnel = { kind: 'ngrok', authtoken_env: 'NGROK_AUTHTOKEN' };
  const tunnel = cfg.webhook.tunnel;

  s.appendChild(
    selectField(
      'Tunnel kind',
      tunnel.kind,
      [
        { value: 'ngrok', label: 'ngrok (managed by digest-agent)' },
        { value: 'external', label: 'External (Cloudflare Tunnel / reverse proxy / …)' },
      ],
      (v) => {
        if (v === 'ngrok') {
          cfg.webhook.tunnel = { kind: 'ngrok', authtoken_env: 'NGROK_AUTHTOKEN' };
        } else {
          cfg.webhook.tunnel = { kind: 'external' };
        }
        dirty();
        render();
      },
    ),
  );

  if (tunnel.kind === 'ngrok') {
    s.appendChild(
      textField(
        'Reserved domain (optional)',
        tunnel.domain ?? '',
        (v) => {
          if (v) tunnel.domain = v;
          else delete (tunnel as Record<string, unknown>)['domain'];
          dirty();
        },
        'e.g. yourname.ngrok.app',
      ),
    );
    s.appendChild(
      textField('ngrok auth token env var', tunnel.authtoken_env ?? 'NGROK_AUTHTOKEN', (v) => {
        tunnel.authtoken_env = v || 'NGROK_AUTHTOKEN';
        dirty();
      }),
    );
  }

  s.appendChild(
    textField('Public URL (informational)', cfg.webhook.public_url, (v) => {
      cfg.webhook.public_url = v;
      dirty();
    }),
  );
  const row = document.createElement('div');
  row.className = 'row';
  row.appendChild(
    textField('Bind host', cfg.webhook.bind_host, (v) => {
      cfg.webhook.bind_host = v;
      dirty();
    }),
  );
  row.appendChild(
    numberField('Bind port', cfg.webhook.bind_port, (v) => {
      cfg.webhook.bind_port = v;
      dirty();
    }),
  );
  s.appendChild(row);
  return s;
}

function modelsSection(cfg: AppConfig): HTMLElement {
  const s = section('Models');
  s.appendChild(textField('Mind agent', cfg.model.mind_agent, (v) => { cfg.model.mind_agent = v; dirty(); }));
  s.appendChild(textField('Diary agent', cfg.model.diary_agent, (v) => { cfg.model.diary_agent = v; dirty(); }));
  s.appendChild(textField('Cold-start agent', cfg.model.cold_start_agent, (v) => { cfg.model.cold_start_agent = v; dirty(); }));
  s.appendChild(textField('Execution agent', cfg.model.execution_agent, (v) => { cfg.model.execution_agent = v; dirty(); }));
  return s;
}

function mcpSection(cfg: AppConfig): HTMLElement {
  const s = section('MCP servers');
  s.appendChild(
    make('p', {
      className: 'hint',
      textContent:
        'Each row is an MCP server: an id, the launch command, optional environment variables. The id is referenced by the per-role access lists below.',
    }),
  );
  const tbl = document.createElement('div');
  for (const [i, server] of cfg.mcp_servers.entries()) {
    const item = document.createElement('div');
    item.style.borderTop = '1px solid var(--rule)';
    item.style.padding = '10px 0';
    item.appendChild(
      textField('id', server.id, (v) => {
        server.id = v;
        dirty();
      }),
    );
    item.appendChild(
      textField('command', server.command, (v) => {
        server.command = v;
        dirty();
      }),
    );
    const del = document.createElement('button');
    del.className = 'ghost';
    del.textContent = 'Remove';
    del.addEventListener('click', () => {
      cfg.mcp_servers.splice(i, 1);
      dirty();
      render();
    });
    item.appendChild(del);
    tbl.appendChild(item);
  }
  const add = document.createElement('button');
  add.className = 'ghost';
  add.textContent = 'Add MCP server';
  add.addEventListener('click', () => {
    cfg.mcp_servers.push({ id: 'new-mcp', command: '' });
    dirty();
    render();
  });
  tbl.appendChild(add);
  s.appendChild(tbl);

  // Per-role access lists.
  s.appendChild(make('h2', { textContent: 'Agent access', style: { marginTop: '18px' } as never }));
  for (const role of ['mind', 'diary', 'cold_start'] as const) {
    const list = cfg.agent_mcp_access[role];
    s.appendChild(
      make('p', {
        className: 'name',
        textContent: role,
      }),
    );
    s.appendChild(
      stringListEditor(
        list,
        (v) => {
          cfg.agent_mcp_access[role] = v;
          dirty();
        },
        'MCP id, e.g. gmail-mcp',
      ),
    );
  }
  return s;
}

function claudeSection(cfg: AppConfig): HTMLElement {
  const s = section('Claude Code');
  s.appendChild(
    textField('Executable', cfg.claude_code.executable, (v) => {
      cfg.claude_code.executable = v;
      dirty();
    }, 'path or binary name on PATH'),
  );
  s.appendChild(
    make('p', { className: 'name', textContent: 'Extra flags' }),
  );
  s.appendChild(
    stringListEditor(
      cfg.claude_code.extra_flags ?? [],
      (v) => {
        cfg.claude_code.extra_flags = v;
        dirty();
      },
      '--flag or --flag=value',
    ),
  );
  return s;
}

// ─── Form primitives ─────────────────────────────────────────────────────

function section(title: string): HTMLElement {
  const s = document.createElement('section');
  s.appendChild(make('h2', { textContent: title }));
  return s;
}

function textField(
  name: string,
  initial: string,
  onChange: (v: string) => void,
  hint?: string,
): HTMLElement {
  const label = document.createElement('label');
  label.appendChild(make('span', { className: 'name', textContent: name }));
  const input = document.createElement('input');
  input.type = 'text';
  input.value = initial;
  input.addEventListener('input', () => onChange(input.value));
  label.appendChild(input);
  if (hint) label.appendChild(make('p', { className: 'hint', textContent: hint }));
  return label;
}

function numberField(
  name: string,
  initial: number,
  onChange: (v: number) => void,
): HTMLElement {
  const label = document.createElement('label');
  label.appendChild(make('span', { className: 'name', textContent: name }));
  const input = document.createElement('input');
  input.type = 'number';
  input.value = String(initial);
  input.addEventListener('input', () => {
    const n = parseInt(input.value, 10);
    if (!isNaN(n)) onChange(n);
  });
  label.appendChild(input);
  return label;
}

function selectField(
  name: string,
  initial: string,
  options: { value: string; label: string }[],
  onChange: (v: string) => void,
): HTMLElement {
  const label = document.createElement('label');
  label.appendChild(make('span', { className: 'name', textContent: name }));
  const select = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === initial) o.selected = true;
    select.appendChild(o);
  }
  select.addEventListener('change', () => onChange(select.value));
  label.appendChild(select);
  return label;
}

function stringListEditor(
  initial: string[],
  onChange: (v: string[]) => void,
  placeholder?: string,
): HTMLElement {
  const items = [...initial];
  const list = document.createElement('ul');
  list.className = 'list';

  function paint(): void {
    list.replaceChildren();
    items.forEach((value, i) => {
      const li = document.createElement('li');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = value;
      if (placeholder) input.placeholder = placeholder;
      input.addEventListener('input', () => {
        items[i] = input.value;
        onChange([...items]);
      });
      const del = document.createElement('button');
      del.className = 'ghost';
      del.textContent = '×';
      del.addEventListener('click', () => {
        items.splice(i, 1);
        onChange([...items]);
        paint();
      });
      li.appendChild(input);
      li.appendChild(del);
      list.appendChild(li);
    });
    const add = document.createElement('button');
    add.className = 'ghost';
    add.textContent = '+ add';
    add.addEventListener('click', () => {
      items.push('');
      onChange([...items]);
      paint();
    });
    list.appendChild(add);
  }
  paint();
  return list;
}

function make<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props?: Partial<HTMLElementTagNameMap[K]> & { className?: string; textContent?: string },
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props) {
    for (const [k, v] of Object.entries(props)) {
      if (k === 'className' && typeof v === 'string') node.className = v;
      else if (k === 'textContent' && typeof v === 'string') node.textContent = v;
      else (node as unknown as Record<string, unknown>)[k] = v;
    }
  }
  return node;
}
