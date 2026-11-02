<script setup lang="ts">
/**
 * ActivityFeed — Vue module.
 *
 * Independently mounted inside the React shell (see src/vue/VueMount.tsx).
 * Consumes the same `ActivityLog` contract and design tokens as React code.
 */
import { computed } from "vue";
import { SECTION_KIND_LABELS, type ActivityLog, type SectionKind, type TaskCheckSide, type TaskStatus } from "@scope/contracts";
import { formatRelative } from "@/lib/date";
import { CHECK_SIDE_LABEL, TASK_STATUS_META } from "@/lib/taskStatus";

const props = withDefaults(
  defineProps<{
    activities: ActivityLog[];
    loading?: boolean;
    /** Map of project uuid → name, shown when the feed spans projects. */
    projectNames?: Record<string, string>;
    /** Render fewer details (used inside bento cards). */
    compact?: boolean;
    /** Maximum items to render. */
    limit?: number;
    emptyText?: string;
    onSelect?: (activity: ActivityLog) => void;
  }>(),
  {
    loading: false,
    projectNames: () => ({}),
    compact: false,
    limit: 50,
    emptyText: "No activity yet.",
    onSelect: undefined,
  },
);

const visible = computed(() => props.activities.slice(0, props.limit));

type ActionMeta = { verb: string; glyph: "check" | "plus" | "comment" | "user" | "export" | "edit" | "undo" | "folder" };

const actionMeta: Record<ActivityLog["action"], ActionMeta> = {
  "project.created": { verb: "created project", glyph: "folder" },
  "project.updated": { verb: "updated project", glyph: "edit" },
  "project.status_changed": { verb: "changed status of", glyph: "edit" },
  "project.deleted": { verb: "deleted project", glyph: "folder" },
  // The noun ("scope" / "revision") is filled in from `meta.kind` by `describe`.
  "section.created": { verb: "added", glyph: "plus" },
  "section.updated": { verb: "renamed", glyph: "edit" },
  "section.deleted": { verb: "removed", glyph: "edit" },
  "section.completed": { verb: "completed", glyph: "check" },
  "task.created": { verb: "added", glyph: "plus" },
  "task.updated": { verb: "updated", glyph: "edit" },
  "task.checked": { verb: "checked", glyph: "check" },
  "task.unchecked": { verb: "cleared the check on", glyph: "undo" },
  "task.status_changed": { verb: "moved", glyph: "edit" },
  "task.deleted": { verb: "deleted", glyph: "edit" },
  "task.assigned": { verb: "assigned", glyph: "user" },
  "comment.added": { verb: "commented on", glyph: "comment" },
  "member.invited": { verb: "invited", glyph: "user" },
  "member.joined": { verb: "—", glyph: "user" },
  "member.removed": { verb: "removed", glyph: "user" },
  "member.left": { verb: "left the project", glyph: "user" },
  "member.role_changed": { verb: "changed the role of", glyph: "user" },
  "member.invitation_declined": { verb: "declined the invitation for", glyph: "undo" },
  "member.invitation_revoked": { verb: "revoked the invitation for", glyph: "undo" },
  "project.ownership_transferred": { verb: "transferred ownership of", glyph: "folder" },
  "project.restored": { verb: "restored project", glyph: "undo" },
  "export.generated": { verb: "exported", glyph: "export" },
};

const ROLE_LABEL: Record<string, string> = { owner: "Owner", editor: "Editor", viewer: "Viewer" };

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts.length > 1 ? parts[parts.length - 1][0] : "")).toUpperCase();
}

function describe(a: ActivityLog): string {
  if (a.action === "member.joined") return a.subject;
  const verb = actionMeta[a.action]?.verb ?? a.action.replace(".", " ");
  if (a.action === "member.left") return verb;
  if (a.action === "member.invited") {
    const role = a.meta?.role as string | undefined;
    return role ? `${verb} ${a.subject} as ${ROLE_LABEL[role] ?? role}` : `${verb} ${a.subject}`;
  }
  if (a.action === "member.role_changed") {
    const to = a.meta?.to as string | undefined;
    return to ? `${verb} ${a.subject} to ${ROLE_LABEL[to] ?? to}` : `${verb} ${a.subject}`;
  }
  if (a.action === "project.ownership_transferred") {
    const to = a.meta?.to as string | undefined;
    return to ? `${verb} ${a.subject} to ${to}` : `${verb} ${a.subject}`;
  }
  if (a.action === "task.checked" || a.action === "task.unchecked") {
    const side = a.meta?.side as TaskCheckSide | undefined;
    return side ? `${verb} ${a.subject} as ${CHECK_SIDE_LABEL[side]}` : `${verb} ${a.subject}`;
  }
  if (a.action === "task.status_changed") {
    const to = a.meta?.to as TaskStatus | undefined;
    return to && TASK_STATUS_META[to] ? `${verb} ${a.subject} to ${TASK_STATUS_META[to].label}` : `${verb} ${a.subject}`;
  }
  if (a.action === "project.status_changed") {
    const to = a.meta?.to as string | undefined;
    return to ? `${verb} ${a.subject} to ${to}` : `${verb} ${a.subject}`;
  }
  if (a.action === "section.created" || a.action === "section.completed") {
    const kind = a.meta?.kind as SectionKind | undefined;
    return `${verb} ${(SECTION_KIND_LABELS[kind ?? "scope"] ?? "Scope").toLowerCase()} ${a.subject}`;
  }
  return `${verb} ${a.subject}`;
}

