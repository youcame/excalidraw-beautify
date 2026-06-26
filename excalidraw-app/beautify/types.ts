// Compact, structured representation of the canvas we send to the AI backend.
// Keeping the payload small (rounded ints, one-letter type codes, truncated
// text) avoids shipping the full Excalidraw element JSON — which can be large
// and full of fields the layout model does not need (seed, versionNonce, etc.).

/** One-letter element category the layout model reasons about. */
export type CompactType = "r" | "t" | "a";

/** A single element reduced to what the layout model needs. `i` is the index
 *  into the original elements array, so the patch can be mapped back. */
export interface CompactElement {
  i: number;
  t: CompactType;
  x: number;
  y: number;
  w: number;
  h: number;
  /** present only for text elements */
  txt?: string;
}

/** One geometry adjustment returned by the backend, keyed by original index. */
export interface PatchItem {
  i: number;
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Backend response envelope. `source` tells us whether the model or the
 *  deterministic fallback produced the patch (useful for the demo + tests). */
export interface BeautifyResponse {
  patch: PatchItem[];
  source?: string;
  model?: string;
}
