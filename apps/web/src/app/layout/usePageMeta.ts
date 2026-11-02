import { useLocation, useParams } from "react-router";
import { routes } from "@/app/routes";
import type { Crumb } from "@/design-system";
import { selectProject, selectSections, useAppStore } from "@/store/useAppStore";

export interface PageMeta {
  title: string;
  crumbs: Crumb[];
  /** Where the mobile back button goes; `null` on top-level pages. */
  backTo: string | null;
  /**
   * What the top-bar search box does here: "page" when the page reads `?q=`
   * and filters its own list, "global" when the box searches every project
   * and shows results in a dropdown instead.
   */
  searchScope: "page" | "global";
}

/** Derive breadcrumbs, mobile title, back target and search behaviour from the current route. */
export function usePageMeta(): PageMeta {
  const { pathname } = useLocation();
  const { projectUuid, sectionUuid } = useParams();
  const project = useAppStore(selectProject(projectUuid ?? null));
  const sections = useAppStore(selectSections(projectUuid ?? null));
  const section = sectionUuid ? sections?.find((s) => s.uuid === sectionUuid) : undefined;

  if (projectUuid) {
    const projectName = project?.name ?? "Project";
    const crumbs: Crumb[] = [{ label: "Projects", to: routes.projects() }, { label: projectName, to: routes.project(projectUuid) }];
    if (sectionUuid) {
      crumbs.push({ label: section?.title ?? "Scope" });
      return { title: section?.title ?? "Scope", crumbs, backTo: routes.project(projectUuid), searchScope: "page" };
    }
    return { title: projectName, crumbs, backTo: routes.projects(), searchScope: "page" };
  }

  if (pathname.startsWith(routes.projects())) return { title: "Projects", crumbs: [{ label: "Projects" }], backTo: null, searchScope: "page" };
  if (pathname.startsWith(routes.activity())) return { title: "Activity", crumbs: [{ label: "Activity" }], backTo: null, searchScope: "global" };
  if (pathname.startsWith(routes.profile())) return { title: "Profile", crumbs: [{ label: "Profile" }], backTo: null, searchScope: "global" };
  if (pathname.startsWith(routes.invitations())) return { title: "Invitations", crumbs: [{ label: "Invitations" }], backTo: routes.dashboard(), searchScope: "global" };
  if (pathname.startsWith(routes.admin())) {
    const section = pathname.startsWith(routes.adminUsers()) ? "Users" : pathname.startsWith(routes.adminProjects()) ? "Projects" : pathname.startsWith(routes.adminAudit()) ? "Audit log" : null;
    const crumbs: Crumb[] = section ? [{ label: "Administration", to: routes.admin() }, { label: section }] : [{ label: "Administration" }];
    // Users, Projects and Errors filter their own tables from `?q=`; the overview, audit log and productivity do not.
    const filtersItself = pathname.startsWith(routes.adminUsers()) || pathname.startsWith(routes.adminProjects()) || pathname.startsWith(routes.adminErrors());
    return { title: section ? `Admin · ${section}` : "Administration", crumbs, backTo: section ? routes.admin() : routes.profile(), searchScope: filtersItself ? "page" : "global" };
  }
  return { title: "Dashboard", crumbs: [{ label: "Dashboard" }], backTo: null, searchScope: "global" };
}
