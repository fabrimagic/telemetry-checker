import type {
  OvertakeData,
  RaceControlMessage,
  PitData,
  StintData,
  IntervalData,
  PositionData,
  Driver,
  Lap,
} from "./openf1";

// ── Event types ──────────────────────────────────────────────

export type DiaryEventType =
  | "OVERTAKE_DONE"
  | "OVERTAKE_RECEIVED"
  | "RACE_CONTROL"
  | "PIT_STOP"
  | "BATTLE";

export type BattleType = "ATTACKING" | "DEFENDING" | "BOTH";

export interface DiaryEvent {
  type: DiaryEventType;
  date: string;
  lapNumber: number | null;
  description: string;
  details: Record<string, any>;
}

// ── Helpers ──────────────────────────────────────────────────

function driverLabel(num: number, drivers: Driver[]): string {
  const d = drivers.find((dr) => dr.driver_number === num);
  return d ? d.name_acronym : `#${num}`;
}

function lapForDate(date: string, laps: Lap[]): number | null {
  const t = new Date(date).getTime();
  for (const lap of laps) {
    if (!lap.date_start || !lap.lap_duration) continue;
    const start = new Date(lap.date_start).getTime();
    const end = start + lap.lap_duration * 1000;
    if (t >= start && t <= end) return lap.lap_number;
  }
  return null;
}

// ── Overtake events ──────────────────────────────────────────

export function getOvertakeEvents(
  driverNumber: number,
  overtakesDone: OvertakeData[],
  overtakesReceived: OvertakeData[],
  allDrivers: Driver[],
): DiaryEvent[] {
  const events: DiaryEvent[] = [];

  for (const o of overtakesDone) {
    events.push({
      type: "OVERTAKE_DONE",
      date: o.date,
      lapNumber: null, // will be resolved later if laps available
      description: `Sorpasso su ${driverLabel(o.overtaken_driver_number, allDrivers)} → P${o.position}`,
      details: {
        targetDriver: o.overtaken_driver_number,
        targetAcronym: driverLabel(o.overtaken_driver_number, allDrivers),
        positionAfter: o.position,
      },
    });
  }

  for (const o of overtakesReceived) {
    events.push({
      type: "OVERTAKE_RECEIVED",
      date: o.date,
      lapNumber: null,
      description: `Sorpassato da ${driverLabel(o.overtaking_driver_number, allDrivers)}`,
      details: {
        targetDriver: o.overtaking_driver_number,
        targetAcronym: driverLabel(o.overtaking_driver_number, allDrivers),
        positionAfter: o.position + 1, // driver lost a position
      },
    });
  }

  return events;
}

// ── Race Control events for driver ───────────────────────────

export function getRaceControlEvents(
  driverNumber: number,
  messages: RaceControlMessage[],
  laps: Lap[],
): DiaryEvent[] {
  return messages
    .filter((m) => {
      const text = (m.message || "").toUpperCase();
      // Include messages that mention driver number or are track-wide important
      const num = String(driverNumber);
      const mentionsDriver = text.includes(num) || text.includes(`CAR ${num}`);
      // Also include track-wide flags (SC, VSC, Red)
      const isTrackWide =
        (m.flag && ["RED", "SAFETY CAR", "VSC"].some((f) => (m.flag || "").toUpperCase().includes(f))) ||
        text.includes("SAFETY CAR") ||
        text.includes("VIRTUAL SAFETY CAR") ||
        text.includes("RED FLAG");
      return mentionsDriver || isTrackWide;
    })
    .map((m) => ({
      type: "RACE_CONTROL" as const,
      date: m.date,
      lapNumber: lapForDate(m.date, laps),
      description: m.message,
      details: {
        category: m.category,
        flag: m.flag,
      },
    }));
}

// ── Pit Stop events ──────────────────────────────────────────

export function getPitEvents(
  driverNumber: number,
  pitStops: PitData[],
  stints: StintData[],
): DiaryEvent[] {
  return pitStops
    .filter((p) => p.driver_number === driverNumber)
    .map((p) => {
      // Find compound after pit
      const stintAfter = stints.find(
        (s) => s.driver_number === driverNumber && s.lap_start === p.lap_number + 1
      );
      const compound = stintAfter?.compound || "?";
      const stopDur = p.stop_duration != null ? `${p.stop_duration.toFixed(1)}s` : "—";

      return {
        type: "PIT_STOP" as const,
        date: p.date,
        lapNumber: p.lap_number,
        description: `Pit stop → ${compound} (sosta ${stopDur})`,
        details: {
          laneDuration: p.lane_duration,
          stopDuration: p.stop_duration,
          compound,
        },
      };
    });
}

