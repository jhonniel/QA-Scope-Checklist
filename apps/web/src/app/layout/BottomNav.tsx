import { NavLink } from "react-router";
import { Activity, FolderKanban, LayoutDashboard, UserRound } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { routes } from "@/app/routes";
import { cn } from "@/lib/cn";

const items = [
  { to: routes.dashboard(), label: "Home", icon: LayoutDashboard, end: true },
  { to: routes.projects(), label: "Projects", icon: FolderKanban, end: false },
  { to: routes.activity(), label: "Activity", icon: Activity, end: false },
  { to: routes.profile(), label: "Profile", icon: UserRound, end: false },
];

/** Mobile bottom navigation for the primary sections. */
export function BottomNav({ className }: { className?: string }) {
  const reduceMotion = useReducedMotion();
  return (
    <nav className={cn("fixed inset-x-0 bottom-0 z-30 border-t border-line bg-canvas/90 backdrop-blur-md safe-bottom", className)} aria-label="Primary">
      <ul className="grid h-bottomnav grid-cols-4">
        {items.map(({ to, label, icon: Icon, end }) => (
          <li key={to} className="flex">
            <NavLink
              to={to}
              end={end}
              className={({ isActive }) =>
                cn("relative flex flex-1 flex-col items-center justify-center gap-1 text-[11px] font-medium", isActive ? "text-accent" : "text-ink-muted")
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="bottom-nav-indicator"
                      className="absolute top-0 h-0.5 w-8 rounded-full bg-accent"
                      transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 500, damping: 40 }}
                      aria-hidden
                    />
                  )}
                  <Icon className="size-5" aria-hidden />
                  {label}
                </>
              )}
            </NavLink>
          </li>
        ))}
      </ul>
    </nav>
  );
}
