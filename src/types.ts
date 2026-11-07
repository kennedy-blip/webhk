/* ------------------------------------------------------------------ */
/*  WebhookPulse — shared domain types                                 */
/* ------------------------------------------------------------------ */

export type HttpMethod = "POST" | "PUT" | "PATCH";

export type TabKey = "dispatcher" | "logs" | "verifier" | "retry";

export interface HeaderRow {
  id: string;
  key: string;
  value: string;
  enabled: boolean;
}

export interface AttemptRecord {
  attempt: number;
  startedAt: number;
  delayBeforeMs: number;
  latencyMs: number;
  status: number;
  statusText: string;
  ok: boolean;
}

export interface DeliveryLog {
  id: string;
  timestamp: number;
  event: string;
  method: string;
  url: string;
  host: string;
  ok: boolean;
  pending: boolean;
  status: number;
  statusText: string;
  latencyMs: number;
  totalDurationMs: number;
  retries: number;
  headers: { key: string; value: string }[];
  payload: string;
  responseBody: string;
  signature: string;
  secret: string;
  chaos: string;
  attempts: AttemptRecord[];
}

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  multiplier: number;
  jitter: boolean;
}

export type DispatchPhase = "sending" | "waiting" | "done";

export interface DispatchProgress {
  attempt: number;
  maxAttempts: number;
  phase: DispatchPhase;
  waitTotalMs: number;
  waitMsLeft: number;
  outcome: "success" | "failure" | null;
  finalStatus: number;
  event: string;
}

export type ChaosMode =
  | "auto"
  | "healthy"
  | "flaky"
  | "client400"
  | "rateLimit429"
  | "server500"
  | "timeout504";

export interface DispatchInput {
  url: string;
  method: HttpMethod;
  headers: HeaderRow[];
  payload: string;
  secret: string;
  chaosOverride: ChaosMode;
}

export type ToastKind = "success" | "error" | "info" | "warning";
export interface Toast {
  id: string;
  kind: ToastKind;
  title: string;
  message?: string;
}

export interface SecretEntry {
  id: string;
  name: string;
  value: string;
  createdAt: number;
  source: "vault" | "generated";
}

export interface VerifierDraft {
  secret: string;
  payload: string;
  signature: string;
}
