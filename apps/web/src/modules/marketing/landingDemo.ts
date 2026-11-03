export type DemoKind = "scope" | "revision";
export type DemoPhaseId = "discovery" | "build";
export type WalkthroughId = "scope" | "phase" | "revision" | "export";

export interface DemoTask {
  id: string;
  title: string;
  done: boolean;
  kind: DemoKind;
  phaseId: DemoPhaseId;
}

export interface DemoPhase {
  id: DemoPhaseId;
  title: string;
}

export interface DemoProgress {
  done: number;
  total: number;
  percent: number;
}

/** Sample project shown on the public landing page — not persisted. */
export const DEMO_PROJECT = {
  name: "Civic Portal Refresh",
  client: "Municipal IT",
  status: "Active",
} as const;

export const DEMO_PHASES: DemoPhase[] = [
  { id: "discovery", title: "Discovery" },
  { id: "build", title: "Build" },
];

export const DEMO_TASKS: DemoTask[] = [
  { id: "ia", title: "Confirm information architecture", done: true, kind: "scope", phaseId: "discovery" },
  { id: "accounts", title: "Resident account recovery flow", done: true, kind: "scope", phaseId: "build" },
  { id: "payments", title: "LandBank payment confirmation", done: false, kind: "scope", phaseId: "build" },
  { id: "receipt", title: "Itemised receipt on the portal", done: false, kind: "revision", phaseId: "build" },
  { id: "sms", title: "SMS notice after a successful payment", done: false, kind: "revision", phaseId: "build" },
];

export const DEMO_REVISION_LABEL = "Revision as of November 3, 2026";

export function toggleDemoTask(tasks: readonly DemoTask[], id: string): DemoTask[] {
  return tasks.map((task) => (task.id === id ? { ...task, done: !task.done } : task));
}

export function demoProgress(tasks: readonly DemoTask[], kind?: DemoKind): DemoProgress {
  const list = kind ? tasks.filter((task) => task.kind === kind) : tasks;
  const done = list.filter((task) => task.done).length;
  return { done, total: list.length, percent: list.length === 0 ? 0 : Math.round((done / list.length) * 100) };
}

export function filterDemoTasks(tasks: readonly DemoTask[], kind: DemoKind, phaseId: DemoPhaseId | "all"): DemoTask[] {
  return tasks.filter((task) => task.kind === kind && (phaseId === "all" || task.phaseId === phaseId));
}

export function groupDemoTasksByPhase(tasks: readonly DemoTask[]): { phase: DemoPhase; tasks: DemoTask[] }[] {
  return DEMO_PHASES.map((phase) => ({ phase, tasks: tasks.filter((task) => task.phaseId === phase.id) })).filter((group) => group.tasks.length > 0);
}

export const WALKTHROUGH: { id: WalkthroughId; step: string; title: string; body: string }[] = [
  {
    id: "scope",
    step: "01",
    title: "Lock the agreed scope",
    body: "Each scope is a checklist the team can tick from either side. Progress is always visible — on the project, in search, and on the exported document.",
  },
  {
    id: "phase",
    step: "02",
    title: "Group work into phases, optionally",
    body: "Discovery, build, go-live — phases are labels, not a second workflow. Leave them off, or drag scopes under one. Deleting a phase only ungroups the work.",
  },
  {
    id: "revision",
    step: "03",
    title: "Record changes as dated revisions",
    body: "When the client asks for more, add a revision beside the original scope. Once every item is done it stamps “Revision as of …” so later rounds stay distinct.",
  },
  {
    id: "export",
    step: "04",
    title: "Export a document you can sign",
    body: "Pick the whole project or selected scopes. The server builds a DOCX with progress charts; revisions print in their own block with their own figures.",
  },
];

export const FEATURES = [
  {
    title: "Scopes stay the source of truth",
    body: "The agreed work lives in checklists, not a slide deck. Status, due dates and comments sit on each task.",
  },
  {
    title: "Revisions never overwrite scope",
    body: "Client-requested changes sit alongside the original. Completing a revision dates it so the next round has a clean start.",
  },
  {
    title: "Phases are optional",
    body: "Use them when a project has natural stages. Skip them on smaller work. Either way, export respects the grouping.",
  },
  {
    title: "Roles that match the room",
    body: "Owners run the project, editors do the work, viewers follow along. Invitations carry a role so access is set before anyone joins.",
  },
  {
    title: "A full activity history",
    body: "Every tick, comment, invite and export is recorded. Administrators can also read the append-only audit log.",
  },
  {
    title: "Documents generated on the server",
    body: "Export uses a replaceable template. Charts and revision banners are built in — no desktop merge step.",
  },
] as const;

export const FAQS = [
  {
    question: "What is the difference between a scope and a revision?",
    answer:
      "A scope is the work everyone agreed at the start. A revision is a later change request. They stay side by side, and a finished revision is labelled with the day it reached 100%.",
  },
  {
    question: "Do I have to use phases?",
    answer: "No. Phases are optional grouping. Projects without phases work exactly as they did before — scopes and revisions list in order.",
  },
  {
    question: "Who can see a project?",
    answer: "Only people you invite, plus administrators. Viewers can read and comment; editors can update tasks; owners manage members and the project itself.",
  },
  {
    question: "What does the export include?",
    answer:
      "A formatted DOCX of the project or the scopes you select. Each scope and each revision has its own progress chart. Revision banners print as “Revision as of …” when complete.",
  },
] as const;
