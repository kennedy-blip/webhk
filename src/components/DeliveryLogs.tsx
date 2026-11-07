import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Search, Download, Trash2, X, ChevronRight, Copy, Check, RotateCw, ShieldCheck,
  Zap, BadgeCheck, Timer, Repeat2, Webhook, SearchX, KeyRound, Fingerprint, Loader2,
} from "lucide-react";
import type { DeliveryLog } from "../types";
import { timeAgo, formatMs, buildCurl, maskSecret } from "../lib/engine";
import JsonBlock from "./JsonBlock";

/* ------------------------------------------------------------------ */

type StatusFilter = "all" | "success" | "client" | "server";

const FILTERS: { key: StatusFilter; label: string }[] = [
  { key: "all", label: "All" },
  { key: "success", label: "2xx Success" },
  { key: "client", label: "4xx Client" },
  { key: "server", label: "5xx Server" },
];

function statusBadge(log: DeliveryLog) {
  if (log.pending)
    return (
      <span className="inline-flex items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/10 px-2 py-1 font-mono text-[9.5px] font-bold uppercase tracking-wider text-amber-400">
        <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> Sending
      </span>
    );
  const s = log.status;
  const tone =
    s >= 200 && s < 300
      ? "border-emerald-500/35 bg-emerald-500/10 text-emerald-400"
      : s >= 400 && s < 500
        ? "border-amber-500/35 bg-amber-500/10 text-amber-400"
        : "border-rose-500/35 bg-rose-500/10 text-rose-400";
  const dot = s >= 200 && s < 300 ? "bg-emerald-400" : s >= 400 && s < 500 ? "bg-amber-400" : "bg-rose-400";
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[9.5px] font-bold uppercase tracking-wider ${tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
      {s > 0 ? `${s} ${log.statusText}` : "NET ERR"}
    </span>
  );
}

function latencyTone(ms: number) {
  return ms < 300 ? "bg-emerald-400" : ms < 800 ? "bg-amber-400" : "bg-rose-400";
}

interface DeliveryLogsProps {
  logs: DeliveryLog[];
  onClear: () => void;
  onExport: () => void;
  onReplay: (log: DeliveryLog) => void;
  onVerify: (log: DeliveryLog) => void;
  onSendTest: () => void;
}

