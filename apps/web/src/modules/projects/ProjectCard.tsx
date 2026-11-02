import { Link } from "react-router";
import { motion } from "framer-motion";
import { CalendarDays } from "lucide-react";
import type { Project } from "@scope/contracts";
import { routes } from "@/app/routes";
import { cn } from "@/lib/cn";
import { formatDueDate, isOverdue } from "@/lib/date";
import { riseIn } from "@/lib/motion";
import { AnimatedNumber, AvatarStack, ProgressRing } from "@/design-system";
import { ProjectStatusBadge } from "./ProjectStatusBadge";

export interface ProjectCardProps {
  project: Project;
  onSelect?: (project: Project) => void;
  className?: string;
}

export function ProjectCard({ project, onSelect, className }: ProjectCardProps) {
  const { stats } = project;
  const overdue = project.status === "active" && isOverdue(project.deadline);

  return (
    <motion.li variants={riseIn} className={cn("list-none", className)}>
      <Link
        to={routes.project(project.uuid)}
        onClick={() => onSelect?.(project)}
        className="group flex h-full flex-col rounded-2xl border border-line bg-surface p-5 transition-colors hover:border-line-strong active:bg-surface-muted"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-[15px] font-semibold text-ink">{project.name}</h3>
            <p className="mt-1 line-clamp-2 text-sm leading-5 text-ink-muted">{project.description || "No description"}</p>
          </div>
          <ProgressRing value={stats.completionPercent} size={52} strokeWidth={5} label={`${project.name} completion`}>
            <AnimatedNumber value={stats.completionPercent} suffix="%" className="text-[11px] font-semibold tabular text-ink" />
          </ProgressRing>
        </div>

        <div className="mt-auto flex items-center justify-between gap-3 pt-5">
          <div className="flex min-w-0 items-center gap-2">
            <ProjectStatusBadge status={project.status} />
            <span className="truncate text-xs tabular text-ink-faint">
              {stats.completedTasks}/{stats.totalTasks} tasks
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-3">
            {project.deadline && project.status === "active" && (
              <span className={cn("hidden items-center gap-1 text-xs tabular text-ink-muted sm:inline-flex", overdue && "font-medium text-danger")}>
                <CalendarDays className="size-3.5" aria-hidden />
                {formatDueDate(project.deadline)}
              </span>
            )}
            <AvatarStack users={project.members.map((m) => m.user)} max={3} size="sm" />
          </div>
        </div>
      </Link>
    </motion.li>
  );
}
