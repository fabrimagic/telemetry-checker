import { useState, useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";
import { readCache, writeCache, CACHE_KEYS, CACHE_TTL } from "@/lib/clientCache";

interface Session {
  session_key: number;
  session_name: string;
  session_type: string;
  country_name: string;
  circuit_short_name: string;
  date_start: string;
  date_end: string;
  year: number;
  meeting_key: number;
}

interface Props {
  onSelect: (sessionKey: number, sessionType: string, meetingKey: number) => void;
  isLoading: boolean;
  /**
   * Optional whitelist of `session_type` values to keep in the dropdown.
   * When omitted, all session types are shown. When provided, only sessions whose
   * `session_type` matches one of these values (case-insensitive) are listed.
   */
  sessionTypeFilter?: string[];
}

export function SessionPicker({ onSelect, isLoading, sessionTypeFilter }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  // Stable filter signature so the effect doesn't rerun on every render
  const filterSig = sessionTypeFilter ? sessionTypeFilter.map(s => s.toLowerCase()).sort().join("|") : "";

  useEffect(() => {
    const year = new Date().getFullYear();
    const cacheKey = CACHE_KEYS.sessionsByYear(year);

    const cached = readCache<Session[]>(cacheKey, CACHE_TTL.SESSIONS);
    if (cached) {
      setSessions(filterAndSort(cached, filterSig));
      setLoading(false);
      return;
    }

    setLoading(true);
    fetch(`https://api.openf1.org/v1/sessions?year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json();
      })
      .then((data: Session[]) => {
        writeCache(cacheKey, data);
        setSessions(filterAndSort(data, filterSig));
      })
        const now = new Date();
        const excludedCountries = ["bahrain", "saudi arabia"];
        const allowedTypes = filterSig ? new Set(filterSig.split("|")) : null;
        const past = data.filter((s) => {
          if (new Date(s.date_start) >= now) return false;
          const country = (s.country_name || "").toLowerCase();
          if (excludedCountries.some((ex) => country.includes(ex))) return false;
          if (allowedTypes && !allowedTypes.has((s.session_type || "").toLowerCase())) return false;
          return true;
        });
        past.sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
        setSessions(past);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [filterSig]);

  // Group sessions by event (country)
  const grouped = useMemo(() => {
    const map = new Map<string, Session[]>();
    for (const s of sessions) {
      const key = `${s.country_name} — ${s.circuit_short_name}`;
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(s);
    }
    return map;
  }, [sessions]);

  const handleChange = (val: string) => {
    setSelected(val);
    const session = sessions.find((s) => s.session_key === Number(val));
    onSelect(Number(val), session?.session_type ?? "", session?.meeting_key ?? 0);
  };

  if (loading) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground text-sm">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading sessions…
      </div>
    );
  }

  if (error) {
    return <div className="text-sm text-destructive">Failed to load sessions: {error}</div>;
  }

  return (
    <div className="w-full">
      <label className="block text-[10px] font-black text-muted-foreground mb-2 uppercase tracking-[0.25em]">
        Seleziona Sessione
      </label>
      <Select value={selected} onValueChange={handleChange} disabled={isLoading}>
        <SelectTrigger className="bg-background/60 border-border hover:border-[hsl(var(--f1-red))]/50 hover:bg-background transition-colors h-11 font-medium">
          <SelectValue placeholder="Scegli una sessione del weekend…" />
        </SelectTrigger>
        <SelectContent className="max-h-80">
          {[...grouped.entries()].map(([event, eventSessions]) => (
            <div key={event}>
              <div className="px-2 py-1.5 text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
                {event}
              </div>
              {eventSessions.map((s) => (
                <SelectItem key={s.session_key} value={s.session_key.toString()}>
                  <span className="flex items-center gap-2">
                    <span>{s.session_name}</span>
                    <span className="text-muted-foreground text-xs">
                      {new Date(s.date_start).toLocaleDateString()}
                    </span>
                  </span>
                </SelectItem>
              ))}
            </div>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
