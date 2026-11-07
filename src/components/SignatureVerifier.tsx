import { useEffect, useMemo, useState } from "react";
import {
  ShieldCheck, ShieldX, KeyRound, Copy, Check, Eye, EyeOff, Trash2, Plus, RefreshCw,
  Fingerprint, BadgeCheck, FileCode2, ArrowRightLeft, FlaskConical, Lock, ChevronRight,
} from "lucide-react";
import type { SecretEntry, ToastKind, VerifierDraft } from "../types";
import { signPayload, hmacSha256Bytes, bytesToHex, compareSignatures, generateSecret, maskSecret, timeAgo, uid } from "../lib/engine";
import { EVENT_PRESETS } from "../lib/engine";

type SignatureFormat = "prefixed" | "hex" | "base64";
type SnippetLang = "node" | "python" | "go";

const panel = "rounded-2xl border border-edge bg-panel shadow-[0_18px_44px_rgba(2,6,18,0.45)]";
const panelHeader = "flex items-center justify-between gap-3 border-b border-edge/70 px-5 py-3.5";

const SNIPPETS: Record<SnippetLang, string> = {
  node: `const crypto = require("crypto");

// req.rawBody must be the UNPARSED request bytes
const expected =
  "sha256=" +
  crypto.createHmac("sha256", process.env.WEBHOOK_SECRET)
        .update(req.rawBody)
        .digest("hex");

const received = req.headers["x-hub-signature-256"] || "";
const a = Buffer.from(expected);
const b = Buffer.from(received);

if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
  return res.status(401).send("invalid signature");
}`,
  python: `import hmac, hashlib, os

raw = request.get_data()  # raw bytes — never re-serialized JSON
expected = (
    "sha256="
    + hmac.new(os.environ["WEBHOOK_SECRET"].encode(), raw, hashlib.sha256).hexdigest()
)

received = request.headers.get("X-Hub-Signature-256", "")

if not hmac.compare_digest(expected, received):
    abort(401, "invalid signature")`,
  go: `mac := hmac.New(sha256.New, []byte(os.Getenv("WEBHOOK_SECRET")))
mac.Write(body) // raw request body bytes
expected := "sha256=" + hex.EncodeToString(mac.Sum(nil))

received := r.Header.Get("X-Hub-Signature-256")
if !hmac.Equal([]byte(expected), []byte(received)) {
    http.Error(w, "invalid signature", http.StatusUnauthorized)
    return
}`,
};

/* Shared module-scope sample so the verifier opens with a live, all-green comparison */
const DEFAULT_SECRET = "whsec_9f2cA4x8QmL7vR3dT6yB1nK5";
const INITIAL_SAMPLE = EVENT_PRESETS[2].build();
const INITIAL_SIGNATURE = signPayload(DEFAULT_SECRET, INITIAL_SAMPLE, "prefixed");

interface SignatureVerifierProps {
  vault: SecretEntry[];
  onVaultChange: (entries: SecretEntry[]) => void;
  draft: VerifierDraft | null;
  onConsumeDraft: () => void;
  pushToast: (kind: ToastKind, title: string, message?: string) => void;
}

