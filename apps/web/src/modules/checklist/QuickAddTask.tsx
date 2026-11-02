import { useState, type FormEvent } from "react";
import { Plus } from "lucide-react";
import { cn } from "@/lib/cn";

export interface QuickAddTaskProps {
  onAdd: (title: string) => Promise<void> | void;
  placeholder?: string;
  className?: string;
  autoFocus?: boolean;
}

/** Inline, single-field task creation. Enter adds; the field stays focused for the next one. */
export function QuickAddTask({ onAdd, placeholder = "Add a task", className, autoFocus }: QuickAddTaskProps) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const title = value.trim();
    if (!title || busy) return;
    setBusy(true);
    try {
      await onAdd(title);
      setValue("");
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className={cn("group flex items-center gap-3 rounded-xl px-3 py-2 transition-colors focus-within:bg-surface-muted", className)}>
      <span className="flex size-5 shrink-0 items-center justify-center rounded-[0.4rem] border border-dashed border-line-strong text-ink-faint group-focus-within:border-accent group-focus-within:text-accent" aria-hidden>
        <Plus className="size-3" />
      </span>
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        autoFocus={autoFocus}
        disabled={busy}
        enterKeyHint="done"
        className="h-6 min-w-0 flex-1 bg-transparent text-sm text-ink placeholder:text-ink-faint focus:outline-none"
      />
      {value.trim() && (
        <button type="submit" disabled={busy} className="text-xs font-medium text-accent">
          Add
        </button>
      )}
    </form>
  );
}
