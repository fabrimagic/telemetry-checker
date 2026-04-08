export function Watermark() {
  return (
    <span className="absolute inset-0 flex items-center justify-center pointer-events-none z-0 select-none">
      <span className="text-[clamp(14px,3vw,28px)] font-bold uppercase tracking-[0.2em] text-muted-foreground/[0.07] rotate-[-18deg]">
        PitWall AI
      </span>
    </span>
  );
}
