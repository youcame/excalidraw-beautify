import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/element/types";

import type { CompactElement, CompactType } from "./types";

// Box-like shapes and arrows collapse into three categories the layout model
// understands. Unknown / unsupported types are skipped (their index simply
// never appears in the patch, so merge leaves them untouched).
const TYPE_CODE: Partial<Record<ExcalidrawElement["type"], CompactType>> = {
  rectangle: "r",
  diamond: "r",
  ellipse: "r",
  text: "t",
  arrow: "a",
  line: "a",
};

const MAX_TEXT_LEN = 24;

/**
 * Reduce a full scene to a compact, model-friendly array. Indices refer to the
 * original `elements` array so a returned patch can be applied back precisely.
 */
export const extractCompact = (
  elements: readonly ExcalidrawElement[],
): CompactElement[] => {
  const out: CompactElement[] = [];
  elements.forEach((el, i) => {
    if (el.isDeleted) {
      return;
    }
    const t = TYPE_CODE[el.type];
    if (!t) {
      return;
    }
    const compact: CompactElement = {
      i,
      t,
      x: Math.round(el.x),
      y: Math.round(el.y),
      w: Math.round(el.width),
      h: Math.round(el.height),
    };
    if (el.type === "text") {
      const text = (el as ExcalidrawTextElement).text
        ?.replace(/\s+/g, " ")
        .trim()
        .slice(0, MAX_TEXT_LEN);
      if (text) {
        compact.txt = text;
      }
    }
    out.push(compact);
  });
  return out;
};
