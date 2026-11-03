import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { normalizePhaseColor, phaseColorHex } from "@scope/contracts";
import { cn } from "@/lib/cn";

export interface PhaseColorPickerProps {
  color: string;
  onChange: (color: string) => void;
}

/** Named presets keep their API names; extras store as hex. 12×2 fills the well. */
const SWATCHES: readonly { name: string; value: string }[] = [
  { name: "indigo", value: "indigo" },
  { name: "blue", value: "#2563eb" },
  { name: "royal", value: "#1d4ed8" },
  { name: "sky", value: "#0284c7" },
  { name: "cyan", value: "#0891b2" },
  { name: "ocean", value: "#0e7490" },
  { name: "teal", value: "teal" },
  { name: "emerald", value: "#059669" },
  { name: "green", value: "#16a34a" },
  { name: "lime", value: "#65a30d" },
  { name: "gold", value: "#ca8a04" },
  { name: "amber", value: "amber" },
  { name: "orange", value: "#ea580c" },
  { name: "red", value: "#dc2626" },
  { name: "rose", value: "rose" },
  { name: "pink", value: "#db2777" },
  { name: "fuchsia", value: "#c026d3" },
  { name: "violet", value: "violet" },
  { name: "purple", value: "#7c3aed" },
  { name: "deep", value: "#4c1d95" },
  { name: "slate", value: "#475569" },
  { name: "zinc", value: "#3f3f46" },
  { name: "stone", value: "#57534e" },
  { name: "ink", value: "#1c1917" },
];

function swatchHex(value: string): string {
  return phaseColorHex(value);
}

/** Compact 12-column palette plus a custom hex field. */
export function PhaseColorPicker({ color, onChange }: PhaseColorPickerProps) {
  const [hex, setHex] = useState(phaseColorHex(color));
  const selectedHex = phaseColorHex(color);

  useEffect(() => {
    setHex(phaseColorHex(color));
  }, [color]);

  const apply = (next: string) => {
    const normalized = normalizePhaseColor(next);
    if (!normalized || normalized === color) return;
    onChange(normalized);
  };

  return (
    <fieldset className="min-w-0">
      <legend className="text-xs font-medium text-ink-muted">Colour</legend>
      <div className="mt-1.5 overflow-hidden rounded-lg border border-line bg-surface-sunken">
        <div className="grid grid-cols-12 gap-1 p-1.5" role="listbox" aria-label="Preset colours">
          {SWATCHES.map((swatch) => {
            const mark = swatchHex(swatch.value);
            const selected = selectedHex === mark;
            return (
              <button
                key={swatch.name}
                type="button"
                role="option"
                aria-selected={selected}
                aria-label={swatch.name}
                onClick={() => apply(swatch.value)}
                className={cn(
                  "relative aspect-square w-full rounded-[0.3rem] ring-1 ring-inset ring-black/10",
                  "hover:brightness-[1.05] focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent",
                  selected && "shadow-[0_0_0_1.5px_var(--color-ink)]",
                )}
                style={{ backgroundColor: mark }}
              >
                {selected && <Check className="absolute inset-0 m-auto size-2 text-white drop-shadow-sm" strokeWidth={3} aria-hidden />}
              </button>
            );
          })}
        </div>
        <label className="flex items-center gap-2 border-t border-line px-1.5 py-1.5">
          <span className="shrink-0 text-xs text-ink-muted">Hex</span>
          <input
            value={hex}
            onChange={(event) => setHex(event.target.value)}
            onBlur={() => apply(hex)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                apply(hex);
              }
            }}
            className="min-w-0 flex-1 bg-transparent font-mono text-xs text-ink outline-none placeholder:text-ink-faint"
            aria-label="Hex colour"
            spellCheck={false}
          />
        </label>
      </div>
    </fieldset>
  );
}
