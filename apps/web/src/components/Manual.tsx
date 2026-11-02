import { useMemo } from "react";
import { Marked } from "marked";
import manual from "../../../../docs/MANUAL.md?raw";

/** GitHub-style heading anchors, so the manual's table of contents works in the app too. */
const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .trim()
    .replace(/\s/g, "-");

const md = new Marked({
  renderer: {
    heading({ tokens, depth }) {
      const text = this.parser.parseInline(tokens);
      return `<h${depth} id="${slug(text)}">${text}</h${depth}>\n`;
    },
  },
});

export function Manual({ onClose }: { onClose: () => void }) {
  const html = useMemo(() => md.parse(manual) as string, []);
  return (
    <div className="modal-bg" onClick={onClose}>
      <div className="modal manual" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="Manual">
        <div className="panel-head" style={{ position: "sticky", top: 0, background: "var(--panel)", paddingTop: 4 }}>
          <h2>Game manual</h2>
          <button className="btn small" onClick={onClose}>
            Close
          </button>
        </div>
        <div className="manual-body" dangerouslySetInnerHTML={{ __html: html }} />
      </div>
    </div>
  );
}
