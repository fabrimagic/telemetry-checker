import type { OvertakeData, Driver } from "@/lib/openf1";
import { ArrowRightLeft } from "lucide-react";

interface Props {
  overtakes: OvertakeData[];
  allDrivers: Driver[];
}

export function OvertakesCard({ overtakes, allDrivers }: Props) {
  if (!overtakes.length) return null;

  const driverName = (num: number) => {
    const d = allDrivers.find((dr) => dr.driver_number === num);
    return d ? d.name_acronym : `#${num}`;
  };

  const driverColor = (num: number) => {
    const d = allDrivers.find((dr) => dr.driver_number === num);
    return d?.team_colour || "ffffff";
  };

  return (
    <div className="bg-card rounded-lg border border-border p-4">
      <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider mb-3 flex items-center gap-1.5">
        <ArrowRightLeft className="h-3.5 w-3.5" />
        Overtakes ({overtakes.length})
      </h3>
      <div className="space-y-2 max-h-48 overflow-y-auto">
        {overtakes.map((o, i) => (
          <div
            key={i}
            className="flex items-center gap-2 text-xs py-1.5 px-2 rounded bg-muted/50"
          >
            <span className="font-mono tabular-nums text-muted-foreground w-6 shrink-0">
              P{o.position}
            </span>
            <span className="flex items-center gap-1">
              <span
                className="w-1.5 h-1.5 rounded-full"
                style={{ backgroundColor: `#${driverColor(o.overtaken_driver_number)}` }}
              />
              <span className="font-mono text-muted-foreground">{driverName(o.overtaken_driver_number)}</span>
            </span>
            <span className="text-muted-foreground text-[10px]">
              {new Date(o.date).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
