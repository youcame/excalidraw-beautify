import { FONT_FAMILY } from "@excalidraw/common";

import type { ExcalidrawElement } from "@excalidraw/element/types";

// Deterministic "consistency" pass that runs regardless of what the AI returns.
// The AI handles the hard spatial reasoning (alignment / spacing); these rules
// guarantee the uniform look the user asked for — equal stroke width, one font
// family, quantized font sizes, no stray rotations — so the demo is never ugly.

export const GRID = 20;

/** Snap a value to the nearest grid multiple. */
export const snap = (n: number, grid: number = GRID): number =>
  Math.round(n / grid) * grid;

const STANDARD_FONT_SIZES = [16, 20, 28, 36];

/** Pull a drifting font size (e.g. 20.85) to the nearest standard size. */
export const quantizeFontSize = (fontSize: number): number =>
  STANDARD_FONT_SIZES.reduce((nearest, candidate) =>
    Math.abs(candidate - fontSize) < Math.abs(nearest - fontSize)
      ? candidate
      : nearest,
  );

/**
 * Style fields to normalize for visual consistency. Returns only the changed
 * fields so the caller can merge them into a single immutable update.
 */
export const styleUpdate = (
  el: ExcalidrawElement,
): Partial<ExcalidrawElement> => {
  const update: Record<string, unknown> = {
    strokeWidth: 2,
    strokeStyle: "solid",
    roughness: 1,
    angle: 0,
  };
  if (el.type === "text") {
    update.fontFamily = FONT_FAMILY.Excalifont;
    update.fontSize = quantizeFontSize(
      (el as { fontSize: number }).fontSize ?? 20,
    );
  }
  return update as Partial<ExcalidrawElement>;
};
