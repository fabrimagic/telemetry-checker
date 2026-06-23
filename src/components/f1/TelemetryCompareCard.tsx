import { useEffect, useMemo, useState } from "react";
import {
  ResponsiveContainer,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
  ReferenceLine,
} from "recharts";
import {
  AccordionItem,
  AccordionTrigger,
  AccordionContent,
} from "@/components/ui/accordion";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Activity, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { getCarData } from "@/lib/openf1";
import type { CarData, Driver, Lap } from "@/lib/openf1";

/**
 * Distance-aligned telemetry comparison between a driver's best lap and
 * a reference driver's best lap of the same session.
 *
 * Pure presentation/fetch — does not change any calculation logic.
 * Reuses the same approach as the Qualifying dashboard.
 */

interface TelemetrySample {
  time: number;
  distance: number;
  speed: number | null;
  throttle: number | null;
  brake: number | null;
  rpm: number | null;
  gear: number | null;
}

interface AlignedPoint {
  distance: number;
  speed_you: number | null;
  speed_ref: number | null;
  throttle_you: number | null;
  throttle_ref: number | null;
  brake_you: number | null;
  brake_ref: number | null;
  rpm_you: number | null;
  rpm_ref: number | null;
  gear_you: number | null;
  gear_ref: number | null;
}

interface Props {
  /** Selected driver (the "you" side). */
  driver: Driver;
  /** Driver color (hex without #). */
  driverColor: string;
  /** Best valid lap of the selected driver in this session, or null if unavailable. */
  bestLap: Lap | null;
  /** All laps of all drivers in the session, used to pick reference best laps. */
  sessionAllLaps: Lap[];
  /** All drivers in the session. */
  allDrivers: Driver[];
  /** Color resolver for any driver number. */
  getColor: (driverNumber: number) => string;
  /** Session key needed for the on-demand telemetry fetch. */
  sessionKey: number;
  /** Accordion item value (must be unique within its accordion). */
  accordionValue?: string;
  /** Accent color for the title icon (hex without #). */
  accentColor?: string;
}

const Placeholder = ({ children = "Dati non disponibili" }: { children?: React.ReactNode }) => (
  <div className="text-xs text-muted-foreground italic">{children}</div>
);

function isValidLap(l: Lap): boolean {
  return (
    typeof l.lap_duration === "number" &&
    l.lap_duration > 0 &&
    !l.is_pit_out_lap &&
    typeof l.duration_sector_1 === "number" &&
    typeof l.duration_sector_2 === "number" &&
    typeof l.duration_sector_3 === "number"
  );
}

function bestLapOf(laps: Lap[]): Lap | null {
  const v = laps.filter(isValidLap);
  if (!v.length) return null;
  return v.reduce((b, l) =>
    (l.lap_duration as number) < (b.lap_duration as number) ? l : b,
  );
}

interface DistanceCompareChartProps {
  label: string;
  data: AlignedPoint[] | { distance: number; delta: number | null }[];
  fieldYou?: keyof AlignedPoint;
  fieldRef?: keyof AlignedPoint;
  deltaFields?: { a: keyof AlignedPoint; b: keyof AlignedPoint };
  youColor: string;
  refColor: string;
  youName: string;
  refName: string;
  height: number;
  unit?: string;
  yDomain?: [number, number];
  cursor: number | null;
  onCursor: (d: number | null) => void;
  showXAxis: boolean;
}

