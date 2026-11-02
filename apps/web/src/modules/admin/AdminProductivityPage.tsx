import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { motion } from "framer-motion";
import { Award, CheckCheck, FileDown, Info, ListChecks, MessageSquare, Pencil, Plus, Trophy, Users } from "lucide-react";
import { ADMIN_PRODUCTIVITY_PERIODS, type AdminProductivity, type AdminProductivityEntry, type AdminProductivityPeriod, type ProductivityBucket } from "@scope/contracts";
import { routes } from "@/app/routes";
import { cn } from "@/lib/cn";
import { formatRelative } from "@/lib/date";
import { riseIn, staggerChildren } from "@/lib/motion";
import { AnimatedNumber, Badge, BentoCard, BentoGrid, Button, Card, EmptyState, MemberAvatar, Meter, SegmentedControl, Skeleton } from "@/design-system";
import { api, ApiError } from "@/services/api";

const PERIOD_LABEL: Record<AdminProductivityPeriod, string> = { "7d": "7 days", "30d": "30 days", "90d": "90 days", all: "All time" };
const isPeriod = (v: string): v is AdminProductivityPeriod => (ADMIN_PRODUCTIVITY_PERIODS as readonly string[]).includes(v);
const plural = (n: number, noun: string) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/** Buckets shown as the per-user breakdown, in display order. */
const BUCKETS: { key: ProductivityBucket; label: string; short: string; icon: typeof CheckCheck }[] = [
  { key: "tasksCompleted", label: "Tasks completed", short: "done", icon: CheckCheck },
  { key: "tasksChecked", label: "Checks recorded", short: "checks", icon: ListChecks },
  { key: "tasksCreated", label: "Tasks created", short: "created", icon: Plus },
  { key: "tasksUpdated", label: "Task edits", short: "edits", icon: Pencil },
  { key: "comments", label: "Comments", short: "comments", icon: MessageSquare },
  { key: "exports", label: "Exports", short: "exports", icon: FileDown },
];

