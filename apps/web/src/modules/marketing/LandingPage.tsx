import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ArrowRight, Check, CheckSquare, ChevronDown, FileDown, Layers3, ListChecks, Users } from "lucide-react";
import { routes } from "@/app/routes";
import { AnimatedNumber, ConfettiBurst, ProgressBar } from "@/design-system";
import { cn } from "@/lib/cn";
import { transitions } from "@/lib/motion";
import { useAppStore } from "@/store/useAppStore";
import {
  DEMO_PROJECT,
  DEMO_REVISION_LABEL,
  DEMO_TASKS,
  FAQS,
  FEATURES,
  WALKTHROUGH,
  demoProgress,
  groupDemoTasksByPhase,
  toggleDemoTask,
  type DemoKind,
  type DemoPhaseId,
  type DemoTask,
  type WalkthroughId,
} from "./landingDemo";
import { LiveProjectCard } from "./LiveProjectCard";

const NAV = [
  { href: "#product", label: "Product" },
  { href: "#how", label: "How it works" },
  { href: "#features", label: "Features" },
] as const;

export function LandingPage() {
  const reduceMotion = useReducedMotion();
  const bootstrap = useAppStore((s) => s.bootstrap);
  const currentUser = useAppStore((s) => s.currentUser);

  const [tasks, setTasks] = useState<DemoTask[]>(DEMO_TASKS);
  const [kind, setKind] = useState<DemoKind>("scope");
  const [phaseId, setPhaseId] = useState<DemoPhaseId | "all">("all");
  const [walkthrough, setWalkthrough] = useState<WalkthroughId>("scope");
  const [faqOpen, setFaqOpen] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [celebrate, setCelebrate] = useState(0);

  const overall = demoProgress(tasks);

  useEffect(() => {
    document.title = "Scope Checklist";
    const root = document.documentElement;
    const previous = root.style.scrollBehavior;
    root.style.scrollBehavior = "smooth";
    void bootstrap();
    return () => {
      root.style.scrollBehavior = previous;
    };
  }, [bootstrap]);

  useEffect(() => {
    if (overall.total > 0 && overall.done === overall.total) setCelebrate((n) => n + 1);
  }, [overall.done, overall.total]);

  const toggle = (id: string) => setTasks((current) => toggleDemoTask(current, id));
  const reset = () => {
    setTasks(DEMO_TASKS);
    setKind("scope");
    setPhaseId("all");
  };

  const selectWalkthrough = (id: WalkthroughId) => {
    setWalkthrough(id);
    if (id === "scope") {
      setKind("scope");
      setPhaseId("all");
    } else if (id === "phase") {
      setKind("scope");
      setPhaseId("all");
    } else if (id === "revision") {
      setKind("revision");
      setPhaseId("all");
    }
  };

  const signedIn = Boolean(currentUser);
  const primaryTo = signedIn ? routes.dashboard() : routes.register();
  const primaryLabel = signedIn ? "Open dashboard" : "Get started";

  return (
    <div className="min-h-dvh bg-canvas text-ink">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <ConfettiBurst fire={celebrate} announcement="Sample project complete" />

      <header className="sticky top-0 z-40 border-b border-line/80 bg-canvas/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
          <a href="#main" className="flex items-center gap-2.5">
            <span className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-fg" aria-hidden>
              <CheckSquare className="size-4" strokeWidth={2.5} />
            </span>
            <span className="text-[15px] font-semibold tracking-tight">Scope Checklist</span>
          </a>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Page">
            {NAV.map((item) => (
              <a key={item.href} href={item.href} className="rounded-lg px-3 py-2 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink">
                {item.label}
              </a>
            ))}
          </nav>
          <div className="hidden items-center gap-2 md:flex">
            {signedIn ? (
              <CtaLink to={routes.dashboard()} variant="primary">
                Open dashboard
              </CtaLink>
            ) : (
              <>
                <CtaLink to={routes.login()} variant="ghost">
                  Sign in
                </CtaLink>
                <CtaLink to={routes.register()} variant="primary">
                  Get started
                </CtaLink>
              </>
            )}
          </div>
          <button
            type="button"
            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-ink md:hidden"
            aria-expanded={menuOpen}
            aria-controls="mobile-nav"
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="sr-only">{menuOpen ? "Close menu" : "Open menu"}</span>
            <span className="flex w-4 flex-col gap-1" aria-hidden>
              <span className={cn("h-0.5 w-full bg-ink transition-transform", menuOpen && "translate-y-1.5 rotate-45")} />
              <span className={cn("h-0.5 w-full bg-ink transition-opacity", menuOpen && "opacity-0")} />
              <span className={cn("h-0.5 w-full bg-ink transition-transform", menuOpen && "-translate-y-1.5 -rotate-45")} />
            </span>
          </button>
        </div>
        {menuOpen && (
          <div id="mobile-nav" className="border-t border-line px-4 py-3 md:hidden">
            <nav className="flex flex-col gap-1" aria-label="Page">
              {NAV.map((item) => (
                <a
                  key={item.href}
                  href={item.href}
                  className="rounded-lg px-3 py-2.5 text-sm font-medium text-ink-muted hover:bg-surface-muted hover:text-ink"
                  onClick={() => setMenuOpen(false)}
                >
                  {item.label}
                </a>
              ))}
            </nav>
            <div className="mt-3 flex flex-col gap-2">
              {signedIn ? (
                <CtaLink to={routes.dashboard()} variant="primary" className="w-full">
                  Open dashboard
                </CtaLink>
              ) : (
                <>
                  <CtaLink to={routes.login()} variant="secondary" className="w-full">
                    Sign in
                  </CtaLink>
                  <CtaLink to={routes.register()} variant="primary" className="w-full">
                    Get started
                  </CtaLink>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main id="main" tabIndex={-1} className="outline-none">
        <section className="relative overflow-hidden">
          <div
            className="pointer-events-none absolute inset-0"
            aria-hidden
            style={{
              background:
                "radial-gradient(900px 420px at 80% -10%, color-mix(in oklab, var(--color-accent) 16%, transparent), transparent 70%), radial-gradient(600px 280px at 10% 110%, color-mix(in oklab, var(--color-accent) 8%, transparent), transparent 65%)",
            }}
          />
          <div className="relative mx-auto grid max-w-6xl gap-12 px-4 py-14 sm:px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:items-center lg:py-20">
            <motion.div initial={reduceMotion ? false : { opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={transitions.slow}>
              <p className="text-xs font-medium tracking-[0.16em] text-accent uppercase">Project delivery</p>
              <h1 className="mt-3 text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                The checklist for agreed scope, later revisions, and sign-off.
              </h1>
              <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-ink-muted text-pretty">
                Keep the work you promised separate from the changes that follow. Group scopes into optional phases. When it is time to report, export a formatted document with progress charts.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
                <CtaLink to={primaryTo} variant="primary" className="h-12 px-5 text-[15px]">
                  {primaryLabel}
                  <ArrowRight className="size-4" aria-hidden />
                </CtaLink>
                {!signedIn && (
                  <CtaLink to={routes.login()} variant="secondary" className="h-12 px-5 text-[15px]">
                    Sign in
                  </CtaLink>
                )}
              </div>
              <p className="mt-5 text-sm text-ink-faint">Tick items in the sample project. Progress updates immediately.</p>
            </motion.div>

            <motion.div
              id="product"
              className="scroll-mt-24"
              initial={reduceMotion ? false : { opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ ...transitions.slow, delay: reduceMotion ? 0 : 0.08 }}
            >
              <LiveProjectCard
                tasks={tasks}
                kind={kind}
                phaseId={phaseId}
                onKind={setKind}
                onPhase={setPhaseId}
                onToggle={toggle}
                onReset={reset}
              />
            </motion.div>
          </div>
        </section>

        <section className="border-y border-line bg-surface" aria-label="What the product covers">
          <div className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-line sm:grid-cols-4">
            <Capability icon={<ListChecks className="size-4" />} label="Agreed scope" detail="Checklists, not slides" />
            <Capability icon={<Layers3 className="size-4" />} label="Optional phases" detail="Group only when it helps" />
            <Capability icon={<Users className="size-4" />} label="Three roles" detail="Owner, editor, viewer" />
            <Capability icon={<FileDown className="size-4" />} label="DOCX export" detail="Charts built on the server" />
          </div>
        </section>

        <section id="how" className="scroll-mt-24 mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
          <div className="max-w-2xl">
            <p className="text-xs font-medium tracking-[0.16em] text-accent uppercase">How it works</p>
            <h2 className="mt-3 text-3xl font-semibold tracking-tight">One project, four deliberate steps.</h2>
            <p className="mt-3 text-[15px] leading-relaxed text-ink-muted">
              Select a step. The preview follows — including the ticks you already made in the sample project.
            </p>
          </div>

          <div className="mt-10 grid gap-8 lg:grid-cols-[minmax(0,20rem)_minmax(0,1fr)] lg:items-start">
            <ol className="flex flex-col gap-2">
              {WALKTHROUGH.map((item) => {
                const active = walkthrough === item.id;
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() => selectWalkthrough(item.id)}
                      aria-current={active ? "step" : undefined}
                      className={cn(
                        "w-full rounded-2xl border px-4 py-3.5 text-left transition-colors",
                        active ? "border-accent-ring bg-accent-soft" : "border-line bg-surface hover:border-line-strong",
                      )}
                    >
                      <span className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{item.step}</span>
                      <span className="mt-0.5 block text-sm font-semibold text-ink">{item.title}</span>
                      {active && <span className="mt-1.5 block text-sm leading-relaxed text-ink-muted">{item.body}</span>}
                    </button>
                  </li>
                );
              })}
            </ol>

            <AnimatePresence mode="wait">
              <motion.div
                key={walkthrough}
                initial={reduceMotion ? false : { opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reduceMotion ? undefined : { opacity: 0, y: -6 }}
                transition={transitions.base}
              >
                {walkthrough === "export" ? <ExportPreview tasks={tasks} /> : <WalkthroughPreview tasks={tasks} kind={walkthrough === "revision" ? "revision" : "scope"} />}
              </motion.div>
            </AnimatePresence>
          </div>
        </section>

        <section id="features" className="scroll-mt-24 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20">
            <div className="max-w-2xl">
              <p className="text-xs font-medium tracking-[0.16em] text-accent uppercase">Features</p>
              <h2 className="mt-3 text-3xl font-semibold tracking-tight">Built for work that has to stay traceable.</h2>
            </div>
            <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map((feature) => (
                <li
                  key={feature.title}
                  className="group rounded-2xl border border-line bg-canvas p-5 transition-colors hover:border-line-strong hover:bg-surface"
                >
                  <h3 className="text-[15px] font-semibold tracking-tight text-ink">{feature.title}</h3>
                  <p className="mt-2 text-sm leading-relaxed text-ink-muted">{feature.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-4 py-16 sm:px-6 lg:py-20" aria-labelledby="faq-heading">
          <div className="grid gap-10 lg:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <div>
              <h2 id="faq-heading" className="text-3xl font-semibold tracking-tight">
                Questions teams ask first
              </h2>
              <p className="mt-3 text-sm leading-relaxed text-ink-muted">Short answers. The product does not invent extra workflow.</p>
            </div>
            <div className="divide-y divide-line rounded-2xl border border-line bg-surface">
              {FAQS.map((item, index) => {
                const open = faqOpen === index;
                return (
                  <div key={item.question}>
                    <h3>
                      <button
                        type="button"
                        aria-expanded={open}
                        className="flex w-full items-center justify-between gap-4 px-5 py-4 text-left text-sm font-semibold text-ink"
                        onClick={() => setFaqOpen(open ? -1 : index)}
                      >
                        {item.question}
                        <ChevronDown className={cn("size-4 shrink-0 text-ink-faint transition-transform", open && "rotate-180")} aria-hidden />
                      </button>
                    </h3>
                    {open && <p className="px-5 pb-4 text-sm leading-relaxed text-ink-muted">{item.answer}</p>}
                  </div>
                );
              })}
            </div>
          </div>
        </section>

        <section className="border-t border-line">
          <div className="mx-auto max-w-6xl px-4 py-16 sm:px-6">
            <div className="relative overflow-hidden rounded-3xl bg-ink px-6 py-12 text-ink-inverse sm:px-12">
              <div
                className="pointer-events-none absolute -right-16 -top-16 size-64 rounded-full"
                aria-hidden
                style={{ background: "radial-gradient(circle, rgb(79 70 229 / 0.45), transparent 70%)" }}
              />
              <div className="relative max-w-xl">
                <h2 className="text-3xl font-semibold tracking-tight">Ready for the next project?</h2>
                <p className="mt-3 text-[15px] leading-relaxed text-white/70">
                  Create an account, invite the people who need to see the work, and export when it is time to sign.
                </p>
                <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                  <CtaLink to={primaryTo} variant="on-dark" className="h-12 px-5 text-[15px]">
                    {primaryLabel}
                    <ArrowRight className="size-4" aria-hidden />
                  </CtaLink>
                  {!signedIn && (
                    <CtaLink to={routes.login()} variant="on-dark-ghost" className="h-12 px-5 text-[15px]">
                      I already have an account
                    </CtaLink>
                  )}
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <div className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-md bg-accent text-accent-fg" aria-hidden>
              <CheckSquare className="size-3.5" strokeWidth={2.5} />
            </span>
            <span className="text-sm font-semibold">Scope Checklist</span>
          </div>
          <p className="text-sm text-ink-faint">© {new Date().getFullYear()} Scope Checklist. Agreed scope, dated revisions, exportable sign-off.</p>
        </div>
      </footer>
    </div>
  );
}

function Capability({ icon, label, detail }: { icon: ReactNode; label: string; detail: string }) {
  return (
    <div className="bg-surface px-5 py-6">
      <span className="flex size-8 items-center justify-center rounded-lg bg-accent-soft text-accent" aria-hidden>
        {icon}
      </span>
      <p className="mt-3 text-sm font-semibold text-ink">{label}</p>
      <p className="mt-0.5 text-sm text-ink-muted">{detail}</p>
    </div>
  );
}

function WalkthroughPreview({ tasks, kind }: { tasks: DemoTask[]; kind: DemoKind }) {
  const groups = groupDemoTasksByPhase(tasks.filter((task) => task.kind === kind));
  const progress = demoProgress(tasks, kind);
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_12px_40px_-24px_rgb(16_24_40/0.2)] sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">{kind === "scope" ? "Agreed scope" : DEMO_REVISION_LABEL}</p>
          <p className="mt-1 text-sm font-semibold text-ink">{DEMO_PROJECT.name}</p>
        </div>
        <p className="text-sm font-semibold tabular text-ink">
          <AnimatedNumber value={progress.percent} suffix="%" />
        </p>
      </div>
      <ProgressBar className="mt-3" value={progress.percent} size="sm" label={kind === "scope" ? "Scope completion" : "Revision completion"} />
      <div className="mt-5 space-y-4">
        {groups.map((group) => (
          <div key={group.phase.id}>
            <p className="text-[11px] font-medium tracking-wide text-ink-faint uppercase">{group.phase.title}</p>
            <ul className="mt-2 space-y-1.5">
              {group.tasks.map((task) => (
                <li key={task.id} className="flex items-center gap-2 text-sm text-ink">
                  <span
                    className={cn(
                      "flex size-4 shrink-0 items-center justify-center rounded-[0.3rem] border",
                      task.done ? "border-accent bg-accent text-accent-fg" : "border-line-strong",
                    )}
                    aria-hidden
                  >
                    {task.done && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <span className={cn(task.done && "text-ink-muted line-through")}>{task.title}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

function ExportPreview({ tasks }: { tasks: DemoTask[] }) {
  const scope = demoProgress(tasks, "scope");
  const revision = demoProgress(tasks, "revision");
  return (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-[0_12px_40px_-24px_rgb(16_24_40/0.2)] sm:p-8">
      <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">Export preview</p>
      <h3 className="mt-2 text-lg font-semibold tracking-tight">{DEMO_PROJECT.name}</h3>
      <p className="mt-1 text-sm text-ink-muted">{DEMO_PROJECT.client} · generated from the ticks you made above</p>
      <div className="mt-6 space-y-5">
        <ExportBlock title="Agreed scope" progress={scope.percent} items={tasks.filter((task) => task.kind === "scope")} />
        <ExportBlock title={DEMO_REVISION_LABEL} progress={revision.percent} items={tasks.filter((task) => task.kind === "revision")} />
      </div>
    </div>
  );
}

function ExportBlock({ title, progress, items }: { title: string; progress: number; items: DemoTask[] }) {
  return (
    <div className="rounded-xl border border-line bg-canvas p-4">
      <div className="flex items-center justify-between gap-3">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs font-medium tabular text-ink-muted">{progress}%</p>
      </div>
      <ProgressBar className="mt-2" value={progress} size="sm" label={title} />
      <ul className="mt-3 space-y-1">
        {items.map((task) => (
          <li key={task.id} className="flex items-center justify-between gap-3 text-sm">
            <span className={cn("text-ink", task.done && "text-ink-muted")}>{task.title}</span>
            <span className="text-xs font-medium text-ink-faint">{task.done ? "Done" : "Open"}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

type CtaVariant = "primary" | "secondary" | "ghost" | "on-dark" | "on-dark-ghost";

function CtaLink({ to, variant, className, children }: { to: string; variant: CtaVariant; className?: string; children: ReactNode }) {
  const styles: Record<CtaVariant, string> = {
    primary: "bg-accent text-accent-fg hover:bg-accent-hover shadow-[inset_0_1px_0_rgb(255_255_255/0.12)]",
    secondary: "bg-surface text-ink border border-line hover:bg-surface-muted",
    ghost: "text-ink-muted hover:text-ink hover:bg-surface-muted",
    "on-dark": "bg-white text-ink hover:bg-white/90",
    "on-dark-ghost": "text-white/80 hover:text-white hover:bg-white/10",
  };
  return (
    <Link
      to={to}
      className={cn(
        "inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-lg px-4 text-sm font-medium whitespace-nowrap transition-colors",
        styles[variant],
        className,
      )}
    >
      {children}
    </Link>
  );
}
