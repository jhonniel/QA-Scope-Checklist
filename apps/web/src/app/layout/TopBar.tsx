import { Suspense, useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate, useSearchParams } from "react-router";
import { ChevronLeft } from "lucide-react";
import { ClerkUserMenu } from "@/app/AuthProviderRoot";
import { routes, TASK_PARAM } from "@/app/routes";
import { Breadcrumbs, MemberAvatar, SearchInput, Skeleton } from "@/design-system";
import { usingClerk } from "@/services/auth/externalAuth";
import { useAppStore } from "@/store/useAppStore";
import { GlobalSearchResults, type SearchResultItem } from "./GlobalSearchResults";
import { usePageMeta } from "./usePageMeta";
import { clearSearchQuery, flushSearchQuery, useSearchQuery } from "./useSearchQuery";

const RESULTS_ID = "topbar-search-results";

/**
 * Top navigation: breadcrumbs + search + profile on desktop; compact title
 * bar with a back control on mobile. The search box always finds projects,
 * scopes and tasks across the workspace (results in a dropdown). On pages
 * that filter their own list it also drives that list through `?q=`.
 */
export function TopBar() {
  const navigate = useNavigate();
  const [, setParams] = useSearchParams();
  const { title, crumbs, backTo } = usePageMeta();
  const [query, setQuery] = useSearchQuery();
  const currentUser = useAppStore((s) => s.currentUser);
  const searchRef = useRef<HTMLInputElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);
  const [items, setItems] = useState<SearchResultItem[]>([]);
  const [panelRect, setPanelRect] = useState<{ top: number; left: number; width: number } | null>(null);
  const resultsOpen = open && query.trim().length > 0;
  const onItemsChange = useCallback((next: SearchResultItem[]) => {
    setItems(next);
    setActiveIndex((i) => (i >= next.length ? -1 : i));
  }, []);

  useLayoutEffect(() => {
    if (!resultsOpen) {
      setPanelRect(null);
      return;
    }
    const update = () => {
      const el = boxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      setPanelRect({ top: r.bottom + 6, left: r.left, width: r.width });
    };
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, [resultsOpen, query]);

  const dismiss = useCallback(() => {
    flushSearchQuery(setParams);
    setOpen(false);
  }, [setParams]);

  const pick = (item: SearchResultItem) => {
    // Navigating drops `?q=` with the old URL, so the box clears itself.
    const to =
      item.kind === "project"
        ? routes.project(item.uuid)
        : item.kind === "section"
          ? routes.section(item.projectUuid, item.uuid)
          : `${routes.project(item.projectUuid)}?${TASK_PARAM}=${item.uuid}`;
    // Clear in memory only — a `?q=` write here would race `navigate` and drop `?task=`.
    clearSearchQuery();
    setOpen(false);
    navigate(to);
    searchRef.current?.blur();
  };

  const onSearchKeyDown = (e: ReactKeyboardEvent<HTMLInputElement>) => {
    if (!resultsOpen) {
      if (e.key === "Escape") {
        searchRef.current?.blur();
        dismiss();
      }
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (items.length === 0 ? -1 : (i + 1) % items.length));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (items.length === 0 ? -1 : (i - 1 + items.length) % items.length));
    } else if (e.key === "Enter") {
      const target = items[activeIndex] ?? items[0];
      if (target) {
        e.preventDefault();
        pick(target);
      }
    } else if (e.key === "Escape") {
      e.preventDefault();
      if (query) setQuery("");
      else {
        searchRef.current?.blur();
        dismiss();
      }
    }
  };

  // "/" focuses search from anywhere (unless typing in a field).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const typing = target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT" || target.isContentEditable);
      if (typing) return;
      e.preventDefault();
      searchRef.current?.focus();
      setOpen(true);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!resultsOpen) return;
    const onPointer = (e: PointerEvent) => {
      const target = e.target as Node | null;
      if (!target) return;
      if (boxRef.current?.contains(target)) return;
      if (document.getElementById(RESULTS_ID)?.contains(target)) return;
      dismiss();
    };
    document.addEventListener("pointerdown", onPointer);
    return () => document.removeEventListener("pointerdown", onPointer);
  }, [resultsOpen, dismiss]);

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

      <div
        ref={boxRef}
        className="relative hidden w-64 md:block lg:w-80"
        onBlur={(e) => {
          // Stay open when focus moves into the portaled results (or a child of this box).
          const next = e.relatedTarget as HTMLElement | null;
          if (next && (e.currentTarget.contains(next) || document.getElementById(RESULTS_ID)?.contains(next))) return;
          // React Router focuses `<main id="main">` on some location writes — that is not a real dismiss.
          if (next?.id === "main") return;
          dismiss();
        }}
      >
        <SearchInput
          ref={searchRef}
          value={query}
          onChange={(value) => {
            setQuery(value);
            setOpen(true);
            setActiveIndex(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onSearchKeyDown}
          placeholder="Search projects and tasks"
          shortcutHint="/"
          aria-label="Search"
          role="combobox"
          aria-expanded={resultsOpen}
          aria-controls={resultsOpen ? RESULTS_ID : undefined}
          aria-autocomplete="list"
          aria-activedescendant={resultsOpen && activeIndex >= 0 ? `${RESULTS_ID}-${activeIndex}` : undefined}
        />
        {resultsOpen &&
          panelRect &&
          createPortal(
            <div
              className="z-50"
              style={{ position: "fixed", top: panelRect.top, left: panelRect.left, width: Math.max(panelRect.width, 288) }}
              onMouseDown={(e) => e.preventDefault()}
            >
              <GlobalSearchResults id={RESULTS_ID} query={query} activeIndex={activeIndex} onItemsChange={onItemsChange} onPick={pick} onHover={setActiveIndex} />
            </div>,
            document.body,
          )}
      </div>

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
