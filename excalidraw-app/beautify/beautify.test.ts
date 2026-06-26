import { FONT_FAMILY } from "@excalidraw/common";
import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { extractCompact } from "./extract";
import { applyBeautify } from "./merge";
import { GRID, quantizeFontSize, snap, styleUpdate } from "./normalize";
import { MESSY_SEED_ELEMENTS } from "./seed";

import type { PatchItem } from "./types";

const rect = (over: Partial<ExcalidrawElement> = {}): ExcalidrawElement =>
  ({
    id: "r1",
    type: "rectangle",
    x: 12.4,
    y: 33.9,
    width: 101.2,
    height: 47.7,
    angle: 0.3,
    strokeColor: "#1e1e1e",
    backgroundColor: "transparent",
    strokeWidth: 4,
    strokeStyle: "dashed",
    roughness: 2,
    isDeleted: false,
    version: 1,
    versionNonce: 1,
    ...over,
  } as unknown as ExcalidrawElement);

const text = (over: Record<string, unknown> = {}): ExcalidrawElement =>
  ({
    id: "t1",
    type: "text",
    x: 20,
    y: 40,
    width: 80,
    height: 25,
    angle: 0,
    strokeColor: "#1e1e1e",
    text: "  hello   world  ",
    fontSize: 20.85,
    fontFamily: 8,
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    isDeleted: false,
    version: 1,
    versionNonce: 1,
    ...over,
  } as unknown as ExcalidrawElement);

describe("normalize helpers", () => {
  it("snaps to the grid", () => {
    expect(snap(12)).toBe(20);
    expect(snap(9)).toBe(0);
    expect(snap(30)).toBe(40);
    expect(GRID).toBe(20);
  });

  it("quantizes drifting font sizes to standard sizes", () => {
    expect(quantizeFontSize(20.85)).toBe(20);
    expect(quantizeFontSize(34.66)).toBe(36);
    expect(quantizeFontSize(17)).toBe(16);
    expect(quantizeFontSize(25)).toBe(28);
  });

  it("normalizes stroke + rotation for any element", () => {
    const update = styleUpdate(rect());
    expect(update.strokeWidth).toBe(2);
    expect(update.strokeStyle).toBe("solid");
    expect(update.roughness).toBe(1);
    expect(update.angle).toBe(0);
  });

  it("normalizes font family + size only for text", () => {
    const update = styleUpdate(text()) as Record<string, unknown>;
    expect(update.fontFamily).toBe(FONT_FAMILY.Excalifont);
    expect(update.fontSize).toBe(20);
    expect(
      (styleUpdate(rect()) as Record<string, unknown>).fontFamily,
    ).toBeUndefined();
  });
});

describe("extractCompact", () => {
  it("reduces elements to compact rounded entries with original indices", () => {
    const els = [rect(), text(), rect({ id: "r2", x: 200, y: 5 })];
    const compact = extractCompact(els);
    expect(compact).toHaveLength(3);
    expect(compact[0]).toMatchObject({
      i: 0,
      t: "r",
      x: 12,
      y: 34,
      w: 101,
      h: 48,
    });
    expect(compact[1]).toMatchObject({ i: 1, t: "t", txt: "hello world" });
    expect(compact[2].i).toBe(2);
  });

  it("skips deleted and unsupported elements but preserves indices", () => {
    const els = [
      rect(),
      rect({ id: "del", isDeleted: true }),
      { ...rect(), type: "frame" } as unknown as ExcalidrawElement,
      text(),
    ];
    const compact = extractCompact(els);
    expect(compact.map((c) => c.i)).toEqual([0, 3]);
  });

  it("truncates long text", () => {
    const compact = extractCompact([text({ text: "x".repeat(80) })]);
    expect(compact[0].txt?.length).toBe(24);
  });
});

describe("applyBeautify", () => {
  const patch: PatchItem[] = [{ i: 0, x: 41, y: 79, w: 159, h: 99 }];

  it("applies grid-snapped geometry from the patch", () => {
    const out = applyBeautify([rect()], patch);
    expect(out[0].x).toBe(40);
    expect(out[0].y).toBe(80);
    expect(out[0].width).toBe(160);
    expect(out[0].height).toBe(100);
  });

  it("normalizes style even with no patch entry", () => {
    const out = applyBeautify([rect()], []);
    expect(out[0].strokeWidth).toBe(2);
    expect(out[0].strokeStyle).toBe("solid");
    expect(out[0].angle).toBe(0);
    expect(out[0].roughness).toBe(1);
  });

  it("does not mutate the input element", () => {
    const input = rect();
    applyBeautify([input], patch);
    expect(input.x).toBe(12.4);
    expect(input.strokeWidth).toBe(4);
  });

  it("only moves text (x/y), never forces its width/height", () => {
    const out = applyBeautify(
      [text()],
      [{ i: 0, x: 60, y: 80, w: 500, h: 500 }],
    );
    expect(out[0].x).toBe(60);
    expect(out[0].y).toBe(80);
    expect(out[0].width).toBe(80); // unchanged
    expect((out[0] as { fontSize: number }).fontSize).toBe(20);
  });

  it("falls back to current value for invalid patch numbers", () => {
    const out = applyBeautify(
      [rect()],
      [{ i: 0, x: NaN, y: 79, w: -5, h: 0 } as unknown as PatchItem],
    );
    expect(out[0].x).toBe(12.4); // NaN ignored
    expect(out[0].y).toBe(80);
    expect(out[0].width).toBe(101.2); // negative ignored
    expect(out[0].height).toBe(47.7); // zero ignored
  });

  it("bumps element version so the scene re-renders", () => {
    const out = applyBeautify([rect()], patch);
    expect(out[0].version).toBeGreaterThan(1);
  });
});

describe("messy seed", () => {
  it("is a non-trivial, intentionally messy diagram", () => {
    expect(MESSY_SEED_ELEMENTS.length).toBeGreaterThanOrEqual(20);
    const strokeWidths = new Set(MESSY_SEED_ELEMENTS.map((e) => e.strokeWidth));
    const fontSizes = new Set(
      MESSY_SEED_ELEMENTS.filter((e) => e.type === "text").map(
        (e) => (e as { fontSize: number }).fontSize,
      ),
    );
    // messiness: more than one stroke width and more than one font size in use
    expect(strokeWidths.size).toBeGreaterThan(1);
    expect(fontSizes.size).toBeGreaterThan(1);
  });

  it("beautifies into a fully consistent, grid-aligned scene", () => {
    const compact = extractCompact(MESSY_SEED_ELEMENTS);
    // simulate the deterministic backend: snap everything to grid
    const patch: PatchItem[] = compact.map((c) => ({
      i: c.i,
      x: snap(c.x),
      y: snap(c.y),
      w: snap(c.w),
      h: snap(c.h),
    }));
    const out = applyBeautify(MESSY_SEED_ELEMENTS, patch);

    // consistency invariants the user asked for
    expect(new Set(out.map((e) => e.strokeWidth))).toEqual(new Set([2]));
    expect(new Set(out.map((e) => e.angle))).toEqual(new Set([0]));
    const textEls = out.filter((e) => e.type === "text");
    expect(
      new Set(textEls.map((e) => (e as { fontFamily: number }).fontFamily)),
    ).toEqual(new Set([FONT_FAMILY.Excalifont]));
    // non-text geometry lands on the grid
    for (const e of out.filter((el) => el.type !== "text")) {
      expect(e.x % GRID).toBe(0);
      expect(e.y % GRID).toBe(0);
    }
  });
});