/** Unknown actions (e.g. from a newer API) fall back to the generic pencil glyph. */
function glyphOf(a: ActivityLog): ActionMeta["glyph"] {
  return actionMeta[a.action]?.glyph ?? "edit";
}

function select(a: ActivityLog) {
  props.onSelect?.(a);
}
</script>

<template>
  <div class="activity-feed">
    <!-- Loading -->
    <ul v-if="loading" class="space-y-3" aria-busy="true" aria-label="Loading activity">
      <li v-for="i in (compact ? 4 : 6)" :key="i" class="flex items-start gap-3">
        <span class="mt-0.5 size-7 shrink-0 animate-pulse rounded-full bg-surface-sunken" />
        <span class="flex-1 space-y-2 pt-1">
          <span class="block h-3 w-[70%] animate-pulse rounded bg-surface-sunken" />
          <span class="block h-2.5 w-[35%] animate-pulse rounded bg-surface-sunken" />
        </span>
      </li>
    </ul>

    <!-- Empty -->
    <p v-else-if="visible.length === 0" class="py-6 text-center text-sm text-ink-faint">{{ emptyText }}</p>

    <!-- List -->
    <TransitionGroup v-else tag="ol" name="feed" class="relative m-0 list-none p-0" :class="compact ? 'space-y-3' : 'space-y-4'">
      <li v-for="a in visible" :key="a.uuid" class="feed-item flex items-start gap-3">
        <span class="relative mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-surface-sunken text-[10px] font-semibold text-ink" :title="a.actor.name" aria-hidden="true">
          {{ initials(a.actor.name) }}
          <span
            class="absolute -right-1 -bottom-1 flex size-3.5 items-center justify-center rounded-full ring-2 ring-surface"
            :class="glyphOf(a) === 'check' ? 'bg-accent text-accent-fg' : 'bg-surface-muted text-ink-muted'"
          >
            <svg viewBox="0 0 24 24" class="size-2.5" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round">
              <path v-if="glyphOf(a) === 'check'" d="M5 12.5l4.5 4.5L19 7.5" />
              <path v-else-if="glyphOf(a) === 'plus'" d="M12 5v14M5 12h14" />
              <path v-else-if="glyphOf(a) === 'comment'" d="M21 12a8 8 0 01-8 8H8l-5 3V12a8 8 0 018-8h2a8 8 0 018 8z" />
              <path v-else-if="glyphOf(a) === 'user'" d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2M12 11a4 4 0 100-8 4 4 0 000 8z" />
              <path v-else-if="glyphOf(a) === 'export'" d="M12 3v12M7 10l5 5 5-5M5 21h14" />
              <path v-else-if="glyphOf(a) === 'undo'" d="M3 7v6h6M3 13a9 9 0 1018-1" />
              <path v-else-if="glyphOf(a) === 'folder'" d="M3 7a2 2 0 012-2h4l2 2h8a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <path v-else d="M4 20h4l10-10-4-4L4 16v4z" />
            </svg>
          </span>
        </span>

        <button type="button" class="feed-button min-w-0 flex-1 rounded-md text-left" @click="select(a)">
          <p class="text-sm leading-5 text-ink">
            <span class="font-medium">{{ a.actor.name }}</span>
            <span class="text-ink-muted">{{ "\u00a0" + describe(a) }}</span>
          </p>
          <p class="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-ink-faint">
            <span v-if="projectNames[a.projectUuid]" class="truncate">{{ projectNames[a.projectUuid] }}</span>
            <span v-if="projectNames[a.projectUuid]" aria-hidden="true">·</span>
            <time :datetime="a.createdAt">{{ formatRelative(a.createdAt) }}</time>
          </p>
        </button>
      </li>
    </TransitionGroup>
  </div>
</template>

<style scoped>
.feed-enter-active,
.feed-leave-active {
  transition:
    opacity var(--duration-base) var(--ease-out-quint),
    transform var(--duration-base) var(--ease-out-quint);
}
.feed-enter-from {
  opacity: 0;
  transform: translateY(6px);
}
.feed-leave-to {
  opacity: 0;
}
.feed-move {
  transition: transform var(--duration-base) var(--ease-out-quint);
}
.feed-button:hover p:first-child span:first-child {
  text-decoration: underline;
  text-decoration-color: var(--color-line-strong);
  text-underline-offset: 3px;
}
</style>
