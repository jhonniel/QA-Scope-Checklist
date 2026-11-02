import { Suspense, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router";
import { ChevronLeft } from "lucide-react";
import { ClerkUserMenu } from "@/app/AuthProviderRoot";
import { routes } from "@/app/routes";
import { Breadcrumbs, MemberAvatar, SearchInput, Skeleton } from "@/design-system";
import { usingClerk } from "@/services/auth/externalAuth";
import { useAppStore } from "@/store/useAppStore";
import { usePageMeta } from "./usePageMeta";
import { useSearchQuery } from "./useSearchQuery";

/**
 * Top navigation: breadcrumbs + search + profile on desktop; compact title
 * bar with a back control on mobile.
 */
export function TopBar() {
  const navigate = useNavigate();
  const { title, crumbs, backTo } = usePageMeta();
  const [query, setQuery] = useSearchQuery();
  const currentUser = useAppStore((s) => s.currentUser);
  const searchRef = useRef<HTMLInputElement>(null);

  // "/" focuses search from anywhere (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
      if (e.key === "/" && !typing) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <header className="sticky top-0 z-30 flex h-topbar shrink-0 items-center gap-3 border-b border-line bg-canvas/85 px-4 backdrop-blur-md lg:px-6">
      {/* Mobile: back + title */}
      <div className="flex min-w-0 flex-1 items-center gap-1 lg:hidden">
        {backTo ? (
          <button
            type="button"
            onClick={() => navigate(backTo)}
            aria-label="Back"
            className="-ml-2 flex size-10 items-center justify-center rounded-full text-ink hover:bg-surface-muted"
          >
            <ChevronLeft className="size-5" aria-hidden />
          </button>
        ) : (
          <span className="mr-1 flex size-7 items-center justify-center rounded-lg bg-accent text-accent-fg" aria-hidden>
            <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 11l3 3L22 4" />
              <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
            </svg>
          </span>
        )}
        <h1 className="truncate text-base font-semibold text-ink">{title}</h1>
      </div>

      {/* Desktop: breadcrumbs */}
      <div className="hidden min-w-0 flex-1 lg:block">
        <Breadcrumbs items={crumbs} />
      </div>

      <SearchInput
        ref={searchRef}
        value={query}
        onChange={setQuery}
        placeholder="Search tasks"
        shortcutHint="/"
        className="hidden w-64 md:flex"
        aria-label="Search"
      />

      {usingClerk ? (
        // Clerk's account menu (manage account, sign out) with a link back to the in-app profile.
        <Suspense fallback={<Skeleton className="size-9 rounded-full" />}>
          <ClerkUserMenu />
        </Suspense>
      ) : (
        <Link to={routes.profile()} aria-label="Your profile" className="rounded-full">
          {currentUser ? <MemberAvatar user={currentUser} size="md" /> : <Skeleton className="size-9 rounded-full" />}
        </Link>
      )}
    </header>
  );
}
