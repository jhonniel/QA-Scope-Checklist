import { useEffect, useRef } from "react";
import { Outlet } from "react-router";
import { WifiOff } from "lucide-react";
import { useOnline } from "@/lib/useOnline";
import { TaskDetailSheet } from "@/modules/checklist/TaskDetailSheet";
import { Sidebar } from "./Sidebar";
import { TopBar } from "./TopBar";
import { BottomNav } from "./BottomNav";
import { PageTransition } from "./PageTransition";
import { usePageMeta } from "./usePageMeta";

/**
 * Application frame.
 * Desktop: sidebar + top bar + scrollable main.
 * Mobile:  top bar + scrollable main + bottom navigation.
 * The task detail sheet is mounted once here so any page can open it.
 * Session resolution happens in the `RequireAuth` guard above this shell.
 */
export function AppShell() {
  const mainRef = useRef<HTMLElement>(null);
  const online = useOnline();
  const { title } = usePageMeta();

  // Browser tab title follows the page so history and tab switching stay readable.
  useEffect(() => {
    document.title = title === "Dashboard" ? "Scope Checklist" : `${title} · Scope Checklist`;
  }, [title]);

  return (
    <div className="flex h-dvh w-full overflow-hidden bg-canvas">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <Sidebar className="hidden lg:flex" />
      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar />
        {!online && (
          <div role="status" className="flex items-center justify-center gap-2 border-b border-line bg-surface-muted px-4 py-1.5 text-xs font-medium text-ink-muted">
            <WifiOff className="size-3.5" aria-hidden />
            You are offline — changes will fail until the connection returns.
          </div>
        )}
        <main
          ref={mainRef}
          id="main"
          tabIndex={-1}
          className="relative min-h-0 flex-1 overflow-x-hidden overflow-y-auto pb-[calc(var(--spacing-bottomnav)+env(safe-area-inset-bottom))] outline-none scrollbar-thin lg:pb-0"
        >
          <PageTransition scrollRef={mainRef}>
            <Outlet />
          </PageTransition>
        </main>
        <BottomNav className="lg:hidden" />
      </div>
      <TaskDetailSheet />
    </div>
  );
}
