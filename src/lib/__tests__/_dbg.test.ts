import { test } from "vitest";
import { calculateCorrectedTyreDegradation } from "../correctedDegradation";
import { adaptLapsToPostRace, adaptStintsToPostRace } from "../liveDataBridge";
test("dbg", () => {
  const pattern = [0, 0.08, 0.20, 0.25, 0.40, 0.48, 0.65, 0.72, 0.90, 1.00, 1.20, 1.30];
  const laps = Array.from({length:12},(_,i)=>({driver_number:1,lap_number:i+1,lap_duration:90+pattern[i],duration_sector_1:null,duration_sector_2:null,duration_sector_3:null,st_speed:null}));
  const stints = [{driver_number:1,stint_number:1,compound:"MEDIUM",tyre_age_at_start:0,lap_start:1,lap_end:null}];
  const al = adaptLapsToPostRace(laps as any, [], 1);
  const as = adaptStintsToPostRace(stints as any, 10, 1);
  const r = calculateCorrectedTyreDegradation(1,"TST","#fff",al,as,[],50);
  console.log(JSON.stringify(r.map(x=>({stint:x.stint,rSquared:x.rSquared,slope_corrected:x.slope_corrected,model_type:x.model_type,lapsUsed:x.lapsUsed,filterSummary:x.filterSummary})),null,2));
});
