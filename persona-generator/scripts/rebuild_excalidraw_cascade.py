#!/usr/bin/env -S uv run python
# /// script
# requires-python = ">=3.11"
# dependencies = []
# ///
"""
Surgically rebuild the day cascade in person_generator_architecture.excalidraw
to show 35 days across two rows (Days 1-18, Days 19-35) instead of 15 in one row.

Preserves all elements before and after the day cascade section. Replaces only
the day-box and cascade-arrow elements.
"""

from __future__ import annotations
import json
from pathlib import Path
from datetime import date, timedelta

PATH = Path("/Users/mufaddal/Projects/myrico/person_generator_architecture.excalidraw")

# Day cascade element ID prefixes to remove (the old 15-day layout):
DAY_BOX_PREFIXES = ("day_01", "day_02", "day_03", "day_04", "day_05",
                    "day_06", "day_07", "day_08", "day_09", "day_10",
                    "day_11", "day_12", "day_13", "day_14", "day_15")
CASCADE_ARROW_PREFIXES = ("casc_1_2", "casc_2_3", "casc_3_4", "casc_4_5", "casc_5_6",
                          "casc_6_7", "casc_7_8", "casc_8_9", "casc_9_10",
                          "casc_10_11", "casc_11_12", "casc_12_13", "casc_13_14", "casc_14_15")
LABEL_IDS = ("cascade_label", "stage_7_outputs", "stage_7_outputs_txt", "arrow_phase_d_to_e")


def is_day_cascade_element(eid: str) -> bool:
    if any(eid.startswith(p) for p in DAY_BOX_PREFIXES):
        return True
    if eid in CASCADE_ARROW_PREFIXES:
        return True
    if eid in LABEL_IDS:
        return True
    return False


# Layout for the new 35-day cascade (two rows)
ROW1_Y = 1850             # warm-up + first eval days
ROW2_Y = 1960             # rest of eval window
BOX_W = 110
BOX_H = 80
GAP = 12

# Row 1: Days 1-18
# 18 boxes × 110 + 17 × 12 = 1980 + 204 = 2184
ROW1_DAYS = list(range(1, 19))  # 1..18
ROW1_START_X = 110

# Row 2: Days 19-35
# 17 boxes × 110 + 16 × 12 = 1870 + 192 = 2062
ROW2_DAYS = list(range(19, 36))  # 19..35
ROW2_START_X = 110

# Date base: Day 1 = 2026-04-19
DAY1_DATE = date(2026, 4, 19)

# Special markers
SAMPLE_DIGEST_DAY = 33  # 2026-05-21 = Day 33 of 35
TODAY_DAY = 35          # 2026-05-23 = Day 35
EVAL_STARTS = 6         # Day 6 = first eval day
LAST_WARMUP = 5         # Day 5 = last warmup day


def day_position(day: int) -> tuple[int, int]:
    if day in ROW1_DAYS:
        idx = day - 1
        return (ROW1_START_X + idx * (BOX_W + GAP), ROW1_Y)
    else:
        idx = day - 19
        return (ROW2_START_X + idx * (BOX_W + GAP), ROW2_Y)


def day_box(day: int) -> dict:
    x, y = day_position(day)
    is_warmup = day <= LAST_WARMUP
    is_today = day == TODAY_DAY
    is_sample = day == SAMPLE_DIGEST_DAY
    is_eval_start = day == EVAL_STARTS

    if is_today:
        stroke = "#047857"
        bg = "#a7f3d0"
        width = 3
        style = "solid"
    elif is_warmup:
        stroke = "#b45309"
        bg = "#fef3c7"
        width = 1
        style = "dashed"
    elif is_sample:
        stroke = "#b45309"
        bg = "#fef3c7"
        width = 3
        style = "solid"
    else:
        stroke = "#b45309"
        bg = "#fef3c7"
        width = 2
        style = "solid"

    return {
        "type": "rectangle",
        "id": f"day_{day:02d}",
        "x": x, "y": y, "width": BOX_W, "height": BOX_H,
        "strokeColor": stroke, "backgroundColor": bg,
        "fillStyle": "solid", "strokeWidth": width, "strokeStyle": style,
        "roughness": 0, "opacity": 100, "angle": 0,
        "seed": 410000 + day * 10, "version": 1, "versionNonce": 410001 + day * 10,
        "isDeleted": False, "groupIds": [], "boundElements": [{"id": f"day_{day:02d}_txt", "type": "text"}],
        "link": None, "locked": False, "roundness": {"type": 3}
    }


