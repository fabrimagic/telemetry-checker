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
import {
  isNeutralizationDeployment,
  isSafetyCarDeployment,
  isVirtualSafetyCarDeployment,
  isPenaltyOrProcedureContext,
} from "./trackStatusClassification";

// ── Severity / Relevance / Confidence ────────────────────────

export type SeverityLevel = "LOW" | "MEDIUM" | "HIGH";
export type StrategicRelevance = "LOW" | "MEDIUM" | "HIGH";
export type ConfidenceLevel = "LOW" | "MEDIUM" | "HIGH";

/** Tags describing the operational domain an event impacts */
export type ImpactTag =
  | "track_position"
  | "pit_cycle"
  | "traffic"
  | "neutralization"
  | "tyre_management"
  | "race_control"
  | "safety";

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
  /** Operational severity: how impactful is this event on race outcome */
  severity?: SeverityLevel;
  /** How relevant is this event for strategy decisions */
  strategic_relevance?: StrategicRelevance;
  /** Confidence in the accuracy of this event's data */
  confidence?: ConfidenceLevel;
  /** Operational domains this event touches */
  impact_tags?: ImpactTag[];
  /** IDs of temporally/logically linked events in the same episode */
  linked_event_ids?: string[];
  /** Episode grouping identifier — events sharing this ID are related */
  episode_id?: string | null;
  /** Stable identifier for cross-referencing */
  _id?: string;
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

/** Generate a stable event ID from type + timestamp */
function makeEventId(type: string, date: string, suffix?: string): string {
  const ts = new Date(date).getTime();
  return `${type}_${ts}${suffix ? `_${suffix}` : ""}`;
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
    const posAfter = o.position;
    // High severity for moves into top-5; medium for top-10
    const severity: SeverityLevel = posAfter <= 3 ? "HIGH" : posAfter <= 10 ? "MEDIUM" : "LOW";
    const relevance: StrategicRelevance = posAfter <= 5 ? "HIGH" : "MEDIUM";

    events.push({
      type: "OVERTAKE_DONE",
      date: o.date,
      lapNumber: null,
      description: `Sorpasso su ${driverLabel(o.overtaken_driver_number, allDrivers)} → P${posAfter}`,
      details: {
        targetDriver: o.overtaken_driver_number,
        targetAcronym: driverLabel(o.overtaken_driver_number, allDrivers),
        positionAfter: posAfter,
      },
      severity,
      strategic_relevance: relevance,
      confidence: "HIGH", // overtake data from official feed
      impact_tags: ["track_position"],
      _id: makeEventId("OVT_DONE", o.date, String(o.overtaken_driver_number)),
    });
  }

  for (const o of overtakesReceived) {
    const posAfter = o.position + 1;
    const severity: SeverityLevel = posAfter <= 3 ? "HIGH" : posAfter <= 10 ? "MEDIUM" : "LOW";

    events.push({
      type: "OVERTAKE_RECEIVED",
      date: o.date,
      lapNumber: null,
      description: `Sorpassato da ${driverLabel(o.overtaking_driver_number, allDrivers)}`,
      details: {
        targetDriver: o.overtaking_driver_number,
        targetAcronym: driverLabel(o.overtaking_driver_number, allDrivers),
        positionAfter: posAfter,
      },
      severity,
      strategic_relevance: posAfter <= 5 ? "HIGH" : "MEDIUM",
      confidence: "HIGH",
      impact_tags: ["track_position"],
      _id: makeEventId("OVT_RECV", o.date, String(o.overtaking_driver_number)),
    });
  }

  return events;
}

// ── Race Control events for driver ───────────────────────────

