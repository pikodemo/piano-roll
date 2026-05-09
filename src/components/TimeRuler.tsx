"use client";

interface Props {
  bars: number;
  beatsPerBar: number;
  pixelsPerBeat: number;
  height: number;
}

export function TimeRuler({ bars, beatsPerBar, pixelsPerBeat, height }: Props) {
  const totalBeats = bars * beatsPerBar;
  const width = totalBeats * pixelsPerBeat;
  const ticks: Array<{ beat: number; major: boolean }> = [];
  for (let b = 0; b <= totalBeats; b++) {
    ticks.push({ beat: b, major: b % beatsPerBar === 0 });
  }
  return (
    <svg width={width} height={height} className="block select-none">
      <rect x={0} y={0} width={width} height={height} fill="#111827" />
      {ticks.map(({ beat, major }) => {
        const x = beat * pixelsPerBeat;
        return (
          <g key={beat}>
            <line x1={x} y1={major ? 0 : height * 0.55} x2={x} y2={height} stroke={major ? "#9ca3af" : "#4b5563"} strokeWidth={major ? 1 : 0.5} />
            {major && (
              <text x={x + 3} y={height - 3} fontSize={10} fill="#d1d5db">
                {beat / beatsPerBar + 1}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
