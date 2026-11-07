import { useEffect, useMemo, useRef, useState } from "react";
import {
  Play, RotateCcw, Copy, Check, Terminal, TrendingUp, Shuffle, Repeat2, Timer,
  ShieldAlert, GitBranch, ChevronRight, Layers, Zap,
} from "lucide-react";
import type { RetryPolicy, ToastKind } from "../types";
import { plannedBackoff, sleep, formatMs } from "../lib/engine";

type Pattern = "fail-then-succeed" | "always-fail" | "flaky";
type SimNodeState = "idle" | "current" | "success" | "failed";

interface SimResult {
  attempt: number;
  ok: boolean;
  status: number;
  statusText: string;
  latencyMs: number;
  delayBeforeMs: number;
  at: number;
}

interface RetrySimulatorProps {
  policy: RetryPolicy;
  onPolicyChange: (p: RetryPolicy) => void;
  autoRetry: boolean;
  onAutoRetryChange: (v: boolean) => void;
  pushToast: (kind: ToastKind, title: string, message?: string) => void;
}

const panel = "rounded-2xl border border-edge bg-panel shadow-[0_18px_44px_rgba(2,6,18,0.45)]";
const panelHeader = "flex items-center justify-between gap-3 border-b border-edge/70 px-5 py-3.5";

const STATUS_POOL = [
  { status: 503, statusText: "Service Unavailable" },
  { status: 500, statusText: "Internal Server Error" },
  { status: 429, statusText: "Too Many Requests" },
  { status: 504, statusText: "Gateway Timeout" },
  { status: 502, statusText: "Bad Gateway" },
];

