import { describe, it, expect } from "vitest";
import { alignShapes, mapLocationsToOutlineIndices } from "../cornerAnalysis";

/** Build a synthetic L-shape outline of arbitrary, well-defined orientation. */
function lShape(): { x: number; y: number }[] {
  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i < 20; i++) pts.push({ x: i, y: 0 });
  for (let i = 1; i < 12; i++) pts.push({ x: 19, y: i });
  return pts;
}

function rotate(pts: { x: number; y: number }[], rad: number, sx = 1, sy = 1) {
  const c = Math.cos(rad), s = Math.sin(rad);
  return pts.map((p) => ({
    x: sx * (c * p.x - s * p.y),
    y: sy * (s * p.x + c * p.y),
  }));
}

function reflectX(pts: { x: number; y: number }[]) {
  return pts.map((p) => ({ x: -p.x, y: p.y }));
}

function translateScale(pts: { x: number; y: number }[], k: number, tx: number, ty: number) {
  return pts.map((p) => ({ x: k * p.x + tx, y: k * p.y + ty }));
}

describe("alignShapes (Procrustes)", () => {
  it("(a) recovers a known rotation (and translation+scale) with ~zero residual", () => {
    const target = lShape();
    // Rotate by 90°, scale by 1.7, translate by (50, -30).
    const source = translateScale(rotate(target, Math.PI / 2), 1.7, 50, -30);
    const out = alignShapes(source, target);
    expect(out.residual).not.toBeNull();
    expect(out.residual!).toBeLessThan(1e-3);
  });

  it("(a) recovers a 137° rotation", () => {
    const target = lShape();
    const source = translateScale(rotate(target, (137 * Math.PI) / 180), 0.8, 10, 20);
    const out = alignShapes(source, target);
    expect(out.residual).not.toBeNull();
    expect(out.residual!).toBeLessThan(1e-3);
  });

  it("(b) handles reflection (mirror) + rotation", () => {
    const target = lShape();
    const source = translateScale(reflectX(rotate(target, Math.PI / 3)), 1.2, -5, 7);
    const out = alignShapes(source, target);
    expect(out.residual).not.toBeNull();
    expect(out.residual!).toBeLessThan(1e-3);
  });

  it("(c) simple mirror-X (legacy PoC case) still works", () => {
    const target = lShape();
    const source = reflectX(target);
    const out = alignShapes(source, target);
    expect(out.residual).not.toBeNull();
    expect(out.residual!).toBeLessThan(1e-3);
  });

  it("(d) after alignment, GPS points snap to the CORRECT outline vertices", () => {
    const target = lShape();
    // Subsample target (every 3rd vertex) then rotate by 45° + translate.
    const sampledIdx = [0, 3, 6, 9, 12, 15, 18, 21, 25, 28];
    const subset = sampledIdx.map((i) => ({ ...target[i] }));
    const source = translateScale(rotate(subset, Math.PI / 4), 1.5, 100, 100);
    const indices = mapLocationsToOutlineIndices(source, target);
    // Every snapped index should be within 1 vertex of the original sample.
    for (let i = 0; i < indices.length; i++) {
      expect(Math.abs(indices[i] - sampledIdx[i])).toBeLessThanOrEqual(1);
    }
  });

  it("(e) residual is HIGH for non-matching shapes", () => {
    const target = lShape();
    // A completely different shape: random scatter in a different bbox.
    const source: { x: number; y: number }[] = [];
    let seed = 1;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };
    for (let i = 0; i < 30; i++) source.push({ x: rng() * 100, y: rng() * 100 });
    const out = alignShapes(source, target);
    expect(out.residual).not.toBeNull();
    // Random scatter vs L-shape: residual should be sizeable (~order 1).
    expect(out.residual!).toBeGreaterThan(0.1);
  });

  it("falls back to bbox path for degenerate (<3 point) sources, residual=null", () => {
    const target = lShape();
    const source = [{ x: 0, y: 0 }, { x: 5, y: 0 }];
    const out = alignShapes(source, target);
    expect(out.residual).toBeNull();
    expect(out.transformed).toHaveLength(2);
  });
});
