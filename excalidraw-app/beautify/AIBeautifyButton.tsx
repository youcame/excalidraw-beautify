import { useEffect, useState } from "react";

import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";

import { beautifyScene } from "./beautify";

import "./AIBeautifyButton.scss";

type Status = "idle" | "loading" | "done" | "error";

const HINT_DISMISSED_KEY = "beautify-used";

interface AIBeautifyButtonProps {
  excalidrawAPI: ExcalidrawImperativeAPI | null;
}

/**
 * The 「美化」 button, rendered inside Excalidraw's top-right control row. A
 * bobbing guide bubble below it nudges first-time visitors to click.
 */
export const AIBeautifyButton = ({ excalidrawAPI }: AIBeautifyButtonProps) => {
  const [status, setStatus] = useState<Status>("idle");
  const [showHint, setShowHint] = useState(
    () => localStorage.getItem(HINT_DISMISSED_KEY) !== "1",
  );

  useEffect(() => {
    if (status === "done") {
      const timer = setTimeout(() => setStatus("idle"), 1600);
      return () => clearTimeout(timer);
    }
    if (status === "error") {
      const timer = setTimeout(() => setStatus("idle"), 2400);
      return () => clearTimeout(timer);
    }
  }, [status]);

  const handleClick = async () => {
    if (status === "loading" || !excalidrawAPI) {
      return;
    }
    setShowHint(false);
    localStorage.setItem(HINT_DISMISSED_KEY, "1");
    setStatus("loading");
    try {
      await beautifyScene(excalidrawAPI);
      setStatus("done");
    } catch (error) {
      console.error("[beautify] failed", error);
      setStatus("error");
    }
  };

  const label =
    status === "loading"
      ? "美化中…"
      : status === "done"
      ? "✓ 已美化"
      : status === "error"
      ? "失败，重试"
      : "✨ 美化";

  return (
    <div className="beautify" data-testid="beautify">
      <button
        type="button"
        className={`beautify__btn beautify__btn--${status}`}
        onClick={() => void handleClick()}
        disabled={status === "loading" || !excalidrawAPI}
        data-status={status}
        data-testid="beautify-button"
        title="美化：对齐边框、统一字体与线宽、连好箭头"
      >
        {status === "loading" && (
          <span className="beautify__spinner" aria-hidden="true" />
        )}
        {label}
      </button>
      {showHint && status === "idle" && (
        <div className="beautify__bubble" role="status">
          点我一键美化
          <span className="beautify__bubble-tail" aria-hidden="true" />
        </div>
      )}
    </div>
  );
};
