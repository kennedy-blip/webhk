import { useCallback, useEffect, useRef, useState } from "react";
import {
  CheckCircle2, XCircle, Info, AlertTriangle, Webhook, ShieldCheck, TerminalSquare,
} from "lucide-react";
import Header from "./components/Header";
import WebhookDispatcher from "./components/WebhookDispatcher";
import DeliveryLogs from "./components/DeliveryLogs";
import SignatureVerifier from "./components/SignatureVerifier";
import RetrySimulator from "./components/RetrySimulator";
import type {
  AttemptRecord, ChaosMode, DeliveryLog, DispatchInput, DispatchProgress, HttpMethod,
  RetryPolicy, SecretEntry, TabKey, Toast, ToastKind, VerifierDraft,
} from "./types";
import {
  backoffDelay, buildOutboundHeaders, detectChaos, formatMs, generateSeedLogs, getPreset,
  responseBodyFor, safeEventType, sampleOutcome, seedVault, signPayload, sleep, uid,
} from "./lib/engine";

const LOGS_KEY = "webhookpulse.logs.v1";
const VAULT_KEY = "webhookpulse.vault.v1";

function loadInitialLogs(): DeliveryLog[] {
  try {
    const raw = localStorage.getItem(LOGS_KEY);
    if (raw) return JSON.parse(raw) as DeliveryLog[];
  } catch {
    /* fall through to seeds */
  }
  return generateSeedLogs();
}

function loadInitialVault(): SecretEntry[] {
  try {
    const raw = localStorage.getItem(VAULT_KEY);
    if (raw) return JSON.parse(raw) as SecretEntry[];
  } catch {
    /* ignore */
  }
  return seedVault();
}

const TOAST_STYLE: Record<ToastKind, { icon: typeof Info; ring: string; iconColor: string }> = {
  success: { icon: CheckCircle2, ring: "border-emerald-500/40", iconColor: "text-emerald-400" },
  error: { icon: XCircle, ring: "border-rose-500/40", iconColor: "text-rose-400" },
  info: { icon: Info, ring: "border-sky-500/40", iconColor: "text-sky-400" },
  warning: { icon: AlertTriangle, ring: "border-amber-500/40", iconColor: "text-amber-400" },
};

