# Pitwall AI — Race Telemetry & Strategy Analysis

Pitwall AI is a post-race / live-race analytics platform built on the OpenF1
public telemetry stream. It reconstructs each driver's race story —
degradation, fuel-corrected pace, pit windows, traffic, neutralisations —
and renders a structured narrative through a Virtual Race Engineer (VRE)
view.

This README documents the **fuel proxy models** used by the corrected
degradation engine. For everything else (architecture, UI, deploy), see the
in-repo memory under `.lovable/memory/`.

---

## Fuel Proxy Models

OpenF1 does not expose real fuel mass per lap. The corrected tyre
degradation regression (`src/lib/correctedDegradation.ts`) therefore needs
a **proxy** for the time-varying fuel load — a feature that decreases
monotonically over the race and is **not collinear** with `tyre_life`,
otherwise the multivariate fit becomes degenerate and Stage A collapses
into noise.

Four proxies are supported via `CorrectedDegradationConfig.fuel_proxy_type`:

| Type | Formula | Required data | Quality | Trade-off |
|---|---|---|---|---|
| `laps_remaining` *(default)* | `totalLaps − lap_number` | `Lap` only | typically `MEDIUM` | Trivially available, but **perfectly collinear with `tyre_life` within a stint** — the very degeneracy this module exists to fight. Kept as the safe default while we validate `throttle_integral` on real sessions. |
| `lap_number` | `lap_number` | `Lap` only | typically `MEDIUM` | Same collinearity pathology as `laps_remaining`, just with the opposite sign. |
| `st_speed` | `lap.st_speed` (km/h, speed-trap) | `Lap.st_speed` (often present) | `LOW`–`HIGH` depending on circuit | Decorrelates from `tyre_life`, but speed-trap value reflects setup, slipstream and tyre state simultaneously — the "fuel" signal is faint. Coverage is reported per stint via `st_speed_coverage`. |
| `throttle_integral` | `totalEstimatedWork − Σ ∫(throttle × rpm) dt` | `CarData` (extra fetch) | `LOW`–`HIGH` depending on coverage | **Physically motivated** (mechanical work proxies fuel burn). Decouples cleanly from `tyre_life`. Cost: one additional `/car_data` request per driver/session (~thousands of samples). Falls back silently if the fetch fails or per-lap coverage is < 50%. |

### Defaults and rollout

`DEFAULT_CORRECTED_CONFIG.fuel_proxy_type === "laps_remaining"`.

The default is intentionally unchanged in this PR. The `throttle_integral`
proxy is shipped as opt-in infrastructure: the loader (`vreLoader.ts`)
already fetches CarData and computes `LapWorkEstimate[]`, and the corrected
degradation engine accepts a `FuelProxyContext` to consume it. **Switching
the default to `throttle_integral` will be a separate PR**, gated on:

1. Validation of `slope_corrected` agreement on a curated set of real
   sessions (Monza, Monaco, Spa, Suzuka, Singapore — varied throttle
   profiles).
2. Per-stint coverage analysis (we want `coverage ≥ 0.7` on the median
   stint before making it the default).
3. Snapshot regeneration for `narrativeBaseline.test.ts`, with a manual
   diff review of the user-facing strings.

### Rate-limit notes

The `/car_data` endpoint returns the heaviest payloads in the OpenF1
catalogue (~3.7 Hz × race duration × N drivers). The loader:

- Issues **one** `getCarData(sessionKey, driverNumber, start, end)` call per
  driver/session.
- Wraps the call in a try/catch — if it fails (timeout, 429, network), the
  VRE pipeline continues with `lapWorkEstimates = undefined` and the
  corrected degradation falls back to the configured default proxy.
- Does **not** block the rest of the analysis on the CarData fetch in any
  failure mode.

For head-to-head (two drivers in parallel), this means **2 extra requests
per comparison**, slotted by the rate-limiter in `openf1.ts`. We have not
observed this to push us over OpenF1's burst limits.

### Implementation entry points

- `src/lib/fuelEstimator.ts` — pure, no I/O. Exposes `estimateLapWork`,
  `buildThrottleIntegralProxy`, `estimateTotalWork`.
- `src/lib/correctedDegradation.ts` — `buildFuelProxy(lap, totalLaps, type, context?)`
  delegates to the estimator when `type === "throttle_integral"`.
- `src/lib/virtualRaceEngineer.ts` — accepts optional `lapWorkEstimates` /
  `totalEstimatedWork` parameters and forwards them as `FuelProxyContext`.
- `src/lib/vreLoader.ts` — owns the CarData fetch and the
  `estimateLapWork` + `estimateTotalWork` call site.

### Tests

- `src/lib/__tests__/fuelProxy.test.ts` — unit tests for `buildFuelProxy`
  across all four proxy types.
- `src/lib/__tests__/fuelEstimator.test.ts` — unit tests for the work
  integral, gap handling, and the proxy builder.
- `src/lib/__tests__/narrativeBaseline.test.ts` — golden-master snapshot
  of VRE narrative output. Must remain bit-identical until the default
  proxy is switched.
