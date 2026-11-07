/* ------------------------------------------------------------------ */
/*  WebhookPulse — crypto, presets & delivery simulation engine        */
/*  Pure-TypeScript SHA-256 + HMAC so signatures work in any context   */
/* ------------------------------------------------------------------ */

import type { ChaosMode, DeliveryLog, RetryPolicy } from "../types";

/* ============================ SHA-256 ============================== */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

const rotr = (x: number, n: number) => ((x >>> n) | (x << (32 - n))) >>> 0;

export function sha256Bytes(message: Uint8Array): Uint8Array {
  const bitLenHi = Math.floor(message.length / 0x20000000);
  const bitLenLo = (message.length << 3) >>> 0;
  const padZeros = (64 - ((message.length + 9) % 64)) % 64;
  const buf = new Uint8Array(message.length + 1 + padZeros + 8);
  buf.set(message);
  buf[message.length] = 0x80;
  const view = new DataView(buf.buffer);
  view.setUint32(buf.length - 8, bitLenHi >>> 0);
  view.setUint32(buf.length - 4, bitLenLo);

  const H = new Uint32Array([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a,
    0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ]);
  const w = new Uint32Array(64);

  for (let offset = 0; offset < buf.length; offset += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(offset + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) | 0;
    }
    let a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) | 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0;
      d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }

  const out = new Uint8Array(32);
  const oview = new DataView(out.buffer);
  for (let i = 0; i < 8; i++) oview.setUint32(i * 4, H[i] >>> 0);
  return out;
}

const encoder = new TextEncoder();

export function hmacSha256Bytes(secret: string, message: string): Uint8Array {
  let key: Uint8Array = encoder.encode(secret);
  if (key.length > 64) key = sha256Bytes(key);
  const ipad = new Uint8Array(64).fill(0x36);
  const opad = new Uint8Array(64).fill(0x5c);
  for (let i = 0; i < key.length; i++) {
    ipad[i] ^= key[i];
    opad[i] ^= key[i];
  }
  const msg = encoder.encode(message);
  const inner = new Uint8Array(64 + msg.length);
  inner.set(ipad);
  inner.set(msg, 64);
  const innerHash = sha256Bytes(inner);
  const outer = new Uint8Array(64 + 32);
  outer.set(opad);
  outer.set(innerHash, 64);
  return sha256Bytes(outer);
}