def day_text(day: int) -> dict:
    x, y = day_position(day)
    d = DAY1_DATE + timedelta(days=day - 1)
    label = d.strftime("%b %-d")
    is_warmup = day <= LAST_WARMUP
    is_today = day == TODAY_DAY
    is_sample = day == SAMPLE_DIGEST_DAY
    is_eval_start = day == EVAL_STARTS

    if is_today:
        suffix = "\n★ TODAY"
        color = "#064e3b"
    elif is_warmup:
        suffix = "\nwarm-up"
        color = "#78350f"
    elif is_sample:
        suffix = "\n★ sample"
        color = "#78350f"
    elif is_eval_start:
        suffix = "\neval starts"
        color = "#78350f"
    else:
        suffix = "\neval"
        color = "#78350f"

    return {
        "type": "text",
        "id": f"day_{day:02d}_txt",
        "x": x + 5, "y": y + 12, "width": BOX_W - 10, "height": 55,
        "text": f"DAY {day}\n{label}{suffix}",
        "originalText": f"DAY {day}\n{label}{suffix}",
        "fontSize": 10, "fontFamily": 3,
        "textAlign": "center", "verticalAlign": "middle",
        "strokeColor": color, "backgroundColor": "transparent",
        "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
        "roughness": 0, "opacity": 100, "angle": 0,
        "seed": 410002 + day * 10, "version": 1, "versionNonce": 410003 + day * 10,
        "isDeleted": False, "groupIds": [], "boundElements": None,
        "link": None, "locked": False, "containerId": f"day_{day:02d}", "lineHeight": 1.3
    }


def cascade_arrow(from_day: int, to_day: int) -> dict:
    """Straight arrow from end of from_day box to start of to_day box.
    If they're in different rows, this becomes a wrap arrow with bend points."""
    fx, fy = day_position(from_day)
    tx, ty = day_position(to_day)
    same_row = (from_day in ROW1_DAYS) == (to_day in ROW1_DAYS)

    if same_row:
        # straight horizontal arrow from right edge of from to left edge of to
        sx = fx + BOX_W
        sy = fy + BOX_H // 2
        ex = tx
        ey = sy
        points = [[0, 0], [ex - sx, 0]]
        return {
            "type": "arrow",
            "id": f"casc_{from_day}_{to_day}",
            "x": sx, "y": sy, "width": ex - sx, "height": 0,
            "strokeColor": "#dc2626", "backgroundColor": "transparent",
            "fillStyle": "solid", "strokeWidth": 2, "strokeStyle": "solid",
            "roughness": 0, "opacity": 100, "angle": 0,
            "seed": 420000 + from_day, "version": 1, "versionNonce": 420001 + from_day,
            "isDeleted": False, "groupIds": [], "boundElements": None,
            "link": None, "locked": False,
            "points": points,
            "startBinding": {"elementId": f"day_{from_day:02d}", "focus": 0, "gap": 0},
            "endBinding": {"elementId": f"day_{to_day:02d}", "focus": 0, "gap": 0},
            "startArrowhead": None, "endArrowhead": "arrow"
        }
    else:
        # wrap arrow from right edge of from (row 1) curving down to left edge of to (row 2)
        # Going from bottom of last row 1 box, down and to the left start of row 2
        sx = fx + BOX_W
        sy = fy + BOX_H // 2
        ex = tx
        ey = ty + BOX_H // 2
        # bend: go right a little, then down, then left to start of row 2
        # points are relative to (sx, sy)
        bend_right = 30
        mid_y = (sy + ey) // 2
        points = [
            [0, 0],
            [bend_right, 0],
            [bend_right, mid_y - sy],
            [(ex - sx) - bend_right, mid_y - sy],
            [(ex - sx) - bend_right, ey - sy],
            [ex - sx, ey - sy],
        ]
        return {
            "type": "arrow",
            "id": f"casc_{from_day}_{to_day}",
            "x": sx, "y": sy, "width": ex - sx, "height": ey - sy,
            "strokeColor": "#dc2626", "backgroundColor": "transparent",
            "fillStyle": "solid", "strokeWidth": 3, "strokeStyle": "solid",
            "roughness": 0, "opacity": 100, "angle": 0,
            "seed": 420000 + from_day, "version": 1, "versionNonce": 420001 + from_day,
            "isDeleted": False, "groupIds": [], "boundElements": None,
            "link": None, "locked": False,
            "points": points,
            "startBinding": {"elementId": f"day_{from_day:02d}", "focus": 0, "gap": 0},
            "endBinding": {"elementId": f"day_{to_day:02d}", "focus": 0, "gap": 0},
            "startArrowhead": None, "endArrowhead": "arrow"
        }


