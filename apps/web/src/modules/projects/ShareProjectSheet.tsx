import { useEffect, useMemo, useState } from "react";
import { Check, Copy, Link2, RefreshCw } from "lucide-react";
import { SECTION_KIND_LABELS, type ChecklistSection, type Project, type ProjectShareSettings } from "@scope/contracts";
import { routes } from "@/app/routes";
import { BottomSheet, Button, Checkbox, ConfirmDialog } from "@/design-system";
import { FormAlert } from "@/modules/auth/AuthLayout";
import { api, ApiError } from "@/services/api";

export interface ShareProjectSheetProps {
  project: Project;
  sections: ChecklistSection[];
  open: boolean;
  onClose: () => void;
}

function shareUrl(token: string): string {
  return `${window.location.origin}${routes.share(token)}`;
}

/** Turn public sharing on, pick which scopes appear, and copy the link. */
export function ShareProjectSheet({ project, sections, open, onClose }: ShareProjectSheetProps) {
  const [settings, setSettings] = useState<ProjectShareSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState(false);
  const [confirmRotate, setConfirmRotate] = useState(false);

  const ordered = useMemo(() => [...sections].sort((a, b) => a.position - b.position), [sections]);

  useEffect(() => {
    if (!open) return;
    setError(null);
    setCopied(false);
    void api
      .getProjectShare(project.uuid)
      .then(setSettings)
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load sharing."));
  }, [open, project.uuid]);

  const save = async (patch: Parameters<typeof api.updateProjectShare>[1]) => {
    setSaving(true);
    setError(null);
    try {
      setSettings(await api.updateProjectShare(project.uuid, patch));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Could not update sharing.");
    } finally {
      setSaving(false);
    }
  };

  const copyLink = async () => {
    if (!settings?.token) return;
    try {
      await navigator.clipboard.writeText(shareUrl(settings.token));
      setCopied(true);
      window.setTimeout(() => setCopied(false), 2000);
    } catch {
      setError("Could not copy the link.");
    }
  };

  const toggleSection = (uuid: string) => {
    if (!settings) return;
    const next = settings.publicSectionUuids.includes(uuid) ? settings.publicSectionUuids.filter((id) => id !== uuid) : [...settings.publicSectionUuids, uuid];
    void save({ publicSectionUuids: next });
  };

  return (
    <>
      <BottomSheet
        open={open}
        onClose={onClose}
        title="Share project"
        description="People with the link can view the selected scopes and tick Client. They cannot open tasks or change anything else."
        snapPoints={[0.94]}
        desktop="dialog"
      >
        {!settings ? (
          <p className="py-6 text-sm text-ink-muted">{error ?? "Loading sharing…"}</p>
        ) : (
          <div className="flex flex-col gap-5 pt-1">
            <div className="flex items-start gap-1 rounded-xl border border-line px-3 py-3">
              <Checkbox checked={settings.enabled} onChange={() => void save({ enabled: !settings.enabled })} disabled={saving} label="Turn on public link" />
              <span className="min-w-0 pt-2">
                <span className="block text-sm font-medium text-ink">Anyone with the link</span>
                <span className="mt-0.5 block text-xs text-ink-muted">No sign-in. They see the list and tick Client. They cannot open a task.</span>
              </span>
            </div>

            {settings.enabled && settings.token && (
              <div className="flex flex-col gap-2">
                <p className="text-xs font-medium text-ink-muted">Public link</p>
                <div className="flex gap-2">
                  <p className="min-w-0 flex-1 truncate rounded-xl border border-line bg-surface-muted px-3 py-2 text-xs text-ink">{shareUrl(settings.token)}</p>
                  <Button variant="secondary" size="icon" onClick={() => void copyLink()} aria-label="Copy link">
                    {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
                  </Button>
                </div>
                <Button variant="ghost" size="sm" className="self-start" leadingIcon={<RefreshCw className="size-3.5" aria-hidden />} onClick={() => setConfirmRotate(true)} disabled={saving}>
                  Reset link
                </Button>
              </div>
            )}

            <div>
              <p className="text-xs font-medium text-ink-muted">Visible scopes and revisions</p>
              <p className="mt-1 text-xs text-ink-faint">Unchecked items stay private. Nothing is shown until you pick at least one.</p>
              {ordered.length === 0 ? (
                <p className="mt-3 text-sm text-ink-faint">Add a scope or revision first.</p>
              ) : (
                <ul className="mt-3 divide-y divide-line rounded-xl border border-line">
                  {ordered.map((section) => {
                    const checked = settings.publicSectionUuids.includes(section.uuid);
                    return (
                      <li key={section.uuid} className="flex items-center gap-2 px-3 py-2">
                        <Checkbox
                          checked={checked}
                          onChange={() => toggleSection(section.uuid)}
                          disabled={saving}
                          label={`Show ${section.title} on the public page`}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm text-ink">{section.title}</span>
                          <span className="text-[11px] text-ink-faint">{SECTION_KIND_LABELS[section.kind]}</span>
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
            </div>

            {error && <FormAlert>{error}</FormAlert>}
            {settings.enabled && settings.publicSectionUuids.length === 0 && (
              <p className="inline-flex items-center gap-1.5 text-xs text-ink-muted">
                <Link2 className="size-3.5" aria-hidden />
                The link is on, but no scopes are visible yet.
              </p>
            )}
          </div>
        )}
      </BottomSheet>

      <ConfirmDialog
        open={confirmRotate}
        onClose={() => setConfirmRotate(false)}
        onConfirm={async () => {
          await save({ rotateToken: true });
        }}
        title="Reset the public link?"
        description="The current URL will stop working. Anyone who already has it will need the new link."
        confirmLabel="Reset link"
        destructive
      />
    </>
  );
}
