import { describe, it, expect } from 'vitest';
import { TEMPLATES, getTemplate, type TemplateId } from './index.ts';
import { SECTIONS, STATUSES } from './_helpers.ts';

describe('template registry', () => {
  it('every template has a unique template_id', () => {
    const ids = TEMPLATES.map((t) => t.templateId);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("every template's goodExample.content validates against its contentSchema", () => {
    for (const tpl of TEMPLATES) {
      const result = tpl.contentSchema.safeParse(tpl.goodExample.content);
      if (!result.success) {
        throw new Error(
          `goodExample for ${tpl.templateId} fails contentSchema: ${result.error.message}`,
        );
      }
    }
  });

  it("every goodExample's section is a valid Section", () => {
    for (const tpl of TEMPLATES) {
      expect(SECTIONS).toContain(tpl.goodExample.section);
    }
  });

  it('every goodExample status is "open" (composition default)', () => {
    for (const tpl of TEMPLATES) {
      expect(STATUSES).toContain(tpl.goodExample.status);
      expect(tpl.goodExample.status).toBe('open');
    }
  });

  it("every goodExample's actions reference only the template's declared actionKinds", () => {
    for (const tpl of TEMPLATES) {
      const allowed = new Set(tpl.actionKinds);
      for (const a of tpl.goodExample.actions) {
        if (!allowed.has(a.kind)) {
          throw new Error(
            `template ${tpl.templateId} goodExample uses action.kind="${a.kind}" not in actionKinds [${tpl.actionKinds.join(', ')}]`,
          );
        }
      }
    }
  });

  it("every examples[*].component.content validates against its contentSchema", () => {
    for (const tpl of TEMPLATES) {
      if (!tpl.examples) continue;
      for (const ex of tpl.examples) {
        const result = tpl.contentSchema.safeParse(ex.component.content);
        if (!result.success) {
          throw new Error(
            `examples["${ex.label}"] for ${tpl.templateId} fails contentSchema: ${result.error.message}`,
          );
        }
      }
    }
  });

  it("every examples[*].component's actions reference only the template's declared actionKinds", () => {
    for (const tpl of TEMPLATES) {
      if (!tpl.examples) continue;
      const allowed = new Set(tpl.actionKinds);
      for (const ex of tpl.examples) {
        for (const a of ex.component.actions) {
          if (!allowed.has(a.kind)) {
            throw new Error(
              `template ${tpl.templateId} examples["${ex.label}"] uses action.kind="${a.kind}" not in actionKinds [${tpl.actionKinds.join(', ')}]`,
            );
          }
        }
      }
    }
  });

  it('template_id and type follow conventions', () => {
    for (const tpl of TEMPLATES) {
      // template_id is `<type>.<variant>` — type prefix is the broad bucket
      expect(tpl.templateId.startsWith(`${tpl.type}.`)).toBe(true);
    }
  });
});

describe('getTemplate lookup', () => {
  it('returns the registry entry by id', () => {
    const entry = getTemplate('diary-prose.note');
    expect(entry.templateId).toBe('diary-prose.note');
    expect(entry.type).toBe('diary-prose');
  });

  it('throws on unknown template_id', () => {
    expect(() => getTemplate('nonexistent.template' as TemplateId)).toThrow(
      /unknown template_id/,
    );
  });
});

describe('registry coverage of existing schema enums', () => {
  // The plan's step 1 requirement: the registry shape MIRRORS the current
  // templateIdSchema enum exactly. Step 4 will collapse them (registry becomes
  // the source). For now we just verify parity.
  it('contains the 11 current template ids', () => {
    const ids = new Set(TEMPLATES.map((t) => t.templateId));
    expect(ids).toEqual(
      new Set([
        'email-draft.inline',
        'calendar-block.decision',
        'choose-one.cards',
        'free-text-reply.compose',
        'diary-prose.note',
        'diary-prose.flash',
        'big-number.metric',
        'stat-block.summary',
        'chart.timeseries',
        'chart.bar',
        'report.brief',
      ]),
    );
  });
});