/** Who is getting work done: every account ranked by weighted activity over a look-back window. */
export function AdminProductivityPage() {
  // Not `useListParams`: it treats the value "all" as "clear the filter", which is a real period here.
  const [params, setParams] = useSearchParams();
  const rawPeriod = params.get("period") ?? "";
  const period: AdminProductivityPeriod = isPeriod(rawPeriod) ? rawPeriod : "30d";
  const setPeriod = (next: AdminProductivityPeriod) => {
    const search = new URLSearchParams(params);
    next === "30d" ? search.delete("period") : search.set("period", next);
    setParams(search, { replace: true });
  };
  const [data, setData] = useState<AdminProductivity | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    api
      .adminProductivity({ period })
      .then((res) => {
        if (!cancelled) setData(res);
      })
      .catch((err) => {
        if (!cancelled) setError(ApiError.message(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [period, tick]);

  const entries = data?.entries ?? [];
  const active = entries.filter((e) => e.totalActions > 0);
  const idle = entries.filter((e) => e.totalActions === 0);
  const topScore = Math.max(1, ...active.map((e) => e.score));
  const leader = active[0];

  return (
    <>
      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="-mx-4 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
          <SegmentedControl<AdminProductivityPeriod>
            layoutId="admin-productivity-period"
            ariaLabel="Look-back period"
            value={period}
            onChange={setPeriod}
            options={ADMIN_PRODUCTIVITY_PERIODS.map((p) => ({ value: p, label: PERIOD_LABEL[p] }))}
          />
        </div>
        <p className="text-xs text-ink-faint">Based on the project activity log · {data ? `updated ${formatRelative(data.generatedAt)}` : "…"}</p>
      </div>

      {error ? (
        <div className="mt-4 flex flex-col items-center gap-3 rounded-2xl border border-line bg-surface py-10 text-center">
          <p className="text-sm text-danger">{error}</p>
          <Button variant="secondary" size="sm" onClick={() => setTick((t) => t + 1)}>
            Retry
          </Button>
        </div>
      ) : (
        <>
          {/* Headline figures */}
          <BentoGrid className="mt-4">
            <BentoCard cols={2} className={cn("justify-between", leader && "border-accent bg-accent text-accent-fg")} label={<span className={cn(leader && "text-accent-fg/75")}>Most productive · {PERIOD_LABEL[period].toLowerCase()}</span>}>
              {!data ? (
                <div className="flex items-center gap-3">
                  <Skeleton className="size-12 rounded-full" />
                  <span className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-40" />
                    <Skeleton className="h-3 w-56" />
                  </span>
                </div>
              ) : leader ? (
                <div className="flex items-center gap-4">
                  <span className="relative">
                    <MemberAvatar user={leader.user} size="lg" plain />
                    <span className="absolute -right-1 -bottom-1 flex size-5 items-center justify-center rounded-full bg-warning text-white" aria-hidden>
                      <Trophy className="size-3" />
                    </span>
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-lg font-semibold">{leader.user.name}</p>
                    <p className="truncate text-xs text-accent-fg/75">
                      {plural(leader.counts.tasksCompleted, "task")} completed · {plural(leader.counts.tasksChecked, "check")} · {plural(leader.activeDays, "active day")} across {plural(leader.projects, "project")}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-3xl font-semibold tabular">
                      <AnimatedNumber value={leader.score} />
                    </p>
                    <p className="text-[10px] font-medium tracking-wide text-accent-fg/75 uppercase">points</p>
                  </div>
                </div>
              ) : (
                <p className="text-sm text-ink-faint">No activity recorded in this period.</p>
              )}
            </BentoCard>
            <Tile label="Active people" value={data ? data.totals.activeUsers : null} hint={data ? `of ${entries.length} accounts` : ""} icon={<Users className="size-4" aria-hidden />} />
            <Tile label="Actions logged" value={data ? data.totals.actions : null} hint={data ? `${data.totals.score} points in total` : ""} icon={<Award className="size-4" aria-hidden />} />
          </BentoGrid>

          {/* Ranking */}
          <Card className="mt-4" padded={false}>
            <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h2 className="text-sm font-semibold text-ink">Ranking</h2>
              <span className="text-xs text-ink-faint">{loading ? "Updating…" : `${active.length} active · ${idle.length} without activity`}</span>
            </div>
            {!data && loading ? (
              <ul aria-busy="true" aria-label="Loading ranking" className="divide-y divide-line">
                {Array.from({ length: 4 }).map((_, i) => (
                  <li key={i} className="flex items-center gap-3 px-4 py-4">
                    <Skeleton className="size-6 rounded-full" />
                    <Skeleton className="size-9 rounded-full" />
                    <span className="flex-1 space-y-2">
                      <Skeleton className="h-3.5 w-40" />
                      <Skeleton className="h-2 w-full" />
                    </span>
                  </li>
                ))}
              </ul>
            ) : entries.length === 0 ? (
              <EmptyState icon={<Users />} title="No accounts" compact />
            ) : (
              <motion.ol variants={staggerChildren(0.05)} initial="hidden" animate="visible" className={cn("divide-y divide-line transition-opacity", loading && "opacity-60")}>
                {active.map((entry, index) => (
                  <RankRow key={entry.user.uuid} entry={entry} rank={index + 1} share={entry.score / topScore} />
                ))}
                {idle.length > 0 && (
                  <motion.li variants={riseIn} layout="position" className="px-4 py-3">
                    <p className="text-xs font-medium tracking-wide text-ink-faint uppercase">No activity in this period</p>
                    <ul className="mt-2 flex flex-wrap gap-2">
                      {idle.map((entry) => (
                        <li key={entry.user.uuid} className="inline-flex items-center gap-1.5 rounded-full border border-line px-2 py-1 text-xs text-ink-muted">
                          <MemberAvatar user={entry.user} size="xs" plain className={cn(entry.disabled && "opacity-50 grayscale")} />
                          <span className={cn(entry.disabled && "line-through")}>{entry.user.name}</span>
                          {entry.disabled && <span className="text-ink-faint">(disabled)</span>}
                        </li>
                      ))}
                    </ul>
                  </motion.li>
                )}
              </motion.ol>
            )}
            {data && (
              <p className="flex items-start gap-1.5 border-t border-line px-4 py-3 text-xs text-ink-faint">
                <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
                <span>
                  Points: {BUCKETS.map((b) => `${b.label.toLowerCase()} ×${data.weights[b.key]}`).join(", ")}, other project changes ×{data.weights.other}. Only what is recorded in project activity counts — reading and
                  exporting preview do not. Open an account in <Link to={routes.adminUsers()} className="font-medium text-ink-muted underline-offset-2 hover:text-ink hover:underline">Users</Link> to manage it.
                </span>
              </p>
            )}
          </Card>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function RankRow({ entry, rank, share }: { entry: AdminProductivityEntry; rank: number; share: number }) {
  const podium = rank <= 3;
  return (
    <motion.li variants={riseIn} layout="position" className="px-4 py-3.5">
      <div className="flex items-center gap-3">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold tabular",
            rank === 1 ? "bg-warning text-white" : podium ? "bg-accent-soft text-accent" : "bg-surface-sunken text-ink-muted",
          )}
          aria-label={`Rank ${rank}`}
        >
          {rank}
        </span>
        <MemberAvatar user={entry.user} size="md" plain className={cn(entry.disabled && "opacity-50 grayscale")} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className={cn("truncate text-sm font-medium text-ink", entry.disabled && "text-ink-muted line-through decoration-line-strong")}>{entry.user.name}</span>
            {entry.disabled && <Badge tone="danger">Disabled</Badge>}
            <span className="text-xs text-ink-faint">{entry.lastActiveAt ? `last active ${formatRelative(entry.lastActiveAt)}` : ""}</span>
          </div>
          <div className="mt-1.5 flex items-center gap-3">
            <Meter value={Math.max(3, share * 100)} className={rank === 1 ? "bg-warning" : "bg-accent"} trackClassName="flex-1" delay={Math.min(rank - 1, 8) * 0.05} />
            <span className="w-16 shrink-0 text-right text-sm font-semibold tabular text-ink">
              <AnimatedNumber value={entry.score} delay={Math.min(rank - 1, 8) * 0.05} /> <span className="text-[10px] font-normal text-ink-faint">pts</span>
            </span>
          </div>
        </div>
      </div>
      <ul className="mt-2 flex flex-wrap gap-x-3 gap-y-1 pl-9 text-xs text-ink-muted sm:pl-[4.5rem]" aria-label={`${entry.user.name} breakdown`}>
        {BUCKETS.filter((b) => entry.counts[b.key] > 0).map((b) => (
          <li key={b.key} className="inline-flex items-center gap-1 tabular">
            <b.icon className="size-3 text-ink-faint" aria-hidden />
            {entry.counts[b.key]} {b.short}
          </li>
        ))}
        {entry.counts.other > 0 && <li className="tabular">{entry.counts.other} other</li>}
        <li className="tabular text-ink-faint">
          {plural(entry.activeDays, "active day")} · {plural(entry.projects, "project")}
        </li>
      </ul>
    </motion.li>
  );
}

function Tile({ label, value, hint, icon }: { label: string; value: number | null; hint: string; icon: React.ReactNode }) {
  return (
    <BentoCard smCols={1} tinted className="p-4 sm:p-5">
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-xs font-medium tracking-wide text-ink-muted uppercase">{label}</p>
        <span className="shrink-0 text-ink-faint">{icon}</span>
      </div>
      {value === null ? (
        <Skeleton className="mt-auto h-9 w-16" />
      ) : (
        <p className="mt-auto pt-5 text-3xl font-semibold tracking-tight tabular sm:pt-6 sm:text-4xl">
          <AnimatedNumber value={value} />
        </p>
      )}
      <p className="mt-1 truncate text-xs text-ink-muted">{hint}</p>
    </BentoCard>
  );
}
