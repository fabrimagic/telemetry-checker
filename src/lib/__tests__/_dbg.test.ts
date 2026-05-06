import { test } from "vitest";
import { calculateCorrectedTyreDegradation } from "../correctedDegradation";
import { adaptLapsToPostRace, adaptStintsToPostRace } from "../liveDataBridge";
test("dbg", () => {
  // Quadratic-ish degradation pattern + 12 laps to break collinearity with linear fuel proxy
  const dur = [90.0, 90.05, 90.15, 90.3, 90.5, 90.75, 91.05, 91.4, 91.8, 92.25, 92.75, 93.3];
  const laps = dur.map((d,i)=>({driver_number:1,lap_number:i+1,lap_duration:d,duration_sector_1:null,duration_sector_2:null,duration_sector_3:null,st_speed:null}));
  const stints = [{driver_number:1,stint_number:1,compound:"MEDIUM",tyre_age_at_start:0,lap_start:1,lap_end:null}];
  const al = adaptLapsToPostRace(laps as any, [], 1);
  const as = adaptStintsToPostRace(stints as any, 12, 1);
  const r = calculateCorrectedTyreDegradation(1,"TST","#fff",al,as,[],50);
  console.log(JSON.stringify(r,null,2));
});
