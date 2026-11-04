import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ExternalLink, Link2, StickyNote, Trash2 } from "lucide-react";
import { type ChecklistSection, type SectionReference, type SectionReferenceKind } from "@scope/contracts";
import { formatRelative } from "@/lib/date";
import { Button, Card, ConfirmDialog, Input, SegmentedControl, Textarea } from "@/design-system";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { useFormSubmit } from "@/modules/auth/useFormSubmit";
import { useAppStore } from "@/store/useAppStore";

export interface SectionReferencesProps {
  section: ChecklistSection;
  canEdit: boolean;
}

/** Notes and links attached to a scope or revision after it was created. */
export function SectionReferences({ section, canEdit }: SectionReferencesProps) {
  const references = section.references ?? [];
  const addSectionReference = useAppStore((s) => s.addSectionReference);
  const deleteSectionReference = useAppStore((s) => s.deleteSectionReference);
  const [kind, setKind] = useState<SectionReferenceKind>("note");
  const [body, setBody] = useState("");
  const [title, setTitle] = useState("");
  const [pendingDelete, setPendingDelete] = useState<SectionReference | null>(null);
  const { submitting, error, fieldErrors, run, clearField } = useFormSubmit();
  const reduceMotion = useReducedMotion();
  const fieldMotion = reduceMotion
    ? { initial: false, animate: { opacity: 1 }, exit: { opacity: 1 } }
    : { initial: { opacity: 0, y: 6 }, animate: { opacity: 1, y: 0 }, exit: { opacity: 0, y: -6 }, transition: { duration: 0.18, ease: "easeOut" as const } };

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const nextBody = body.trim();
    if (!nextBody) return;
    void run(async () => {
      await addSectionReference(section.uuid, {
        kind,
        body: nextBody,
        title: kind === "link" ? title.trim() || null : null,
      });
      setBody("");
      setTitle("");
    });
  };

  return (
    <Card padded={false} className="mt-4 px-5 py-4">
      <h2 className="text-xs font-medium text-ink-muted">
        Links & notes {references.length > 0 && <span className="text-ink-faint">· {references.length}</span>}
      </h2>

      {references.length === 0 ? (
        <p className="mt-2 text-sm text-ink-faint">{canEdit ? "Add a note or a link after this scope or revision exists." : "No notes or links yet."}</p>
      ) : (
        <ul className="mt-3 space-y-3">
          {references.map((ref) => (
            <li key={ref.uuid} className="flex gap-2.5">
              <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-muted text-ink-muted" aria-hidden>
                {ref.kind === "link" ? <Link2 className="size-3.5" /> : <StickyNote className="size-3.5" />}
              </span>
              <div className="min-w-0 flex-1 rounded-xl rounded-tl-sm bg-surface-muted px-3 py-2">
                <div className="flex items-baseline justify-between gap-2">
                  <span className="truncate text-xs font-medium text-ink">{ref.author.name}</span>
                  <span className="shrink-0 text-[11px] text-ink-faint">{formatRelative(ref.createdAt)}</span>
                </div>
                {ref.kind === "link" ? (
                  <a
                    href={ref.body}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-0.5 inline-flex max-w-full items-center gap-1 text-sm font-medium text-accent hover:underline"
                  >
                    <span className="truncate">{ref.title || ref.body}</span>
                    <ExternalLink className="size-3 shrink-0" aria-hidden />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : (
                  <p className="mt-0.5 text-sm leading-relaxed text-ink">{ref.body}</p>
                )}
                {ref.kind === "link" && ref.title && <p className="mt-0.5 truncate text-[11px] text-ink-faint">{ref.body}</p>}
              </div>
              {canEdit && (
                <Button variant="ghost" size="icon-sm" className="mt-1 shrink-0" onClick={() => setPendingDelete(ref)} aria-label={`Remove ${ref.kind}`}>
                  <Trash2 className="size-3.5" aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}

      {canEdit && (
        <form onSubmit={submit} className="mt-4 flex flex-col gap-3">
          <SegmentedControl
            layoutId="section-reference-kind"
            ariaLabel="Add a note or a link"
            value={kind}
            onChange={(next) => {
              setKind(next);
              clearField("body");
              clearField("title");
            }}
            options={[
              { value: "note", label: "Note" },
              { value: "link", label: "Link" },
            ]}
          />
          <AnimatePresence mode="wait" initial={false}>
            {kind === "note" ? (
              <motion.div key="note" {...fieldMotion}>
                <Textarea
                  label="Note"
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    clearField("body");
                  }}
                  placeholder="Add a note for this scope or revision"
                  className="min-h-16"
                  autoGrow
                  error={fieldErrors.body}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) void submit(e);
                  }}
                />
              </motion.div>
            ) : (
              <motion.div key="link" className="flex flex-col gap-3" {...fieldMotion}>
                <Input
                  label="Label (optional)"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    clearField("title");
                  }}
                  placeholder="Client sign-off sheet"
                  error={fieldErrors.title}
                />
                <Input
                  label="URL"
                  type="text"
                  inputMode="url"
                  value={body}
                  onChange={(e) => {
                    setBody(e.target.value);
                    clearField("body");
                  }}
                  placeholder="https://…"
                  error={fieldErrors.body}
                />
              </motion.div>
            )}
          </AnimatePresence>
          {error && <FormAlert>{error}</FormAlert>}
          <div className="flex justify-end">
            <Button type="submit" variant="secondary" size="md" disabled={!body.trim()} loading={submitting}>
              Add {kind}
            </Button>
          </div>
        </form>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        onClose={() => setPendingDelete(null)}
        onConfirm={async () => {
          if (!pendingDelete) return;
          await deleteSectionReference(section.uuid, pendingDelete.uuid);
        }}
        destructive
        title={pendingDelete?.kind === "link" ? "Remove this link?" : "Remove this note?"}
        description={pendingDelete?.kind === "link" ? pendingDelete.title || pendingDelete.body : pendingDelete?.body}
        confirmLabel="Remove"
      />
    </Card>
  );
}