// ── Battle detection ─────────────────────────────────────────

interface BattleEpisode {
  battleType: BattleType;
  startDate: string;
  endDate: string;
  startLap: number | null;
  endLap: number | null;
  driverAhead: string | null;
  driverBehind: string | null;
  minGap: number;
  durationSeconds: number;
}

export function getBattleEvents(
  driverNumber: number,
  intervals: IntervalData[],
  positions: PositionData[],
  allDrivers: Driver[],
  laps: Lap[],
): DiaryEvent[] {
  if (!intervals.length || !positions.length) return [];

  // Sort intervals by date
  const sorted = [...intervals].sort((a, b) => a.date.localeCompare(b.date));

  // Get unique timestamps from positions
  const posMap = new Map<string, Map<number, number>>(); // date -> (driver -> position)
  for (const p of positions) {
    if (!posMap.has(p.date)) posMap.set(p.date, new Map());
    posMap.get(p.date)!.set(p.driver_number, p.position);
  }

  // Build interval map: date -> (driver -> interval_to_car_ahead)
  const ivlMap = new Map<string, Map<number, number>>();
  for (const iv of sorted) {
    const gap = typeof iv.interval === "number" ? iv.interval : null;
    if (gap == null) continue;
    if (!ivlMap.has(iv.date)) ivlMap.set(iv.date, new Map());
    ivlMap.get(iv.date)!.set(iv.driver_number, gap);
  }

  // Sample timestamps where our driver has interval data
  const driverIntervals = sorted.filter((iv) => iv.driver_number === driverNumber);

  const BATTLE_GAP = 1.0;
  const episodes: BattleEpisode[] = [];
  let currentEpisode: {
    startDate: string;
    endDate: string;
    type: Set<"ATTACKING" | "DEFENDING">;
    ahead: number | null;
    behind: number | null;
    minGap: number;
  } | null = null;

  // Track latest known positions
  const latestPos = new Map<number, number>();

  for (const iv of driverIntervals) {
    const t = new Date(iv.date).getTime();
    // Update positions from nearest position data
    const posEntry = posMap.get(iv.date);
    if (posEntry) {
      for (const [dn, pos] of posEntry) latestPos.set(dn, pos);
    }

    const myPos = latestPos.get(driverNumber);
    const myInterval = typeof iv.interval === "number" ? iv.interval : null;

    let attacking = false;
    let defending = false;
    let aheadDriver: number | null = null;
    let behindDriver: number | null = null;
    let minGapSample = Infinity;

    // Attacking: my interval to car ahead < 1s
    if (myInterval != null && myInterval < BATTLE_GAP && myInterval > 0) {
      attacking = true;
      minGapSample = Math.min(minGapSample, myInterval);
      // Find car ahead
      if (myPos != null) {
        for (const [dn, pos] of latestPos) {
          if (pos === myPos - 1) { aheadDriver = dn; break; }
        }
      }
    }

    // Defending: car behind has interval < 1s to me
    if (myPos != null) {
      for (const [dn, pos] of latestPos) {
        if (pos === myPos + 1) {
          behindDriver = dn;
          // Find that driver's interval
          const behindIv = ivlMap.get(iv.date)?.get(dn);
          if (behindIv != null && behindIv < BATTLE_GAP && behindIv > 0) {
            defending = true;
            minGapSample = Math.min(minGapSample, behindIv);
          }
          break;
        }
      }
    }

    const inBattle = attacking || defending;

    if (inBattle) {
      if (!currentEpisode) {
        currentEpisode = {
          startDate: iv.date,
          endDate: iv.date,
          type: new Set(),
          ahead: aheadDriver,
          behind: behindDriver,
          minGap: minGapSample,
        };
      }
      currentEpisode.endDate = iv.date;
      if (attacking) currentEpisode.type.add("ATTACKING");
      if (defending) currentEpisode.type.add("DEFENDING");
      if (aheadDriver) currentEpisode.ahead = aheadDriver;
      if (behindDriver) currentEpisode.behind = behindDriver;
      currentEpisode.minGap = Math.min(currentEpisode.minGap, minGapSample);
    } else if (currentEpisode) {
      // Close episode
      const dur = (new Date(currentEpisode.endDate).getTime() - new Date(currentEpisode.startDate).getTime()) / 1000;
      if (dur >= 5) { // Only keep battles lasting at least 5 seconds
        const bt: BattleType =
          currentEpisode.type.has("ATTACKING") && currentEpisode.type.has("DEFENDING")
            ? "BOTH"
            : currentEpisode.type.has("ATTACKING")
            ? "ATTACKING"
            : "DEFENDING";

        const target = bt === "DEFENDING"
          ? currentEpisode.behind
          : currentEpisode.ahead;
        const targetLabel = target ? driverLabel(target, allDrivers) : "?";

        episodes.push({
          battleType: bt,
          startDate: currentEpisode.startDate,
          endDate: currentEpisode.endDate,
          startLap: lapForDate(currentEpisode.startDate, laps),
          endLap: lapForDate(currentEpisode.endDate, laps),
          driverAhead: currentEpisode.ahead ? driverLabel(currentEpisode.ahead, allDrivers) : null,
          driverBehind: currentEpisode.behind ? driverLabel(currentEpisode.behind, allDrivers) : null,
          minGap: currentEpisode.minGap,
          durationSeconds: dur,
        });
      }
      currentEpisode = null;
    }
  }

  // Close any remaining episode
  if (currentEpisode) {
    const ce = currentEpisode;
    const dur = (new Date(ce.endDate).getTime() - new Date(ce.startDate).getTime()) / 1000;
    if (dur >= 5) {
      const bt: BattleType =
        ce.type.has("ATTACKING") && ce.type.has("DEFENDING")
          ? "BOTH"
          : ce.type.has("ATTACKING")
          ? "ATTACKING"
          : "DEFENDING";
      episodes.push({
        battleType: bt,
        startDate: ce.startDate,
        endDate: ce.endDate,
        startLap: lapForDate(ce.startDate, laps),
        endLap: lapForDate(ce.endDate, laps),
        driverAhead: ce.ahead ? driverLabel(ce.ahead, allDrivers) : null,
        driverBehind: ce.behind ? driverLabel(ce.behind, allDrivers) : null,
        minGap: ce.minGap,
        durationSeconds: dur,
      });
    }
  }

  // Convert to diary events
  return episodes.map((ep) => {
    const typeLabel =
      ep.battleType === "ATTACKING" ? "Attacco" : ep.battleType === "DEFENDING" ? "Difesa" : "Attacco/Difesa";
    const target =
      ep.battleType === "DEFENDING" ? ep.driverBehind : ep.driverAhead;
    const lapRange =
      ep.startLap != null && ep.endLap != null
        ? ep.startLap === ep.endLap
          ? `Giro ${ep.startLap}`
          : `Giri ${ep.startLap}–${ep.endLap}`
        : "";

    return {
      type: "BATTLE" as const,
      date: ep.startDate,
      lapNumber: ep.startLap,
      description: `${typeLabel} con ${target || "?"} ${lapRange} — gap min ${ep.minGap.toFixed(2)}s (${Math.round(ep.durationSeconds)}s)`,
      details: {
        battleType: ep.battleType,
        startLap: ep.startLap,
        endLap: ep.endLap,
        driverAhead: ep.driverAhead,
        driverBehind: ep.driverBehind,
        minGap: ep.minGap,
        durationSeconds: ep.durationSeconds,
      },
    };
  });
}

// ── Main diary builder ───────────────────────────────────────

export function buildRaceDiary(
  driverNumber: number,
  overtakesDone: OvertakeData[],
  overtakesReceived: OvertakeData[],
  raceControlMessages: RaceControlMessage[],
  pitStops: PitData[],
  stints: StintData[],
  intervals: IntervalData[],
  positions: PositionData[],
  allDrivers: Driver[],
  laps: Lap[],
): DiaryEvent[] {
  const events: DiaryEvent[] = [
    ...getOvertakeEvents(driverNumber, overtakesDone, overtakesReceived, allDrivers),
    ...getRaceControlEvents(driverNumber, raceControlMessages, laps),
    ...getPitEvents(driverNumber, pitStops, stints),
    ...getBattleEvents(driverNumber, intervals, positions, allDrivers, laps),
  ];

  // Resolve lap numbers for overtake events
  for (const e of events) {
    if (e.lapNumber == null && e.date) {
      e.lapNumber = lapForDate(e.date, laps);
    }
  }

  // Sort chronologically
  events.sort((a, b) => a.date.localeCompare(b.date));

  return events;
}
