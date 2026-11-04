import { useState, type ReactNode } from "react";

const KEY = "laycan-tips-v1";

function readSeen(): Record<string, number> {
  try {
    return JSON.parse(localStorage.getItem(KEY) ?? "{}") as Record<string, number>;
  } catch {
    return {};
  }
}

function writeSeen(seen: Record<string, number>) {
  try {
    localStorage.setItem(KEY, JSON.stringify(seen));
  } catch {
    /* storage unavailable: tips come back next time */
  }
}

/** Show every tip again (from the manual). */
export function resetTips() {
  writeSeen({});
}

/**
 * A row of tips shown one at a time: closing one (×) brings up the next, until all are seen.
 * Remembered per browser.
 */
export function Tips({ id, tips }: { id: string; tips: ReactNode[] }) {
  const [seen, setSeen] = useState(() => readSeen()[id] ?? 0);
  if (seen >= tips.length) return null;
  const close = () => {
    const all = readSeen();
    all[id] = seen + 1;
    writeSeen(all);
    setSeen(seen + 1);
  };
  return (
    <div className="hint tip" data-testid={`tip-${id}`}>
      <div className="tip-body">
        {tips.length > 1 && (
          <span className="tip-count">
            Tip {seen + 1}/{tips.length}
          </span>
        )}
        {tips[seen]}
      </div>
      <button className="tip-close" onClick={close} aria-label={seen + 1 < tips.length ? "Next tip" : "Close tip"} title={seen + 1 < tips.length ? "Close (next tip)" : "Close"}>
        ×
      </button>
    </div>
  );
}
