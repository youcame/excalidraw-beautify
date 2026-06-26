import { CaptureUpdateAction } from "@excalidraw/excalidraw";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { localBeautify } from "./localBeautify";

/**
 * 美化 the current scene: align boxes into tidy columns, straighten, unify
 * styles, re-center bound text, reconnect bound arrows. Instant + deterministic
 * (no network / model), and undoable via Ctrl+Z.
 */
export const beautifyScene = async (
  api: ExcalidrawImperativeAPI,
): Promise<void> => {
  const elements = api.getSceneElements();
  if (!elements.length) {
    return;
  }
  const next = localBeautify(elements);
  api.updateScene({
    elements: next,
    captureUpdate: CaptureUpdateAction.IMMEDIATELY,
  });
  api.scrollToContent(next, { fitToContent: true, animate: true });
};
