import { test } from "vitest";
import { calculateCorrectedTyreDegradation } from "../correctedDegradation";
import { adaptLapsToPostRace, adaptStintsToPostRace } from "../liveDataBridge";
test("dbg", () => {
  // Quadratic degradation: linear part absorbed by fuel, quadratic remains as residual.
  const dur = Array.from({length:12},(_,i)=>{const t=i; return 90 + 0.05*t + 0.01*t*t;});
  const laps = dur.map((d,i)=>({driver_number:1,lap_number:i+1,lap_duration:d,duration_sector_1:null,duration_sector_2:null,duration_sector_3:null,st_speed:null}));
  const stints = [{driver_number:1,stint_number:1,compound:"MEDIUM",tyre_age_at_start:0,lap_start:1,lap_end:null}];
  const al = adaptLapsToPostRace(laps as any, [], 1);
  const as = adaptStintsToPostRace(stints as any, 12, 1);
  const r = calculateCorrectedTyreDegradation(1,"TST","#fff",al,as,[],50);
  console.log("slope_corr", r[0]?.slope_corrected, "rSq", r[0]?.rSquared, "slope_raw", r[0]?.slope_raw);
});
