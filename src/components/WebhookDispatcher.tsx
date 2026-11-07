import { useEffect, useMemo, useRef, useState } from "react";
import {
  Globe, Plus, Trash2, SendHorizontal, Loader2, Copy, Check, Eye, EyeOff, RefreshCw,
  Braces, Minimize2, Wand2, BadgeCheck, FileJson2, RadioTower, KeyRound,
  Zap, Timer, Repeat2, Shuffle, TrendingUp, CheckCircle2, XCircle, Terminal, Save,
  FileWarning, ShieldCheck, CircleDashed, CheckCheck,
} from "lucide-react";
import type { DispatchInput, DispatchProgress, HttpMethod, HeaderRow, RetryPolicy, ChaosMode, ToastKind } from "../types";
import { EVENT_PRESETS, CHAOS_META, detectChaos, signPayload, formatBytes, uid, safeEventType, buildCurl } from "../lib/engine";
import JsonBlock from "./JsonBlock";

/* ------------------------------------------------------------------ */

const URL_CHIPS: { label: string; url: string; dot: string }[] = [
  { label: "acmecorp · prod", url: "https://api.acmecorp.io/v1/webhooks/stripe", dot: "#10b981" },
  { label: "staging · inbound", url: "https://staging.internal.dev/hooks/inbound", dot: "#10b981" },
  { label: "paygate sandbox", url: "https://sandbox.paygate.test/webhook/receiver", dot: "#f59e0b" },
  { label: "legacy billing", url: "https://api.legacybilling.net/v1/hooks", dot: "#f43f5e" },
  { label: "timeout gateway", url: "https://gateway.timeout-prone.io/ingest", dot: "#f43f5e" },
];

const CHAOS_CHIPS: { key: ChaosMode; label: string }[] = [
  { key: "auto", label: "Auto" },
  { key: "healthy", label: "Healthy" },
  { key: "flaky", label: "Flaky" },
  { key: "client400", label: "400" },
  { key: "rateLimit429", label: "429" },
  { key: "server500", label: "500" },
  { key: "timeout504", label: "504" },
];

const METHODS: HttpMethod[] = ["POST", "PUT", "PATCH"];
const METHOD_COLOR: Record<HttpMethod, string> = {
  POST: "text-emerald-400 border-emerald-500/40 bg-emerald-500/10",
  PUT: "text-amber-400 border-amber-500/40 bg-amber-500/10",
  PATCH: "text-sky-400 border-sky-500/40 bg-sky-500/10",
};

interface DispatcherProps {
  onDispatch: (input: DispatchInput) => void;
  progress: DispatchProgress | null;
  dispatching: boolean;
  retryPolicy: RetryPolicy;
  autoRetry: boolean;
  onAutoRetryChange: (v: boolean) => void;
  onSaveSecretToVault: (value: string) => void;
  pushToast: (kind: ToastKind, title: string, message?: string) => void;
}

const panel = "rounded-2xl border border-edge bg-panel shadow-[0_18px_44px_rgba(2,6,18,0.45)]";
const panelHeader = "flex items-center justify-between gap-3 border-b border-edge/70 px-5 py-3.5";

