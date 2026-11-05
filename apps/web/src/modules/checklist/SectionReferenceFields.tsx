import { type KeyboardEvent } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { type SectionReferenceKind } from "@scope/contracts";
import { Input, SegmentedControl, Textarea } from "@/design-system";

export interface SectionReferenceFieldsProps {
  kind: SectionReferenceKind;
  body: string;
  title: string;
  onKind: (kind: SectionReferenceKind) => void;
  onBody: (value: string) => void;
  onTitle: (value: string) => void;
  bodyError?: string;
  titleError?: string;
  layoutId: string;
  /** Hide field labels so the block sits in a compact add form. */
  compact?: boolean;
  notePlaceholder?: string;
  linkTitlePlaceholder?: string;
  onNoteKeyDown?: (event: KeyboardEvent<HTMLTextAreaElement>) => void;
}

/** Shared Note / Link switch and fields, used when creating or editing a scope. */
export function SectionReferenceFields({
  kind,
  body,
  title,
  onKind,
  onBody,
  onTitle,
  bodyError,
  titleError,
  layoutId,
  compact,
  notePlaceholder = "Add a note for this scope or revision",
  linkTitlePlaceholder = "Client sign-off sheet",
  onNoteKeyDown,
}: SectionReferenceFieldsProps) {
  const reduceMotion = useReducedMotion();
  const fieldMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.18, ease: "easeOut" as const } };

  return (
    <div className="flex flex-col gap-3">
      <SegmentedControl
        layoutId={layoutId}
        ariaLabel="Add a note or a link"
        value={kind}
        onChange={onKind}
        options={[
          { value: "note", label: "Note" },
          { value: "link", label: "Link" },
        ]}
      />
      <AnimatePresence mode="wait" initial={false}>
        {kind === "note" ? (
          <motion.div key="note" {...fieldMotion}>
            <Textarea
              label={compact ? undefined : "Note"}
              value={body}
              onChange={(e) => onBody(e.target.value)}
              placeholder={notePlaceholder}
              aria-label="Note"
              className="min-h-16"
              autoGrow
              error={bodyError}
              onKeyDown={onNoteKeyDown}
            />
          </motion.div>
        ) : (
          <motion.div key="link" className="flex flex-col gap-3" {...fieldMotion}>
            <Input
              label={compact ? undefined : "Label (optional)"}
              value={title}
              onChange={(e) => onTitle(e.target.value)}
              placeholder={linkTitlePlaceholder}
              aria-label="Link label"
              error={titleError}
            />
            <Input
              label={compact ? undefined : "URL"}
              type="text"
              inputMode="url"
              value={body}
              onChange={(e) => onBody(e.target.value)}
              placeholder="https://…"
              aria-label="URL"
              error={bodyError}
            />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
