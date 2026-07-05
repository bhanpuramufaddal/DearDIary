/**
 * Onboarding wizard — opens automatically on first launch (no config.jsonc on
 * disk). Walks the principal through the minimum settings to make the app
 * useful, then writes config.jsonc atomically via `digest:writeConfig`.
 *
 * Steps: welcome → timezone → schedule → webhook → models → profile.md → done.
 * Each step renders one focused page in the same journal aesthetic as the
 * diary so the experience feels continuous.
 *
 * The wizard works against the AppConfig type directly; the schema validates
 * via the IPC writeConfig handler. Niche knobs (api keys, MCP servers) are
 * not surfaced here — the principal can edit them in Settings afterwards.
 */

import './frame.css';
import type { AppConfig } from '@shared/types/config.js';

const root = document.getElementById('root')!;

const detectedTz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

let cfg: AppConfig | null = null;
let stepIndex = 0;

const steps: { id: string; title: string; render: (host: HTMLElement) => void }[] = [
  { id: 'welcome',    title: 'Welcome',         render: renderWelcome },
  { id: 'timezone',   title: 'Where you live',  render: renderTimezone },
  { id: 'schedule',   title: 'When to compose', render: renderSchedule },
  { id: 'webhook',    title: 'Tunnel inbound',  render: renderWebhook },
  { id: 'models',     title: 'Model picks',     render: renderModels },
  { id: 'done',       title: 'Ready',           render: renderDone },
];

void boot();

async function boot(): Promise<void> {
  try {
    cfg = (await window.digest.readConfig()) as AppConfig;
    cfg.timezone = detectedTz;
    paint();
  } catch (err) {
    root.textContent = err instanceof Error ? err.message : String(err);
  }
}

function paint(): void {
  if (!cfg) return;
  const shell = document.createElement('div');
  shell.className = 'wizard';

  const stepMeta = make('p', { className: 'step-meta', textContent: steps[stepIndex]!.title });
  shell.appendChild(stepMeta);

  steps[stepIndex]!.render(shell);

  // Nav bar
  const nav = document.createElement('div');
  nav.className = 'nav';
  const back = make('button', { className: 'ghost', textContent: 'Back' }) as HTMLButtonElement;
  back.disabled = stepIndex === 0;
  back.addEventListener('click', () => {
    stepIndex--;
    paint();
  });

  const indicator = make('span', {
    className: 'step-indicator',
    textContent: `${stepIndex + 1} of ${steps.length}`,
  });

  const isLast = stepIndex === steps.length - 1;
  const next = make('button', {
    className: 'primary',
    textContent: isLast ? 'Save & close' : 'Continue',
  }) as HTMLButtonElement;
  next.addEventListener('click', async () => {
    if (isLast) {
      next.disabled = true;
      try {
        await window.digest.writeConfig(cfg);
        // After save we close the window — main detects the next boot will
        // pick up the new config naturally.
        window.close();
      } catch (err) {
        const note = make('p', {
          className: 'callout',
          textContent: `Couldn't save: ${err instanceof Error ? err.message : String(err)}`,
        });
        shell.appendChild(note);
        next.disabled = false;
      }
      return;
    }
    stepIndex++;
    paint();
  });

  nav.appendChild(back);
  nav.appendChild(indicator);
  const spacer = document.createElement('span');
  spacer.className = 'spacer';
  nav.appendChild(spacer);
  nav.appendChild(next);

  shell.appendChild(nav);

  root.replaceChildren(shell);
}

// ─── Step pages ────────────────────────────────────────────────────────

function renderWelcome(host: HTMLElement): void {
  host.appendChild(make('h1', { textContent: 'A diary for the rest of your life' }));
  host.appendChild(
    make('p', {
      className: 'lede',
      textContent:
        'Digest watches your inbox, calendar, and notes — and twice a day composes a journal page you read instead. The agent decides what matters. You decide what to do.',
    }),
  );
  host.appendChild(
    make('p', {
      className: 'callout',
      textContent:
        "We'll set up a few things — your timezone, when to compose each day, how to listen for events. Six steps; about two minutes.",
    }),
  );
}

function renderTimezone(host: HTMLElement): void {
  if (!cfg) return;
  host.appendChild(make('h1', { textContent: 'What timezone are you in?' }));
  host.appendChild(
    make('p', {
      className: 'lede',
      textContent:
        "Scheduled diary times follow this timezone. We've guessed based on your system; you can change it now or later in Settings.",
    }),
  );
  host.appendChild(
    textField('IANA timezone', cfg.timezone, (v) => {
      cfg!.timezone = v;
    }),
  );
}

function renderSchedule(host: HTMLElement): void {
  if (!cfg) return;
  host.appendChild(make('h1', { textContent: 'When should the diary recompose?' }));
  host.appendChild(
    make('p', {
      className: 'lede',
      textContent:
        'Most people pick a morning time (start of day) and an evening time (wrap-up). You can run a fresh tick manually any time with /digest_run.',
    }),
  );
  host.appendChild(
    listEditor(cfg.schedule.diary_times, (v) => {
      cfg!.schedule.diary_times = v;
    }, 'HH:MM, 24-hour'),
  );
}

