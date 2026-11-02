import { Outlet, useLocation, useNavigate } from "react-router";
import { ShieldCheck } from "lucide-react";
import { routes } from "@/app/routes";
import { PageHeader } from "@/app/layout/PageHeader";
import { Badge, SegmentedControl } from "@/design-system";

type Tab = "overview" | "users" | "productivity" | "projects" | "audit" | "errors";

const TAB_ROUTE: Record<Tab, string> = {
  overview: routes.admin(),
  users: routes.adminUsers(),
  productivity: routes.adminProductivity(),
  projects: routes.adminProjects(),
  audit: routes.adminAudit(),
  errors: routes.adminErrors(),
};

function currentTab(pathname: string): Tab {
  if (pathname.startsWith(routes.adminUsers())) return "users";
  if (pathname.startsWith(routes.adminProductivity())) return "productivity";
  if (pathname.startsWith(routes.adminProjects())) return "projects";
  if (pathname.startsWith(routes.adminAudit())) return "audit";
  if (pathname.startsWith(routes.adminErrors())) return "errors";
  return "overview";
}

/** Frame for the admin area: heading, section tabs and the routed section. */
export function AdminLayout() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const tab = currentTab(pathname);

  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-5 lg:px-8 lg:py-8">
      <PageHeader
        eyebrow={
          <Badge tone="accent">
            <ShieldCheck className="size-3.5" aria-hidden /> Administrator
          </Badge>
        }
        title="Administration"
        description="Monitor the whole system, manage accounts and every project, and review what administrators changed."
      />

      <div className="mt-5 -mx-4 overflow-x-auto px-4 pb-1 scrollbar-none sm:mx-0 sm:px-0">
        <SegmentedControl<Tab>
          layoutId="admin-tabs"
          ariaLabel="Administration sections"
          value={tab}
          onChange={(next) => navigate(TAB_ROUTE[next])}
          options={[
            { value: "overview", label: "Overview" },
            { value: "users", label: "Users" },
            { value: "productivity", label: "Productivity" },
            { value: "projects", label: "Projects" },
            { value: "audit", label: "Audit log" },
            { value: "errors", label: "Errors" },
          ]}
        />
      </div>

      <Outlet />
    </div>
  );
}