export default function App() {
  const [activeTab, setActiveTab] = useState<TabKey>("dispatcher");
  const [logs, setLogs] = useState<DeliveryLog[]>(loadInitialLogs);
  const [vault, setVault] = useState<SecretEntry[]>(loadInitialVault);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [policy, setPolicy] = useState<RetryPolicy>({ maxAttempts: 4, baseDelayMs: 600, multiplier: 2, jitter: true });
  const [autoRetry, setAutoRetry] = useState(true);
  const [dispatching, setDispatching] = useState(false);
  const [progress, setProgress] = useState<DispatchProgress | null>(null);
  const [verifierDraft, setVerifierDraft] = useState<VerifierDraft | null>(null);

  const dispatchLock = useRef(false);
  const policyRef = useRef(policy);
  const autoRetryRef = useRef(autoRetry);
  policyRef.current = policy;
  autoRetryRef.current = autoRetry;

  /* ---------- persistence ---------- */
  useEffect(() => {
    try {
      localStorage.setItem(LOGS_KEY, JSON.stringify(logs.filter((l) => !l.pending).slice(0, 60)));
    } catch {
      /* storage full — non-fatal */
    }
  }, [logs]);
  useEffect(() => {
    try {
      localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
    } catch {
      /* ignore */
    }
  }, [vault]);

  /* ---------- toasts ---------- */
  const pushToast = useCallback((kind: ToastKind, title: string, message?: string) => {
    const id = uid("toast");
    setToasts((t) => [...t.slice(-3), { id, kind, title, message }]);
    window.setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200);
  }, []);
  const dismissToast = useCallback((id: string) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  /* ================= DISPATCH ENGINE ================= */
  const runDispatch = useCallback(
    async (input: DispatchInput) => {
      if (dispatchLock.current) {
        pushToast("info", "Dispatcher busy", "A dispatch is already in flight — wait for it to settle.");
        return;
      }
      dispatchLock.current = true;
      setDispatching(true);

      const maxAttempts = autoRetryRef.current ? policyRef.current.maxAttempts : 1;
      const policyNow = policyRef.current;
      const id = uid("log");
      const event = safeEventType(input.payload);
      const signature = signPayload(input.secret, input.payload, "prefixed");
      const effectiveChaos: Exclude<ChaosMode, "auto"> = input.chaosOverride === "auto" ? detectChaos(input.url) : input.chaosOverride;
      const enabled = input.headers.filter((h) => h.enabled && h.key.trim()).map(({ key, value }) => ({ key, value }));
      const outHeaders = buildOutboundHeaders(enabled, input.url, input.payload, signature);
      let host = "receiver.internal";
      try {
        host = new URL(input.url).host;
      } catch {
        /* unreachable — caller validated */
      }

      const baseLog: DeliveryLog = {
        id,
        timestamp: Date.now(),
        event,
        method: input.method,
        url: input.url,
        host,
        ok: false,
        pending: true,
        status: 0,
        statusText: "Dispatching…",
        latencyMs: 0,
        totalDurationMs: 0,
        retries: 0,
        headers: outHeaders,
        payload: input.payload,
        responseBody: "",
        signature,
        secret: input.secret,
        chaos: effectiveChaos,
        attempts: [],
      };
      setLogs((prev) => [baseLog, ...prev]);

      const started = Date.now();
      let attempt = 0;
      let delayBefore = 0;
      let finalOutcome: { status: number; statusText: string; ok: boolean; latencyMs: number } | null = null;

      for (;;) {
        attempt += 1;
        if (attempt > 1) {
          // ---- exponential backoff with live countdown ----
          delayBefore = backoffDelay(policyNow, attempt - 1);
          const waitStart = Date.now();
          for (;;) {
            const elapsed = Date.now() - waitStart;
            const left = delayBefore - elapsed;
            if (left <= 0) break;
            setProgress({
              attempt,
              maxAttempts,
              phase: "waiting",
              waitTotalMs: delayBefore,
              waitMsLeft: left,
              outcome: null,
              finalStatus: finalOutcome?.status ?? 0,
              event,
            });
            await sleep(90);
          }
        }

        setProgress({
          attempt,
          maxAttempts,
          phase: "sending",
          waitTotalMs: 0,
          waitMsLeft: 0,
          outcome: null,
          finalStatus: 0,
          event,
        });

        const result = sampleOutcome(effectiveChaos);
        await sleep(result.latencyMs);
        finalOutcome = result;

        const startedAt = Date.now() - result.latencyMs;
        const rec: AttemptRecord = {
          attempt,
          startedAt,
          delayBeforeMs: delayBefore,
          latencyMs: result.latencyMs,
          status: result.status,
          statusText: result.statusText,
          ok: result.ok,
        };
        delayBefore = 0;

        setLogs((prev) =>
          prev.map((l) =>
            l.id === id
              ? {
                  ...l,
                  attempts: [...l.attempts, rec],
                  retries: attempt - 1,
                  status: result.status,
                  statusText: result.statusText,
                  ok: result.ok,
                  latencyMs: result.latencyMs,
                  responseBody: responseBodyFor(result.status, event, attempt),
                  totalDurationMs: Date.now() - started,
                }
              : l
          )
        );

        const doneAttempt = result.ok || attempt >= maxAttempts;
        if (doneAttempt) break;
      }

      const finalOk = finalOutcome?.ok ?? false;
      setLogs((prev) =>
        prev.map((l) =>
          l.id === id ? { ...l, pending: false, totalDurationMs: Date.now() - started, ok: finalOk } : l
        )
      );
      setProgress({
        attempt,
        maxAttempts,
        phase: "done",
        waitTotalMs: 0,
        waitMsLeft: 0,
        outcome: finalOk ? "success" : "failure",
        finalStatus: finalOutcome?.status ?? 0,
        event,
      });

      if (finalOk) {
        pushToast("success", `Delivered — HTTP ${finalOutcome?.status} ${finalOutcome?.statusText}`, `${event} → ${host} in ${formatMs(finalOutcome?.latencyMs ?? 0)} · signed HMAC-SHA256`);
      } else {
        pushToast(
          "error",
          `Delivery failed after ${attempt} attempt${attempt > 1 ? "s" : ""}`,
          `HTTP ${finalOutcome?.status ?? 0} ${finalOutcome?.statusText ?? ""} — open Delivery Logs to inspect the attempt timeline.`
        );
      }
      setDispatching(false);
      dispatchLock.current = false;
    },
    [pushToast]
  );

  /* ---------- quick actions ---------- */
  const handleSendTest = useCallback(() => {
    const payload = getPreset("customer.created").build();
    runDispatch({
      url: "https://api.acmecorp.io/v1/webhooks/stripe",
      method: "POST",
      headers: [
        { id: uid("hdr"), key: "Content-Type", value: "application/json", enabled: true },
        { id: uid("hdr"), key: "X-Custom-Source", value: "WebhookPulse", enabled: true },
      ],
      payload,
      secret: vault[0]?.value ?? "whsec_demo_quick_test_secret",
      chaosOverride: "healthy",
    });
    setActiveTab("logs");
    pushToast("info", "Test webhook dispatched", "customer.created → api.acmecorp.io/v1/webhooks/stripe");
  }, [runDispatch, pushToast, vault]);

  const handleClearHistory = useCallback(() => {
    setLogs([]);
    pushToast("info", "History cleared", "All delivery logs were purged from the local store.");
  }, [pushToast]);

  const handleExport = useCallback(() => {
    const blob = new Blob([JSON.stringify(logs, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "webhookpulse-delivery-logs.json";
    a.click();
    URL.revokeObjectURL(url);
    pushToast("success", "Logs exported", `${logs.length} entr${logs.length === 1 ? "y" : "ies"} written to webhookpulse-delivery-logs.json`);
  }, [logs, pushToast]);

  const handleReplay = useCallback(
    (log: DeliveryLog) => {
      const metaKeys = new Set(["host", "user-agent", "content-length", "x-hub-signature-256", "x-webhook-id", "x-webhook-timestamp", "x-webhook-event", "x-delivery-attempt"]);
      const custom = log.headers.filter((h) => !metaKeys.has(h.key.toLowerCase()));
      const method: HttpMethod = log.method === "PUT" || log.method === "PATCH" ? log.method : "POST";
      runDispatch({
        url: log.url,
        method,
        headers: custom.map((h) => ({ ...h, id: uid("hdr"), enabled: true })),
        payload: log.payload,
        secret: log.secret,
        chaosOverride: "auto",
      });
      pushToast("info", "Replay dispatched", `Re-delivering ${log.event} → ${log.host}`);
    },
    [runDispatch, pushToast]
  );

  const handleVerify = useCallback((log: DeliveryLog) => {
    setVerifierDraft({ secret: log.secret, payload: log.payload, signature: log.signature });
    setActiveTab("verifier");
  }, []);

  const handleSaveSecretToVault = useCallback(
    (value: string) => {
      const name = `Captured ${new Date().toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} dispatcher secret`;
      setVault((v) => [{ id: uid("sec"), name, value, createdAt: Date.now(), source: "vault" }, ...v]);
      pushToast("success", "Secret vaulted", `“${name}” is now available in the Signature Verifier.`);
    },
    [pushToast]
  );

  const successCount = logs.filter((l) => l.ok && !l.pending).length;

  /* ================= RENDER ================= */
  return (
    <div className="relative min-h-screen bg-abyss font-sans text-slate-300">
      {/* ---------- Ambient background FX ---------- */}
      <div aria-hidden className="pointer-events-none fixed inset-0 z-0">
        <div
          className="absolute inset-0"
          style={{
            backgroundImage:
              "linear-gradient(rgba(148,163,184,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(148,163,184,0.05) 1px, transparent 1px)",
            backgroundSize: "44px 44px",
            maskImage: "radial-gradient(ellipse 90% 65% at 50% -5%, black 35%, transparent 78%)",
            WebkitMaskImage: "radial-gradient(ellipse 90% 65% at 50% -5%, black 35%, transparent 78%)",
          }}
        />
        <div className="absolute -top-36 left-[12%] h-96 w-[30rem] rounded-full" style={{ background: "radial-gradient(closest-side, rgba(139,92,246,0.17), transparent)" }} />
        <div className="absolute -right-32 top-1/3 h-96 w-[26rem] rounded-full" style={{ background: "radial-gradient(closest-side, rgba(244,63,94,0.07), transparent)" }} />
        <div className="absolute -bottom-36 left-1/4 h-96 w-[32rem] rounded-full" style={{ background: "radial-gradient(closest-side, rgba(16,185,129,0.09), transparent)" }} />
      </div>

      <Header
        activeTab={activeTab}
        onTabChange={setActiveTab}
        onSendTest={handleSendTest}
        onClearHistory={handleClearHistory}
        logsCount={logs.length}
        dispatching={dispatching}
      />

      {/* ---------- Main workspace ---------- */}
      <main className="relative z-10 mx-auto w-full max-w-[1600px] px-4 py-6 sm:px-6 lg:px-8">
        {activeTab === "dispatcher" && (
          <div key="dispatcher" className="anim-fade-up">
            <WebhookDispatcher
              onDispatch={runDispatch}
              progress={progress}
              dispatching={dispatching}
              retryPolicy={policy}
              autoRetry={autoRetry}
              onAutoRetryChange={setAutoRetry}
              onSaveSecretToVault={handleSaveSecretToVault}
              pushToast={pushToast}
            />
          </div>
        )}

        {activeTab === "logs" && (
          <div key="logs" className="anim-fade-up">
            <DeliveryLogs
              logs={logs}
              onClear={handleClearHistory}
              onExport={handleExport}
              onReplay={handleReplay}
              onVerify={handleVerify}
              onSendTest={handleSendTest}
            />
          </div>
        )}

        {activeTab === "verifier" && (
          <div key="verifier" className="anim-fade-up">
            <SignatureVerifier
              vault={vault}
              onVaultChange={setVault}
              draft={verifierDraft}
              onConsumeDraft={() => setVerifierDraft(null)}
              pushToast={pushToast}
            />
          </div>
        )}

        {activeTab === "retry" && (
          <div key="retry" className="anim-fade-up">
            <RetrySimulator
              policy={policy}
              onPolicyChange={setPolicy}
              autoRetry={autoRetry}
              onAutoRetryChange={setAutoRetry}
              pushToast={pushToast}
            />
          </div>
        )}
      </main>

      {/* ---------- Status footer bar ---------- */}
      <footer className="relative z-10 border-t border-edge/70 bg-abyss/90 backdrop-blur">
        <div className="mx-auto flex h-9 w-full max-w-[1600px] items-center justify-between gap-4 px-4 font-mono text-[9px] uppercase tracking-[0.16em] text-slate-600 sm:px-6 lg:px-8">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            <span className="flex shrink-0 items-center gap-1.5 text-slate-500"><Webhook size={10} className="text-violet-500" /> webhookpulse v2.4.1</span>
            <span className="hidden text-edge-2 md:inline">|</span>
            <span className="hidden items-center gap-1.5 md:flex"><TerminalSquare size={10} /> engine: simulation · tls 1.3</span>
            <span className="hidden text-edge-2 lg:inline">|</span>
            <span className="hidden tabular-nums lg:inline">{logs.length} events · {successCount} delivered</span>
          </div>
          <div className="flex shrink-0 items-center gap-3 sm:gap-4">
            <span className="hidden items-center gap-1.5 sm:flex"><span className={`h-1.5 w-1.5 rounded-full ${dispatching ? "animate-pulse bg-amber-400" : "bg-emerald-400"}`} />{dispatching ? "queue: draining" : "queue: idle"}</span>
            <span className="flex items-center gap-1.5 text-emerald-500/90"><ShieldCheck size={10} /> hmac-sha256 armed</span>
          </div>
        </div>
      </footer>

      {/* ---------- Toast stack ---------- */}
      <div className="pointer-events-none fixed bottom-12 right-4 z-50 flex w-[min(92vw,380px)] flex-col gap-2 sm:bottom-14 sm:right-6">
        {toasts.map((toast) => {
          const style = TOAST_STYLE[toast.kind];
          const Icon = style.icon;
          return (
            <div
              key={toast.id}
              role="status"
              className={`anim-toast-in pointer-events-auto flex items-start gap-3 rounded-xl border ${style.ring} bg-panel/95 p-3 shadow-[0_16px_40px_rgba(0,0,0,0.5)] backdrop-blur-xl`}
            >
              <Icon size={17} className={`mt-0.5 shrink-0 ${style.iconColor}`} />
              <div className="min-w-0 flex-1">
                <p className="text-[11.5px] font-bold leading-snug text-slate-100">{toast.title}</p>
                {toast.message && <p className="mt-0.5 break-words font-mono text-[9px] leading-relaxed text-slate-500">{toast.message}</p>}
              </div>
              <button onClick={() => dismissToast(toast.id)} aria-label="Dismiss notification"
                className="shrink-0 rounded-md p-1 text-slate-600 transition-colors hover:bg-panel-3 hover:text-slate-300">
                <XCircle size={13} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
