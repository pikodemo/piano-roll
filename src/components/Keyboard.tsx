"use client";

import { midiToName, pitchClass } from "@/lib/music";

interface Props {
  minPitch: number;
  maxPitch: number;
  rowHeight: number;
  width: number;
  onPreview?: (midi: number) => void;
}

const BLACK = new Set([1, 3, 6, 8, 10]);

// Keyboard rendered as a vertical strip. Pitches go top (high) → bottom (low).
export function Keyboard({ minPitch, maxPitch, rowHeight, width, onPreview }: Props) {
  const rows: number[] = [];
  for (let p = maxPitch; p >= minPitch; p--) rows.push(p);
  const totalH = rows.length * rowHeight;
  return (
    <svg width={width} height={totalH} className="block select-none">
      {rows.map((p, i) => {
        const isBlack = BLACK.has(pitchClass(p));
        const y = i * rowHeight;
        return (
          <g key={p} onPointerDown={() => onPreview?.(p)} style={{ cursor: "pointer" }}>
            <rect
              x={0}
              y={y}
              width={width}
              height={rowHeight}
              fill={isBlack ? "#1f2937" : "#f9fafb"}
              stroke="#9ca3af"
              strokeWidth={0.25}
            />
            {pitchClass(p) === 0 && (
              <text
                x={width - 4}
                y={y + rowHeight - 3}
                textAnchor="end"
                fontSize={Math.min(10, rowHeight - 2)}
                fill={isBlack ? "#e5e7eb" : "#374151"}
              >
                {midiToName(p)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
