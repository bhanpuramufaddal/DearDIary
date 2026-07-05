<!--
  GENERATED FILE — do not edit.
  Source: src/shared/templates/diary-prose.note.ts
  Regenerate with: npm run regen:prompts
-->
# Template: `diary-prose.note` (`type: diary-prose`)

MCP tool: `write_diary_prose_note`

A paraphrased prose note. The diary narrating, in its own voice, something worth knowing.

**Voice.** Diary voice. Past tense for things that happened, second person for things the principal might do. Concrete and specific — name the person, the matter, what changed. Pull context from across the substrate; do not just summarize the immediate source.

**`action.kind` values:** `dismiss`

**Content fields:**

- `text`: `string` (40–2000 chars) — The paraphrased note in your voice. Lead with attribution ("Maya sent over the case-study brief", "Marcus replied late last night"). Then synthesize what the principal needs to know — pull in prior threads, related commitments, relationship state. Reads like a diary entry, not a doc abstract. Do not quote source verbatim; paraphrase from everything you know.

## Example calls

### Synthesis across substrate *(teaches: pull context from multiple anchors and prior threads, not just the immediate source)*

```json
{
  "date": "2026-05-01",
  "id": "note-maya-brief-2026-05-01",
  "section": "tracking",
  "headline": "Maya sent the case-study brief",
  "anchor_refs": [
    "maya_chen"
  ],
  "content": {
    "text": "Maya sent over the case-study brief late Friday — three customers (Halberd, Holdfast, Bench), 800-word target each, draft due by 5/15. She wants your sign-off on the customer order before Renee starts, since you'd previously flagged Halberd's confidentiality terms as the tightest. Renee starts Monday and the kickoff is on her calendar; the brief sits in the same Notion as last quarter's drafts."
  },
  "actions": [
    {
      "id": "dismiss",
      "label": "Got it",
      "kind": "dismiss"
    }
  ]
}
```

### Terse observation *(teaches: one-sentence body when the matter is simple; no over-explaining)*

```json
{
  "date": "2026-05-05",
  "id": "note-deploy-green-2026-05-05",
  "section": "tracking",
  "headline": "Halberd migration deployed — green",
  "anchor_refs": [
    "halberd"
  ],
  "content": {
    "text": "The Q2 migration shipped overnight; all health checks are green. No action needed — noting because you asked to be kept in the loop."
  },
  "actions": [
    {
      "id": "dismiss",
      "label": "Got it",
      "kind": "dismiss"
    }
  ]
}
```

### Contradiction flag *(teaches: surface two sources that disagree — don't pick one and hide the other)*

```json
{
  "date": "2026-05-06",
  "id": "note-marcus-meeting-conflict-2026-05-06",
  "section": "on_the_desk",
  "headline": "Calendar and email disagree about the Marcus meeting",
  "anchor_refs": [
    "marcus_webb"
  ],
  "content": {
    "text": "Calendar shows your Marcus check-in on Thursday 4pm. His email Wednesday confirmed he moved it to Monday 10am. I haven't reconciled — confirm with Marcus before either of you walks into the wrong slot."
  },
  "actions": [
    {
      "id": "dismiss",
      "label": "Got it",
      "kind": "dismiss"
    }
  ]
}
```

