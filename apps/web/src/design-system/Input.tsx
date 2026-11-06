import { forwardRef, useId, useLayoutEffect, useRef, useState, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from "react";
import { ChevronDown, Eye, EyeOff } from "lucide-react";
import { clampTextareaHeight } from "@/lib/autosize";
import { cn } from "@/lib/cn";

const fieldBase =
  "w-full rounded-lg border border-line bg-surface px-3 text-sm text-ink placeholder:text-ink-faint transition-colors focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent-ring disabled:bg-surface-muted disabled:text-ink-muted";

interface FieldWrapperProps {
  label?: string;
  hint?: string;
  error?: string;
  id: string;
  children: ReactNode;
  className?: string;
}

function FieldWrapper({ label, hint, error, id, children, className }: FieldWrapperProps) {
  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      {label && (
        <label htmlFor={id} className="text-xs font-medium text-ink-muted">
          {label}
        </label>
      )}
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-xs text-danger">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-ink-faint">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(function Input({ label, hint, error, wrapperClassName, className, id, type, disabled, ...rest }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const [revealed, setRevealed] = useState(false);
  const isPassword = type === "password";
  return (
    <FieldWrapper id={fieldId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <div className={cn(isPassword && "relative")}>
        <input
          ref={ref}
          id={fieldId}
          type={isPassword && revealed ? "text" : type}
          disabled={disabled}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${fieldId}-error` : hint ? `${fieldId}-hint` : undefined}
          className={cn(fieldBase, "h-10", isPassword && "pr-10", error && "border-danger focus:ring-danger-soft", className)}
          {...rest}
        />
        {isPassword && (
          <button
            type="button"
            disabled={disabled}
            aria-label={revealed ? "Hide password" : "Show password"}
            title={revealed ? "Hide password" : "Show password"}
            aria-pressed={revealed}
            onClick={() => setRevealed((open) => !open)}
            className="absolute inset-y-0 right-0 flex w-10 items-center justify-center text-ink-muted transition-colors hover:text-ink focus-visible:text-ink focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
          >
            {revealed ? <EyeOff className="size-4" aria-hidden /> : <Eye className="size-4" aria-hidden />}
          </button>
        )}
      </div>
    </FieldWrapper>
  );
});

export interface TextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
  /** Start as a single line and grow downward as the text wraps. */
  autoGrow?: boolean;
  minRows?: number;
  maxRows?: number;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(function Textarea(
  { label, hint, error, wrapperClassName, className, id, autoGrow = false, minRows = 1, maxRows = 6, onInput, value, ...rest },
  ref,
) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  const innerRef = useRef<HTMLTextAreaElement | null>(null);

  const setRef = (node: HTMLTextAreaElement | null) => {
    innerRef.current = node;
    if (typeof ref === "function") ref(node);
    else if (ref) ref.current = node;
  };

  const grow = () => {
    const el = innerRef.current;
    if (!el || !autoGrow) return;
    const styles = getComputedStyle(el);
    const line = Number.parseFloat(styles.lineHeight) || 20;
    const pad = (Number.parseFloat(styles.paddingTop) || 0) + (Number.parseFloat(styles.paddingBottom) || 0);
    const min = line * minRows + pad;
    const max = line * maxRows + pad;
    el.style.height = "0px";
    const next = clampTextareaHeight(el.scrollHeight, min, max);
    el.style.height = `${next}px`;
    el.style.overflowY = el.scrollHeight > max + 1 ? "auto" : "hidden";
  };

  useLayoutEffect(() => {
    grow();
  }, [value, autoGrow, minRows, maxRows]);

  return (
    <FieldWrapper id={fieldId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <textarea
        ref={setRef}
        id={fieldId}
        rows={autoGrow ? minRows : undefined}
        value={value}
        aria-invalid={error ? true : undefined}
        onInput={(event) => {
          grow();
          onInput?.(event);
        }}
        className={cn(
          fieldBase,
          autoGrow ? "min-h-10 resize-none overflow-hidden py-2 leading-5" : "min-h-24 resize-y py-2.5 leading-relaxed",
          error && "border-danger",
          className,
        )}
        {...rest}
      />
    </FieldWrapper>
  );
});

export interface SelectProps extends SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  hint?: string;
  error?: string;
  wrapperClassName?: string;
}

export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select({ label, hint, error, wrapperClassName, className, id, children, ...rest }, ref) {
  const autoId = useId();
  const fieldId = id ?? autoId;
  return (
    <FieldWrapper id={fieldId} label={label} hint={hint} error={error} className={wrapperClassName}>
      <div className="relative">
        <select ref={ref} id={fieldId} className={cn(fieldBase, "h-10 appearance-none pr-9", className)} {...rest}>
          {children}
        </select>
        <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-ink-faint" aria-hidden />
      </div>
    </FieldWrapper>
  );
});
