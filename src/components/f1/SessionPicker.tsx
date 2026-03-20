import { useState, useEffect, useMemo } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Loader2 } from "lucide-react";

interface Session {
  session_key: number;
  session_name: string;
  session_type: string;
  country_name: string;
  circuit_short_name: string;
  date_start: string;
  date_end: string;
  year: number;
}

interface Props {
  onSelect: (sessionKey: number, sessionType: string) => void;
  isLoading: boolean;
}

export function SessionPicker({ onSelect, isLoading }: Props) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState("");

  useEffect(() => {
    const year = new Date().getFullYear();
    setLoading(true);
    fetch(`https://api.openf1.org/v1/sessions?year=${year}`)
      .then((r) => {
        if (!r.ok) throw new Error(`API error ${r.status}`);
        return r.json();
      })
      .then((data: Session[]) => {
        const now = new Date();
        const past = data.filter((s) => new Date(s.date_start) < now);
        past.sort((a, b) => new Date(b.date_start).getTime() - new Date(a.date_start).getTime());
        setSessions(past);
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, []);

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
    onSelect(Number(val), session?.session_type ?? "");
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
    <div className="max-w-md">
      <label className="block text-xs font-medium text-muted-foreground mb-1.5 uppercase tracking-wider">
        Session
      </label>
      <Select value={selected} onValueChange={handleChange} disabled={isLoading}>
        <SelectTrigger className="bg-muted border-border">
          <SelectValue placeholder="Select a session" />
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
