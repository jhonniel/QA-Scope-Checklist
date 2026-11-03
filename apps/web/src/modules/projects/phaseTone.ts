import { defaultPhaseColor, isPhaseColorPreset, PHASE_COLOR_HEX, phaseColorHex, type PhaseColorPreset } from "@scope/contracts";

/** Resolved tray colours — fill, border, and mark share one hue. */
export interface PhaseTone {
  name: string;
  fill: string;
  line: string;
  mark: string;
}

const PRESET_TONES: Record<PhaseColorPreset, PhaseTone> = {
  indigo: { name: "indigo", fill: "#e8eafc", line: "#c4c8f8", mark: PHASE_COLOR_HEX.indigo },
  teal: { name: "teal", fill: "#e6f4f2", line: "#9ad4cd", mark: PHASE_COLOR_HEX.teal },
  amber: { name: "amber", fill: "#fdf3e7", line: "#f0c48a", mark: PHASE_COLOR_HEX.amber },
  violet: { name: "violet", fill: "#f3eefc", line: "#d4c4f5", mark: PHASE_COLOR_HEX.violet },
  rose: { name: "rose", fill: "#fce8f0", line: "#f0b6cc", mark: PHASE_COLOR_HEX.rose },
};

export const PHASE_TONES: readonly PhaseTone[] = Object.values(PRESET_TONES);

function parseHex(hex: string): [number, number, number] {
  const value = hex.startsWith("#") ? hex.slice(1) : hex;
  return [parseInt(value.slice(0, 2), 16), parseInt(value.slice(2, 4), 16), parseInt(value.slice(4, 6), 16)];
}

/** Mix `hex` toward white. `amount` 0 keeps the colour, 1 is white. */
export function mixTowardWhite(hex: string, amount: number): string {
  const [r, g, b] = parseHex(hex);
  const mix = (channel: number) => Math.round(channel + (255 - channel) * amount);
  return `#${[mix(r), mix(g), mix(b)].map((n) => n.toString(16).padStart(2, "0")).join("")}`;
}

export function resolvePhaseTone(color: string): PhaseTone {
  if (isPhaseColorPreset(color)) return PRESET_TONES[color];
  const mark = phaseColorHex(color);
  return { name: "custom", fill: mixTowardWhite(mark, 0.88), line: mixTowardWhite(mark, 0.45), mark };
}

/** Fallback when a phase has no stored colour yet. */
export function phaseTone(index: number): PhaseTone {
  return PRESET_TONES[defaultPhaseColor(index)];
}