/** Classify race control message severity and tags from message text and flag */
function classifyRaceControl(
  msg: string,
  flag: string | undefined,
): { severity: SeverityLevel; relevance: StrategicRelevance; tags: ImpactTag[] } {
  const upper = (msg || "").toUpperCase();
  const upperFlag = (flag || "").toUpperCase();
  const tags: ImpactTag[] = ["race_control"];

  // Safety Car / Red Flag → high severity, neutralization (real deployments only)
  if (
    upperFlag.includes("RED") ||
    upper.includes("RED FLAG")
  ) {
    tags.push("neutralization", "safety");
    return { severity: "HIGH", relevance: "HIGH", tags };
  }
  if (
    isSafetyCarDeployment(upper, upperFlag) ||
    isVirtualSafetyCarDeployment(upper, upperFlag)
  ) {
    tags.push("neutralization", "safety");
    return { severity: "HIGH", relevance: "HIGH", tags };
  }

  // Penalties / investigations (incl. mentions like "SAFETY CAR INFRINGEMENT")
  if (
    isPenaltyOrProcedureContext(upper) ||
    upper.includes("PENALTY") ||
    upper.includes("INVESTIGATION") ||
    upper.includes("NOTED")
  ) {
    return { severity: "MEDIUM", relevance: "MEDIUM", tags };
  }

  // Track limits / warnings
  if (upper.includes("TRACK LIMITS") || upper.includes("WARNING") || upper.includes("BLACK AND WHITE")) {
    return { severity: "LOW", relevance: "LOW", tags };
  }

  // DRS enabled/disabled affects traffic picture
  if (upper.includes("DRS")) {
    tags.push("traffic");
    return { severity: "LOW", relevance: "MEDIUM", tags };
  }

  return { severity: "LOW", relevance: "LOW", tags };
}

/**
 * Precise check that a Race Control message text refers to a specific driver.
 * Avoids false positives from naive substring includes (e.g. "CAR 14" matching driver 4,
 * "TURN 4", "14:32" timestamps, etc.). Matches only:
 *  - "CAR <num>" as a delimited token (word-boundary on the number)
 *  - "DRIVER <num>" as a delimited token
 *  - The driver's broadcast acronym in parentheses "(ACR)"
 */
export function messageMentionsDriver(
  text: string,
  driverNumber: number,
  driverAcronym?: string | null,
): boolean {
  if (!text) return false;
  const upper = text.toUpperCase();
  const num = String(driverNumber);
  // \b doesn't behave well across all digit edges in some engines, use explicit
  // boundaries: non-digit (or start/end) on both sides.
  const numPattern = new RegExp(`(?:^|[^0-9])(?:CAR|DRIVER)\\s+${num}(?:$|[^0-9])`, "i");
  if (numPattern.test(upper)) return true;
  if (driverAcronym) {
    const acr = driverAcronym.toUpperCase();
    if (upper.includes(`(${acr})`)) return true;
  }
  return false;
}