export default function RetrySimulator({ policy, onPolicyChange, autoRetry, onAutoRetryChange, pushToast }: RetrySimulatorProps) {
  const [pattern, setPattern] = useState<Pattern>("fail-then-succeed");
  const [succeedAfter, setSucceedAfter] = useState(2);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<SimResult[]>([]);
  const [nodeStates, setNodeStates] = useState<SimNodeState[]>([]);
  const [countdown, setCountdown] = useState<number | null>(null);
  const [consoleLines, setConsoleLines] = useState<string[]>(["retry-engine ready — configure the policy and press Run simulation"]);
  const [verdict, setVerdict] = useState<"success" | "failure" | null>(null);
  const [policyCopied, setPolicyCopied] = useState(false);

  const consoleRef = useRef<HTMLDivElement>(null);
  const cancelRef = useRef(false);

  const plan = useMemo(() => plannedBackoff(policy), [policy]);
  const worstCaseMs = useMemo(() => plan.reduce((a, p) => a + p.delayBefore, 0), [plan]);
  const maxPlannedDelay = useMemo(() => Math.max(...plan.map((p) => p.delayBefore), 1), [plan]);

  useEffect(() => {
    if (consoleRef.current) consoleRef.current.scrollTop = consoleRef.current.scrollHeight;
  }, [consoleLines]);

  const setPolicy = (patch: Partial<RetryPolicy>) => onPolicyChange({ ...policy, ...patch });

  const reset = () => {
    cancelRef.current = true;
    setRunning(false);
    setResults([]);
    setNodeStates([]);
    setCountdown(null);
    setVerdict(null);
    setConsoleLines(["retry-engine reset — waiting for a run"]);
  };

  const stamp = () => new Date().toISOString().slice(11, 23);
  const pushLine = (line: string) => setConsoleLines((l) => [...l.slice(-60), `[${stamp()}] ${line}`]);

  const decideOutcome = (attempt: number): { ok: boolean } => {
    if (pattern === "always-fail") return { ok: false };
    if (pattern === "fail-then-succeed") return { ok: attempt > succeedAfter };
    return { ok: Math.random() < 0.45 };
  };

  const run = async () => {
    if (running) return;
    cancelRef.current = false;
    setRunning(true);
    setResults([]);
    setVerdict(null);
    setConsoleLines([]);
    setNodeStates(Array.from({ length: policy.maxAttempts }, () => "idle" as SimNodeState));
    pushLine(`dispatch → receiver (pattern=${pattern}, maxAttempts=${policy.maxAttempts})`);

    const started = Date.now();
    for (let attempt = 1; attempt <= policy.maxAttempts; attempt++) {
      if (cancelRef.current) return;
      let delayBefore = 0;
      if (attempt > 1) {
        delayBefore = policy.baseDelayMs * Math.pow(policy.multiplier, attempt - 2);
        delayBefore = policy.jitter ? Math.round(delayBefore * (0.5 + Math.random() * 0.5)) : Math.round(delayBefore);
        pushLine(`sleep ${formatMs(delayBefore)} before attempt ${attempt} (base × ${policy.multiplier}^${attempt - 2}${policy.jitter ? ", jittered" : ""})`);
        setNodeStates((s) => s.map((n, i) => (i === attempt - 1 ? "current" : n)));
        const step = 100;
        for (let left = delayBefore; left > 0; left -= step) {
          if (cancelRef.current) return;
          setCountdown(left);
          await sleep(Math.min(step, left));
        }
        setCountdown(null);
      } else {
        setNodeStates((s) => s.map((n, i) => (i === 0 ? "current" : n)));
      }

      const { ok } = decideOutcome(attempt);
      const p = STATUS_POOL[Math.floor(Math.random() * STATUS_POOL.length)];
      const latencyMs = Math.round(ok ? 60 + Math.random() * 260 : 180 + Math.random() * 850);
      await sleep(latencyMs); // simulate the wire
      if (cancelRef.current) return;

      const rec: SimResult = {
        attempt,
        ok,
        status: ok ? 200 : p.status,
        statusText: ok ? "OK" : p.statusText,
        latencyMs,
        delayBeforeMs: delayBefore,
        at: Date.now(),
      };
      setResults((r) => [...r, rec]);
      setNodeStates((s) => s.map((n, i) => (i === attempt - 1 ? (ok ? "success" : "failed") : n)));
      pushLine(ok ? `ACK  200 OK in ${formatMs(latencyMs)} — retry loop halted after ${attempt} attempt(s)` : `FAIL ${rec.status} ${rec.statusText} in ${formatMs(latencyMs)}${attempt < policy.maxAttempts ? " — scheduling retry" : " — budget exhausted, opening circuit"}`);

      if (ok) {
        setVerdict("success");
        pushLine(`done — wall clock ${formatMs(Date.now() - started)} · signature intact · idempotency key preserved`);
        setRunning(false);
        return;
      }
    }
    setVerdict("failure");
    pushLine(`circuit OPEN after ${policy.maxAttempts} attempts — quarantining receiver; alerting on-call`);
    setRunning(false);
    pushToast("warning", "Retry budget exhausted", "The receiver rejected every attempt — circuit breaker opened.");
  };

  const sliderFill = (value: number, min: number, max: number) => ({ ["--fill" as string]: `${((value - min) / (max - min)) * 100}%` });

  const policyJson = useMemo(
    () =>
      JSON.stringify(
        { strategy: "exponential", maxAttempts: policy.maxAttempts, baseDelayMs: policy.baseDelayMs, multiplier: policy.multiplier, jitter: policy.jitter, maxDelayMs: 20000, deadLetterQueue: "webhook-pulse-dlq" },
        null,
        2
      ),
    [policy]
  );

  const nodeStateFor = (i: number): SimNodeState => {
    if (nodeStates[i]) return nodeStates[i];
    if (results[i]) return results[i].ok ? "success" : "failed";
    return "idle";
  };

  return (
    <div className="space-y-5">
      {/* ============ Intro strip ============ */}
      <div className="anim-fade-up flex flex-col gap-3 rounded-2xl border border-amber-500/25 bg-gradient-to-r from-amber-500/10 via-orange-500/6 to-transparent px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-amber-500/35 bg-amber-500/12 text-amber-300 shadow-[0_0_18px_rgba(245,158,11,0.28)]">
            <Repeat2 size={19} />
          </div>
          <div>
            <h2 className="text-[14px] font-bold tracking-tight text-slate-100">Retry Simulator &amp; Backoff Trainer</h2>
            <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-slate-500">Watch exponential backoff happen in real time — then bind the exact policy to the live dispatcher.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {["exponential", policy.jitter ? "jitter on" : "no jitter", "budget-aware", "DLQ on exhaustion"].map((t) => (
            <span key={t} className="rounded-md border border-edge bg-abyss/60 px-2 py-1">{t}</span>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-12">
        {/* ============ LEFT — Policy controls ============ */}
        <section className={`${panel} anim-fade-up delay-1 xl:col-span-5`}>
          <div className={panelHeader}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-400"><Layers size={15} /></div>
              <div>
                <h3 className="text-[13px] font-semibold tracking-tight text-slate-100">Backoff Policy</h3>
                <p className="text-[10.5px] text-slate-500">Shared with the live dispatcher engine</p>
              </div>
            </div>
            <button
              role="switch"
              aria-checked={autoRetry}
              aria-label="Bind policy to dispatcher"
              onClick={() => onAutoRetryChange(!autoRetry)}
              title="Bind this policy to the live Payload Dispatcher"
              className={`wp-switch relative h-6 w-11 shrink-0 rounded-full ${autoRetry ? "bg-emerald-500 shadow-[0_0_14px_rgba(16,185,129,0.4)]" : "bg-panel-3"}`}
            >
              <span className={`wp-switch-knob absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md ${autoRetry ? "translate-x-5" : ""}`} />
            </button>
          </div>

          <div className="space-y-5 px-5 py-5">
            {/* max attempts */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="maxAttempts" className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Max attempts</label>
                <span className="font-mono text-[13px] font-bold tabular-nums text-violet-300">{policy.maxAttempts}</span>
              </div>
              <input id="maxAttempts" type="range" min={2} max={8} step={1} value={policy.maxAttempts}
                onChange={(e) => setPolicy({ maxAttempts: Number(e.target.value) })}
                className="wp-range w-full" style={sliderFill(policy.maxAttempts, 2, 8)} />
              <div className="mt-1 flex justify-between font-mono text-[8px] text-slate-700"><span>2</span><span>4</span><span>6</span><span>8</span></div>
            </div>

            {/* base delay */}
            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label htmlFor="baseDelay" className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Base delay</label>
                <span className="font-mono text-[13px] font-bold tabular-nums text-violet-300">{policy.baseDelayMs}<span className="text-[9px] text-slate-600">ms</span></span>
              </div>
              <input id="baseDelay" type="range" min={100} max={2000} step={50} value={policy.baseDelayMs}
                onChange={(e) => setPolicy({ baseDelayMs: Number(e.target.value) })}
                className="wp-range w-full" style={sliderFill(policy.baseDelayMs, 100, 2000)} />
              <div className="mt-1 flex justify-between font-mono text-[8px] text-slate-700"><span>100ms</span><span>1s</span><span>2s</span></div>
            </div>

            {/* multiplier */}
            <div>
              <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Backoff multiplier</label>
              <div className="grid grid-cols-4 overflow-hidden rounded-lg border border-edge">
                {[1.5, 2, 2.5, 3].map((m) => (
                  <button key={m} onClick={() => setPolicy({ multiplier: m })}
                    className={`py-2 font-mono text-[11px] font-bold transition-all ${policy.multiplier === m ? "bg-violet-500/25 text-violet-300 shadow-[inset_0_0_0_1px_rgba(139,92,246,0.45)]" : "bg-panel-2 text-slate-500 hover:text-slate-300"}`}>
                    ×{m}
                  </button>
                ))}
              </div>
            </div>

            {/* jitter */}
            <div className="flex items-center justify-between gap-3 rounded-xl border border-edge/70 bg-panel-2 px-4 py-3">
              <div>
                <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-slate-200"><Shuffle size={12} className="text-amber-400" /> Full jitter</p>
                <p className="mt-0.5 font-mono text-[8.5px] leading-snug text-slate-600">delay × random(0.5–1.0) — prevents thundering-herd retries</p>
              </div>
              <button role="switch" aria-checked={policy.jitter} aria-label="Toggle jitter" onClick={() => setPolicy({ jitter: !policy.jitter })}
                className={`wp-switch relative h-6 w-11 shrink-0 rounded-full ${policy.jitter ? "bg-amber-500 shadow-[0_0_14px_rgba(245,158,11,0.4)]" : "bg-panel-3"}`}>
                <span className={`wp-switch-knob absolute left-0.5 top-0.5 h-5 w-5 rounded-full bg-white shadow-md ${policy.jitter ? "translate-x-5" : ""}`} />
              </button>
            </div>

            {/* failure pattern */}
            <div>
              <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Failure pattern</label>
              <div className="grid grid-cols-3 gap-1.5">
                {([
                  ["fail-then-succeed", "Heals later"],
                  ["always-fail", "Always down"],
                  ["flaky", "Coin-flip 45%"],
                ] as [Pattern, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => setPattern(key)}
                    className={`rounded-lg border px-2 py-2 font-mono text-[9px] font-semibold leading-tight transition-all ${pattern === key ? "border-amber-500/50 bg-amber-500/12 text-amber-300 shadow-[0_0_14px_rgba(245,158,11,0.18)]" : "border-edge bg-panel-2 text-slate-500 hover:text-slate-300"}`}>
                    {label}
                  </button>
                ))}
              </div>
              {pattern === "fail-then-succeed" && (
                <div className="mt-2 flex items-center gap-2 rounded-lg border border-edge/70 bg-panel-2 px-3 py-2 anim-fade-in">
                  <span className="font-mono text-[9px] text-slate-500">receiver healthy after</span>
                  <div className="flex overflow-hidden rounded border border-edge">
                    {Array.from({ length: Math.max(1, policy.maxAttempts - 1) }, (_, i) => i + 1).map((n) => (
                      <button key={n} onClick={() => setSucceedAfter(n)}
                        className={`h-6 w-6 font-mono text-[9px] font-bold transition-all ${succeedAfter === n ? "bg-amber-500/30 text-amber-300" : "bg-panel-3 text-slate-600 hover:text-slate-300"}`}>
                        {n}
                      </button>
                    ))}
                  </div>
                  <span className="font-mono text-[9px] text-slate-500">failure{succeedAfter === 1 ? "" : "s"}</span>
                </div>
              )}
            </div>

            {/* run controls */}
            <div className="flex gap-2">
              <button onClick={run} disabled={running}
                className="flex h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-amber-500/45 bg-gradient-to-r from-amber-500 to-orange-600 text-[12.5px] font-extrabold tracking-tight text-black shadow-[0_0_26px_rgba(245,158,11,0.35)] transition-all hover:from-amber-400 hover:to-orange-500 disabled:cursor-wait disabled:opacity-70">
                <Play size={15} strokeWidth={2.6} className={running ? "animate-pulse" : ""} />
                {running ? "Simulating…" : "Run Simulation"}
              </button>
              <button onClick={reset} title="Reset simulator" aria-label="Reset simulator"
                className="flex h-11 w-11 items-center justify-center rounded-xl border border-edge text-slate-500 transition-all hover:border-edge-2 hover:text-slate-200">
                <RotateCcw size={16} />
              </button>
            </div>

            {/* policy output */}
            <div className="overflow-hidden rounded-xl border border-edge/80">
              <div className="flex items-center justify-between border-b border-edge/70 bg-panel-2 px-3 py-2">
                <span className="flex items-center gap-1.5 font-mono text-[8.5px] font-bold uppercase tracking-[0.2em] text-slate-500"><GitBranch size={10} /> policy.json</span>
                <div className="flex items-center gap-2">
                  <span className="hidden items-center gap-1 rounded border border-emerald-500/30 bg-emerald-500/8 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-emerald-400 sm:flex"><Zap size={8} /> bound to dispatcher</span>
                  <button onClick={() => { navigator.clipboard?.writeText(policyJson).catch(() => {}); setPolicyCopied(true); window.setTimeout(() => setPolicyCopied(false), 1600); }}
                    className="flex items-center gap-1 font-mono text-[9px] text-slate-500 hover:text-slate-200" aria-label="Copy policy JSON">
                    {policyCopied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />} copy
                  </button>
                </div>
              </div>
              <pre className="max-h-40 overflow-auto bg-[#0a0f1a] px-3 py-2.5 font-mono text-[9.5px] leading-[1.8] text-slate-400">{policyJson}</pre>
            </div>
          </div>
        </section>

        {/* ============ RIGHT — Timeline, chart, console ============ */}
        <div className="flex flex-col gap-4 sm:gap-5 xl:col-span-7">
          {/* attempt timeline */}
          <section className={`${panel} anim-fade-up delay-2`}>
            <div className={panelHeader}>
              <div className="flex items-center gap-3">
                <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><Timer size={15} /></div>
                <div>
                  <h3 className="text-[13px] font-semibold tracking-tight text-slate-100">Backoff Timeline</h3>
                  <p className="text-[10.5px] text-slate-500">planned sleeps between attempts — updates live</p>
                </div>
              </div>
              <div className="flex items-center gap-3 font-mono text-[9px] tabular-nums text-slate-500">
                <span title="Sum of planned sleeps (no jitter)">worst-case <span className="text-amber-400">{formatMs(worstCaseMs)}</span></span>
                <span className="hidden sm:inline text-edge-2">|</span>
                <span className="hidden sm:inline">budget <span className="text-violet-300">{policy.maxAttempts}×</span></span>
              </div>
            </div>

            <div className="mask-x flex items-stretch gap-0 overflow-x-auto px-6 py-5">
              {plan.map((p, i) => {
                const state = nodeStateFor(i);
                const isWaiting = running && state === "current" && countdown !== null;
                return (
                  <div key={p.attempt} className="flex shrink-0 items-center">
                    {i > 0 && (
                      <div className="flex w-14 flex-col items-center sm:w-16">
                        <span className="font-mono text-[9px] font-semibold tabular-nums text-amber-500/90">+{formatMs(plan[i].delayBefore)}</span>
                        <div className={`mt-0.5 h-px w-full ${state === "idle" ? "bg-edge" : "bg-amber-500/40"}`} />
                        <span className="mt-0.5 font-mono text-[7.5px] uppercase tracking-widest text-slate-700">sleep</span>
                      </div>
                    )}
                    <div className="flex flex-col items-center">
                      <div
                        className={`flex h-12 w-12 items-center justify-center rounded-full border font-mono text-[13px] font-extrabold transition-all duration-300 ${
                          state === "success"
                            ? "border-emerald-500/60 bg-emerald-500/15 text-emerald-400 shadow-[0_0_18px_rgba(16,185,129,0.4)]"
                            : state === "failed"
                              ? "border-rose-500/60 bg-rose-500/12 text-rose-400 shadow-[0_0_14px_rgba(244,63,94,0.3)]"
                              : state === "current"
                                ? "border-violet-500/70 bg-violet-500/15 text-violet-300 shadow-[0_0_20px_rgba(139,92,246,0.45)]"
                                : "border-edge bg-panel-2 text-slate-600"
                        }`}
                      >
                        {state === "success" ? "✓" : state === "failed" ? "✕" : p.attempt}
                      </div>
                      <p className="mt-1.5 font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-slate-600">Try {p.attempt}</p>
                      <p className="font-mono text-[8.5px] tabular-nums text-slate-700">
                        {results[i] ? `${results[i].status} · ${formatMs(results[i].latencyMs)}` : p.delayBefore === 0 ? "immediate" : `+${formatMs(p.delayBefore)}`}
                      </p>
                      {isWaiting && countdown !== null && (
                        <p className="mt-0.5 font-mono text-[9px] font-bold tabular-nums text-amber-400 anim-fade-in">in {(countdown / 1000).toFixed(1)}s</p>
                      )}
                    </div>
                  </div>
                );
              })}
              {/* DLQ terminus */}
              <div className="flex shrink-0 items-center">
                <div className="flex w-14 flex-col items-center sm:w-16">
                  <span className="font-mono text-[9px] tabular-nums text-slate-700">∞</span>
                  <div className="mt-0.5 h-px w-full bg-edge" />
                  <span className="mt-0.5 font-mono text-[7.5px] uppercase tracking-widest text-slate-800">dlq</span>
                </div>
                <div className="flex flex-col items-center">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-dashed border-edge-2 text-slate-700"><ShieldAlert size={18} /></div>
                  <p className="mt-1.5 font-mono text-[8px] font-bold uppercase tracking-[0.18em] text-slate-700">DLQ</p>
                  <p className="font-mono text-[8.5px] text-slate-800">park &amp; alert</p>
                </div>
              </div>
            </div>
          </section>

          {/* delay growth chart */}
          <section className={`${panel} anim-fade-up delay-3`}>
            <div className="border-b border-edge/70 px-5 py-3">
              <p className="font-mono text-[9px] font-bold uppercase tracking-[0.22em] text-slate-600">Delay growth curve — ms before attempt n</p>
            </div>
            <div className="flex h-28 items-end gap-2 px-5 pb-3 pt-4">
              {plan.filter((p) => p.delayBefore >= 0).map((p) => {
                const h = p.attempt === 1 ? 4 : Math.max(10, (p.delayBefore / maxPlannedDelay) * 72);
                const hue = p.attempt >= policy.maxAttempts ? "from-rose-500/80 to-rose-600/50" : p.attempt >= 3 ? "from-amber-400/80 to-amber-600/45" : "from-violet-500/85 to-violet-700/50";
                return (
                  <div key={p.attempt} className="flex flex-1 flex-col items-center gap-1">
                    <span className="font-mono text-[8px] tabular-nums text-slate-600">{p.attempt === 1 ? "0" : p.delayBefore >= 1000 ? `${(p.delayBefore / 1000).toFixed(1)}s` : p.delayBefore}</span>
                    <div className={`w-full rounded-t-md bg-gradient-to-t ${hue} transition-all duration-500`} style={{ height: h }} />
                    <span className="font-mono text-[8px] text-slate-600">#{p.attempt}</span>
                  </div>
                );
              })}
            </div>
          </section>

          {/* console + verdict */}
          <section className={`${panel} anim-fade-up delay-4 flex min-h-0 flex-1 flex-col overflow-hidden`}>
            <div className="terminal-titlebar flex h-9 items-center justify-between border-b border-edge/80 px-4">
              <div className="flex items-center gap-2">
                <Terminal size={11} className="text-slate-500" />
                <span className="font-mono text-[9.5px] text-slate-500">retry-engine — stdout</span>
              </div>
              <div className="flex items-center gap-2">
                {verdict === "success" && <span className="rounded border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-emerald-400">recovered</span>}
                {verdict === "failure" && <span className="rounded border border-rose-500/40 bg-rose-500/10 px-2 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[0.2em] text-rose-400">circuit open</span>}
                <span className={`h-2 w-2 rounded-full ${running ? "animate-pulse bg-amber-400" : "bg-slate-700"}`} />
              </div>
            </div>
            <div ref={consoleRef} className="max-h-56 min-h-[132px] flex-1 overflow-y-auto bg-[#0a0f1a] px-4 py-3 font-mono text-[10px] leading-[1.9]">
              {consoleLines.map((line, i) => {
                const color = line.includes("ACK")
                  ? "text-emerald-400"
                  : line.includes("FAIL")
                    ? "text-rose-400"
                    : line.includes("sleep")
                      ? "text-amber-400/90"
                      : line.includes("circuit")
                        ? "text-rose-300"
                        : "text-slate-500";
                return <div key={i} className={color}>{line}</div>;
              })}
              {running && <div className="text-slate-600">▌</div>}
            </div>
          </section>
        </div>
      </div>

      {/* ============ Why it matters — 3 tips ============ */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { icon: TrendingUp, tone: "text-violet-400 border-violet-500/30 bg-violet-500/10", title: "Why exponential?", body: "Fixed-interval retries hammer a struggling receiver. Doubling the delay each attempt gives it room to recover while still bounding total wall-clock time." },
          { icon: Shuffle, tone: "text-amber-400 border-amber-500/30 bg-amber-500/10", title: "Why jitter?", body: "Thousands of synchronized senders retrying in lockstep form a thundering herd. Randomizing each sleep de-synchronizes them and protects the receiver’s recovery window." },
          { icon: ShieldAlert, tone: "text-rose-400 border-rose-500/30 bg-rose-500/10", title: "Why a circuit breaker?", body: "After the budget is spent, stop queuing more failures. Park the event in a DLQ, alert, and let a human decide — retrying forever just hides an outage." },
        ].map(({ icon: Icon, tone, title, body }) => (
          <div key={title} className="card-lift rounded-2xl border border-edge bg-panel p-5">
            <span className={`flex h-9 w-9 items-center justify-center rounded-lg border ${tone}`}><Icon size={16} /></span>
            <h4 className="mt-3 flex items-center gap-1 text-[12px] font-bold tracking-tight text-slate-100">{title}<ChevronRight size={12} className="text-slate-600" /></h4>
            <p className="mt-1.5 text-[10.5px] leading-relaxed text-slate-500">{body}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
