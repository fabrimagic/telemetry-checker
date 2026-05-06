import { test } from "vitest";
import { calculateCorrectedTyreDegradation } from "../src/lib/correctedDegradation";
import { adaptLapsToPostRace, adaptStintsToPostRace } from "../src/lib/liveDataBridge";
test("dbg", () => {
  const laps = Array.from({length:10},(_,i)=>({driver_number:1,lap_number:i+1,lap_duration:90+(i+1)*0.05,duration_sector_1:null,duration_sector_2:null,duration_sector_3:null,st_speed:null}));
  const stints = [{driver_number:1,stint_number:1,compound:"MEDIUM",tyre_age_at_start:0,lap_start:1,lap_end:null}];
  const al = adaptLapsToPostRace(laps as any, [], 1);
  const as = adaptStintsToPostRace(stints as any, 10, 1);
  const r = calculateCorrectedTyreDegradation(1,"TST","#fff",al,as,[],50);
  console.log(JSON.stringify(r.map(x=>({stint:x.stint,rSquared:x.rSquared,slope_corrected:x.slope_corrected,model_type:x.model_type,lapsUsed:x.lapsUsed,filterSummary:x.filterSummary})),null,2));
});
