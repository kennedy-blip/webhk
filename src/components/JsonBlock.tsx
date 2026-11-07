import { useMemo } from "react";
import type { ReactNode } from "react";

/** Tokenize JSON text into syntax-highlighted React nodes (Cyber-violet theme). */
function highlightJson(source: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const re = /("(?:\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*")(\s*:)?|\b(true|false)\b|\bnull\b|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g;
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) {
    if (m.index > last) nodes.push(<span key={`t${i++}`}>{source.slice(last, m.index)}</span>);
    const full = m[0];
    const str = m[1];
    const colon = m[2];
    if (str !== undefined) {
      nodes.push(
        <span key={`s${i++}`} className={colon !== undefined ? "text-violet-300" : "text-emerald-300"}>
          {str}
        </span>
      );
      if (colon) nodes.push(<span key={`c${i++}`}>{colon}</span>);
    } else if (full === "true" || full === "false") {
      nodes.push(<span key={`b${i++}`} className="text-rose-400">{full}</span>);
    } else if (full === "null") {
      nodes.push(<span key={`n${i++}`} className="text-slate-500 italic">{full}</span>);
    } else {
      nodes.push(<span key={`d${i++}`} className="text-amber-300">{full}</span>);
    }
    last = m.index + full.length;
  }
  if (last < source.length) nodes.push(<span key={`tail${i++}`}>{source.slice(last)}</span>);
  return nodes;
}

interface JsonBlockProps {
  code: string;
  className?: string;
  /** when set, the block gets a max height and scrolls */
  maxHeight?: number;
}

export default function JsonBlock({ code, className = "", maxHeight }: JsonBlockProps) {
  const nodes = useMemo(() => highlightJson(code), [code]);
  const isJson = useMemo(() => {
    try {
      JSON.parse(code);
      return true;
    } catch {
      return false;
    }
  }, [code]);

  return (
    <pre
      className={`code-block overflow-auto rounded-xl p-4 font-mono text-[11.5px] leading-[1.75] text-slate-400 ${className}`}
      style={maxHeight ? { maxHeight, whiteSpace: "pre" } : { whiteSpace: "pre-wrap", wordBreak: "break-word" }}
    >
      {isJson ? nodes : code}
    </pre>
  );
}
