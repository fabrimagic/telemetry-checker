import { useEffect, useRef } from "react";

/**
 * Animated background simulating a real-time F1 telemetry feed.
 * - Multiple synthetic channels (speed, throttle, brake, RPM, gear, g-force)
 *   scroll horizontally like a live trace.
 * - The whole canvas slowly rotates around its center to add visual depth.
 * - Uses the app's existing palette via CSS variables (--f1-red, --chart-*).
 *
 * Pure presentational; mounted once at the root and fixed behind the UI.
 */
export default function TelemetryBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    let width = 0;
    let height = 0;

    const resize = () => {
      width = window.innerWidth;
      height = window.innerHeight;
      canvas.width = Math.floor(width * dpr);
      canvas.height = Math.floor(height * dpr);
      canvas.style.width = `${width}px`;
      canvas.style.height = `${height}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    // Resolve theme colors from CSS vars (HSL strings like "0 84% 55%").
    const cssVar = (name: string, fallback: string) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v ? `hsl(${v})` : fallback;
    };
    const cssVarA = (name: string, alpha: number, fallback: string) => {
      const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
      return v ? `hsl(${v} / ${alpha})` : fallback;
    };

    const colors = {
      red: cssVar("--f1-red", "hsl(0 84% 55%)"),
      redSoft: cssVarA("--f1-red", 0.55, "hsla(0,84%,55%,0.55)"),
      green: cssVar("--chart-green", "hsl(142 70% 45%)"),
      blue: cssVar("--chart-blue", "hsl(217 91% 60%)"),
      yellow: cssVar("--chart-yellow", "hsl(45 93% 58%)"),
      orange: cssVar("--chart-orange", "hsl(25 95% 53%)"),
      grid: cssVarA("--border", 0.35, "hsla(220,14%,16%,0.35)"),
      muted: cssVarA("--muted-foreground", 0.4, "hsla(215,14%,60%,0.4)"),
    };

    type Channel = {
      label: string;
      color: string;
      amp: number;       // 0..1
      base: number;      // 0..1 baseline within its lane
      freq: number;      // primary frequency
      freq2: number;     // secondary frequency
      noise: number;
      phase: number;
    };

    const channels: Channel[] = [
      { label: "SPEED",    color: colors.red,    amp: 0.42, base: 0.55, freq: 0.012, freq2: 0.045, noise: 0.04, phase: 0 },
      { label: "THROTTLE", color: colors.green,  amp: 0.45, base: 0.5,  freq: 0.018, freq2: 0.07,  noise: 0.05, phase: 1.2 },
      { label: "BRAKE",    color: colors.orange, amp: 0.35, base: 0.35, freq: 0.022, freq2: 0.09,  noise: 0.06, phase: 2.4 },
      { label: "RPM",      color: colors.yellow, amp: 0.4,  base: 0.6,  freq: 0.03,  freq2: 0.12,  noise: 0.05, phase: 3.1 },
      { label: "GEAR",     color: colors.blue,   amp: 0.3,  base: 0.5,  freq: 0.008, freq2: 0.03,  noise: 0.02, phase: 0.7 },
      { label: "G-FORCE",  color: colors.redSoft,amp: 0.4,  base: 0.5,  freq: 0.025, freq2: 0.08,  noise: 0.06, phase: 4.5 },
    ];

    const sample = (ch: Channel, x: number, t: number) => {
      const v =
        ch.base +
        ch.amp *
          (0.6 * Math.sin(x * ch.freq + t * 0.0009 + ch.phase) +
            0.4 * Math.sin(x * ch.freq2 - t * 0.0014 + ch.phase * 0.5)) +
        ch.noise * (Math.sin(x * 0.31 + t * 0.003 + ch.phase) * 0.5);
      return Math.max(0.02, Math.min(0.98, v));
    };

    let raf = 0;
    let start = performance.now();

    const draw = (now: number) => {
      const t = now - start;
      ctx.clearRect(0, 0, width, height);

      // Gentle rotation around center.
      const cx = width / 2;
      const cy = height / 2;
      const angle = reduced ? 0 : Math.sin(t * 0.00008) * 0.18; // ~±10°
      const scale = 1.25; // overscan to hide rotation corners

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(scale, scale);
      ctx.translate(-cx, -cy);

      // Background grid
      ctx.strokeStyle = colors.grid;
      ctx.lineWidth = 1;
      const gridSize = 48;
      const offset = (t * 0.04) % gridSize;
      ctx.beginPath();
      for (let x = -gridSize + offset; x < width + gridSize; x += gridSize) {
        ctx.moveTo(x, -gridSize);
        ctx.lineTo(x, height + gridSize);
      }
      for (let y = -gridSize; y < height + gridSize; y += gridSize) {
        ctx.moveTo(-gridSize, y);
        ctx.lineTo(width + gridSize, y);
      }
      ctx.stroke();

      // Lanes
      const padX = 80;
      const padTop = 60;
      const padBottom = 60;
      const usableH = height - padTop - padBottom;
      const laneH = usableH / channels.length;
      const step = 6; // px between samples
      const scroll = reduced ? 0 : t * 0.18;

      channels.forEach((ch, i) => {
        const laneTop = padTop + i * laneH;
        const laneBottom = laneTop + laneH;
        const innerH = laneH * 0.78;
        const innerTop = laneTop + (laneH - innerH) / 2;

        // Lane baseline
        ctx.strokeStyle = colors.muted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(padX, laneBottom - 1);
        ctx.lineTo(width - padX, laneBottom - 1);
        ctx.stroke();

        // Label
        ctx.fillStyle = colors.muted;
        ctx.font = "11px ui-monospace, SFMono-Regular, Menlo, monospace";
        ctx.textBaseline = "middle";
        ctx.fillText(ch.label, 16, laneTop + laneH / 2);

        // Trace
        ctx.beginPath();
        let firstX = padX;
        let firstY = innerTop + innerH * (1 - sample(ch, padX + scroll, t));
        ctx.moveTo(firstX, firstY);
        for (let x = padX + step; x < width - padX; x += step) {
          const y = innerTop + innerH * (1 - sample(ch, x + scroll, t));
          ctx.lineTo(x, y);
        }

        // Glow stroke
        ctx.strokeStyle = ch.color;
        ctx.lineWidth = 1.6;
        ctx.shadowColor = ch.color;
        ctx.shadowBlur = 10;
        ctx.stroke();
        ctx.shadowBlur = 0;

        // Leading dot (live cursor)
        const headX = width - padX;
        const headY = innerTop + innerH * (1 - sample(ch, headX + scroll, t));
        ctx.fillStyle = ch.color;
        ctx.beginPath();
        ctx.arc(headX, headY, 2.5, 0, Math.PI * 2);
        ctx.fill();
      });

      // Sweep beam (subtle)
      const sweepX = ((t * 0.12) % (width + 200)) - 100;
      const grad = ctx.createLinearGradient(sweepX - 80, 0, sweepX + 80, 0);
      grad.addColorStop(0, "hsla(0,0%,100%,0)");
      grad.addColorStop(0.5, "hsla(0,84%,55%,0.06)");
      grad.addColorStop(1, "hsla(0,0%,100%,0)");
      ctx.fillStyle = grad;
      ctx.fillRect(sweepX - 80, 0, 160, height);

      ctx.restore();

      raf = requestAnimationFrame(draw);
    };

    raf = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
    };
  }, []);

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 -z-10 overflow-hidden"
      style={{
        // Keep it subtle so it never competes with foreground content.
        opacity: 0.35,
        maskImage:
          "radial-gradient(ellipse 90% 75% at 50% 45%, black 55%, transparent 100%)",
        WebkitMaskImage:
          "radial-gradient(ellipse 90% 75% at 50% 45%, black 55%, transparent 100%)",
      }}
    >
      <canvas ref={canvasRef} className="block h-full w-full" />
    </div>
  );
}
