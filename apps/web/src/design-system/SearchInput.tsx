import { forwardRef, type InputHTMLAttributes } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

export interface SearchInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  onClear?: () => void;
  shortcutHint?: string;
}

export const SearchInput = forwardRef<HTMLInputElement, SearchInputProps>(function SearchInput(
  { value, onChange, onClear, shortcutHint, className, placeholder = "Search", ...rest },
  ref,
) {
  return (
    <div className={cn("group relative flex items-center", className)}>
      <Search className="pointer-events-none absolute left-3 size-4 text-ink-faint group-focus-within:text-ink-muted" aria-hidden />
      <input
        ref={ref}
        type="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={rest["aria-label"] ?? placeholder}
        className="h-10 w-full rounded-lg border border-line bg-surface pr-9 pl-9 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring [&::-webkit-search-cancel-button]:hidden"
        {...rest}
      />
      {value ? (
        <button
          type="button"
          onClick={() => {
            onChange("");
            onClear?.();
          }}
          aria-label="Clear search"
          className="absolute right-2 flex size-6 items-center justify-center rounded-full text-ink-faint hover:bg-surface-muted hover:text-ink"
        >
          <X className="size-3.5" aria-hidden />
        </button>
      ) : shortcutHint ? (
        <kbd className="pointer-events-none absolute right-2.5 hidden rounded border border-line bg-surface-muted px-1.5 font-sans text-[10px] leading-5 text-ink-faint md:block" aria-hidden>
          {shortcutHint}
        </kbd>
      ) : null}
    </div>
  );
});
