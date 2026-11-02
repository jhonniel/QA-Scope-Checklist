import { useMemo, useState } from "react";
import { motion } from "framer-motion";
import { FolderKanban, Plus } from "lucide-react";
import type { ProjectStatus } from "@scope/contracts";
import { useSearchQuery } from "@/app/layout/useSearchQuery";
import { staggerChildren } from "@/lib/motion";
import { Button, CardSkeleton, EmptyState, SegmentedControl } from "@/design-system";
import { useAppStore } from "@/store/useAppStore";
import { ProjectCard } from "./ProjectCard";
import { CreateProjectSheet } from "./CreateProjectSheet";
import { PageHeader } from "@/app/layout/PageHeader";

type Filter = "all" | ProjectStatus;

export function ProjectsPage() {
  const projects = useAppStore((s) => s.projects);
  const bootState = useAppStore((s) => s.bootState);
  const setActiveProject = useAppStore((s) => s.setActiveProject);
  const [query] = useSearchQuery();
  const [filter, setFilter] = useState<Filter>("all");
  const [creating, setCreating] = useState(false);

  const counts = useMemo(
    () => ({
      all: projects.length,
      active: projects.filter((p) => p.status === "active").length,
      completed: projects.filter((p) => p.status === "completed").length,
      archived: projects.filter((p) => p.status === "archived").length,
    }),
    [projects],
  );

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return projects.filter((p) => (filter === "all" || p.status === filter) && (!q || p.name.toLowerCase().includes(q) || p.description.toLowerCase().includes(q)));
  }, [projects, filter, query]);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8 lg:py-8">
      <PageHeader
        title="Projects"
        description="Everything you own or have been invited to."
        actions={
          <Button variant="primary" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
            New project
          </Button>
        }
      />

      <div className="mt-5 flex items-center justify-between gap-3 overflow-x-auto scrollbar-none">
        <SegmentedControl<Filter>
          layoutId="projects-filter"
          ariaLabel="Filter projects by status"
          value={filter}
          onChange={setFilter}
          options={[
            { value: "all", label: "All", count: counts.all },
            { value: "active", label: "Active", count: counts.active },
            { value: "completed", label: "Completed", count: counts.completed },
            { value: "archived", label: "Archived", count: counts.archived },
          ]}
        />
      </div>

      {bootState !== "ready" ? (
        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <CardSkeleton key={i} className="h-44" />
          ))}
        </div>
      ) : visible.length === 0 ? (
        <EmptyState
          icon={<FolderKanban />}
          title={query ? "No projects match your search" : "No projects here"}
          description={query ? "Try a different name or clear the search." : "Create a project to start building its checklist."}
          action={
            !query && (
              <Button variant="primary" leadingIcon={<Plus className="size-4" aria-hidden />} onClick={() => setCreating(true)}>
                New project
              </Button>
            )
          }
        />
      ) : (
        <motion.ul variants={staggerChildren()} initial="hidden" animate="visible" className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {visible.map((project) => (
            <ProjectCard key={project.uuid} project={project} onSelect={(p) => setActiveProject(p.uuid)} />
          ))}
        </motion.ul>
      )}

      <CreateProjectSheet open={creating} onClose={() => setCreating(false)} />
    </div>
  );
}
