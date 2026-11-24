"use client";

import type { MouseEvent } from "react";
import { SORT_LABELS, type Sort } from "@/search/filters";
import type { NaturalSearch } from "@/search/natural";
import { Spinner, useSearchNavigation } from "./search-transition";

const EXAMPLES = [
  "zuverlässiger Kombi für Familie bis 8.000 €",
  "VW Golf Diesel ab 2015 unter 150.000 km",
  "Bastlerauto zum Flippen, Marge ab 1.000 €",
  "Automatik-SUV bis 15.000 € um München",
];

const SORT_NOTES: Partial<Record<Sort, string>> = {
  empfehlung:
    "Modelle mit weniger HU-Mängeln als gleich alte Autos (Modell-Akte) und Preise unter Marktwert kommen zuerst.",
  flip: "Angebote mit dem höchsten Stundenlohn nach Reparatur und Weiterverkauf kommen zuerst.",
  below_market: "Angebote mit dem größten Abstand zum Marktwert kommen zuerst.",
};

const kiHref = (text: string) => `/ki?text=${encodeURIComponent(text)}`;

/**
 * The search in own words above the results: a sentence instead of the filter form. After a
 * search it shows what became a filter, what has no filter, and which words it did not know.
 */
export function NaturalSearchBox({ text, search, sort }: { text?: string; search: NaturalSearch | null; sort: Sort }) {
  const { pendingOrigin, markLeaving } = useSearchNavigation();
  const understanding = pendingOrigin === "ki";
  // An example opens the page anew (a plain link), so show it loading, unless it opens in a new tab.
  const onExample = (event: MouseEvent) => {
    if (event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) markLeaving("example");
  };
  return (
    <section aria-labelledby="ki-title" className="mb-6 rounded-xl border border-line bg-surface p-4">
      <h2 id="ki-title" className="mb-2 text-sm font-semibold">
        Suche in eigenen Worten
      </h2>
      {/* A route handler turns the sentence into filters, so a plain form that works without JavaScript. */}
      <form action="/ki" method="get" onSubmit={() => markLeaving("ki")} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="ki-text" className="sr-only">
          Beschreib dein Wunschauto
        </label>
        <input
          id="ki-text"
          name="text"
          type="search"
          maxLength={200}
          defaultValue={text}
          placeholder="z. B. zuverlässiger Kombi für Familie bis 8.000 €"
          className="min-w-0 flex-1 rounded-md border border-line bg-background px-3 py-2 text-base outline-none focus:border-accent focus:ring-2 focus:ring-accent/20"
        />
        <button
          type="submit"
          className="inline-flex items-center justify-center gap-2 rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong"
        >
          {understanding && <Spinner />}
          {understanding ? "Sucht …" : "Verstehen und suchen"}
        </button>
      </form>
      {search ? (
        <Understood search={search} sort={sort} />
      ) : (
        <p className="mt-2 text-xs text-muted">
          Zum Beispiel:{" "}
          {EXAMPLES.map((example, i) => (
            <span key={example}>
              {i > 0 && " · "}
              <a href={kiHref(example)} onClick={onExample} className="text-accent hover:underline">
                {example}
              </a>
            </span>
          ))}
        </p>
      )}
    </section>
  );
}

function Understood({ search, sort }: { search: NaturalSearch; sort: Sort }) {
  const note = SORT_NOTES[sort];
  return (
    <div className="mt-3 space-y-2 text-sm">
      {search.understood.length > 0 ? (
        <div>
          <span className="mr-1 text-muted">Verstanden:</span>
          <ul className="inline">
            {search.understood.map((item) => (
              <li
                key={item.label}
                title={`„${item.text}“`}
                className="mb-1 mr-1 inline-block rounded-full bg-accent-soft px-2.5 py-0.5 text-xs font-medium text-accent-strong"
              >
                {item.label}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-muted">
          Daraus konnte ich keinen Filter machen. Nenne z. B. Marke, Modell, Preis, Kilometer, Baujahr, Kraftstoff oder Fahrzeugtyp.
        </p>
      )}
      <p className="text-muted">
        Sortiert: <span className="font-medium text-foreground">{SORT_LABELS[sort]}</span>
        {note && <>. {note}</>}
      </p>
      {search.ignored.length > 0 && (
        <ul className="space-y-0.5 text-muted">
          {search.ignored.map((item) => (
            <li key={`${item.text}-${item.reason}`}>
              <span className="text-warn-text">„{item.text}“ nicht berücksichtigt:</span> {item.reason}
            </li>
          ))}
        </ul>
      )}
      {search.unknown.length > 0 && (
        <p className="text-muted">
          Nicht verstanden: {search.unknown.map((word) => `„${word}“`).join(", ")}
        </p>
      )}
      <p className="text-xs text-muted">Links kannst du jeden Filter noch ändern.</p>
    </div>
  );
}
