import { useState, useEffect, useMemo } from "react";
import { getNextSession, type F1Session } from "@/lib/f1Calendar2026";
import { Timer, Flag, AlertTriangle } from "lucide-react";

function formatCountdown(diffMs: number): string {
  if (diffMs <= 0) return "00:00:00";
  const totalSeconds = Math.floor(diffMs / 1000);
  const days = Math.floor(totalSeconds / 86400);
  const hours = Math.floor((totalSeconds % 86400) / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;

  const pad = (n: number) => String(n).padStart(2, "0");

  if (days > 0) {
    return `${days}g ${pad(hours)}:${pad(minutes)}`;
  }
  return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
}

function formatLocalDate(utcIso: string): string {
  const d = new Date(utcIso);
  return d.toLocaleDateString(undefined, {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function sessionTypeLabel(type: F1Session["sessionType"]): string {
  return type;
}

export function CountdownBanner() {
  const [now, setNow] = useState(() => new Date());

  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  const result = useMemo(() => getNextSession(now), [now]);

  if (!result) {
    return (
      <div className="w-full bg-muted border-b border-border px-4 py-3">
        <div className="max-w-7xl mx-auto flex items-center justify-center gap-2 text-muted-foreground text-sm">
          <AlertTriangle className="h-4 w-4" />
          <span>Nessuna sessione programmata</span>
        </div>
      </div>
    );
  }

  const { session, status } = result;
  const startMs = new Date(session.dateUtc).getTime();
  const diffMs = startMs - now.getTime();

  const isInProgress = status === "in_progress";
  const isImminent = status === "imminent";

  return (
    <div
      className={`w-full border-b px-4 py-3 transition-colors ${
        isInProgress
          ? "bg-[hsl(var(--f1-red))/0.15] border-[hsl(var(--f1-red))/0.3]"
          : isImminent
            ? "bg-[hsl(var(--accent))/0.08] border-[hsl(var(--accent))/0.2]"
            : "bg-muted/50 border-border"
      }`}
    >
      <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2 sm:gap-4">
        {/* Left: Label */}
        <div className="flex items-center gap-2 text-xs text-muted-foreground shrink-0">
          <Flag className="h-3.5 w-3.5" />
          <span className="uppercase tracking-wider font-medium">Prossima sessione F1</span>
        </div>

        {/* Center: GP + Session type + Date */}
        <div className="flex flex-col sm:flex-row items-center gap-1 sm:gap-3 text-center min-w-0">
          <span className="text-sm font-semibold text-foreground truncate max-w-[280px]">
            {session.gpName}
          </span>
          <span className="hidden sm:inline text-muted-foreground">·</span>
          <span className="text-xs font-medium text-primary">
            {sessionTypeLabel(session.sessionType)}
          </span>
          <span className="hidden sm:inline text-muted-foreground">·</span>
          <span className="text-xs text-muted-foreground">
            {formatLocalDate(session.dateUtc)}
          </span>
        </div>

        {/* Right: Countdown or status */}
        <div className="flex items-center gap-2 shrink-0">
          {isInProgress ? (
            <div className="flex items-center gap-1.5">
              <span className="relative flex h-2.5 w-2.5">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-[hsl(var(--f1-red))] opacity-75" />
                <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-[hsl(var(--f1-red))]" />
              </span>
              <span className="text-sm font-bold text-[hsl(var(--f1-red))]">
                Sessione in corso
              </span>
            </div>
          ) : isImminent ? (
            <div className="flex items-center gap-1.5">
              <Timer className="h-4 w-4 text-primary animate-pulse" />
              <span className="text-sm font-bold text-primary">
                Sta per iniziare
              </span>
              <span className="text-lg font-mono font-bold text-foreground tabular-nums">
                {formatCountdown(diffMs)}
              </span>
            </div>
          ) : (
            <div className="flex items-center gap-1.5">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="text-lg font-mono font-bold text-foreground tabular-nums">
                {formatCountdown(diffMs)}
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
