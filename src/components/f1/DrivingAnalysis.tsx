import { useMemo } from "react";
import type { CarData } from "@/lib/openf1";

interface DriverAnalysis {
  driverNumber: number;
  acronym: string;
  color: string;
  carData: CarData[];
}

export interface ZoneDate {
  date: string;
  type: "superclipping" | "liftcoast";
}

export interface DriverZones {
  driverNumber: number;
  color: string;
  zones: ZoneDate[];
}

interface Props {
  drivers: DriverAnalysis[];
}

function computeZones(carData: CarData[]) {
  let superclipCount = 0;
  let superclipMs = 0;
  let liftcoastCount = 0;
  let liftcoastMs = 0;

  const superclipDates: string[] = [];
  const liftcoastDates: string[] = [];

  let inLiftCoast = false;

  for (let i = 1; i < carData.length; i++) {
    const prev = carData[i - 1];
    const curr = carData[i];
    const dt = new Date(curr.date).getTime() - new Date(prev.date).getTime();

    // Superclipping: throttle 100% but speed decreasing
    if (curr.throttle >= 100 && curr.speed < prev.speed && prev.speed > 0) {
      superclipMs += dt;
      superclipDates.push(curr.date);
      if (i === 1 || !(carData[i - 1].throttle >= 100 && prev.speed < carData[i - 2]?.speed)) {
        superclipCount++;
      }
    }

    // Lift & Coast: starts when going from (throttle>90, brake=0) to (throttle=0, brake=0)
    // ends when throttle OR brake are pressed
    if (!inLiftCoast) {
      const prevHighThrottle = prev.throttle > 90 && prev.brake === 0;
      const currCoasting = curr.throttle === 0 && curr.brake === 0;
      if (prevHighThrottle && currCoasting) {
        liftcoastCount++;
        inLiftCoast = true;
        liftcoastMs += dt;
        liftcoastDates.push(curr.date);
      }
    } else {
      if (curr.throttle === 0 && curr.brake === 0) {
        liftcoastMs += dt;
        liftcoastDates.push(curr.date);
      } else {
        inLiftCoast = false;
      }
    }
  }

  return {
    superclipping: { count: superclipCount, duration: superclipMs / 1000, dates: superclipDates },
    liftcoast: { count: liftcoastCount, duration: liftcoastMs / 1000, dates: liftcoastDates },
  };
}

export function DrivingAnalysis({ drivers }: Props) {
  const analyses = useMemo(
    () => drivers.map((d) => ({ ...d, zones: computeZones(d.carData) })),
    [drivers]
  );

  // Export zone dates for TrackMap
  const allZones: DriverZones[] = useMemo(
    () =>
      analyses.map((a) => ({
        driverNumber: a.driverNumber,
        color: a.color,
        zones: [
          ...a.zones.superclipping.dates.map((date) => ({ date, type: "superclipping" as const })),
          ...a.zones.liftcoast.dates.map((date) => ({ date, type: "liftcoast" as const })),
        ],
      })),
    [analyses]
  );

  if (!analyses.length) return null;

  return (
    <div className="mt-4 grid grid-cols-2 gap-3">
      {/* Superclipping */}
      <div className="bg-muted/30 rounded-md p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: "hsl(0 85% 55%)" }} />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Superclipping</span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          Deceleration while throttle is at 100%
        </p>
        {analyses.map((a) => (
          <div key={a.driverNumber} className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: `#${a.color}` }} />
            <span className="text-xs font-mono font-bold">{a.acronym}</span>
            <span className="text-xs font-mono text-foreground ml-auto">{a.zones.superclipping.duration.toFixed(2)}s</span>
            <span className="text-[10px] text-muted-foreground">({a.zones.superclipping.count}×)</span>
          </div>
        ))}
      </div>

      {/* Lift & Coast */}
      <div className="bg-muted/30 rounded-md p-3">
        <div className="flex items-center gap-2 mb-2">
          <span className="w-2.5 h-2.5 rounded-[2px]" style={{ backgroundColor: "hsl(200 85% 55%)" }} />
          <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Lift & Coast</span>
        </div>
        <p className="text-[10px] text-muted-foreground mb-2">
          Throttle &gt;90% → 0% with no braking
        </p>
        {analyses.map((a) => (
          <div key={a.driverNumber} className="flex items-center gap-2 mb-1.5">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ backgroundColor: `#${a.color}` }} />
            <span className="text-xs font-mono font-bold">{a.acronym}</span>
            <span className="text-xs font-mono text-foreground ml-auto">{a.zones.liftcoast.duration.toFixed(2)}s</span>
            <span className="text-[10px] text-muted-foreground">({a.zones.liftcoast.count}×)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// Helper to extract zones for TrackMap usage
export function computeDriverZones(carData: CarData[], driverNumber: number, color: string): DriverZones {
  const zones = computeZones(carData);
  return {
    driverNumber,
    color,
    zones: [
      ...zones.superclipping.dates.map((date) => ({ date, type: "superclipping" as const })),
      ...zones.liftcoast.dates.map((date) => ({ date, type: "liftcoast" as const })),
    ],
  };
}
