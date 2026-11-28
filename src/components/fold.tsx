import type { ReactNode } from "react";

/**
 * Progressive disclosure without JavaScript: the main point stays visible, the explanation or
 * the long table opens on a tap. Plain <details>, so it works before the page is interactive and
 * on every phone. The chevron turns via globals.css (summary.fold).
 */

export function Chevron({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`chevron shrink-0 transition-transform ${className}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 9l6 6 6-6" />
    </svg>
  );
}

/** A small muted "How is this worked out?" under a number: the method, for whoever wants it. */
export function HowItWorks({ label = "Wie wird das berechnet?", children, className = "mt-3" }: { label?: string; children: ReactNode; className?: string }) {
  return (
    <details className={`group text-xs text-muted ${className}`}>
      <summary className="fold inline-flex cursor-pointer select-none items-center gap-1 rounded hover:text-accent">
        <InfoIcon />
        {label}
        <Chevron className="h-3.5 w-3.5" />
      </summary>
      <div className="mt-1.5 space-y-1.5 leading-relaxed">{children}</div>
    </details>
  );
}

/** A section whose content opens on a tap: a long table, a calculator. */
export function Fold({
  title,
  aside,
  open = false,
  children,
  className = "",
  id,
}: {
  title: ReactNode;
  /** Short muted text after the title, e.g. "nur zum Vergleich". */
  aside?: ReactNode;
  open?: boolean;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <details open={open} className={className} id={id}>
      <summary className="fold flex cursor-pointer select-none items-center justify-between gap-3 rounded-md py-1 hover:text-accent">
        <span className="min-w-0">
          <span className="font-semibold">{title}</span>
          {aside && <span className="ml-1.5 text-sm font-normal text-muted">{aside}</span>}
        </span>
        <Chevron />
      </summary>
      <div className="mt-2">{children}</div>
    </details>
  );
}

export function InfoIcon({ className = "h-3.5 w-3.5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}
