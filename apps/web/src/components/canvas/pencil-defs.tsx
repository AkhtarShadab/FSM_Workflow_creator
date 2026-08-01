"use client";

/**
 * PencilDefs — SVG filter that wobbles strokes into hand-drawn pencil lines
 * (feTurbulence + feDisplacementMap, the classic sketch effect).
 * Mounted once on the canvas; edges reference it via filter: url(#pencil-rough).
 */
export function PencilDefs() {
  return (
    <svg width="0" height="0" className="absolute" aria-hidden="true">
      <defs>
        <filter
          id="pencil-rough"
          x="-20%"
          y="-20%"
          width="140%"
          height="140%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.035"
            numOctaves="4"
            seed="7"
            result="noise"
          />
          <feDisplacementMap in="SourceGraphic" in2="noise" scale="3.5" />
        </filter>
      </defs>
    </svg>
  );
}

/** Hand-written edge label with a paper halo so it reads over the canvas */
export function PencilEdgeLabel({
  x,
  y,
  text,
}: {
  x: number;
  y: number;
  text: string;
}) {
  return (
    <div
      style={{
        transform: `translate(-50%, -50%) translate(${x}px,${y}px) rotate(-1.5deg)`,
        textShadow:
          "0 0 5px var(--paper), 0 0 5px var(--paper), 0 0 5px var(--paper)",
      }}
      className="nodrag nopan pointer-events-none absolute font-hand text-[17px] font-semibold text-[var(--ink)]"
    >
      {text}
    </div>
  );
}

/**
 * BeamDot — MagicUI-style animated beam traveling along an edge path
 * (SMIL animateMotion; duration varies per edge so beams desync).
 */
export function BeamDot({
  path,
  color,
  seed,
}: {
  path: string;
  color: string;
  seed: string;
}) {
  let h = 0;
  for (let i = 0; i < seed.length; i++) h = (h + seed.charCodeAt(i)) % 997;
  const dur = 2.2 + (h % 3);
  return (
    <circle r={4} fill={color} opacity={0.9} className="pointer-events-none">
      <animateMotion dur={`${dur}s`} repeatCount="indefinite" path={path} />
    </circle>
  );
}
