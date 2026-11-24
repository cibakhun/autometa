"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { createContext, use, useCallback, useEffect, useMemo, useState, useTransition, type ComponentProps, type ReactNode } from "react";

/** A page load slower than this is taken as stopped by the user; a real one replaces the page first. */
const LEAVING_TIMEOUT_MS = 20_000;

/** What started a navigation, so only that control shows a spinner ("form", "ki", "sort", …). */
type Origin = string | null;

interface SearchNavigation {
  /** True from a click or submit until the new results are on screen. */
  pending: boolean;
  /** The origin passed to navigate or markLeaving while pending, else null. */
  pendingOrigin: Origin;
  navigate: (href: string, origin?: Origin) => void;
  /** For a plain form or link that leaves the page (the search in own words): pending until the page is replaced. */
  markLeaving: (origin?: Origin) => void;
}

const SearchNavigationContext = createContext<SearchNavigation>({
  pending: false,
  pendingOrigin: null,
  navigate: () => {},
  markLeaving: () => {},
});

/**
 * Around the search page: a search can take seconds, and a client navigation keeps the old
 * results on screen meanwhile. Navigations started here run in one transition, so the control
 * that started it, the results and a bar at the top can show that the next results are coming.
 */
export function SearchTransition({ children }: { children: ReactNode }) {
  const router = useRouter();
  const [navigating, startTransition] = useTransition();
  const [leaving, setLeaving] = useState(false);
  const [origin, setOrigin] = useState<Origin>(null);

  // Coming back from the next page via the browser's back/forward cache restores the old state.
  useEffect(() => {
    const reset = (event: PageTransitionEvent) => event.persisted && setLeaving(false);
    window.addEventListener("pageshow", reset);
    return () => window.removeEventListener("pageshow", reset);
  }, []);

  // A document navigation the user stops (Esc, stop button) fires no event: the page simply stays.
  // Without a sign of the next page after a while, the pending state ends, so it can't hang forever.
  useEffect(() => {
    if (!leaving) return;
    const timer = window.setTimeout(() => setLeaving(false), LEAVING_TIMEOUT_MS);
    return () => window.clearTimeout(timer);
  }, [leaving]);

  const navigate = useCallback(
    (href: string, from: Origin = null) => {
      // A client navigation never inherits a document navigation that did not happen.
      setLeaving(false);
      setOrigin(from);
      startTransition(() => router.push(href));
    },
    [router],
  );
  const markLeaving = useCallback((from: Origin = null) => {
    setOrigin(from);
    setLeaving(true);
  }, []);
  const pending = navigating || leaving;
  const value = useMemo(
    () => ({ pending, pendingOrigin: pending ? origin : null, navigate, markLeaving }),
    [pending, origin, navigate, markLeaving],
  );

  return (
    <SearchNavigationContext value={value}>
      <div
        aria-hidden="true"
        className={`pointer-events-none fixed inset-x-0 top-0 z-50 h-1 overflow-hidden transition-opacity ${pending ? "opacity-100 delay-150" : "opacity-0"}`}
      >
        <div className="search-progress h-full w-1/3 bg-accent" />
      </div>
      {children}
    </SearchNavigationContext>
  );
}

export const useSearchNavigation = () => use(SearchNavigationContext);

/** A link to another search (page, filter removed, reset) that shows the pending state while it loads. */
export function SearchLink({ href, ...props }: Omit<ComponentProps<typeof Link>, "href" | "onNavigate"> & { href: string }) {
  const { navigate } = useSearchNavigation();
  return (
    <Link
      href={href}
      onNavigate={(event) => {
        event.preventDefault();
        navigate(href);
      }}
      {...props}
    />
  );
}

/** A small turning circle in the current text color, e.g. on a button while its search loads. */
export function Spinner({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`animate-spin motion-reduce:animate-none ${className}`} aria-hidden="true" fill="none">
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.3" strokeWidth="3" />
      <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

/** The results: dimmed and marked busy while the next ones load, with a note for screen readers. */
export function PendingResults({ children }: { children: ReactNode }) {
  const { pending } = useSearchNavigation();
  return (
    <div aria-busy={pending} className={`transition-opacity ${pending ? "opacity-50 delay-150" : ""}`}>
      <p role="status" className="sr-only">
        {pending ? "Suche läuft …" : ""}
      </p>
      {children}
    </div>
  );
}