function renderWebhook(host: HTMLElement): void {
  if (!cfg) return;
  if (!cfg.webhook.tunnel) cfg.webhook.tunnel = { kind: 'ngrok', authtoken_env: 'NGROK_AUTHTOKEN' };
  const tunnel = cfg.webhook.tunnel;
  host.appendChild(make('h1', { textContent: 'How should events reach you?' }));
  host.appendChild(
    make('p', {
      className: 'lede',
      textContent:
        'Inbound events (email, calendar, Slack) need to reach this app over HTTPS. Digest can manage a free ngrok tunnel for you, or you can point an existing reverse proxy at the local port.',
    }),
  );
  host.appendChild(
    selectField(
      'Tunnel kind',
      tunnel.kind,
      [
        { value: 'ngrok', label: 'ngrok — managed by Digest (recommended)' },
        { value: 'external', label: 'External — I have my own reverse proxy / Cloudflare Tunnel' },
      ],
      (v) => {
        if (v === 'ngrok') cfg!.webhook.tunnel = { kind: 'ngrok', authtoken_env: 'NGROK_AUTHTOKEN' };
        else cfg!.webhook.tunnel = { kind: 'external' };
        paint();
      },
    ),
  );
  if (tunnel.kind === 'ngrok') {
    host.appendChild(
      make('p', {
        className: 'callout',
        textContent:
          'Set the NGROK_AUTHTOKEN env var before launching Digest (free at ngrok.com → tunnels → authtokens).',
      }),
    );
  }
}

function renderModels(host: HTMLElement): void {
  if (!cfg) return;
  host.appendChild(make('h1', { textContent: 'Which models?' }));
  host.appendChild(
    make('p', {
      className: 'lede',
      textContent:
        'Defaults are good. The diary and cold-start composer use Opus (high care, low frequency); mind and execution use Sonnet (every event, lower cost).',
    }),
  );
  host.appendChild(textField('Mind agent', cfg.model.mind_agent, (v) => { cfg!.model.mind_agent = v; }));
  host.appendChild(textField('Diary agent', cfg.model.diary_agent, (v) => { cfg!.model.diary_agent = v; }));
  host.appendChild(textField('Cold-start agent', cfg.model.cold_start_agent, (v) => { cfg!.model.cold_start_agent = v; }));
  host.appendChild(textField('Execution agent', cfg.model.execution_agent, (v) => { cfg!.model.execution_agent = v; }));
}

function renderDone(host: HTMLElement): void {
  host.appendChild(make('h1', { textContent: 'Ready.' }));
  host.appendChild(
    make('p', {
      className: 'lede',
      textContent:
        "We'll write your config to ~/digest/config.jsonc. You can edit it any time in Settings, or directly in the file.",
    }),
  );
  host.appendChild(
    make('p', {
      className: 'callout',
      textContent:
        'Next: drop a profile.md into ~/digest/ describing who you are and what matters to you. The cold-start agent reads it on save and seeds the substrate.',
    }),
  );
}

// ─── Form primitives ───────────────────────────────────────────────────

function textField(name: string, initial: string, onChange: (v: string) => void): HTMLElement {
  const l = document.createElement('label');
  l.appendChild(make('span', { className: 'name', textContent: name }));
  const i = document.createElement('input');
  i.type = 'text';
  i.value = initial;
  i.addEventListener('input', () => onChange(i.value));
  l.appendChild(i);
  return l;
}

function selectField(
  name: string,
  initial: string,
  options: { value: string; label: string }[],
  onChange: (v: string) => void,
): HTMLElement {
  const l = document.createElement('label');
  l.appendChild(make('span', { className: 'name', textContent: name }));
  const s = document.createElement('select');
  for (const opt of options) {
    const o = document.createElement('option');
    o.value = opt.value;
    o.textContent = opt.label;
    if (opt.value === initial) o.selected = true;
    s.appendChild(o);
  }
  s.addEventListener('change', () => onChange(s.value));
  l.appendChild(s);
  return l;
}

function listEditor(
  initial: string[],
  onChange: (v: string[]) => void,
  placeholder?: string,
): HTMLElement {
  const items = [...initial];
  const list = document.createElement('ul');
  list.className = 'list';
  function paintList(): void {
    list.replaceChildren();
    items.forEach((v, i) => {
      const li = document.createElement('li');
      const input = document.createElement('input');
      input.type = 'text';
      input.value = v;
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
        paintList();
      });
      li.appendChild(input);
      li.appendChild(del);
      list.appendChild(li);
    });
    const add = document.createElement('button');
    add.className = 'ghost';
    add.textContent = '+ add a time';
    add.addEventListener('click', () => {
      items.push('');
      onChange([...items]);
      paintList();
    });
    list.appendChild(add);
  }
  paintList();
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
