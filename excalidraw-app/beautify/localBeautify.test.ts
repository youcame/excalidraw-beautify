import { FONT_FAMILY } from "@excalidraw/common";

import { describe, expect, it } from "vitest";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { localBeautify } from "./localBeautify";
import { MESSY_SEED_ELEMENTS } from "./seed";

const live = (els: ExcalidrawElement[]) => els.filter((e) => !e.isDeleted);

describe("localBeautify", () => {
  it("the seed is genuinely messy (mixed strokes, fonts, angles)", () => {
    const boxes = MESSY_SEED_ELEMENTS.filter((e) => e.type === "rectangle");
    expect(new Set(boxes.map((b) => b.strokeWidth)).size).toBeGreaterThan(1);
    expect(boxes.some((b) => Math.abs(b.angle) > 0.01)).toBe(true);
    const fonts = MESSY_SEED_ELEMENTS.filter((e) => e.type === "text").map(
      (e) => (e as { fontSize: number }).fontSize,
    );
    expect(new Set(fonts).size).toBeGreaterThan(1);
  });

  it("straightens, unifies stroke width, and grid-aligns box centers", () => {
    const out = live(localBeautify(MESSY_SEED_ELEMENTS));
    const boxes = out.filter((e) => e.type === "rectangle");
    expect(boxes.length).toBeGreaterThanOrEqual(8);
    for (const b of boxes) {
      expect(b.angle).toBe(0);
      expect(b.strokeWidth).toBe(2);
      expect(b.strokeStyle).toBe("solid");
      expect(b.x % 20).toBe(0);
      expect(b.y % 20).toBe(0);
    }
  });

  it("unifies font family across all text", () => {
    const out = live(localBeautify(MESSY_SEED_ELEMENTS));
    const fonts = new Set(
      out
        .filter((e) => e.type === "text")
        .map((e) => (e as { fontFamily: number }).fontFamily),
    );
    expect(fonts).toEqual(new Set([FONT_FAMILY.Excalifont]));
  });

  it("re-routes bound arrows to valid 2-point connectors", () => {
    const out = live(localBeautify(MESSY_SEED_ELEMENTS));
    const arrows = out.filter((e) => e.type === "arrow");
    expect(arrows.length).toBeGreaterThan(0);
    for (const a of arrows) {
      const pts = (a as unknown as { points: number[][] }).points;
      expect(pts).toHaveLength(2);
      expect(Number.isFinite(pts[1][0])).toBe(true);
      expect(Number.isFinite(pts[1][1])).toBe(true);
      expect(a.angle).toBe(0);
    }
  });

  it("aligns the main pipeline boxes onto a shared center axis", () => {
    const out = live(localBeautify(MESSY_SEED_ELEMENTS));
    // the center column (用户请求/API网关/业务逻辑/LLM/结果聚合/返回响应) should
    // share one center-x after beautify
    const centers = out
      .filter((e) => e.type === "rectangle")
      .map((b) => Math.round(b.x + b.width / 2));
    const counts = new Map<number, number>();
    for (const c of centers) {
      counts.set(c, (counts.get(c) ?? 0) + 1);
    }
    const dominant = Math.max(...counts.values());
    expect(dominant).toBeGreaterThanOrEqual(5); // most boxes share the center column
  });

  it("does not mutate the input", () => {
    const before = JSON.stringify(MESSY_SEED_ELEMENTS[0]);
    localBeautify(MESSY_SEED_ELEMENTS);
    expect(JSON.stringify(MESSY_SEED_ELEMENTS[0])).toBe(before);
  });
});