export const bytesToHex = (bytes: Uint8Array) =>
  [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");

export const bytesToBase64 = (bytes: Uint8Array) => {
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
};

export type SignatureFormat = "prefixed" | "hex" | "base64";

export function signPayload(secret: string, payload: string, format: SignatureFormat = "prefixed"): string {
  const bytes = hmacSha256Bytes(secret, payload);
  if (format === "base64") return bytesToBase64(bytes);
  const hex = bytesToHex(bytes);
  return format === "prefixed" ? `sha256=${hex}` : hex;
}

/** Normalizes a user-supplied signature (strip prefix, lowercase) for comparison. */
export function normalizeSignature(sig: string): string {
  return sig.trim().toLowerCase().replace(/^sha256=/, "");
}

/** Constant-time-ish string comparison. Returns {match, matches[]} for diff rendering. */
export function compareSignatures(expectedHex: string, receivedRaw: string) {
  const received = normalizeSignature(receivedRaw);
  const len = expectedHex.length;
  const chars: { ch: string; ok: boolean }[] = [];
  let mismatches = 0;
  for (let i = 0; i < received.length; i++) {
    const ok = i < len && received[i] === expectedHex[i];
    if (!ok) mismatches++;
    chars.push({ ch: received[i], ok });
  }
  const lengthMatch = received.length === len;
  if (!lengthMatch) mismatches += Math.abs(received.length - len);
  return { match: lengthMatch && mismatches === 0, chars, mismatches, lengthMatch, expectedHex, received };
}

/* ========================= Small utilities ========================= */

export const uid = (prefix = "evt") =>
  `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export const formatBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(2)} MB`;

export const formatMs = (ms: number) =>
  ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(2)}s`;

export const timeAgo = (ts: number) => {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
};

export const maskSecret = (v: string, visible = 4) =>
  v.length <= visible + 4 ? "••••••••" : `${v.slice(0, visible)}${"•".repeat(Math.min(18, v.length - visible * 2))}${v.slice(-visible)}`;

export const randomHex = (bytes: number) => {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  return bytesToHex(buf);
};

export const generateSecret = () => `whsec_${randomHex(18)}`;

/* ======================= Event payload presets ====================== */

export interface EventPreset {
  id: string;
  label: string;
  type: string;
  description: string;
  dot: string;
  build: () => string;
}

const nowIso = () => new Date().toISOString();
const randPick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

export const EVENT_PRESETS: EventPreset[] = [
  {
    id: "customer.created",
    label: "customer.created",
    type: "customer.created",
    description: "New customer record provisioned",
    dot: "#8b5cf6",
    build: () =>
      JSON.stringify(
        {
          id: uid("evt"),
          type: "customer.created",
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          data: {
            object: {
              id: uid("cus"),
              email: randPick(["jane.doe@acmecorp.io", "marcus@northwind.dev", "priya@lumina.app", "lena@ferrostack.com"]),
              name: randPick(["Jane Doe", "Marcus Whitmore", "Priya Raghavan", "Lena Fischer"]),
              plan: randPick(["starter", "growth", "enterprise"]),
              currency: "usd",
              created: Math.floor(Date.now() / 1000),
              metadata: { source: "signup_form", referrer: "webhookpulse_test" },
            },
          },
        },
        null,
        2
      ),
  },
  {
    id: "subscription.renewed",
    label: "subscription.renewed",
    type: "subscription.renewed",
    description: "Recurring subscription cycle renewed",
    dot: "#10b981",
    build: () =>
      JSON.stringify(
        {
          id: uid("evt"),
          type: "subscription.renewed",
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          data: {
            object: {
              id: uid("sub"),
              customer: uid("cus"),
              status: "active",
              plan: "growth_annual",
              amount: 118800,
              currency: "usd",
              current_period_end: Math.floor(Date.now() / 1000) + 31536000,
              cancel_at_period_end: false,
            },
          },
        },
        null,
        2
      ),
  },
  {
    id: "payment.failed",
    label: "payment.failed",
    type: "payment.failed",
    description: "Charge attempt declined by processor",
    dot: "#f43f5e",
    build: () =>
      JSON.stringify(
        {
          id: uid("evt"),
          type: "payment.failed",
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          data: {
            object: {
              id: uid("pay"),
              customer: uid("cus"),
              amount: 4900,
              currency: "usd",
              failure_code: randPick(["card_declined", "insufficient_funds", "expired_card"]),
              failure_message: "The card was declined.",
              attempt_count: randPick([1, 2, 3]),
              next_retry: Math.floor(Date.now() / 1000) + 86400,
            },
          },
        },
        null,
        2
      ),
  },
  {
    id: "order.shipped",
    label: "order.shipped",
    type: "order.shipped",
    description: "Fulfillment handed to carrier",
    dot: "#f59e0b",
    build: () =>
      JSON.stringify(
        {
          id: uid("evt"),
          type: "order.shipped",
          created: Math.floor(Date.now() / 1000),
          livemode: false,
          data: {
            object: {
              id: uid("ord"),
              order_number: `WC-${Math.floor(100000 + Math.random() * 900000)}`,
              customer: uid("cus"),
              carrier: randPick(["DHL Express", "UPS Ground", "FedEx International", "Royal Mail"]),
              tracking_code: `1Z${randomHex(8).toUpperCase()}`,
              items: randPick([2, 3, 5]),
              shipped_at: nowIso(),
              eta_days: randPick([2, 4, 6]),
            },
          },
        },
        null,
        2
      ),
  },
];

export const getPreset = (id: string) => EVENT_PRESETS.find((p) => p.id === id) ?? EVENT_PRESETS[0];

/* ==================== Chaos / outcome simulation ==================== */

export type ChaosEffective = Exclude<ChaosMode, "auto">;

export const CHAOS_META: Record<ChaosEffective, { label: string; hint: string; color: string; dot: string }> = {
  healthy: { label: "Healthy", hint: "Consistently returns 2xx", color: "text-emerald-400", dot: "#10b981" },
  flaky: { label: "Flaky 50/50", hint: "Alternates between 200 and 500", color: "text-amber-400", dot: "#f59e0b" },
  client400: { label: "400 Bad Request", hint: "Receiver rejects the payload shape", color: "text-rose-400", dot: "#f43f5e" },
  rateLimit429: { label: "429 Rate Limited", hint: "Receiver throttles the sender", color: "text-amber-400", dot: "#f59e0b" },
  server500: { label: "500 / 502 / 503", hint: "Receiver crashes upstream", color: "text-rose-400", dot: "#f43f5e" },
  timeout504: { label: "504 Gateway Timeout", hint: "No response within the read window", color: "text-rose-400", dot: "#f43f5e" },
};

export function detectChaos(url: string): ChaosEffective {
  const u = url.toLowerCase();
  if (/(timeout|gateway|deadline|504)/.test(u)) return "timeout504";
  if (/(flaky|sandbox|staging-flaky|unstable|random)/.test(u)) return "flaky";
  if (/(429|throttle|ratelimit|rate-limit)/.test(u)) return "rateLimit429";
  if (/(500|502|503|crash|explod|legacy)/.test(u)) return "server500";
  if (/(400|invalid|malformed|badrequest)/.test(u)) return "client400";
  return "healthy";
}

export interface AttemptOutcome {
  status: number;
  statusText: string;
  ok: boolean;
  latencyMs: number;
}

const rand = (min: number, max: number) => Math.round(min + Math.random() * (max - min));

export function sampleOutcome(chaos: ChaosEffective): AttemptOutcome {
  const pickOk = () => {
    const status = Math.random() < 0.85 ? 200 : 201;
    return {
      status,
      statusText: status === 200 ? "OK" : "Created",
      ok: true,
      latencyMs: rand(64, 340),
    };
  };
  switch (chaos) {
    case "healthy":
      return pickOk();
    case "flaky":
      if (Math.random() < 0.5) return pickOk();
      return {
        status: 500,
        statusText: "Internal Server Error",
        ok: false,
        latencyMs: rand(280, 950),
      };
    case "client400":
      return {
        status: 400,
        statusText: "Bad Request",
        ok: false,
        latencyMs: rand(45, 190),
      };
    case "rateLimit429":
      return {
        status: 429,
        statusText: "Too Many Requests",
        ok: false,
        latencyMs: rand(38, 140),
      };
    case "server500": {
      const pool = [
        { status: 500, statusText: "Internal Server Error" },
        { status: 502, statusText: "Bad Gateway" },
        { status: 503, statusText: "Service Unavailable" },
      ];
      const p = randPick(pool);
      return { ...p, ok: false, latencyMs: rand(240, 1100) };
    }
    case "timeout504":
      return {
        status: 504,
        statusText: "Gateway Timeout",
        ok: false,
        latencyMs: rand(1900, 3300),
      };
  }
}

/* ==================== Backoff & response bodies ===================== */

export function backoffDelay(policy: RetryPolicy, failedAttempt: number): number {
  const exp = policy.baseDelayMs * Math.pow(policy.multiplier, failedAttempt - 1);
  const jittered = policy.jitter ? exp * (0.5 + Math.random() * 0.5) : exp;
  return Math.round(Math.min(jittered, 20000));
}

export function plannedBackoff(policy: RetryPolicy): { attempt: number; delayBefore: number; cumulative: number }[] {
  const plan: { attempt: number; delayBefore: number; cumulative: number }[] = [];
  let cumulative = 0;
  for (let i = 1; i <= policy.maxAttempts; i++) {
    const delayBefore = i === 1 ? 0 : policy.baseDelayMs * Math.pow(policy.multiplier, i - 2);
    cumulative += delayBefore;
    plan.push({ attempt: i, delayBefore: Math.round(delayBefore), cumulative: Math.round(cumulative) });
  }
  return plan;
}

export function responseBodyFor(status: number, event: string, attempt: number): string {
  const trace = `tr_${randomHex(8)}`;
  if (status >= 200 && status < 300) {
    return JSON.stringify(
      { ok: true, id: uid("rcpt"), event, received_at: new Date().toISOString(), attempt, trace_id: trace },
      null,
      2
    );
  }
  const map: Record<number, [string, string]> = {
    400: ["invalid_payload", "Request body failed schema validation: data.object.email must be a valid email address."],
    401: ["invalid_signature", "X-Hub-Signature-256 did not match the expected HMAC digest for the provided secret."],
    404: ["not_found", "No webhook receiver is registered at this path. Check the endpoint configuration."],
    408: ["request_timeout", "The receiver did not read the request body in time."],
    429: ["rate_limited", "Rate limit of 600 requests per minute exceeded. Retry after the window resets."],
    500: ["internal_error", "Receiver threw an unhandled exception while processing the event (RuntimeError: worker crashed)."],
    502: ["bad_gateway", "Upstream receiver responded with an invalid response from the application server."],
    503: ["service_unavailable", "Receiver is temporarily unavailable — deploy in progress or pool exhausted."],
    504: ["gateway_timeout", "Upstream did not respond within the 15000ms read deadline."],
  };
  const [code, message] = map[status] ?? ["unexpected_status", "The receiver returned an unexpected response."];
  return JSON.stringify({ ok: false, error: code, message, trace_id: trace, attempt, retriable: status >= 500 || status === 429 }, null, 2);
}

export function buildOutboundHeaders(
  enabledHeaders: { key: string; value: string }[],
  url: string,
  payload: string,
  signature: string
): { key: string; value: string }[] {
  let host = "receiver.internal";
  try {
    host = new URL(url).host;
  } catch {
    /* ignore */
  }
  const has = (k: string) => enabledHeaders.some((h) => h.key.toLowerCase() === k.toLowerCase());
  const meta: { key: string; value: string }[] = [
    { key: "Host", value: host },
    { key: "User-Agent", value: "WebhookPulse-Dispatcher/2.4.1 (+https://webhookpulse.dev/agents)" },
    { key: "Content-Length", value: String(encoder.encode(payload).length) },
    { key: "X-Hub-Signature-256", value: signature },
    { key: "X-Webhook-Id", value: uid("msg") },
    { key: "X-Webhook-Timestamp", value: String(Math.floor(Date.now() / 1000)) },
    { key: "X-Webhook-Event", value: safeEventType(payload) },
    { key: "X-Delivery-Attempt", value: "1" },
  ];
  const out = [...enabledHeaders];
  if (!has("content-type")) out.unshift({ key: "Content-Type", value: "application/json" });
  for (const m of meta) out.push(m);
  return out;
}

export function safeEventType(payload: string): string {
  try {
    const parsed = JSON.parse(payload);
    return typeof parsed?.type === "string" && parsed.type ? parsed.type : "custom.event";
  } catch {
    return "invalid.json";
  }
}

export function buildCurl(input: { url: string; method: string; headers: { key: string; value: string }[]; payload: string; signature: string }): string {
  const lines = [`curl -X ${input.method} '${input.url}' \\`];
  for (const h of input.headers) lines.push(`  -H '${h.key}: ${h.value}' \\`);
  lines.push(`  -H 'X-Hub-Signature-256: ${input.signature}' \\`);
  const compact = input.payload.replace(/\s+/g, " ").replace(/'/g, "\\'");
  lines.push(`  -d '${compact}'`);
  return lines.join("\n");
}

/* ========================= Seed log history ========================= */

const mulberry32 = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const SEED_ENDPOINTS = [
  "https://api.acmecorp.io/v1/webhooks/stripe",
  "https://staging.internal.dev/hooks/inbound",
  "https://sandbox.paygate.test/webhook/receiver",
  "https://api.legacybilling.net/v1/hooks",
  "https://gateway.timeout-prone.io/ingest",
  "https://hooks.slack.com/services/T04/B82/xK9fPq2mZ",
];

export function generateSeedLogs(): DeliveryLog[] {
  const rng = mulberry32(20240521);
  const now = Date.now();
  const logs: DeliveryLog[] = [];
  const eventIds = ["customer.created", "subscription.renewed", "payment.failed", "order.shipped"];
  // [endpointIdx, finalStatus, retriesBeforeFinal]
  const plan: [number, number, number][] = [
    [0, 200, 0],
    [2, 500, 2],
    [0, 200, 0],
    [3, 400, 0],
    [1, 200, 0],
    [4, 504, 4],
    [0, 201, 0],
    [2, 200, 1],
    [5, 200, 0],
    [3, 400, 0],
    [1, 200, 0],
    [2, 200, 3],
    [0, 200, 0],
    [4, 200, 2],
    [1, 200, 1],
  ];
  let cursor = now - 1000 * 60 * 11;

  for (let i = 0; i < plan.length; i++) {
    const [epIdx, finalStatus, retries] = plan[i];
    const url = SEED_ENDPOINTS[epIdx];
    const eventId = eventIds[Math.floor(rng() * eventIds.length)];
    const preset = getPreset(eventId);
    const payload = preset.build();
    const secret = "whsec_seed_demo_secret_do_not_use_in_prod";
    const signature = signPayload(secret, payload, "prefixed");
    const attemptsArr = [];
    let total = 0;
    const attemptCount = retries + 1;
    for (let a = 1; a <= attemptCount; a++) {
      const isLast = a === attemptCount;
      const status = isLast ? finalStatus : randPick([500, 502, 503]);
      const statusText = isLast
        ? finalStatus === 200
          ? "OK"
          : finalStatus === 201
            ? "Created"
            : finalStatus === 400
              ? "Bad Request"
              : finalStatus === 429
                ? "Too Many Requests"
                : finalStatus === 504
                  ? "Gateway Timeout"
                  : "Service Unavailable"
        : "Service Unavailable";
      const latency = isLast ? Math.round(60 + rng() * 240) : Math.round(280 + rng() * 900);
      const delayBefore = a === 1 ? 0 : Math.round(700 * Math.pow(2, a - 2) * (0.6 + rng() * 0.5));
      total += latency + delayBefore;
      attemptsArr.push({
        attempt: a,
        startedAt: cursor - total,
        delayBeforeMs: delayBefore,
        latencyMs: latency,
        status,
        statusText,
        ok: status >= 200 && status < 300,
      });
    }
    const ok = finalStatus >= 200 && finalStatus < 300;
    logs.push({
      id: `seed_${i}_${Math.floor(rng() * 1e9)}`,
      timestamp: cursor - total,
      event: eventId,
      method: "POST",
      url,
      host: new URL(url).host,
      ok,
      pending: false,
      status: finalStatus,
      statusText: attemptsArr[attemptsArr.length - 1].statusText,
      latencyMs: attemptsArr[attemptsArr.length - 1].latencyMs,
      totalDurationMs: total,
      retries,
      headers: [
        { key: "Content-Type", value: "application/json" },
        { key: "X-Custom-Source", value: "WebhookPulse" },
      ],
      payload,
      responseBody: responseBodyFor(finalStatus, eventId, attemptCount),
      signature,
      secret,
      chaos: detectChaos(url),
      attempts: attemptsArr,
    });
    cursor -= Math.round(1000 * 60 * (9 + rng() * 75));
  }
  return logs.sort((a, b) => b.timestamp - a.timestamp);
}

/* ========================= Vault seed secrets ======================== */

export function seedVault() {
  const now = Date.now();
  return [
    { id: uid("sec"), name: "Production signing secret", value: "whsec_live_51Hf2KqLmN8vX3pQ7wTzA9sD", createdAt: now - 1000 * 60 * 60 * 24 * 42, source: "vault" as const },
    { id: uid("sec"), name: "Staging / CI testing", value: "whsec_test_9a4fC2mQ7xB1vL8dR5tY3uI6", createdAt: now - 1000 * 60 * 60 * 24 * 9, source: "vault" as const },
  ];
}