function PanelIcon({ children, tone = "violet" }: { children: React.ReactNode; tone?: "violet" | "emerald" | "amber" }) {
  const tones = {
    violet: "border-violet-500/30 bg-violet-500/10 text-violet-400",
    emerald: "border-emerald-500/30 bg-emerald-500/10 text-emerald-400",
    amber: "border-amber-500/30 bg-amber-500/10 text-amber-400",
  } as const;
  return (
    <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${tones[tone]}`}>
      {children}
    </div>
  );
}

/* ================================================================== */

export default function WebhookDispatcher({
  onDispatch, progress, dispatching, retryPolicy, autoRetry, onAutoRetryChange, onSaveSecretToVault, pushToast,
}: DispatcherProps) {
  const [method, setMethod] = useState<HttpMethod>("POST");
  const [url, setUrl] = useState("https://api.acmecorp.io/v1/webhooks/stripe");
  const [chaosOverride, setChaosOverride] = useState<ChaosMode>("auto");
  const [headers, setHeaders] = useState<HeaderRow[]>([
    { id: uid("hdr"), key: "Content-Type", value: "application/json", enabled: true },
    { id: uid("hdr"), key: "X-Custom-Source", value: "WebhookPulse", enabled: true },
  ]);
  const [secret, setSecret] = useState("whsec_9f2cA4x8QmL7vR3dT6yB1nK5");
  const [secretVisible, setSecretVisible] = useState(false);
  const [secretCopied, setSecretCopied] = useState(false);
  const [payload, setPayload] = useState(() => EVENT_PRESETS[0].build());
  const [activePreset, setActivePreset] = useState<string | null>(EVENT_PRESETS[0].id);
  const [payloadCopied, setPayloadCopied] = useState(false);
  const [curlCopied, setCurlCopied] = useState(false);

  const gutterRef = useRef<HTMLDivElement>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);

  /* ---------- derived values ---------- */
  const urlValid = useMemo(() => {
    try {
      const u = new URL(url);
      return u.protocol === "https:" || u.protocol === "http:";
    } catch {
      return false;
    }
  }, [url]);

  const host = useMemo(() => (urlValid ? new URL(url).host : "invalid-host"), [url, urlValid]);
  const path = useMemo(() => {
    if (!urlValid) return "/";
    const u = new URL(url);
    return u.pathname + u.search || "/";
  }, [url, urlValid]);

  const parseResult = useMemo(() => {
    try {
      const parsed = JSON.parse(payload);
      return { ok: true as const, value: parsed, error: "" as string };
    } catch (e) {
      return { ok: false as const, value: null, error: e instanceof Error ? e.message : "Invalid JSON" };
    }
  }, [payload]);

  const jsonOk = parseResult.ok;
  const jsonErrorLine = useMemo(() => {
    if (jsonOk) return null;
    const m = /position (\d+)/.exec(parseResult.error);
    if (!m) return null;
    return payload.slice(0, Number(m[1])).split("\n").length;
  }, [jsonOk, parseResult.error, payload]);

  const eventType = safeEventType(payload);
  const bytes = useMemo(() => new Blob([payload]).size, [payload]);
  const lineCount = useMemo(() => payload.split("\n").length, [payload]);
  const signature = useMemo(() => signPayload(secret, payload, "prefixed"), [secret, payload]);
  const signaturesForPreview = useMemo(() => ({ webhookId: uid("msg"), ts: Math.floor(Date.now() / 1000) }), [signature]);

  const detected = detectChaos(url);
  const effectiveChaos = chaosOverride === "auto" ? detected : chaosOverride;
  const chaosMeta = CHAOS_META[effectiveChaos];

  const enabledHeaders = headers.filter((h) => h.enabled && h.key.trim());
  const curlPreview = useMemo(
    () =>
      buildCurl({
        url: url || "https://receiver.internal/",
        method,
        headers: enabledHeaders.map((h) => ({ key: h.key, value: h.value })),
        payload,
        signature,
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [url, method, headers, payload, signature]
  );

  /* ---------- gutter sync ---------- */
  useEffect(() => {
    if (gutterRef.current && taRef.current) gutterRef.current.scrollTop = taRef.current.scrollTop;
  }, [payload]);

  /* ---------- actions ---------- */
  const applyPreset = (id: string) => {
    const preset = EVENT_PRESETS.find((p) => p.id === id)!;
    setPayload(preset.build());
    setActivePreset(id);
  };

  const formatPayload = () => {
    if (!jsonOk) return pushToast("error", "Cannot format", "The payload is not valid JSON.");
    setPayload(JSON.stringify(parseResult.value, null, 2));
  };
  const minifyPayload = () => {
    if (!jsonOk) return pushToast("error", "Cannot minify", "The payload is not valid JSON.");
    setPayload(JSON.stringify(parseResult.value));
  };
  const copy = (text: string, set: (v: boolean) => void) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    set(true);
    window.setTimeout(() => set(false), 1600);
  };

  const handleSend = () => {
    if (dispatching) return;
    if (!urlValid) return pushToast("error", "Invalid endpoint", "Enter a fully-qualified http(s) URL.");
    if (!jsonOk) return pushToast("error", "Invalid JSON payload", "Fix the syntax error before dispatching.");
    onDispatch({ url: url.trim(), method, headers, payload, secret, chaosOverride });
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
      e.preventDefault();
      handleSend();
    }
  };

  const setHeader = (id: string, patch: Partial<HeaderRow>) =>
    setHeaders((hs) => hs.map((h) => (h.id === id ? { ...h, ...patch } : h)));
  const addHeader = () => setHeaders((hs) => [...hs, { id: uid("hdr"), key: "", value: "", enabled: true }]);
  const removeHeader = (id: string) => setHeaders((hs) => (hs.length > 1 ? hs.filter((h) => h.id !== id) : hs));

  /* ---------- pipeline step model ---------- */
  type StepState = "pending" | "active" | "done" | "warn" | "failed";
  const phase = progress?.phase;
  const done = phase === "done";
  const success = done && progress?.outcome === "success";
  const failure = done && progress?.outcome === "failure";
  const stepFor = (n: number): StepState => {
    if (!progress) return "pending";
    if (phase === "sending") return n <= 2 ? (n < 3 ? "done" : "active") : n === 3 ? "active" : "pending";
    if (phase === "waiting") return n <= 2 ? "done" : n === 3 ? "warn" : "warn";
    return success ? "done" : failure ? (n <= 2 ? "done" : "failed") : "pending";
  };
  const stepStyles = (s: StepState) =>
    s === "done"
      ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-400"
      : s === "active"
        ? "border-violet-500/60 bg-violet-500/15 text-violet-300 shadow-[0_0_16px_rgba(139,92,246,0.35)]"
        : s === "warn"
          ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
          : s === "failed"
            ? "border-rose-500/50 bg-rose-500/10 text-rose-400"
            : "border-edge bg-panel-2 text-slate-600";

  const stepIcon = (n: number, s: StepState) =>
    s === "done" ? <CheckCheck size={15} /> : s === "failed" ? <XCircle size={15} /> : n === 1 ? <FileJson2 size={15} /> : n === 2 ? <KeyRound size={15} /> : n === 3 ? <RadioTower size={15} /> : <ShieldCheck size={15} />;

  const steps = [
    { n: 1, title: "Serialize & validate", sub: jsonOk ? `payload parsed · ${formatBytes(bytes)} · ${lineCount} lines` : "payload failed JSON.parse" },
    { n: 2, title: "Sign HMAC-SHA256", sub: `sha256=${signature.slice(7, 23)}…` },
    { n: 3, title: `Transmit ${method} over TLS 1.3`, sub: !progress ? "awaiting dispatch" : phase === "sending" ? `attempt ${progress.attempt} in flight → ${host}` : phase === "waiting" ? `attempt ${progress.attempt} rejected · HTTP ${progress.finalStatus}` : failure ? `last attempt returned HTTP ${progress.finalStatus}` : `HTTP ${progress.finalStatus} acknowledged` },
    { n: 4, title: "Await response & classify", sub: phase === "waiting" && progress ? `backoff sleep ${(progress.waitMsLeft / 1000).toFixed(1)}s → attempt ${progress.attempt + 1}/${progress.maxAttempts}` : done ? (success ? "2xx received — delivery confirmed" : "retry budget exhausted") : "not yet evaluated" },
  ];

  const waitFrac = progress && progress.phase === "waiting" && progress.waitTotalMs > 0 ? progress.waitMsLeft / progress.waitTotalMs : 0;
  const CIRC = 2 * Math.PI * 15.5;

  /* ================================================================= */

  return (
    <div className="grid grid-cols-12 gap-4 sm:gap-5" onKeyDown={handleKeyDown}>
      {/* ============ LEFT — Target configurator ============ */}
      <section className={`${panel} anim-fade-up col-span-12 xl:col-span-5`}>
        <div className={panelHeader}>
          <div className="flex items-center gap-3">
            <PanelIcon><RadioTower size={15} /></PanelIcon>
            <div>
              <h2 className="text-[13px] font-semibold tracking-tight text-slate-100">Target Endpoint</h2>
              <p className="text-[10.5px] text-slate-500">Where the signed event is delivered</p>
            </div>
          </div>
          <div className="flex items-center gap-1.5 rounded-md border border-edge bg-panel-2 px-2 py-1" title="Receiver behavior profile">
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: chaosMeta.dot }} />
            <span className={`font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] ${chaosMeta.color}`}>
              {chaosMeta.label}
            </span>
          </div>
        </div>

        <div className="space-y-5 px-5 py-5">
          {/* chaos profile */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Receiver profile</label>
              <span className="font-mono text-[9px] text-slate-600">auto-detects from URL · overridable</span>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {CHAOS_CHIPS.map((c) => {
                const active = chaosOverride === c.key;
                return (
                  <button
                    key={c.key}
                    onClick={() => setChaosOverride(c.key)}
                    className={`rounded-md border px-2 py-1 font-mono text-[10px] font-semibold transition-all ${
                      active
                        ? "border-violet-500/60 bg-violet-500/15 text-violet-300 shadow-[0_0_12px_rgba(139,92,246,0.25)]"
                        : "border-edge bg-panel-2 text-slate-500 hover:border-edge-2 hover:text-slate-300"
                    }`}
                  >
                    {c.label}
                  </button>
                );
              })}
            </div>
          </div>

          {/* method + url */}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Endpoint URL</label>
            <div className="flex gap-2">
              <div className="flex shrink-0 overflow-hidden rounded-lg border border-edge bg-panel-2">
                {METHODS.map((m) => (
                  <button
                    key={m}
                    onClick={() => setMethod(m)}
                    className={`h-11 border-r border-edge px-3 font-mono text-[11px] font-bold tracking-wide transition-all last:border-r-0 ${
                      method === m ? METHOD_COLOR[m] : "text-slate-500 hover:text-slate-300"
                    }`}
                  >
                    {m}
                  </button>
                ))}
              </div>
              <div className="field relative flex h-11 flex-1 items-center rounded-lg">
                <Globe size={14} className="pointer-events-none absolute left-3 text-slate-600" />
                <input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  placeholder="https://api.mycompany.com/v1/webhooks"
                  className="h-full w-full rounded-lg bg-transparent pl-9 pr-8 font-mono text-[11.5px] text-slate-100 placeholder:text-slate-700 focus:outline-none"
                />
                <span
                  className={`absolute right-3 h-2 w-2 rounded-full transition-colors ${urlValid ? "bg-emerald-400 shadow-[0_0_8px_rgba(16,185,129,0.7)]" : "bg-rose-500 shadow-[0_0_8px_rgba(244,63,94,0.7)]"}`}
                  title={urlValid ? "URL parses correctly" : "Malformed URL"}
                />
              </div>
            </div>
            {/* endpoint quick chips */}
            <div className="mt-2 flex flex-wrap gap-1.5">
              {URL_CHIPS.map((chip) => (
                <button
                  key={chip.url}
                  onClick={() => setUrl(chip.url)}
                  className="flex items-center gap-1.5 rounded-md border border-edge/80 bg-panel-2 px-2 py-1 font-mono text-[9.5px] text-slate-500 transition-all hover:border-violet-500/40 hover:text-violet-300"
                >
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: chip.dot }} />
                  {chip.label}
                </button>
              ))}
            </div>
          </div>

          {/* headers builder */}
          <div>
            <div className="mb-1.5 flex items-center justify-between">
              <label className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">Custom Headers</label>
              <span className="font-mono text-[9px] tabular-nums text-slate-600">{enabledHeaders.length}/{headers.length} active</span>
            </div>
            <div className="space-y-1.5">
              <div className="grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1.35fr)_28px] gap-2 px-1">
                <span />
                <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-slate-600">Header</span>
                <span className="font-mono text-[8.5px] uppercase tracking-[0.2em] text-slate-600">Value</span>
                <span />
              </div>
              {headers.map((h) => (
                <div key={h.id} className={`grid grid-cols-[20px_minmax(0,1fr)_minmax(0,1.35fr)_28px] items-center gap-2 rounded-lg border p-1.5 transition-opacity ${h.enabled ? "border-edge/70 bg-panel-2" : "border-transparent opacity-45"}`}>
                  <input
                    type="checkbox"
                    checked={h.enabled}
                    onChange={(e) => setHeader(h.id, { enabled: e.target.checked })}
                    aria-label="Toggle header"
                    className="h-4 w-4 cursor-pointer accent-[#8b5cf6]"
                  />
                  <input
                    value={h.key}
                    onChange={(e) => setHeader(h.id, { key: e.target.value })}
                    placeholder="X-Custom-Header"
                    spellCheck={false}
                    className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 font-mono text-[11px] text-violet-200 placeholder:text-slate-700 focus:border-edge focus:outline-none"
                  />
                  <input
                    value={h.value}
                    onChange={(e) => setHeader(h.id, { value: e.target.value })}
                    placeholder="value"
                    spellCheck={false}
                    className="h-8 w-full rounded-md border border-transparent bg-transparent px-2 font-mono text-[11px] text-emerald-200 placeholder:text-slate-700 focus:border-edge focus:outline-none"
                  />
                  <button onClick={() => removeHeader(h.id)} title="Remove header" aria-label="Remove header"
                    className="flex h-7 w-7 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
              <button onClick={addHeader}
                className="flex h-9 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-edge-2/70 font-mono text-[10.5px] font-medium text-slate-500 transition-all hover:border-violet-500/45 hover:text-violet-300">
                <Plus size={13} /> Add header
              </button>
            </div>
          </div>

          {/* signing secret */}
          <div>
            <label className="mb-1.5 block font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-500">HMAC Signing Secret</label>
            <div className="field flex h-11 items-center rounded-lg">
              <KeyRound size={14} className="pointer-events-none ml-3 shrink-0 text-amber-500/80" />
              <input
                type={secretVisible ? "text" : "password"}
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="h-full w-full bg-transparent px-2.5 font-mono text-[11px] text-amber-100/90 focus:outline-none"
              />
              <div className="mr-1.5 flex shrink-0 items-center gap-1">
                <button onClick={() => setSecretVisible((v) => !v)} title={secretVisible ? "Mask secret" : "Reveal secret"} aria-label="Toggle secret visibility"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-panel-3 hover:text-slate-300">
                  {secretVisible ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
                <button onClick={() => copy(secret, setSecretCopied)} title="Copy secret" aria-label="Copy secret"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-panel-3 hover:text-slate-300">
                  {secretCopied ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}
                </button>
                <button onClick={() => setSecret(`whsec_${crypto.getRandomValues(new Uint8Array(12)).reduce((s, b) => s + b.toString(16).padStart(2, "0"), "")}`)}
                  title="Generate random secret" aria-label="Generate random secret"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-panel-3 hover:text-violet-300">
                  <RefreshCw size={13} />
                </button>
                <button onClick={() => onSaveSecretToVault(secret)} title="Save to secret vault" aria-label="Save to secret vault"
                  className="flex h-8 w-8 items-center justify-center rounded-md text-slate-500 transition-colors hover:bg-panel-3 hover:text-emerald-300">
                  <Save size={13} />
                </button>
              </div>
            </div>
            <p className="mt-1.5 font-mono text-[9px] leading-relaxed text-slate-600">Embedded into <span className="text-slate-500">X-Hub-Signature-256</span> via HMAC-SHA256 over the raw body. Stored locally only.</p>
          </div>

          {/* SEND */}
          <button
            onClick={handleSend}
            disabled={dispatching}
            className="group relative flex h-12 w-full items-center justify-center gap-2.5 overflow-hidden rounded-xl border border-violet-400/40 bg-gradient-to-r from-violet-600 via-purple-600 to-violet-700 text-[13.5px] font-bold tracking-tight text-white shadow-[0_0_28px_rgba(139,92,246,0.4),inset_0_1px_0_rgba(255,255,255,0.3)] transition-all hover:shadow-[0_0_40px_rgba(139,92,246,0.6)] disabled:cursor-wait disabled:opacity-80"
          >
            <span aria-hidden className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.18),transparent_65%)]" />
            {dispatching ? (
              <>
                <Loader2 size={17} className="anim-spin-slow" />
                <span className="font-mono text-[12px] tabular-nums">
                  Attempt {progress?.attempt ?? 1}/{progress?.maxAttempts ?? retryPolicy.maxAttempts}
                  {progress?.phase === "waiting" ? ` — retry in ${(progress.waitMsLeft / 1000).toFixed(1)}s` : " — dispatching…"}
                </span>
              </>
            ) : (
              <>
                <SendHorizontal size={17} strokeWidth={2.3} className="transition-transform duration-300 group-hover:translate-x-1 group-hover:-translate-y-0.5" />
                Dispatch Webhook
                <kbd className="rounded-md border border-white/25 bg-white/10 px-1.5 py-0.5 font-mono text-[9px] font-semibold text-violet-100">⌘↵</kbd>
              </>
            )}
          </button>
        </div>
      </section>

      {/* ============ RIGHT — JSON payload editor ============ */}
      <section className={`${panel} anim-fade-up delay-1 col-span-12 flex flex-col xl:col-span-7`}>
        <div className={panelHeader}>
          <div className="flex items-center gap-3">
            <PanelIcon tone="emerald"><Braces size={15} /></PanelIcon>
            <div>
              <h2 className="text-[13px] font-semibold tracking-tight text-slate-100">JSON Payload</h2>
              <p className="text-[10.5px] text-slate-500">Raw body sent verbatim to the receiver</p>
            </div>
          </div>
          <div className="flex items-center gap-1">
            <button onClick={formatPayload} title="Pretty-print JSON" className="flex h-8 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] font-medium text-slate-500 transition-colors hover:bg-panel-3 hover:text-slate-200"><Wand2 size={12} /> Format</button>
            <button onClick={minifyPayload} title="Minify JSON" className="flex h-8 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] font-medium text-slate-500 transition-colors hover:bg-panel-3 hover:text-slate-200"><Minimize2 size={12} /> Minify</button>
            <button onClick={() => copy(payload, setPayloadCopied)} title="Copy payload" className="flex h-8 items-center gap-1.5 rounded-md px-2 font-mono text-[10px] font-medium text-slate-500 transition-colors hover:bg-panel-3 hover:text-slate-200">
              {payloadCopied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />} Copy
            </button>
          </div>
        </div>

        {/* preset templates */}
        <div className="flex flex-wrap items-center gap-1.5 border-b border-edge/70 px-5 py-2.5">
          <span className="mr-1 font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-600">Event templates</span>
          {EVENT_PRESETS.map((p) => {
            const active = activePreset === p.id;
            return (
              <button
                key={p.id}
                onClick={() => applyPreset(p.id)}
                title={p.description}
                className={`flex items-center gap-1.5 rounded-md border px-2 py-1 font-mono text-[10px] transition-all ${
                  active
                    ? "border-emerald-500/45 bg-emerald-500/10 text-emerald-300 shadow-[0_0_12px_rgba(16,185,129,0.18)]"
                    : "border-edge bg-panel-2 text-slate-500 hover:border-emerald-500/30 hover:text-emerald-300"
                }`}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: p.dot }} />
                {p.label}
              </button>
            );
          })}
        </div>

        {/* editor with gutter */}
        <div className={`relative flex min-h-[380px] flex-1 ${jsonOk ? "" : "ring-1 ring-inset ring-rose-500/35"}`}>
          <div
            ref={gutterRef}
            aria-hidden
            className="w-12 shrink-0 select-none overflow-hidden border-r border-edge/60 py-4 pr-2 text-right font-mono text-[12.5px] leading-6 text-slate-700"
          >
            {Array.from({ length: lineCount }, (_, i) => (
              <div key={i}>{i + 1}</div>
            ))}
          </div>
          <textarea
            ref={taRef}
            value={payload}
            onChange={(e) => { setPayload(e.target.value); setActivePreset(null); }}
            onScroll={(e) => { if (gutterRef.current) gutterRef.current.scrollTop = e.currentTarget.scrollTop; }}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="JSON payload editor"
            className="h-full min-h-[380px] w-full flex-1 resize-none overflow-auto bg-transparent py-4 pl-4 pr-4 font-mono text-[12.5px] leading-6 text-slate-200 caret-[#a78bfa] focus:outline-none"
          />
          {/* validity ribbon */}
          <div className="pointer-events-none absolute bottom-3 right-4 flex items-center gap-2 rounded-md border border-edge/80 bg-abyss/85 px-2 py-1 backdrop-blur">
            {jsonOk ? (
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold text-emerald-400"><BadgeCheck size={11} /> VALID JSON</span>
            ) : (
              <span className="flex items-center gap-1.5 font-mono text-[9.5px] font-semibold text-rose-400">
                <FileWarning size={11} /> {jsonErrorLine ? `LINE ${jsonErrorLine} — ` : ""}{parseResult.error.slice(0, 72)}
              </span>
            )}
          </div>
        </div>

        {/* editor footer stats */}
        <div className="flex items-center justify-between gap-3 border-t border-edge/70 px-5 py-2.5 font-mono text-[9.5px] text-slate-600">
          <div className="flex items-center gap-3">
            <span className="tabular-nums">{formatBytes(bytes)}</span>
            <span className="hidden sm:inline text-edge-2">|</span>
            <span className="hidden sm:inline tabular-nums">{lineCount} lines</span>
            <span className="hidden md:inline text-edge-2">|</span>
            <span className="hidden md:inline">UTF-8 · LF</span>
          </div>
          <div className="flex min-w-0 items-center gap-1.5">
            <Zap size={10} className="shrink-0 text-violet-400" />
            <span className="truncate text-violet-300/90">type: {eventType}</span>
          </div>
        </div>
      </section>

      {/* ============ LEFT — Raw HTTP terminal ============ */}
      <section className={`${panel} anim-fade-up delay-2 col-span-12 overflow-hidden xl:col-span-7`}>
        <div className="terminal-titlebar flex h-11 items-center justify-between border-b border-edge/80 px-4">
          <div className="flex items-center gap-3">
            <div className="flex gap-1.5">
              <span className="h-2.5 w-2.5 rounded-full bg-rose-500/90" />
              <span className="h-2.5 w-2.5 rounded-full bg-amber-400/90" />
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500/90" />
            </div>
            <span className="flex items-center gap-1.5 font-mono text-[10.5px] font-medium text-slate-500"><Terminal size={11} /> raw-request.http — live preview</span>
          </div>
          <button onClick={() => copy(curlPreview, setCurlCopied)} title="Copy as cURL"
            className="flex h-7 items-center gap-1.5 rounded-md border border-edge bg-panel px-2 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-slate-400 transition-all hover:border-violet-500/40 hover:text-violet-300">
            {curlCopied ? <Check size={11} className="text-emerald-400" /> : <Copy size={11} />} cURL
          </button>
        </div>
        <div className="max-h-72 overflow-auto bg-[#0a0f1a] px-4 py-3 font-mono text-[10.5px] leading-[1.9]">
          <div>
            <span className="font-bold text-violet-400">{method}</span>{" "}
            <span className="text-sky-300">{path}</span>{" "}
            <span className="text-slate-600">HTTP/1.1</span>
          </div>
          <div><span className="text-slate-500">Host:</span> <span className="text-slate-200">{host}</span></div>
          {enabledHeaders.map((h, i) => (
            <div key={i}><span className="text-amber-200/80">{h.key}:</span> <span className="text-emerald-200/85">{h.value}</span></div>
          ))}
          <div><span className="text-slate-500">User-Agent:</span> <span className="text-slate-400">WebhookPulse-Dispatcher/2.4.1</span></div>
          <div><span className="text-slate-500">Content-Length:</span> <span className="text-slate-300">{new Blob([payload]).size}</span></div>
          <div className="break-all"><span className="text-fuchsia-300/90">X-Hub-Signature-256:</span> <span className="text-emerald-300">{signature}</span></div>
          <div><span className="text-slate-500">X-Webhook-Id:</span> <span className="text-slate-400">{signaturesForPreview.webhookId}</span></div>
          <div><span className="text-slate-500">X-Webhook-Timestamp:</span> <span className="text-slate-400">{signaturesForPreview.ts}</span></div>
          <div><span className="text-slate-500">X-Webhook-Event:</span> <span className="text-amber-300">{eventType}</span></div>
          <div className="my-1 select-none text-slate-700">──────────────────────────────────────────────</div>
          <JsonBlock code={payload} className="border-0 bg-transparent p-0 text-[10.5px] leading-[1.9]" />
        </div>
      </section>

      {/* ============ RIGHT — Delivery pipeline ============ */}
      <section className={`${panel} anim-fade-up delay-3 col-span-12 flex flex-col xl:col-span-5`}>
        <div className={panelHeader}>
          <div className="flex items-center gap-3">
            <PanelIcon tone="amber"><Zap size={15} /></PanelIcon>
            <div>
              <h2 className="text-[13px] font-semibold tracking-tight text-slate-100">Delivery Pipeline</h2>
              <p className="text-[10.5px] text-slate-500">serialize → sign → transmit → classify</p>
            </div>
          </div>
          {phase === "waiting" && (
            <div className="relative flex h-10 w-10 items-center justify-center">
              <svg viewBox="0 0 36 36" className="absolute inset-0 h-full w-full -rotate-90">
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#1f2a3d" strokeWidth="2.5" />
                <circle cx="18" cy="18" r="15.5" fill="none" stroke="#f59e0b" strokeWidth="2.5" strokeLinecap="round"
                  strokeDasharray={CIRC} strokeDashoffset={CIRC * (1 - waitFrac)} style={{ transition: "stroke-dashoffset 0.1s linear" }} />
              </svg>
              <span className="font-mono text-[10px] font-bold tabular-nums text-amber-400">{Math.ceil((progress?.waitMsLeft ?? 0) / 1000)}</span>
            </div>
          )}
        </div>

        <div className="flex-1 space-y-0 px-5 py-5">
          {steps.map((step, idx) => {
            const s = stepFor(step.n);
            const last = idx === steps.length - 1;
            return (
              <div key={step.n} className="flex gap-3">
                {/* rail */}
                <div className="flex flex-col items-center">
                  <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-all duration-300 ${stepStyles(s)}`}>
                    {s === "active" ? <span className="relative flex h-3 w-3"><span className="anim-ping-slow absolute inline-flex h-full w-full rounded-full bg-violet-400" /><span className="relative inline-flex h-3 w-3 rounded-full bg-violet-400" /></span> : stepIcon(step.n, s)}
                  </div>
                  {!last && <div className={`w-px flex-1 ${s === "done" ? "bg-emerald-500/30" : "bg-edge"}`} style={{ minHeight: 18 }} />}
                </div>
                {/* content */}
                <div className={`pb-4 pt-1.5 ${last ? "pb-0" : ""}`}>
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.22em] text-slate-600">0{step.n}</span>
                    <p className={`text-[12px] font-semibold tracking-tight transition-colors ${s === "pending" ? "text-slate-600" : s === "failed" ? "text-rose-300" : "text-slate-200"}`}>{step.title}</p>
                    {s === "done" && <CheckCircle2 size={12} className="text-emerald-500" />}
                    {s === "failed" && <XCircle size={12} className="text-rose-500" />}
                  </div>
                  <p className={`mt-0.5 font-mono text-[9.5px] leading-relaxed transition-colors ${s === "pending" ? "text-slate-700" : s === "warn" ? "text-amber-500/90" : "text-slate-500"}`}>{step.sub}</p>
                </div>
              </div>
            );
          })}
        </div>

        {/* outcome banner */}
        {done && (
          <div className={`mx-5 mb-4 flex items-start gap-2.5 rounded-xl border px-3.5 py-3 anim-fade-in ${success ? "border-emerald-500/35 bg-emerald-500/8" : "border-rose-500/35 bg-rose-500/8"}`}>
            {success
              ? <CheckCircle2 size={16} className="mt-0.5 shrink-0 text-emerald-400" />
              : <XCircle size={16} className="mt-0.5 shrink-0 text-rose-400" />}
            <div>
              <p className={`text-[12px] font-bold ${success ? "text-emerald-300" : "text-rose-300"}`}>
                {success ? `Delivered — HTTP ${progress?.finalStatus}` : `Delivery exhausted — HTTP ${progress?.finalStatus || "network error"}`}
              </p>
              <p className="mt-0.5 font-mono text-[9px] leading-relaxed text-slate-500">
                {success
                  ? "Receiver acknowledged the event. Signature verified upstream. Receipt stored in Delivery Logs."
                  : `All ${progress?.maxAttempts} attempts rejected. Payload signature remained valid — failure is downstream of your receiver.`}
              </p>
            </div>
          </div>
        )}

        {/* auto-retry footer */}
        <div className="border-t border-edge/70 px-5 py-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="flex items-center gap-1.5 text-[12px] font-semibold text-slate-200"><Repeat2 size={12} className="text-amber-400" /> Auto-retry with backoff</p>
              <p className="mt-0.5 font-mono text-[9px] text-slate-600">replays failed attempts exponentially until budget is spent</p>
            </div>
            <button
              role="switch"
              aria-checked={autoRetry}
              aria-label="Toggle auto-retry"
              onClick={() => onAutoRetryChange(!autoRetry)}
              className={`wp-switch relative h-6 w-11 shrink-0 rounded-full ${autoRetry ? "bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.45)]" : "bg-panel-3"}`}
            >
              <span className={`wp-switch-knob absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md ${autoRetry ? "translate-x-5" : "translate-x-0"}`} />
            </button>
          </div>
          <div className="mt-3 flex flex-wrap gap-1.5">
            {[
              { icon: Repeat2, text: `${retryPolicy.maxAttempts} attempts max` },
              { icon: Timer, text: `base ${retryPolicy.baseDelayMs}ms` },
              { icon: TrendingUp, text: `×${retryPolicy.multiplier} backoff` },
              { icon: Shuffle, text: retryPolicy.jitter ? "jitter on" : "jitter off" },
            ].map(({ icon: Icon, text }) => (
              <span key={text} className="flex items-center gap-1.5 rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[9px] font-medium text-slate-500">
                <Icon size={10} className="text-violet-400" /> {text}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* empty helper when nothing dispatched yet (keeps grid honest) */}
      {!progress && (
        <div className="anim-fade-up delay-4 col-span-12 -mt-1 hidden items-center justify-center gap-2 font-mono text-[10px] text-slate-700 xl:flex">
          <CircleDashed size={11} /> Pipeline idle — configure the target above and press <kbd className="rounded border border-edge bg-panel px-1 py-0.5 text-[8.5px]">⌘↵</kbd> to dispatch
        </div>
      )}
    </div>
  );
}