export default function DeliveryLogs({ logs, onClear, onExport, onReplay, onVerify, onSendTest }: DeliveryLogsProps) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<StatusFilter>("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [drawerTab, setDrawerTab] = useState<"request" | "response" | "attempts">("request");
  const [copied, setCopied] = useState<string | null>(null);

  const selected = useMemo(() => logs.find((l) => l.id === selectedId) ?? null, [logs, selectedId]);

  useEffect(() => {
    document.body.style.overflow = selected ? "hidden" : "";
    return () => {
      document.body.style.overflow = "";
    };
  }, [selected]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setSelectedId(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const copy = useCallback((key: string, text: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(key);
    window.setTimeout(() => setCopied(null), 1600);
  }, []);

  /* ---------- stats ---------- */
  const stats = useMemo(() => {
    const done = logs.filter((l) => !l.pending);
    const total = done.length;
    const okCount = done.filter((l) => l.ok).length;
    const successRate = total ? (okCount / total) * 100 : 0;
    const avgLatency = total ? done.reduce((a, l) => a + l.latencyMs, 0) / total : 0;
    const retries = done.reduce((a, l) => a + l.retries, 0);
    return { total, successRate, avgLatency, retries };
  }, [logs]);

  /* ---------- filtering ---------- */
  const counts = useMemo(() => {
    const c = { all: logs.length, success: 0, client: 0, server: 0 };
    for (const l of logs) {
      if (l.ok) c.success++;
      else if (l.status >= 400 && l.status < 500) c.client++;
      else if (l.status >= 500 || l.status === 0) c.server++;
    }
    return c;
  }, [logs]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return logs.filter((l) => {
      if (filter === "success" && !l.ok) return false;
      if (filter === "client" && !(l.status >= 400 && l.status < 500)) return false;
      if (filter === "server" && !(l.status >= 500 || l.status === 0)) return false;
      if (!q) return true;
      return (
        l.url.toLowerCase().includes(q) ||
        l.event.toLowerCase().includes(q) ||
        String(l.status).includes(q) ||
        l.statusText.toLowerCase().includes(q) ||
        l.host.toLowerCase().includes(q)
      );
    });
  }, [logs, query, filter]);

  const curlFor = (log: DeliveryLog) =>
    buildCurl({ url: log.url, method: log.method, headers: log.headers, payload: log.payload, signature: log.signature });

  const statCards = [
    { icon: Zap, label: "Total Dispatches", value: String(stats.total), sub: "signed & attempted", tone: "text-violet-400 border-violet-500/30 bg-violet-500/10" },
    { icon: BadgeCheck, label: "Success Rate", value: `${stats.successRate.toFixed(1)}%`, sub: `${Math.round((stats.successRate / 100) * stats.total)} of ${stats.total} 2xx`, tone: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10" },
    { icon: Timer, label: "Avg Latency", value: formatMs(stats.avgLatency), sub: "last attempt, p50-ish", tone: "text-sky-400 border-sky-500/30 bg-sky-500/10" },
    { icon: Repeat2, label: "Retries Spent", value: String(stats.retries), sub: "exponential backoff replays", tone: "text-amber-400 border-amber-500/30 bg-amber-500/10" },
  ];

  return (
    <div className="space-y-5">
      {/* ============ Stat strip ============ */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        {statCards.map(({ icon: Icon, label, value, sub, tone }) => (
          <div key={label} className="card-lift rounded-2xl border border-edge bg-panel p-4 sm:p-5">
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-slate-500">{label}</p>
              <span className={`flex h-7 w-7 items-center justify-center rounded-lg border ${tone}`}><Icon size={13} /></span>
            </div>
            <p className="mt-2.5 font-mono text-[26px] font-bold leading-none tracking-tight text-slate-100 tabular-nums">{value}</p>
            <p className="mt-1.5 font-mono text-[9px] text-slate-600">{sub}</p>
          </div>
        ))}
      </div>

      {/* ============ Table card ============ */}
      <section className="overflow-hidden rounded-2xl border border-edge bg-panel shadow-[0_18px_44px_rgba(2,6,18,0.45)]">
        {/* toolbar */}
        <div className="flex flex-col gap-3 border-b border-edge/70 px-5 py-4 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex flex-1 items-center gap-3">
            <div className="field flex h-10 w-full max-w-md items-center rounded-lg">
              <Search size={14} className="ml-3 shrink-0 text-slate-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search URL, event type, status…"
                aria-label="Search delivery logs"
                className="h-full w-full bg-transparent px-2.5 font-mono text-[11.5px] text-slate-200 placeholder:text-slate-700 focus:outline-none"
              />
              {query && (
                <button onClick={() => setQuery("")} className="mr-2 rounded p-1 text-slate-600 hover:text-slate-300" aria-label="Clear search">
                  <X size={13} />
                </button>
              )}
            </div>
            <div className="hidden shrink-0 items-center gap-1.5 rounded-md border border-edge bg-panel-2 px-2 py-1.5 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600 md:flex">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-400" /> {filtered.length} shown
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-lg border border-edge bg-panel-2 p-1">
              {FILTERS.map((f) => {
                const active = filter === f.key;
                return (
                  <button
                    key={f.key}
                    onClick={() => setFilter(f.key)}
                    className={`rounded-md px-2.5 py-1.5 font-mono text-[10px] font-semibold transition-all ${
                      active ? "bg-violet-500/20 text-violet-300 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.4)]" : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {f.label} <span className="tabular-nums opacity-70">{counts[f.key]}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={onExport} title="Export logs as JSON"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-edge bg-panel px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-all hover:border-sky-500/40 hover:text-sky-300">
              <Download size={12} /> <span className="hidden sm:inline">Export</span>
            </button>
            <button onClick={onClear} title="Delete all logs"
              className="flex h-9 items-center gap-1.5 rounded-lg border border-edge bg-panel px-3 font-mono text-[10px] font-semibold uppercase tracking-wider text-slate-400 transition-all hover:border-rose-500/40 hover:text-rose-300">
              <Trash2 size={12} /> <span className="hidden sm:inline">Clear</span>
            </button>
          </div>
        </div>

        {/* table */}
        {logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-4 px-6 py-16 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-violet-500/30 bg-violet-500/8 shadow-[0_0_40px_rgba(139,92,246,0.18)]">
              <Webhook size={28} className="text-violet-400" />
            </div>
            <div>
              <p className="text-[15px] font-semibold text-slate-200">No deliveries recorded yet</p>
              <p className="mt-1 max-w-sm font-mono text-[10.5px] leading-relaxed text-slate-500">
                Fire your first signed test event and every dispatch — attempts, signatures, responses — will be inspected here.
              </p>
            </div>
            <button onClick={onSendTest}
              className="mt-1 inline-flex h-10 items-center gap-2 rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 px-5 text-[12px] font-bold text-white shadow-[0_0_24px_rgba(139,92,246,0.4)] transition-all hover:from-violet-500 hover:to-purple-500">
              <Zap size={14} /> Send Test Webhook
            </button>
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex flex-col items-center gap-3 px-6 py-14 text-center">
            <SearchX size={26} className="text-slate-600" />
            <p className="font-mono text-[11px] text-slate-500">No logs match <span className="text-slate-300">“{query}”</span></p>
            <button onClick={() => { setQuery(""); setFilter("all"); }} className="font-mono text-[10px] uppercase tracking-widest text-violet-400 hover:text-violet-300">Reset filters</button>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] border-collapse text-left">
              <thead>
                <tr className="bg-panel-2/60">
                  {["Status", "Event", "Endpoint", "Latency", "Retries", "Age", ""].map((h, i) => (
                    <th key={i} className="px-4 py-2.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.22em] text-slate-600">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {filtered.map((log) => (
                  <tr
                    key={log.id}
                    onClick={() => { setSelectedId(log.id); setDrawerTab("request"); }}
                    className="log-row group cursor-pointer border-t border-edge/50"
                    tabIndex={0}
                    onKeyDown={(e) => e.key === "Enter" && setSelectedId(log.id)}
                    aria-label={`Inspect delivery to ${log.url}`}
                  >
                    <td className="px-4 py-3 align-middle">{statusBadge(log)}</td>
                    <td className="px-4 py-3 align-middle">
                      <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium text-violet-300">
                        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-violet-500" />
                        {log.event}
                      </span>
                    </td>
                    <td className="max-w-[260px] px-4 py-3 align-middle">
                      <div className="flex items-center gap-2">
                        <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/8 px-1.5 py-0.5 font-mono text-[8.5px] font-bold text-emerald-400">{log.method}</span>
                        <span className="truncate font-mono text-[10.5px] text-slate-400" title={log.url}>{log.url}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <div className="font-mono text-[10.5px] tabular-nums text-slate-300">{log.pending ? "—" : formatMs(log.latencyMs)}</div>
                      {!log.pending && (
                        <div className="mt-1 h-1 w-16 overflow-hidden rounded-full bg-edge">
                          <div className={`h-full rounded-full ${latencyTone(log.latencyMs)}`} style={{ width: `${Math.min(100, (log.latencyMs / 2000) * 100)}%` }} />
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 align-middle">
                      <span className={`flex items-center gap-1 font-mono text-[10.5px] tabular-nums ${log.retries > 0 ? "text-amber-400" : "text-slate-600"}`}>
                        <Repeat2 size={11} /> ×{log.retries}
                      </span>
                    </td>
                    <td className="whitespace-nowrap px-4 py-3 align-middle font-mono text-[10px] text-slate-500">{timeAgo(log.timestamp)}</td>
                    <td className="px-2 py-3 align-middle">
                      <ChevronRight size={15} className="text-slate-700 transition-all duration-200 group-hover:translate-x-0.5 group-hover:text-violet-400" />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ============ Drawer ============ */}
      {selected && (
        <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Delivery inspection drawer">
          <div className="anim-fade-in absolute inset-0 bg-black/65 backdrop-blur-sm" onClick={() => setSelectedId(null)} />
          <aside className="anim-drawer-in absolute right-0 top-0 flex h-full w-full max-w-2xl flex-col border-l border-edge-2/60 bg-panel-2 shadow-[0_0_80px_rgba(0,0,0,0.6)]">
            {/* drawer header */}
            <div className="terminal-titlebar border-b border-edge/80 px-5 pb-4 pt-4">
              <div className="flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="rounded border border-emerald-500/30 bg-emerald-500/8 px-1.5 py-0.5 font-mono text-[9px] font-bold text-emerald-400">{selected.method}</span>
                    {statusBadge(selected)}
                  </div>
                  <p className="mt-2 break-all font-mono text-[11.5px] font-semibold leading-snug text-slate-100">{selected.url}</p>
                  <p className="mt-1 font-mono text-[9px] uppercase tracking-[0.18em] text-slate-600">{new Date(selected.timestamp).toISOString().replace("T", "  ").slice(0, 21)} UTC · {selected.event}</p>
                </div>
                <button onClick={() => setSelectedId(null)} aria-label="Close inspector"
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-edge text-slate-500 transition-colors hover:border-edge-2 hover:text-slate-200">
                  <X size={15} />
                </button>
              </div>
              {/* meta grid */}
              <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  { k: "Latency", v: selected.pending ? "—" : formatMs(selected.latencyMs) },
                  { k: "Total time", v: selected.pending ? "—" : formatMs(selected.totalDurationMs) },
                  { k: "Attempts", v: String(selected.attempts.length || 1) },
                  { k: "Retries", v: `×${selected.retries}` },
                ].map(({ k, v }) => (
                  <div key={k} className="rounded-lg border border-edge/70 bg-abyss/50 px-2.5 py-2">
                    <p className="font-mono text-[8px] font-semibold uppercase tracking-[0.2em] text-slate-600">{k}</p>
                    <p className="mt-0.5 font-mono text-[13px] font-bold tabular-nums text-slate-100">{v}</p>
                  </div>
                ))}
              </div>
              {/* signature banner */}
              <div className="mt-3 rounded-xl border border-fuchsia-500/25 bg-fuchsia-500/6 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.22em] text-fuchsia-300/90"><KeyRound size={10} /> X-Hub-Signature-256</span>
                  <button onClick={() => copy("sig", selected.signature)} className="flex items-center gap-1 font-mono text-[9px] text-slate-500 transition-colors hover:text-slate-200">
                    {copied === "sig" ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />} copy
                  </button>
                </div>
                <p className="mt-1.5 break-all font-mono text-[10px] leading-relaxed text-emerald-300/90">{selected.signature}</p>
              </div>
            </div>

            {/* tabs */}
            <div className="flex items-center gap-1 border-b border-edge/70 px-5 pt-3">
              {([
                { key: "request", label: "Request" },
                { key: "response", label: "Response" },
                { key: "attempts", label: `Attempts ×${selected.attempts.length || 1}` },
              ] as const).map((t) => (
                <button
                  key={t.key}
                  onClick={() => setDrawerTab(t.key)}
                  className={`rounded-t-lg border-b-2 px-4 pb-2.5 pt-2 font-mono text-[10.5px] font-semibold transition-all ${
                    drawerTab === t.key ? "border-violet-400 text-violet-300" : "border-transparent text-slate-500 hover:text-slate-300"
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* drawer body */}
            <div className="flex-1 overflow-y-auto px-5 py-4">
              {drawerTab === "request" && (
                <div className="space-y-4 anim-fade-in">
                  <div>
                    <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-slate-600">Request headers</p>
                    <div className="overflow-hidden rounded-xl border border-edge/70">
                      {selected.headers.map((h, i) => (
                        <div key={i} className={`grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3 px-3 py-1.5 font-mono text-[10px] ${i % 2 ? "bg-panel-3/40" : "bg-abyss/40"}`}>
                          <span className="truncate text-amber-200/75" title={h.key}>{h.key}</span>
                          <span className="break-all text-slate-300">{h.value}</span>
                        </div>
                      ))}
                      <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.6fr)] gap-3 bg-fuchsia-500/6 px-3 py-1.5 font-mono text-[10px]">
                        <span className="truncate text-fuchsia-300/80">X-Hub-Signature-256</span>
                        <span className="break-all text-emerald-300/85">{selected.signature}</span>
                      </div>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 flex items-center justify-between font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-slate-600">
                      Raw body
                      <span className="normal-case tracking-normal text-slate-700">{new Blob([selected.payload]).size} bytes · verbatim bytes signed</span>
                    </p>
                    <JsonBlock code={selected.payload} maxHeight={280} />
                  </div>
                  <p className="font-mono text-[9px] text-slate-700">Secret fingerprint: <span className="text-slate-500">{maskSecret(selected.secret, 8)}</span> — full secret never leaves the client.</p>
                </div>
              )}

              {drawerTab === "response" && (
                <div className="space-y-4 anim-fade-in">
                  <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${selected.pending ? "border-amber-500/30 bg-amber-500/5" : selected.ok ? "border-emerald-500/30 bg-emerald-500/6" : "border-rose-500/30 bg-rose-500/6"}`}>
                    {selected.pending ? <Loader2 size={16} className="anim-spin-slow text-amber-400" /> : <span className={`h-2.5 w-2.5 rounded-full ${selected.ok ? "bg-emerald-400" : "bg-rose-400"}`} />}
                    <div>
                      <p className={`font-mono text-[12px] font-bold ${selected.pending ? "text-amber-300" : selected.ok ? "text-emerald-300" : "text-rose-300"}`}>
                        {selected.pending ? "Awaiting receiver response…" : `HTTP ${selected.status} — ${selected.statusText}`}
                      </p>
                      <p className="font-mono text-[9px] text-slate-600">{selected.pending ? "the dispatch is still in flight" : `returned in ${formatMs(selected.latencyMs)} · trace attached below`}</p>
                    </div>
                  </div>
                  <div>
                    <p className="mb-2 font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-slate-600">Response body</p>
                    {selected.pending ? (
                      <div className="space-y-2 rounded-xl border border-edge/70 bg-abyss/40 p-4">
                        {[80, 60, 90].map((w, i) => <div key={i} className="shimmer h-3.5 rounded" style={{ width: `${w}%` }} />)}
                      </div>
                    ) : (
                      <JsonBlock code={selected.responseBody} maxHeight={320} />
                    )}
                  </div>
                </div>
              )}

              {drawerTab === "attempts" && (
                <div className="anim-fade-in">
                  <p className="mb-3 font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-slate-600">Retry timeline — exponential backoff</p>
                  <div className="relative ml-2 border-l border-edge-2/60 pl-6">
                    {selected.attempts.length === 0 && <p className="font-mono text-[10.5px] text-slate-600">First attempt is still in flight…</p>}
                    {selected.attempts.map((a) => (
                      <div key={a.attempt} className="relative pb-5 last:pb-0">
                        <span className={`absolute -left-[31px] top-1 h-3.5 w-3.5 rounded-full border-2 border-panel-2 ${a.ok ? "bg-emerald-400" : "bg-rose-500"}`} />
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[10.5px] font-bold text-slate-200">Attempt {a.attempt}</span>
                          {a.delayBeforeMs > 0 && (
                            <span className="rounded border border-amber-500/30 bg-amber-500/8 px-1.5 py-0.5 font-mono text-[8.5px] font-semibold text-amber-400">
                              waited {formatMs(a.delayBeforeMs)}
                            </span>
                          )}
                          <span className={`rounded border px-1.5 py-0.5 font-mono text-[8.5px] font-bold ${a.ok ? "border-emerald-500/30 bg-emerald-500/8 text-emerald-400" : "border-rose-500/30 bg-rose-500/8 text-rose-400"}`}>
                            {a.status > 0 ? `HTTP ${a.status}` : "NET ERR"}
                          </span>
                          <span className="font-mono text-[9px] tabular-nums text-slate-600">{formatMs(a.latencyMs)}</span>
                          <span className="font-mono text-[9px] text-slate-700">{new Date(a.startedAt).toISOString().slice(11, 19)}</span>
                        </div>
                        <p className="mt-1 font-mono text-[9px] text-slate-600">{a.ok ? "2xx acknowledged — retry loop stopped" : `${a.statusText} — backoff scheduled (base × multiplier^n, jittered)`}</p>
                      </div>
                    ))}
                  </div>
                  {!selected.pending && (
                    <div className="mt-4 rounded-xl border border-edge/70 bg-abyss/40 px-4 py-3 font-mono text-[9.5px] leading-relaxed text-slate-500">
                      <span className="text-slate-300">Wall clock:</span> {formatMs(selected.totalDurationMs)} across {selected.attempts.length} attempt(s) · <span className="text-slate-300">{selected.retries} retr{selected.retries === 1 ? "y" : "ies"}</span> consumed · strategy <span className="text-violet-300">exponential</span>
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* drawer footer */}
            <div className="flex flex-wrap items-center gap-2 border-t border-edge/80 bg-abyss/40 px-5 py-3">
              <button onClick={() => onVerify(selected)}
                className="flex h-9 items-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-violet-300 transition-all hover:bg-violet-500/20 hover:shadow-[0_0_16px_rgba(139,92,246,0.3)]">
                <Fingerprint size={12} /> Verify HMAC
              </button>
              <button onClick={() => onReplay(selected)} disabled={selected.pending}
                className="flex h-9 items-center gap-2 rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-emerald-300 transition-all hover:bg-emerald-500/20 disabled:cursor-not-allowed disabled:opacity-40">
                <RotateCw size={12} /> Replay
              </button>
              <button onClick={() => copy("curl", curlFor(selected))}
                className="flex h-9 items-center gap-2 rounded-lg border border-edge bg-panel px-3 font-mono text-[10px] font-bold uppercase tracking-wider text-slate-400 transition-all hover:text-slate-200">
                {copied === "curl" ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} cURL
              </button>
              <span className="ml-auto hidden items-center gap-1.5 font-mono text-[8px] uppercase tracking-[0.2em] text-slate-700 sm:flex"><ShieldCheck size={10} /> signed · TLS 1.3</span>
            </div>
          </aside>
        </div>
      )}
    </div>
  );
}