def main():
    data = json.loads(PATH.read_text())
    elements = data["elements"]

    # Filter out old day cascade
    new_elements = [e for e in elements if not is_day_cascade_element(e.get("id", ""))]

    # Build new day boxes + texts
    day_elements = []
    for day in range(1, 36):
        day_elements.append(day_box(day))
        day_elements.append(day_text(day))

    # Build cascade arrows: 1->2, 2->3, ..., 34->35
    arrow_elements = [cascade_arrow(d, d + 1) for d in range(1, 35)]

    # New labels: cascade label + outputs box + transition arrow
    label_elements = [
        {
            "type": "text",
            "id": "cascade_label",
            "x": 110, "y": 2060, "width": 2200, "height": 25,
            "text": "← red arrows = state cascade · day N reads accumulated state from day N–1 · Day 18 → Day 19 wraps to row 2 · the spine of realism →",
            "originalText": "← red arrows = state cascade · day N reads accumulated state from day N–1 · Day 18 → Day 19 wraps to row 2 · the spine of realism →",
            "fontSize": 12, "fontFamily": 3, "textAlign": "center", "verticalAlign": "top",
            "strokeColor": "#dc2626", "backgroundColor": "transparent",
            "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
            "roughness": 0, "opacity": 100, "angle": 0,
            "seed": 420100, "version": 1, "versionNonce": 420101,
            "isDeleted": False, "groupIds": [], "boundElements": None,
            "link": None, "locked": False, "containerId": None, "lineHeight": 1.25
        },
        {
            "type": "rectangle",
            "id": "stage_7_outputs",
            "x": 110, "y": 2100, "width": 2325, "height": 130,
            "strokeColor": "#1e3a5f", "backgroundColor": "#f0f9ff",
            "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
            "roughness": 0, "opacity": 100, "angle": 0,
            "seed": 420102, "version": 1, "versionNonce": 420103,
            "isDeleted": False, "groupIds": [], "boundElements": [{"id": "stage_7_outputs_txt", "type": "text"}],
            "link": None, "locked": False, "roundness": {"type": 3}
        },
        {
            "type": "text",
            "id": "stage_7_outputs_txt",
            "x": 130, "y": 2114, "width": 2285, "height": 100,
            "text": "EACH DAY'S CALL PRODUCES  (one structured envelope, four documents inside; everything prose except calendar_ops)\n\n[PROSE]  Day-N section appended to activity_log.md    — journal entry: what happened today, named subjects of sentences\n[PROSE]  internal/daily_state/day_NN.md              — narrative state at end of Day N: each open thread its own paragraph by name\n[PROSE]  internal/planted_artifact_traces/<id>.md     — one per planted artifact: context → reading → conclusion (3 movements)\n[STRUCT] graph/calendar_ops.jsonl                    — append-only: {ts, op, event_id, source: direct|email, linked_email_id, payload}  for deterministic replay",
            "originalText": "EACH DAY'S CALL PRODUCES  (one structured envelope, four documents inside; everything prose except calendar_ops)\n\n[PROSE]  Day-N section appended to activity_log.md    — journal entry: what happened today, named subjects of sentences\n[PROSE]  internal/daily_state/day_NN.md              — narrative state at end of Day N: each open thread its own paragraph by name\n[PROSE]  internal/planted_artifact_traces/<id>.md     — one per planted artifact: context → reading → conclusion (3 movements)\n[STRUCT] graph/calendar_ops.jsonl                    — append-only: {ts, op, event_id, source: direct|email, linked_email_id, payload}  for deterministic replay",
            "fontSize": 11, "fontFamily": 3, "textAlign": "left", "verticalAlign": "top",
            "strokeColor": "#1e40af", "backgroundColor": "transparent",
            "fillStyle": "solid", "strokeWidth": 1, "strokeStyle": "solid",
            "roughness": 0, "opacity": 100, "angle": 0,
            "seed": 420104, "version": 1, "versionNonce": 420105,
            "isDeleted": False, "groupIds": [], "boundElements": None,
            "link": None, "locked": False, "containerId": "stage_7_outputs", "lineHeight": 1.4
        },
        {
            "type": "arrow",
            "id": "arrow_phase_d_to_e",
            "x": 1270, "y": 2250, "width": 0, "height": 80,
            "strokeColor": "#6d28d9", "backgroundColor": "transparent",
            "fillStyle": "solid", "strokeWidth": 3, "strokeStyle": "solid",
            "roughness": 0, "opacity": 100, "angle": 0,
            "seed": 420106, "version": 1, "versionNonce": 420107,
            "isDeleted": False, "groupIds": [], "boundElements": None,
            "link": None, "locked": False,
            "points": [[0, 0], [0, 80]],
            "startBinding": None, "endBinding": None,
            "startArrowhead": None, "endArrowhead": "arrow"
        },
    ]

    # Append the new day cascade elements at the end (excalidraw renders in array order)
    new_elements.extend(day_elements)
    new_elements.extend(arrow_elements)
    new_elements.extend(label_elements)

    data["elements"] = new_elements
    PATH.write_text(json.dumps(data, indent=2))
    print(f"OK. Total elements: {len(new_elements)}")
    print(f"  Day boxes + texts: {len(day_elements)}")
    print(f"  Cascade arrows: {len(arrow_elements)}")
    print(f"  Labels/outputs/transition: {len(label_elements)}")


if __name__ == "__main__":
    main()