function DistanceCompareChart({
  label,
  data,
  fieldYou,
  fieldRef,
  deltaFields,
  youColor,
  refColor,
  youName,
  refName,
  height,
  unit = "",
  yDomain,
  cursor,
  onCursor,
  showXAxis,
}: DistanceCompareChartProps) {
  const series = deltaFields
    ? (data as AlignedPoint[]).map((p) => {
        const a = p[deltaFields.a] as number | null;
        const b = p[deltaFields.b] as number | null;
        return { distance: p.distance, delta: a != null && b != null ? a - b : null };
      })
    : data;
  return (
    <div className="relative">
      <span className="absolute top-0 left-2 text-[10px] font-medium text-muted-foreground uppercase tracking-wider z-10">
        {label}
      </span>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart
          data={series as any[]}
          margin={{ top: 18, right: 12, left: 0, bottom: showXAxis ? 18 : 0 }}
          onMouseMove={(s: any) => {
            const d = s?.activePayload?.[0]?.payload?.distance;
            if (typeof d === "number") onCursor(d);
          }}
          onMouseLeave={() => onCursor(null)}
        >
          <CartesianGrid stroke="hsl(var(--border))" strokeDasharray="3 3" opacity={0.4} vertical={false} />
          <XAxis
            dataKey="distance"
            type="number"
            domain={["dataMin", "dataMax"]}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            hide={!showXAxis}
            tickFormatter={(v) => `${Math.round(v as number)}`}
            label={
              showXAxis
                ? {
                    value: "Distanza (m)",
                    position: "insideBottom",
                    offset: -4,
                    style: { fontSize: 10, fill: "hsl(var(--muted-foreground))" },
                  }
                : undefined
            }
          />
          <YAxis
            width={42}
            tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }}
            axisLine={false}
            tickLine={false}
            domain={yDomain ?? ["auto", "auto"]}
          />
          <Tooltip
            contentStyle={{
              background: "hsl(var(--background))",
              border: "1px solid hsl(var(--border))",
              fontSize: 11,
            }}
            labelFormatter={(v) => `${Math.round(v as number)} m`}
            formatter={(val: any, name: any) => {
              if (val == null || !Number.isFinite(val)) return ["—", name];
              const v = Number(val);
              return [`${v.toFixed(unit === "%" ? 0 : 1)}${unit}`, name];
            }}
          />
          {cursor != null && (
            <ReferenceLine x={cursor} stroke="hsl(0 0% 50%)" strokeDasharray="2 2" />
          )}
          {deltaFields ? (
            <Line
              type="monotone"
              dataKey="delta"
              name={youName}
              stroke={youColor}
              strokeWidth={1.5}
              dot={false}
              isAnimationActive={false}
              connectNulls
            />
          ) : (
            <>
              <Line
                type="monotone"
                dataKey={fieldYou as string}
                name={youName}
                stroke={youColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
              <Line
                type="monotone"
                dataKey={fieldRef as string}
                name={refName}
                stroke={refColor}
                strokeWidth={1.5}
                dot={false}
                isAnimationActive={false}
                connectNulls
              />
            </>
          )}
          {!deltaFields && <Legend wrapperStyle={{ fontSize: 10 }} />}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export function TelemetryCompareCard({
  driver,
  driverColor,
  bestLap,
  sessionAllLaps,
  allDrivers,
  getColor,
  sessionKey,
  accordionValue = "telemetry",
  accentColor,
}: Props) {
  const accent = accentColor ? `#${accentColor}` : `#${driverColor}`;

  // Drivers other than the selected one
  const otherDrivers = useMemo(
    () => allDrivers.filter((d) => d.driver_number !== driver.driver_number),
    [allDrivers, driver.driver_number],
  );

  // Default reference: the driver (other than self) with the fastest valid lap.
  const defaultRefNumber = useMemo<number | null>(() => {
    let best: { num: number; t: number } | null = null;
    for (const d of otherDrivers) {
      const dl = sessionAllLaps.filter((l) => l.driver_number === d.driver_number);
      const bl = bestLapOf(dl);
      if (bl && typeof bl.lap_duration === "number") {
        if (!best || (bl.lap_duration as number) < best.t) {
          best = { num: d.driver_number, t: bl.lap_duration as number };
        }
      }
    }
    return best?.num ?? otherDrivers[0]?.driver_number ?? null;
  }, [otherDrivers, sessionAllLaps]);

  const [refDriverNum, setRefDriverNum] = useState<number | null>(defaultRefNumber);

  useEffect(() => {
    setRefDriverNum(defaultRefNumber);
  }, [defaultRefNumber]);

  const referenceDriver = useMemo(
    () => allDrivers.find((d) => d.driver_number === refDriverNum) ?? null,
    [allDrivers, refDriverNum],
  );

  const referenceLap = useMemo(() => {
    if (refDriverNum == null) return null;
    const refLaps = sessionAllLaps.filter((l) => l.driver_number === refDriverNum);
    return bestLapOf(refLaps);
  }, [refDriverNum, sessionAllLaps]);

  // Telemetry state
  type TeleState =
    | { status: "idle" }
    | { status: "loading" }
    | { status: "error"; message: string }
    | { status: "ready"; you: TelemetrySample[]; ref: TelemetrySample[] };
  const [teleState, setTeleState] = useState<TeleState>({ status: "idle" });
  const [cursorDistance, setCursorDistance] = useState<number | null>(null);

  useEffect(() => {
    setTeleState({ status: "idle" });
    setCursorDistance(null);
  }, [bestLap?.date_start, referenceLap?.date_start, refDriverNum]);

  const mapToSamples = (car: CarData[]): TelemetrySample[] => {
    if (!car.length) return [];
    const t0 = new Date(car[0].date).getTime();
    let prevT: number | null = null;
    let prevSpeedMs: number | null = null;
    let distance = 0;
    const out: TelemetrySample[] = [];
    for (const c of car) {
      const ts = new Date(c.date).getTime();
      if (!Number.isFinite(ts)) continue;
      const tSec = (ts - t0) / 1000;
      const speed = typeof c.speed === "number" && Number.isFinite(c.speed) ? c.speed : null;
      const speedMs = speed != null ? speed / 3.6 : null;
      if (prevT != null) {
        let dt = tSec - prevT;
        if (!Number.isFinite(dt) || dt <= 0) dt = 0;
        if (dt > 0 && speedMs != null) {
          const vAvg = prevSpeedMs != null ? (prevSpeedMs + speedMs) / 2 : speedMs;
          distance += vAvg * dt;
        }
      }
      out.push({
        time: tSec,
        distance,
        speed,
        throttle: typeof c.throttle === "number" ? c.throttle : null,
        brake: typeof c.brake === "number" ? c.brake : null,
        rpm: typeof c.rpm === "number" ? c.rpm : null,
        gear: typeof c.n_gear === "number" ? c.n_gear : null,
      });
      prevT = tSec;
      if (speedMs != null) prevSpeedMs = speedMs;
    }
    return out;
  };

  const loadTelemetry = async () => {
    if (!bestLap || !referenceLap || !referenceDriver) return;
    setTeleState({ status: "loading" });
    try {
      const ownStart = bestLap.date_start!;
      const ownEnd = new Date(
        new Date(ownStart).getTime() + (bestLap.lap_duration as number) * 1000,
      ).toISOString();
      const refStart = referenceLap.date_start!;
      const refEnd = new Date(
        new Date(refStart).getTime() + (referenceLap.lap_duration as number) * 1000,
      ).toISOString();
      const ownCar = await getCarData(sessionKey, driver.driver_number, ownStart, ownEnd);
      const refCar = await getCarData(sessionKey, referenceDriver.driver_number, refStart, refEnd);
      const you = mapToSamples(ownCar);
      const ref = mapToSamples(refCar);
      if (you.length < 2 || ref.length < 2) {
        setTeleState({ status: "error", message: "Telemetria non disponibile per questi giri." });
        return;
      }
      setTeleState({ status: "ready", you, ref });
    } catch {
      setTeleState({ status: "error", message: "Errore nel caricamento della telemetria." });
    }
  };

  const interpolateAt = (
    samples: TelemetrySample[],
    distance: number,
    field: keyof Pick<TelemetrySample, "speed" | "throttle" | "brake" | "rpm" | "gear">,
  ): number | null => {
    if (!samples.length) return null;
    let lo = 0, hi = samples.length - 1;
    if (distance <= samples[0].distance) return samples[0][field];
    if (distance >= samples[hi].distance) return samples[hi][field];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (samples[mid].distance <= distance) lo = mid;
      else hi = mid;
    }
    const a = samples[lo], b = samples[hi];
    const va = a[field], vb = b[field];
    if (va == null && vb == null) return null;
    if (va == null) return vb;
    if (vb == null) return va;
    const span = b.distance - a.distance;
    if (span <= 0) return va;
    const t = (distance - a.distance) / span;
    if (field === "gear") return t < 0.5 ? va : vb;
    return va + (vb - va) * t;
  };

  const alignedData: AlignedPoint[] = useMemo(() => {
    if (teleState.status !== "ready") return [];
    const youMax = teleState.you[teleState.you.length - 1].distance;
    const refMax = teleState.ref[teleState.ref.length - 1].distance;
    const maxD = Math.min(youMax, refMax);
    if (!Number.isFinite(maxD) || maxD <= 0) return [];
    const N = 500;
    const out: AlignedPoint[] = new Array(N);
    for (let i = 0; i < N; i++) {
      const d = (maxD * i) / (N - 1);
      out[i] = {
        distance: d,
        speed_you: interpolateAt(teleState.you, d, "speed"),
        speed_ref: interpolateAt(teleState.ref, d, "speed"),
        throttle_you: interpolateAt(teleState.you, d, "throttle"),
        throttle_ref: interpolateAt(teleState.ref, d, "throttle"),
        brake_you: interpolateAt(teleState.you, d, "brake"),
        brake_ref: interpolateAt(teleState.ref, d, "brake"),
        rpm_you: interpolateAt(teleState.you, d, "rpm"),
        rpm_ref: interpolateAt(teleState.ref, d, "rpm"),
        gear_you: interpolateAt(teleState.you, d, "gear"),
        gear_ref: interpolateAt(teleState.ref, d, "gear"),
      };
    }
    return out;
  }, [teleState]);

  const refColorHex = referenceDriver ? `#${getColor(referenceDriver.driver_number)}` : "#888";
  const youColorHex = `#${driverColor}`;
  const youAcr = driver.name_acronym;
  const refAcr = referenceDriver?.name_acronym ?? "REF";

  return (
    <AccordionItem
      value={accordionValue}
      className="border border-border/60 rounded-xl bg-card overflow-hidden !border-b"
    >
      <AccordionTrigger className="px-4 py-3 hover:no-underline">
        <div className="flex items-center gap-2">
          <Activity className="h-4 w-4" style={{ color: accent }} />
          <span className="text-[11px] font-black uppercase tracking-[0.22em]">
            Confronto telemetria miglior giro
          </span>
        </div>
      </AccordionTrigger>
      <AccordionContent className="px-4 pb-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          {otherDrivers.length > 0 && (
            <Select
              value={refDriverNum != null ? String(refDriverNum) : ""}
              onValueChange={(v) => setRefDriverNum(Number(v))}
            >
              <SelectTrigger className="h-8 w-[220px] text-xs">
                <SelectValue placeholder="Seleziona pilota di riferimento" />
              </SelectTrigger>
              <SelectContent>
                {otherDrivers.map((d) => (
                  <SelectItem key={d.driver_number} value={String(d.driver_number)}>
                    <span className="flex items-center gap-2">
                      <span
                        className="inline-block w-2 h-2 rounded-full"
                        style={{ backgroundColor: `#${getColor(d.driver_number)}` }}
                      />
                      <span className="font-mono">{d.name_acronym}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <Button
            type="button"
            size="sm"
            variant="outline"
            onClick={loadTelemetry}
            disabled={
              !bestLap ||
              !referenceLap ||
              !referenceDriver ||
              teleState.status === "loading"
            }
          >
            {teleState.status === "loading"
              ? "Caricamento…"
              : teleState.status === "ready"
              ? "Ricarica telemetria"
              : "Carica confronto telemetria"}
          </Button>
          {referenceDriver && bestLap && referenceLap && (
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: `#${driverColor}` }}
                />
                <span className="font-mono">{driver.name_acronym}</span>
                <span>(selezionato)</span>
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="inline-block w-2.5 h-2.5 rounded-full"
                  style={{ backgroundColor: `#${getColor(referenceDriver.driver_number)}` }}
                />
                <span className="font-mono">{referenceDriver.name_acronym}</span>
                <span>(riferimento)</span>
              </span>
            </div>
          )}
        </div>

        {!bestLap ? (
          <Placeholder>Miglior giro del pilota non disponibile.</Placeholder>
        ) : !referenceLap || !referenceDriver ? (
          <Placeholder>Giro di riferimento non disponibile.</Placeholder>
        ) : teleState.status === "idle" ? (
          <div className="text-[11px] text-muted-foreground">
            La telemetria viene scaricata solo su richiesta per non sovraccaricare le API.
            Premi il pulsante per caricare il confronto tra i due migliori giri.
          </div>
        ) : teleState.status === "loading" ? (
          <div className="text-[11px] text-muted-foreground">Caricamento telemetria…</div>
        ) : teleState.status === "error" ? (
          <Placeholder>{teleState.message}</Placeholder>
        ) : alignedData.length === 0 ? (
          <Placeholder>Telemetria non sufficiente per costruire l'asse distanza.</Placeholder>
        ) : (
          <>
            <DistanceCompareChart
              label="Velocità (km/h)"
              data={alignedData}
              fieldYou="speed_you"
              fieldRef="speed_ref"
              youColor={youColorHex}
              refColor={refColorHex}
              youName={youAcr}
              refName={refAcr}
              height={180}
              unit=" km/h"
              cursor={cursorDistance}
              onCursor={setCursorDistance}
              showXAxis={false}
            />
            <DistanceCompareChart
              label="Delta velocità (selezionato − riferimento)"
              data={alignedData}
              deltaFields={{ a: "speed_you", b: "speed_ref" }}
              youColor={youColorHex}
              refColor={refColorHex}
              youName={`${youAcr} − ${refAcr}`}
              refName=""
              height={120}
              unit=" km/h"
              cursor={cursorDistance}
              onCursor={setCursorDistance}
              showXAxis={false}
            />
            <DistanceCompareChart
              label="Gas (%)"
              data={alignedData}
              fieldYou="throttle_you"
              fieldRef="throttle_ref"
              youColor={youColorHex}
              refColor={refColorHex}
              youName={youAcr}
              refName={refAcr}
              height={110}
              unit="%"
              yDomain={[0, 100]}
              cursor={cursorDistance}
              onCursor={setCursorDistance}
              showXAxis={false}
            />
            <DistanceCompareChart
              label="Freno (%)"
              data={alignedData}
              fieldYou="brake_you"
              fieldRef="brake_ref"
              youColor={youColorHex}
              refColor={refColorHex}
              youName={youAcr}
              refName={refAcr}
              height={90}
              unit="%"
              yDomain={[0, 100]}
              cursor={cursorDistance}
              onCursor={setCursorDistance}
              showXAxis={true}
            />
            <div className="text-[10px] text-muted-foreground leading-snug flex gap-1.5">
              <Info className="h-3 w-3 flex-shrink-0 mt-px" />
              <span>
                I due tracciati sono allineati sulla <strong>distanza percorsa in pista</strong> (posizione lungo il giro),
                così da confrontare i piloti nello stesso punto del tracciato. La distanza è <strong>stimata</strong>{" "}
                integrando la velocità nel tempo (OpenF1 non fornisce un canale distanza diretto), quindi è soggetta a
                piccole imprecisioni dovute al campionamento. L'allineamento è limitato alla porzione di giro coperta
                da entrambi i tracciati.
              </span>
            </div>
          </>
        )}
      </AccordionContent>
    </AccordionItem>
  );
}
