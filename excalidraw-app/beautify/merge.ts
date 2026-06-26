import { newElementWith } from "@excalidraw/element";

import type { ExcalidrawElement } from "@excalidraw/element/types";

import { snap, styleUpdate } from "./normalize";

import type { PatchItem } from "./types";

const isPositive = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n) && n > 0;
const isFiniteNum = (n: unknown): n is number =>
  typeof n === "number" && Number.isFinite(n);

/**
 * Apply the AI geometry patch back onto the real elements and run the
 * deterministic consistency pass. Pure + immutable: returns a brand new array,
 * never mutates the input (newElementWith handles version bumping).
 *
 * - Geometry from the patch is grid-snapped and validated; bad values fall back
 *   to the element's current value (the model is untrusted input).
 * - Text elements only take x/y from the patch — width/height are governed by
 *   autoResize + the (possibly changed) font size, so forcing them desyncs the
 *   label from its glyphs.
 * - Every element is style-normalized even if it has no patch entry.
 */
export const applyBeautify = (
  elements: readonly ExcalidrawElement[],
  patch: readonly PatchItem[],
): ExcalidrawElement[] => {
  const byIndex = new Map<number, PatchItem>();
  for (const p of patch) {
    if (p && Number.isInteger(p.i)) {
      byIndex.set(p.i, p);
    }
  }

  return elements.map((el, i) => {
    // Leave tombstones untouched — bumping a deleted element's version would
    // interfere with version-based reconciliation in collaborative sessions.
    if (el.isDeleted) {
      return el;
    }
    const p = byIndex.get(i);
    const geom: { x?: number; y?: number; width?: number; height?: number } =
      {};
    if (p) {
      if (isFiniteNum(p.x)) {
        geom.x = snap(p.x);
      }
      if (isFiniteNum(p.y)) {
        geom.y = snap(p.y);
      }
      if (el.type !== "text") {
        if (isPositive(p.w)) {
          geom.width = snap(p.w);
        }
        if (isPositive(p.h)) {
          geom.height = snap(p.h);
        }
      }
    }
    return newElementWith(el, { ...styleUpdate(el), ...geom });
  });
};
