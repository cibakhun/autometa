import type { ReactNode } from "react";
import type { Verdict, VerdictReason } from "@/core/verdict";

/**
 * How the verdict looks everywhere (cards, detail page): one tinted panel per verdict, so the
 * assessment reads as one block, apart from the plain facts of the car.
 */
export const VERDICT_STYLE: Record<Verdict, { panel: string; text: string }> = {
  anschauen: { panel: "border-good-line bg-good-bg", text: "text-good-text" },
  schrauber: { panel: "border-good-line bg-good-bg", text: "text-good-text" },
  fair: { panel: "border-line bg-accent-soft", text: "text-accent-strong" },
  eher_nicht: { panel: "border-warn-line bg-warn-bg", text: "text-warn-text" },
  unklar: { panel: "border-line bg-background", text: "text-muted" },
};

/** A small pill for the verdict where a whole panel would be too much (watch list notes, chips). */
export const VERDICT_BADGE: Record<Verdict, string> = {
  anschauen: "border-good-line bg-good-bg text-good-text",
  schrauber: "border-good-line bg-good-bg text-good-text",
  fair: "border-line bg-accent-soft text-accent-strong",
  eher_nicht: "border-warn-line bg-warn-bg text-warn-text",
  unklar: "border-line bg-background text-muted",
};

export function VerdictIcon({ verdict, className = "h-4 w-4" }: { verdict: Verdict; className?: string }) {
  const paths: Record<Verdict, ReactNode> = {
    // A tick: worth a look.
    anschauen: <path d="M5 12.5l4.5 4.5L19 7.5" />,
    // A wrench: worth it for someone who repairs.
    schrauber: <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2l-5 5a1.6 1.6 0 0 0 2.2 2.2l5-5a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.1-.4-.4-2.1z" />,
    // An equals sign: about what such cars cost.
    fair: <path d="M6 9.5h12M6 14.5h12" />,
    // A warning sign.
    eher_nicht: (
      <>
        <path d="M12 4l9 16H3z" />
        <path d="M12 10v4M12 17h.01" />
      </>
    ),
    // A question mark.
    unklar: (
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.6 9.5a2.5 2.5 0 0 1 4.8.8c0 1.7-2.4 2.2-2.4 3.7M12 17h.01" />
      </>
    ),
  };
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      {paths[verdict]}
    </svg>
  );
}

export type ChipTone = "good" | "warn" | "neutral";

const CHIP_TONES: Record<ChipTone, string> = {
  good: "border-good-line text-good-text",
  warn: "border-warn-line text-warn-text",
  neutral: "border-line text-muted",
};

export const toneOf = (tone: VerdictReason["tone"]): ChipTone => (tone === "plus" ? "good" : tone === "minus" ? "warn" : "neutral");

/** One fact about the assessment as a pill: "HU nur bis 03/2027", "Kupplung", "Schwierigkeit 3/5". */
export function Chip({
  tone = "neutral",
  title,
  mark,
  children,
}: {
  tone?: ChipTone;
  title?: string;
  /** Shown before the text; by default + for good and − for warn, so the tone does not rest on color alone. Null for none. */
  mark?: ReactNode | null;
  children: ReactNode;
}) {
  const sign = mark === undefined ? (tone === "good" ? "+" : tone === "warn" ? "−" : null) : mark;
  return (
    <span title={title} className={`inline-flex items-baseline gap-1 rounded-full border bg-surface px-2 py-0.5 text-xs font-medium leading-5 ${CHIP_TONES[tone]}`}>
      {sign && <span aria-hidden="true">{sign}</span>}
      {children}
    </span>
  );
}

/** A wrench, for damage named in the title. */
export function WrenchIcon({ className = "h-3 w-3 self-center" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={`shrink-0 ${className}`} aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a4 4 0 0 0-5.4 5.2l-5 5a1.6 1.6 0 0 0 2.2 2.2l5-5a4 4 0 0 0 5.2-5.4l-2.4 2.4-2.1-.4-.4-2.1z" />
    </svg>
  );
}

/** "Modell: 23 % weniger Mängel": the Modell-Akte comparison in a few words, for a chip. */
export function reliabilityChip(ratio: number): { text: string; tone: ChipTone; title: string } {
  const percent = Math.round(Math.abs(1 - ratio) * 100);
  const text = percent < 5 ? "Modell: Mängel wie üblich" : `Modell: ${percent} % ${ratio < 1 ? "weniger" : "mehr"} Mängel`;
  return {
    text,
    tone: percent < 5 ? "neutral" : ratio < 1 ? "good" : "warn",
    title:
      "Modell-Akte: Anteil der Autos dieses Modells und Alters mit Mangel bei der Hauptuntersuchung (niederländische RDW-Daten), verglichen mit allen gleich alten Autos",
  };
}

/** First letter up, for a reason used as a heading line ("17 % unter Marktwert", "Kein Marktwert …"). */
export const sentenceCase = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
