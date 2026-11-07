import { useEffect, useState } from "react";
import {
  Webhook,
  SendHorizontal,
  ScrollText,
  ShieldCheck,
  RotateCw,
  Trash2,
  Zap,
  Cpu,
} from "lucide-react";
import type { TabKey } from "../types";

interface HeaderProps {
  activeTab: TabKey;
  onTabChange: (tab: TabKey) => void;
  onSendTest: () => void;
  onClearHistory: () => void;
  logsCount: number;
  dispatching: boolean;
}

const TABS: { key: TabKey; label: string; icon: typeof SendHorizontal; badge?: boolean }[] = [
  { key: "dispatcher", label: "Payload Dispatcher", icon: SendHorizontal },
  { key: "logs", label: "Delivery Logs", icon: ScrollText, badge: true },
  { key: "verifier", label: "Signature Verifier", icon: ShieldCheck },
  { key: "retry", label: "Retry Simulator", icon: RotateCw },
];

function useUtcClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(now.getUTCHours())}:${pad(now.getUTCMinutes())}:${pad(now.getUTCSeconds())} UTC`;
}

export default function Header({
  activeTab,
  onTabChange,
  onSendTest,
  onClearHistory,
  logsCount,
  dispatching,
}: HeaderProps) {
  const clock = useUtcClock();

  return (
    <header className="sticky top-0 z-40 border-b border-edge/80 bg-abyss/85 backdrop-blur-xl">
      {/* hairline violet gradient along the very top */}
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-px"
        style={{
          background:
            "linear-gradient(90deg, transparent, rgba(139,92,246,0.7) 22%, rgba(16,185,129,0.55) 50%, rgba(139,92,246,0.7) 78%, transparent)",
        }}
      />
      <div className="mx-auto max-w-[1600px] px-4 sm:px-6 lg:px-8">
        {/* ============ Primary bar ============ */}
        <div className="flex h-16 items-center justify-between gap-3">
          {/* Brand */}
          <div className="flex min-w-0 items-center gap-3.5">
            <div className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 via-violet-600 to-purple-800 shadow-[0_0_26px_rgba(139,92,246,0.5),inset_0_1px_0_rgba(255,255,255,0.35)]">
              <Webhook className="h-5.5 w-5.5 text-white" strokeWidth={2.1} size={22} />
              <span className="absolute -right-1 -top-1 flex h-3 w-3">
                <span className="anim-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                <span className="relative inline-flex h-3 w-3 rounded-full border-2 border-abyss bg-emerald-400" />
              </span>
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2.5">
                <h1 className="font-mono text-[17px] font-bold leading-none tracking-tight text-slate-100">
                  Webhook<span className="bg-gradient-to-r from-violet-400 to-fuchsia-400 bg-clip-text text-transparent">Pulse</span>
                </h1>
                <span className="hidden rounded-md border border-edge bg-panel-2 px-1.5 py-0.5 font-mono text-[9px] font-medium uppercase tracking-[0.14em] text-slate-500 sm:inline-block">
                  v2.4.1
                </span>
              </div>
              {/* live status badge */}
              <div className="mt-1 flex items-center gap-1.5">
                <span className="relative flex h-1.5 w-1.5">
                  <span className="anim-ping-slow absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
                  <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-400" />
                </span>
                <span className="font-mono text-[9.5px] font-medium uppercase tracking-[0.18em] text-emerald-400/90">
                  Webhook Dispatcher: Active
                </span>
              </div>
            </div>
          </div>

          {/* Right cluster */}
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            <div className="hidden items-center gap-2 rounded-lg border border-edge bg-panel-2 px-3 py-1.5 lg:flex">
              <Cpu size={12} className="text-violet-400" />
              <span className="font-mono text-[11px] tabular-nums tracking-wider text-slate-400">{clock}</span>
            </div>

            <button
              onClick={onSendTest}
              disabled={dispatching}
              title="Send a signed customer.created test event to the healthy demo receiver"
              className="group relative inline-flex h-9 items-center gap-2 overflow-hidden rounded-lg bg-gradient-to-r from-violet-600 to-purple-600 px-3 text-[12.5px] font-semibold text-white shadow-[0_0_22px_rgba(139,92,246,0.4),inset_0_1px_0_rgba(255,255,255,0.28)] transition-all hover:from-violet-500 hover:to-purple-500 hover:shadow-[0_0_30px_rgba(139,92,246,0.55)] disabled:cursor-not-allowed disabled:opacity-60 sm:px-4"
            >
              <Zap size={14} strokeWidth={2.4} className={dispatching ? "animate-pulse" : "transition-transform duration-300 group-hover:scale-110"} />
              <span className="hidden sm:inline">{dispatching ? "Dispatching…" : "Send Test Webhook"}</span>
              <span className="sm:hidden">Send</span>
            </button>

            <button
              onClick={onClearHistory}
              title="Clear delivery history"
              className="inline-flex h-9 items-center gap-2 rounded-lg border border-edge bg-panel px-3 text-[12.5px] font-medium text-slate-400 transition-all hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300"
            >
              <Trash2 size={14} />
              <span className="hidden md:inline">Clear History</span>
            </button>
          </div>
        </div>

        {/* ============ Tab bar ============ */}
        <nav className="-mb-px flex items-center gap-1.5 overflow-x-auto pb-2.5 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => onTabChange(tab.key)}
                aria-pressed={active}
                className={`group relative flex shrink-0 items-center gap-2 rounded-lg border px-3 py-2 font-mono text-[11.5px] font-medium tracking-tight transition-all duration-200 sm:px-4 ${
                  active
                    ? "border-violet-500/45 bg-violet-500/12 text-violet-300 shadow-[0_0_20px_rgba(139,92,246,0.18),inset_0_1px_0_rgba(255,255,255,0.06)]"
                    : "border-transparent text-slate-500 hover:border-edge hover:bg-panel hover:text-slate-300"
                }`}
              >
                <Icon
                  size={14}
                  strokeWidth={2.2}
                  className={active ? "text-violet-400" : "text-slate-600 transition-colors group-hover:text-slate-400"}
                />
                {tab.label}
                {tab.badge && (
                  <span
                    className={`rounded-md px-1.5 py-0.5 font-mono text-[9.5px] font-semibold tabular-nums leading-none transition-colors ${
                      active ? "bg-violet-500/25 text-violet-300" : "bg-panel-3 text-slate-500"
                    }`}
                  >
                    {logsCount}
                  </span>
                )}
                {active && (
                  <span className="absolute inset-x-3 -bottom-[11px] h-[2px] rounded-full bg-gradient-to-r from-transparent via-violet-400 to-transparent" />
                )}
              </button>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