export default function SignatureVerifier({ vault, onVaultChange, draft, onConsumeDraft, pushToast }: SignatureVerifierProps) {
  /* ---------- sign panel state ---------- */
  const [secret, setSecret] = useState(DEFAULT_SECRET);
  const [signPayloadText, setSignPayloadText] = useState(INITIAL_SAMPLE);
  const [format, setFormat] = useState<SignatureFormat>("prefixed");
  const [sigCopied, setSigCopied] = useState(false);

  /* ---------- verify panel state ---------- */
  const [vSecret, setVSecret] = useState(DEFAULT_SECRET);
  const [vPayload, setVPayload] = useState(INITIAL_SAMPLE);
  const [vSignature, setVSignature] = useState(INITIAL_SIGNATURE);
  const [receivedCopied, setReceivedCopied] = useState(false);

  /* ---------- snippet + vault state ---------- */
  const [lang, setLang] = useState<SnippetLang>("node");
  const [snippetCopied, setSnippetCopied] = useState(false);
  const [revealed, setRevealed] = useState<Record<string, boolean>>({});
  const [vaultCopied, setVaultCopied] = useState<string | null>(null);
  const [newName, setNewName] = useState("");
  const [newValue, setNewValue] = useState("");

  /* ---------- consume draft coming from Delivery Logs ---------- */
  useEffect(() => {
    if (draft) {
      setVSecret(draft.secret);
      setVPayload(draft.payload);
      setVSignature(draft.signature);
      onConsumeDraft();
      pushToast("info", "Delivery loaded into verifier", "Signature and raw body mirrored from the log entry.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft]);

  /* ---------- derived signatures ---------- */
  const signature = useMemo(() => signPayload(secret, signPayloadText, format), [secret, signPayloadText, format]);
  const keyBytes = useMemo(() => new TextEncoder().encode(secret).length, [secret]);

  const expectedHex = useMemo(() => bytesToHex(hmacSha256Bytes(vSecret, vPayload)), [vSecret, vPayload]);
  const comparison = useMemo(
    () => (vSecret && vPayload && vSignature.trim() ? compareSignatures(expectedHex, vSignature) : null),
    [expectedHex, vSecret, vPayload, vSignature]
  );

  const copy = (text: string, set?: (v: boolean) => void, key?: string) => {
    navigator.clipboard?.writeText(text).catch(() => {});
    if (set) {
      set(true);
      window.setTimeout(() => set(false), 1600);
    }
    if (key) {
      setVaultCopied(key);
      window.setTimeout(() => setVaultCopied(null), 1600);
    }
  };

  const mirrorToVerifier = () => {
    setVSecret(secret);
    setVPayload(signPayloadText);
    setVSignature(signature);
    pushToast("info", "Mirrored into verifier", "Signer output copied — toggle one character to watch it fail.");
  };

  const tamper = () => {
    if (!vPayload) return;
    const idx = vPayload.search(/[a-zA-Z]/);
    if (idx === -1) return;
    const ch = vPayload[idx];
    setVPayload(vPayload.slice(0, idx) + (ch === "a" ? "b" : "a") + vPayload.slice(idx + 1));
  };

  const addToVault = () => {
    const value = newValue.trim();
    if (!value) return pushToast("warning", "Empty secret", "Paste an existing secret or generate one first.");
    const name = newName.trim() || `Secret ${vault.length + 1}`;
    onVaultChange([{ id: uid("sec"), name, value, createdAt: Date.now(), source: "generated" }, ...vault]);
    setNewName("");
    setNewValue("");
    pushToast("success", "Secret vaulted", `“${name}” stored in your local encrypted-at-rest vault list.`);
  };

  const removeFromVault = (id: string) => {
    const target = vault.find((s) => s.id === id);
    onVaultChange(vault.filter((s) => s.id !== id));
    pushToast("warning", "Secret removed", target ? `“${target.name}” deleted from the vault.` : undefined);
  };

  const formatMeta = format === "base64" ? "base64 · 44 chars" : format === "hex" ? "hex · 64 chars" : "prefixed · sha256= + 64 hex";

  return (
    <div className="space-y-5">
      {/* ============ Intro strip ============ */}
      <div className="anim-fade-up flex flex-col gap-3 rounded-2xl border border-violet-500/25 bg-gradient-to-r from-violet-500/10 via-fuchsia-500/6 to-transparent px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-violet-500/35 bg-violet-500/12 text-violet-300 shadow-[0_0_18px_rgba(139,92,246,0.3)]">
            <Fingerprint size={19} />
          </div>
          <div>
            <h2 className="text-[14px] font-bold tracking-tight text-slate-100">Signature Verifier &amp; Secret Manager</h2>
            <p className="mt-0.5 max-w-xl text-[11px] leading-snug text-slate-500">Generate, compare and audit HMAC-SHA256 digests over the exact bytes your receiver must reproduce — keys never leave this browser.</p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.16em] text-slate-500">
          {["HMAC-SHA256", "256-bit digest", "raw bytes", "timing-safe compare"].map((t) => (
            <span key={t} className="rounded-md border border-edge bg-abyss/60 px-2 py-1">{t}</span>
          ))}
        </div>
      </div>

      {/* ============ Sign / Verify panels ============ */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-2">
        {/* ---- Sign panel ---- */}
        <section className={`${panel} anim-fade-up delay-1 flex flex-col`}>
          <div className={panelHeader}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-violet-500/30 bg-violet-500/10 text-violet-400"><KeyRound size={15} /></div>
              <div>
                <h3 className="text-[13px] font-semibold tracking-tight text-slate-100">Generate Signature</h3>
                <p className="text-[10.5px] text-slate-500">What your sender attaches to every dispatch</p>
              </div>
            </div>
            <span className="rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-600">signer</span>
          </div>

          <div className="flex flex-1 flex-col gap-4 px-5 py-4">
            {/* secret + vault chips */}
            <div>
              <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Secret key</label>
              <input
                value={secret}
                onChange={(e) => setSecret(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="field h-10 w-full rounded-lg px-3 font-mono text-[11px] text-amber-100/90 focus:outline-none"
              />
              {vault.length > 0 && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className="font-mono text-[8.5px] uppercase tracking-[0.18em] text-slate-600">Vault:</span>
                  {vault.slice(0, 3).map((s) => (
                    <button key={s.id} onClick={() => setSecret(s.value)} title={s.name}
                      className="max-w-[150px] truncate rounded border border-edge bg-panel-2 px-2 py-1 font-mono text-[9px] text-slate-500 transition-all hover:border-violet-500/40 hover:text-violet-300">
                      {s.name}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* payload */}
            <div className="flex min-h-0 flex-1 flex-col">
              <div className="mb-1.5 flex items-center justify-between">
                <label className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Payload (raw bytes)</label>
                <button onClick={() => setSignPayloadText(EVENT_PRESETS[Math.floor(Math.random() * EVENT_PRESETS.length)].build())}
                  className="font-mono text-[9px] uppercase tracking-[0.18em] text-violet-400/80 transition-colors hover:text-violet-300">
                  ↻ random event
                </button>
              </div>
              <textarea
                value={signPayloadText}
                onChange={(e) => setSignPayloadText(e.target.value)}
                spellCheck={false}
                aria-label="Payload to sign"
                className="field min-h-[128px] w-full flex-1 resize-y rounded-lg p-3 font-mono text-[10.5px] leading-relaxed text-slate-300 focus:outline-none"
              />
            </div>

            {/* format segmented */}
            <div className="flex items-center justify-between gap-3">
              <div className="flex overflow-hidden rounded-lg border border-edge">
                {([["prefixed", "sha256=…"], ["hex", "raw hex"], ["base64", "base64"]] as [SignatureFormat, string][]).map(([key, label]) => (
                  <button key={key} onClick={() => setFormat(key)}
                    className={`px-3 py-1.5 font-mono text-[9.5px] font-semibold transition-all ${format === key ? "bg-violet-500/20 text-violet-300" : "bg-panel-2 text-slate-500 hover:text-slate-300"}`}>
                    {label}
                  </button>
                ))}
              </div>
              <span className="font-mono text-[8.5px] text-slate-600">{formatMeta} · key {keyBytes}B</span>
            </div>

            {/* output */}
            <div className="rounded-xl border border-emerald-500/25 bg-[#070d12] p-3.5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[8.5px] font-bold uppercase tracking-[0.22em] text-emerald-500/90">X-Hub-Signature-256</span>
                <button onClick={() => copy(signature, setSigCopied)} className="flex items-center gap-1 font-mono text-[9px] text-slate-500 transition-colors hover:text-slate-200">
                  {sigCopied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />} copy
                </button>
              </div>
              <p className="mt-2 break-all font-mono text-[10.5px] leading-relaxed text-emerald-300">{signature}</p>
            </div>

            <button onClick={mirrorToVerifier}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-violet-500/40 bg-violet-500/10 font-mono text-[10px] font-bold uppercase tracking-[0.18em] text-violet-300 transition-all hover:bg-violet-500/20">
              <ArrowRightLeft size={12} /> Mirror into verifier
            </button>
          </div>
        </section>

        {/* ---- Verify panel ---- */}
        <section className={`${panel} anim-fade-up delay-2 flex flex-col`}>
          <div className={panelHeader}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-emerald-500/30 bg-emerald-500/10 text-emerald-400"><ShieldCheck size={15} /></div>
              <div>
                <h3 className="text-[13px] font-semibold tracking-tight text-slate-100">Verify Signature</h3>
                <p className="text-[10.5px] text-slate-500">What your receiver must compute to trust the event</p>
              </div>
            </div>
            <button onClick={tamper} title="Flip one payload character to demonstrate tamper detection"
              className="flex h-7 items-center gap-1.5 rounded-md border border-amber-500/35 bg-amber-500/8 px-2 font-mono text-[9px] font-semibold uppercase tracking-wider text-amber-400 transition-all hover:bg-amber-500/15">
              <FlaskConical size={11} /> Tamper
            </button>
          </div>

          <div className="flex flex-1 flex-col gap-4 px-5 py-4">
            <div>
              <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Secret key</label>
              <input
                value={vSecret}
                onChange={(e) => setVSecret(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="field h-10 w-full rounded-lg px-3 font-mono text-[11px] text-amber-100/90 focus:outline-none"
              />
            </div>

            <div>
              <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Received payload (raw body)</label>
              <textarea
                value={vPayload}
                onChange={(e) => setVPayload(e.target.value)}
                spellCheck={false}
                placeholder='{"id":"evt_…","type":"payment.failed", …}'
                aria-label="Received payload"
                className="field h-[104px] w-full resize-y rounded-lg p-3 font-mono text-[10.5px] leading-relaxed text-slate-300 placeholder:text-slate-700 focus:outline-none"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between">
                <label className="font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Received X-Hub-Signature-256</label>
                <button onClick={() => copy(vSignature, setReceivedCopied)} className="flex items-center gap-1 font-mono text-[9px] text-slate-600 hover:text-slate-300">
                  {receivedCopied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />} copy
                </button>
              </div>
              <input
                value={vSignature}
                onChange={(e) => setVSignature(e.target.value)}
                spellCheck={false}
                placeholder="sha256=9b1f…"
                aria-label="Received signature"
                className="field h-10 w-full rounded-lg px-3 font-mono text-[10.5px] text-emerald-200 placeholder:text-slate-700 focus:outline-none"
              />
            </div>

            {/* verdict */}
            {comparison ? (
              <div className={`rounded-xl border px-4 py-3 anim-fade-in ${comparison.match ? "border-emerald-500/40 bg-emerald-500/8 shadow-[0_0_28px_rgba(16,185,129,0.12)]" : "border-rose-500/40 bg-rose-500/8 shadow-[0_0_28px_rgba(244,63,94,0.12)]"}`}>
                <div className="flex items-center gap-3">
                  {comparison.match
                    ? <span className="anim-success-pop flex h-9 w-9 items-center justify-center rounded-full border border-emerald-500/50 bg-emerald-500/15 text-emerald-400"><BadgeCheck size={18} /></span>
                    : <span className="flex h-9 w-9 items-center justify-center rounded-full border border-rose-500/50 bg-rose-500/15 text-rose-400"><ShieldX size={18} /></span>}
                  <div>
                    <p className={`text-[13px] font-extrabold tracking-tight ${comparison.match ? "text-emerald-300" : "text-rose-300"}`}>
                      {comparison.match ? "SIGNATURE VALID" : "SIGNATURE MISMATCH"}
                    </p>
                    <p className="font-mono text-[9px] text-slate-500">
                      {comparison.match
                        ? "digest matches a live re-computation — the payload is authentic and untampered"
                        : `${comparison.mismatches} mismatch${comparison.mismatches === 1 ? "" : "es"} · ${comparison.lengthMatch ? "length ok" : `expected ${comparison.expectedHex.length}, got ${comparison.received.length}`} — reject this delivery with 401`}
                    </p>
                  </div>
                </div>
                {/* character-level diff */}
                <div className="mt-3 border-t border-white/5 pt-2.5">
                  <p className="mb-1 font-mono text-[8px] font-bold uppercase tracking-[0.22em] text-slate-600">received digest — red glyphs deviate from expected</p>
                  <p className="break-all font-mono text-[9.5px] leading-[1.9] tracking-[0.06em]">
                    {comparison.chars.map((c, i) => (
                      <span key={i} className={c.ok ? "text-emerald-600" : "char-bad"}>{c.ch}</span>
                    ))}
                    {comparison.received.length < comparison.expectedHex.length && <span className="text-slate-700">{"▯".repeat(comparison.expectedHex.length - comparison.received.length)}</span>}
                  </p>
                </div>
              </div>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-edge-2/60 px-4 py-6 text-center">
                <Lock size={18} className="text-slate-700" />
                <p className="max-w-[280px] font-mono text-[9.5px] leading-relaxed text-slate-600">Provide the secret, the raw payload bytes and the received signature — the verdict computes live as you type.</p>
              </div>
            )}
          </div>
        </section>
      </div>

      {/* ============ Vault + snippets ============ */}
      <div className="grid grid-cols-1 gap-4 sm:gap-5 xl:grid-cols-12">
        {/* vault */}
        <section className={`${panel} anim-fade-up delay-3 xl:col-span-5`}>
          <div className={panelHeader}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-400"><Lock size={15} /></div>
              <div>
                <h3 className="text-[13px] font-semibold tracking-tight text-slate-100">Secret Vault</h3>
                <p className="text-[10.5px] text-slate-500">Local-only store · shared with signer &amp; replay</p>
              </div>
            </div>
            <span className="rounded-md border border-edge bg-panel-2 px-2 py-1 font-mono text-[9px] tabular-nums text-slate-500">{vault.length} stored</span>
          </div>

          <div className="max-h-64 space-y-2 overflow-y-auto px-5 pt-4">
            {vault.length === 0 && <p className="py-6 text-center font-mono text-[10px] text-slate-600">Vault is empty — add your first receiver secret below.</p>}
            {vault.map((entry) => {
              const open = !!revealed[entry.id];
              return (
                <div key={entry.id} className="group flex items-center gap-2.5 rounded-xl border border-edge/70 bg-panel-2 px-3 py-2.5 transition-all hover:border-edge-2">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-amber-500/25 bg-amber-500/8 text-amber-500"><KeyRound size={13} /></span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-semibold text-slate-200">{entry.name}</p>
                    <p className="mt-0.5 truncate font-mono text-[9px] text-slate-600">{open ? entry.value : maskSecret(entry.value, 6)} · added {timeAgo(entry.createdAt)}</p>
                  </div>
                  <button onClick={() => setRevealed((r) => ({ ...r, [entry.id]: !r[entry.id] }))} aria-label="Toggle reveal" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-panel-3 hover:text-slate-300">{open ? <EyeOff size={13} /> : <Eye size={13} />}</button>
                  <button onClick={() => copy(entry.value, undefined, entry.id)} aria-label="Copy secret" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-panel-3 hover:text-slate-300">{vaultCopied === entry.id ? <Check size={13} className="text-emerald-400" /> : <Copy size={13} />}</button>
                  <button onClick={() => removeFromVault(entry.id)} aria-label="Delete secret" className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-slate-600 transition-colors hover:bg-rose-500/10 hover:text-rose-400"><Trash2 size={13} /></button>
                </div>
              );
            })}
          </div>

          <div className="border-t border-edge/70 px-5 py-4">
            <label className="mb-1.5 block font-mono text-[9px] font-semibold uppercase tracking-[0.2em] text-slate-500">Add a receiver secret</label>
            <div className="flex gap-2">
              <input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Name (e.g. Billing prod)" aria-label="Secret name"
                className="field h-9 w-[38%] min-w-0 rounded-lg px-2.5 text-[11px] text-slate-200 placeholder:text-slate-700 focus:outline-none" />
              <input value={newValue} onChange={(e) => setNewValue(e.target.value)} placeholder="whsec_…" spellCheck={false} aria-label="Secret value"
                className="field h-9 min-w-0 flex-1 rounded-lg px-2.5 font-mono text-[10.5px] text-amber-100/90 placeholder:text-slate-700 focus:outline-none" />
              <button onClick={() => setNewValue(generateSecret())} title="Generate strong secret" aria-label="Generate strong secret"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-edge text-slate-500 transition-colors hover:border-violet-500/40 hover:text-violet-300">
                <RefreshCw size={14} />
              </button>
              <button onClick={addToVault} aria-label="Add secret to vault"
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-amber-500/90 text-black transition-all hover:bg-amber-400">
                <Plus size={16} strokeWidth={2.5} />
              </button>
            </div>
            <p className="mt-2 font-mono text-[8px] leading-relaxed text-slate-700">Stored in this browser’s localStorage only — never transmitted. Use unique secrets per receiver environment.</p>
          </div>
        </section>

        {/* snippets */}
        <section className={`${panel} anim-fade-up delay-4 xl:col-span-7`}>
          <div className={panelHeader}>
            <div className="flex items-center gap-3">
              <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-sky-500/30 bg-sky-500/10 text-sky-400"><FileCode2 size={15} /></div>
              <div>
                <h3 className="text-[13px] font-semibold tracking-tight text-slate-100">Receiver Verification Snippets</h3>
                <p className="text-[10.5px] text-slate-500">Drop-in HMAC checks for your webhook handler</p>
              </div>
            </div>
            <div className="flex items-center gap-1 overflow-hidden rounded-lg border border-edge">
              {([["node", "Node.js"], ["python", "Python"], ["go", "Go"]] as [SnippetLang, string][]).map(([key, label]) => (
                <button key={key} onClick={() => setLang(key)}
                  className={`px-2.5 py-1.5 font-mono text-[9.5px] font-semibold transition-all ${lang === key ? "bg-sky-500/20 text-sky-300" : "bg-panel-2 text-slate-500 hover:text-slate-300"}`}>
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="relative">
            <button onClick={() => copy(SNIPPETS[lang], setSnippetCopied)}
              className="absolute right-4 top-3 z-10 flex items-center gap-1.5 rounded-md border border-edge bg-abyss/80 px-2 py-1 font-mono text-[9px] text-slate-500 backdrop-blur transition-all hover:text-slate-200">
              {snippetCopied ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />} copy
            </button>
            <pre className="max-h-72 overflow-auto bg-[#0a0f1a] px-5 py-4 font-mono text-[10.5px] leading-[1.85] text-slate-300">{SNIPPETS[lang]}</pre>
          </div>
          <div className="border-t border-edge/70 px-5 py-3.5">
            <p className="flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-slate-500">
              <ChevronRight size={11} className="mt-0.5 shrink-0 text-sky-400" />
              <span><span className="text-slate-300">Golden rule:</span> always hash the <span className="text-amber-300/90">raw, unparsed body bytes</span> — re-serialized JSON (key order, whitespace) will change the digest and spuriously fail verification.</span>
            </p>
            <p className="mt-1.5 flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-slate-500">
              <ChevronRight size={11} className="mt-0.5 shrink-0 text-sky-400" />
              <span>Compare digests with a constant-time function (<span className="text-slate-300">timingSafeEqual</span> / <span className="text-slate-300">compare_digest</span> / <span className="text-slate-300">hmac.Equal</span>) — never <span className="text-rose-300/90">==</span> or early-exit loops.</span>
            </p>
            <p className="mt-1.5 flex items-start gap-2 font-mono text-[9.5px] leading-relaxed text-slate-500">
              <ChevronRight size={11} className="mt-0.5 shrink-0 text-sky-400" />
              <span>Rotate secrets quarterly and keep <span className="text-violet-300">whsec_</span>-prefixed values in a secrets manager, not in source control.</span>
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