export function getRaceControlEvents(
  driverNumber: number,
  messages: RaceControlMessage[],
  laps: Lap[],
  driverAcronym?: string | null,
): DiaryEvent[] {
  return messages
    .filter((m) => {
      const text = (m.message || "").toUpperCase();
      const mentionsDriver = messageMentionsDriver(text, driverNumber, driverAcronym);
      // Track-wide only for *real* deployments (SC/VSC/RED). Mentions in
      // penalty/procedure messages (e.g. "SAFETY CAR INFRINGEMENT") do not
      // make the message track-wide.
      const isTrackWide = isNeutralizationDeployment(text, m.flag);
      return mentionsDriver || isTrackWide;
    })
    .map((m) => {
      const classification = classifyRaceControl(m.message, m.flag);
      // Track-wide events have lower confidence for driver-specific impact
      const mentionsDriver = messageMentionsDriver(m.message || "", driverNumber, driverAcronym);

      return {
        type: "RACE_CONTROL" as const,
        date: m.date,
        lapNumber: lapForDate(m.date, laps),
        description: m.message,
        details: {
          category: m.category,
          flag: m.flag,
        },
        severity: classification.severity,
        strategic_relevance: classification.relevance,
        confidence: mentionsDriver ? "HIGH" as ConfidenceLevel : "MEDIUM" as ConfidenceLevel,
        impact_tags: classification.tags,
        _id: makeEventId("RC", m.date, m.flag || "msg"),
      };
    });
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
      const stintAfter = stints.find(
        (s) => s.driver_number === driverNumber && s.lap_start === p.lap_number + 1
      );
      const compound = stintAfter?.compound || "?";
      const stopDur = p.stop_duration != null ? `${p.stop_duration.toFixed(1)}s` : "—";

      // Slow stops are operationally significant
      const isSlow = p.stop_duration != null && p.stop_duration > 4.0;
      const severity: SeverityLevel = isSlow ? "HIGH" : "MEDIUM";

      const tags: ImpactTag[] = ["pit_cycle", "tyre_management"];
      if (isSlow) tags.push("traffic"); // slow stop likely causes rejoin in traffic

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
        severity,
        strategic_relevance: "HIGH" as StrategicRelevance, // every pit stop is strategically relevant
        confidence: "HIGH" as ConfidenceLevel,
        impact_tags: tags,
        _id: makeEventId("PIT", p.date, String(p.lap_number)),
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

/** Classify a battle episode with metadata derived from its observed properties */
function classifyBattle(ep: BattleEpisode): {
  severity: SeverityLevel;
  relevance: StrategicRelevance;
  confidence: ConfidenceLevel;
  tags: ImpactTag[];
} {
  const tags: ImpactTag[] = ["traffic"];

  // Duration-based severity: long battles are more impactful
  const isLong = ep.durationSeconds >= 30;
  const isVeryLong = ep.durationSeconds >= 60;
  const isClose = ep.minGap < 0.5;

  let severity: SeverityLevel = "LOW";
  if (isVeryLong || (isLong && isClose)) severity = "HIGH";
  else if (isLong || isClose) severity = "MEDIUM";

  // Defending battles near other cars affect position
  if (ep.battleType === "DEFENDING" || ep.battleType === "BOTH") {
    tags.push("track_position");
  }

  // Strategic relevance: longer and closer battles are more relevant
  const relevance: StrategicRelevance =
    isVeryLong || isClose ? "HIGH" : isLong ? "MEDIUM" : "LOW";

  // Confidence: interval data is reliable but position matching is approximate
  const confidence: ConfidenceLevel = isLong ? "HIGH" : "MEDIUM";

  return { severity, relevance, confidence, tags };
}

export function getBattleEvents(
  driverNumber: number,
  intervals: IntervalData[],
  positions: PositionData[],
  allDrivers: Driver[],
  laps: Lap[],
): DiaryEvent[] {
  if (!intervals.length || !positions.length) return [];

  const sorted = [...intervals].sort((a, b) => a.date.localeCompare(b.date));

  const posMap = new Map<string, Map<number, number>>();
  for (const p of positions) {
    if (!posMap.has(p.date)) posMap.set(p.date, new Map());
    posMap.get(p.date)!.set(p.driver_number, p.position);
  }

  const ivlMap = new Map<string, Map<number, number>>();
  for (const iv of sorted) {
    const gap = typeof iv.interval === "number" ? iv.interval : null;
    if (gap == null) continue;
    if (!ivlMap.has(iv.date)) ivlMap.set(iv.date, new Map());
    ivlMap.get(iv.date)!.set(iv.driver_number, gap);
  }

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

  const latestPos = new Map<number, number>();

  for (const iv of driverIntervals) {
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

    if (myInterval != null && myInterval < BATTLE_GAP && myInterval > 0) {
      attacking = true;
      minGapSample = Math.min(minGapSample, myInterval);
      if (myPos != null) {
        for (const [dn, pos] of latestPos) {
          if (pos === myPos - 1) { aheadDriver = dn; break; }
        }
      }
    }

    if (myPos != null) {
      for (const [dn, pos] of latestPos) {
        if (pos === myPos + 1) {
          behindDriver = dn;
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
      const dur = (new Date(currentEpisode.endDate).getTime() - new Date(currentEpisode.startDate).getTime()) / 1000;
      if (dur >= 5) {
        const bt: BattleType =
          currentEpisode.type.has("ATTACKING") && currentEpisode.type.has("DEFENDING")
            ? "BOTH"
            : currentEpisode.type.has("ATTACKING")
            ? "ATTACKING"
            : "DEFENDING";

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

    const classification = classifyBattle(ep);

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
      severity: classification.severity,
      strategic_relevance: classification.relevance,
      confidence: classification.confidence,
      impact_tags: classification.tags,
      _id: makeEventId("BATTLE", ep.startDate, `${ep.battleType}_${Math.round(ep.durationSeconds)}`),
    };
  });
}

// ── Episode grouping ─────────────────────────────────────────

/** Window (seconds) within which events on the same lap are grouped into an episode */
const EPISODE_TIME_WINDOW_S = 15;

/**
 * Assign episode_id to events that are temporally close (within EPISODE_TIME_WINDOW_S)
 * and share the same lap. Does NOT infer causality — only proximity grouping.
 */
function assignEpisodes(events: DiaryEvent[]): void {
  if (events.length < 2) return;

  let episodeCounter = 0;
  let currentEpisodeId: string | null = null;
  let currentEpisodeEvents: DiaryEvent[] = [];
  let lastTimestamp = 0;
  let lastLap: number | null = null;

  for (const ev of events) {
    const ts = new Date(ev.date).getTime();
    const sameLap = ev.lapNumber != null && ev.lapNumber === lastLap;
    const closeInTime = Math.abs(ts - lastTimestamp) <= EPISODE_TIME_WINDOW_S * 1000;

    if (sameLap && closeInTime && currentEpisodeId) {
      // Continue current episode
      ev.episode_id = currentEpisodeId;
      currentEpisodeEvents.push(ev);
    } else if (sameLap && closeInTime) {
      // Start new episode from previous event
      episodeCounter++;
      currentEpisodeId = `EP_${episodeCounter}`;
      // Tag previous event too
      if (currentEpisodeEvents.length === 0 && events.indexOf(ev) > 0) {
        const prev = events[events.indexOf(ev) - 1];
        if (prev.lapNumber === ev.lapNumber) {
          prev.episode_id = currentEpisodeId;
          currentEpisodeEvents.push(prev);
        }
      }
      ev.episode_id = currentEpisodeId;
      currentEpisodeEvents.push(ev);
    } else {
      // Finalize previous episode — assign linked_event_ids
      if (currentEpisodeEvents.length >= 2) {
        const ids = currentEpisodeEvents.map((e) => e._id).filter(Boolean) as string[];
        for (const e of currentEpisodeEvents) {
          e.linked_event_ids = ids.filter((id) => id !== e._id);
        }
      }
      currentEpisodeId = null;
      currentEpisodeEvents = [];
    }

    lastTimestamp = ts;
    lastLap = ev.lapNumber;
  }

  // Finalize last episode
  if (currentEpisodeEvents.length >= 2) {
    const ids = currentEpisodeEvents.map((e) => e._id).filter(Boolean) as string[];
    for (const e of currentEpisodeEvents) {
      e.linked_event_ids = ids.filter((id) => id !== e._id);
    }
  }
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
  const driverAcr = allDrivers.find((d) => d.driver_number === driverNumber)?.name_acronym ?? null;
  const events: DiaryEvent[] = [
    ...getOvertakeEvents(driverNumber, overtakesDone, overtakesReceived, allDrivers),
    ...getRaceControlEvents(driverNumber, raceControlMessages, laps, driverAcr),
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

  // Assign episode grouping based on temporal proximity
  assignEpisodes(events);

  return events;
}
