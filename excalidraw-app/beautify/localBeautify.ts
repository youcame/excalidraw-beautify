import { FONT_FAMILY } from "@excalidraw/common";
import { newElementWith } from "@excalidraw/element";

import type {
  ExcalidrawElement,
  ExcalidrawLinearElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

// Pure, instant, deterministic "美化". No network, no model.
// 1. Center-align boxes into columns and snap to a grid.
// 2. Straighten everything (angle = 0) and unify stroke width / font.
// 3. Re-center bound text in its (moved) box.
// 4. Re-route bound arrows to connect the new box edges.
// Reliable by construction: a messy diagram always becomes a tidy one.

const GRID = 20;
const COL_BUCKET = 120; // boxes whose centers fall in the same bucket share a column
const STD_SIZES = [16, 20, 28, 36];

const snap = (n: number): number => Math.round(n / GRID) * GRID;
const quantize = (fs: number): number =>
  STD_SIZES.reduce((a, b) => (Math.abs(b - fs) < Math.abs(a - fs) ? b : a));

const BOX_TYPES = new Set(["rectangle", "diamond", "ellipse"]);

interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** New geometry for every box, keyed by id. */
const layoutBoxes = (boxes: readonly ExcalidrawElement[]): Map<string, Box> => {
  const centerX = (b: ExcalidrawElement) => b.x + b.width / 2;
  const bucket = (cx: number) => Math.round(cx / COL_BUCKET);

  const columns = new Map<number, ExcalidrawElement[]>();
  for (const b of boxes) {
    const k = bucket(centerX(b));
    const arr = columns.get(k);
    if (arr) {
      arr.push(b);
    } else {
      columns.set(k, [b]);
    }
  }
  // each column snaps to its median center, so varied-width boxes look centered
  const columnCenter = new Map<number, number>();
  for (const [k, arr] of columns) {
    const centers = arr.map(centerX).sort((a, b) => a - b);
    columnCenter.set(k, snap(centers[Math.floor(centers.length / 2)]));
  }

  const placed = new Map<string, Box>();
  for (const b of boxes) {
    // width snapped to a multiple of 2*GRID so that `center - w/2` stays on the
    // grid — this makes every box in a column share the EXACT same center x.
    const w = Math.max(2 * GRID, Math.round(b.width / (2 * GRID)) * (2 * GRID));
    const h = snap(b.height);
    const cc = columnCenter.get(bucket(centerX(b)));
    const x = cc != null ? cc - w / 2 : snap(b.x);
    placed.set(b.id, { x, y: snap(b.y), w, h });
  }
  return placed;
};

/** Normalized [0..1] edge-midpoint of box `from` on the side facing box `to`. */
const edgeFixedPoint = (from: Box, to: Box): [number, number] => {
  const dx = to.x + to.w / 2 - (from.x + from.w / 2);
  const dy = to.y + to.h / 2 - (from.y + from.h / 2);
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? [1, 0.5] : [0, 0.5];
  }
  return dy >= 0 ? [0.5, 1] : [0.5, 0];
};

export const localBeautify = (
  elements: readonly ExcalidrawElement[],
): ExcalidrawElement[] => {
  const boxes = elements.filter((e) => !e.isDeleted && BOX_TYPES.has(e.type));
  const np = layoutBoxes(boxes);

  return elements.map((e) => {
    if (e.isDeleted) {
      return e;
    }

    // boxes: reposition + resize + straighten + unify stroke
    if (np.has(e.id)) {
      const p = np.get(e.id)!;
      return newElementWith(e, {
        x: p.x,
        y: p.y,
        width: p.w,
        height: p.h,
        angle: 0 as ExcalidrawElement["angle"],
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
      });
    }

    // text: re-center in its (moved) container; unify font; straighten
    if (e.type === "text") {
      const t = e as ExcalidrawTextElement;
      const update: Record<string, unknown> = {
        angle: 0,
        fontFamily: FONT_FAMILY.Excalifont,
        fontSize: quantize(t.fontSize),
      };
      const box = t.containerId ? np.get(t.containerId) : undefined;
      if (box) {
        update.x = snap(box.x + (box.w - t.width) / 2);
        update.y = snap(box.y + (box.h - t.height) / 2);
      } else {
        update.x = snap(t.x);
        update.y = snap(t.y);
      }
      return newElementWith(e, update as Partial<ExcalidrawTextElement>);
    }

    // arrows/lines: re-route bound endpoints to the new box edges
    if (e.type === "arrow" || e.type === "line") {
      const a = e as ExcalidrawLinearElement;
      const s = a.startBinding?.elementId;
      const t = a.endBinding?.elementId;
      const sb = s ? np.get(s) : undefined;
      const eb = t ? np.get(t) : undefined;
      const base: Record<string, unknown> = {
        angle: 0,
        strokeWidth: 2,
        strokeStyle: "solid",
        roughness: 1,
      };
      if (sb && eb && s && t) {
        // This Excalidraw uses FixedPointBinding (mode + normalized fixedPoint),
        // NOT focus/gap. restoreElements derives those from the *messy* layout,
        // so after we move boxes a drag re-routes the arrow back into the box
        // (penetration). Rebind to the edge-midpoint facing the other box with
        // mode "orbit" (arrow stays OUTSIDE the shape) → clean on drag.
        const fps = edgeFixedPoint(sb, eb);
        const fpe = edgeFixedPoint(eb, sb);
        const sx = sb.x + fps[0] * sb.w;
        const sy = sb.y + fps[1] * sb.h;
        const ex = eb.x + fpe[0] * eb.w;
        const ey = eb.y + fpe[1] * eb.h;
        base.x = sx;
        base.y = sy;
        base.width = ex - sx;
        base.height = ey - sy;
        base.points = [
          [0, 0],
          [ex - sx, ey - sy],
        ];
        base.startBinding = { elementId: s, mode: "orbit", fixedPoint: fps };
        base.endBinding = { elementId: t, mode: "orbit", fixedPoint: fpe };
      }
      return newElementWith(e, base as Partial<ExcalidrawLinearElement>);
    }

    return newElementWith(e, { angle: 0 as ExcalidrawElement["angle"] });
  });
};
