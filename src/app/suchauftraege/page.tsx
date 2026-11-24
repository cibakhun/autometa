import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getVapidKeys } from "@/alerts/push";
import { PushSetup } from "@/components/push-setup";
import { getPool } from "@/lib/db";
import { formatDayTime, formatNumber } from "@/lib/format";
import { currentDevice } from "@/lib/profile";
import { describeSort, listSavedSearches, MAX_NAME_LENGTH, type SavedSearch } from "@/profiles/searches";
import { getQuietNights } from "@/profiles/store";

export const metadata: Metadata = { title: "Suchaufträge – AutoMeta" };

export default function SavedSearchesPage({ searchParams }: PageProps<"/suchauftraege">) {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-2xl font-bold">Suchaufträge</h1>
      <p className="mt-2 text-sm text-muted">
        Gespeicherte Suchen. Kommt ein passendes Auto neu dazu oder wird eins günstiger, schickt AutoMeta eine Benachrichtigung, meist
        wenige Minuten nachdem es auf der Börse gelesen wurde.
      </p>
      <Suspense
        fallback={
          <div aria-busy="true" className="mt-6 h-96 animate-pulse rounded-xl bg-surface">
            <span className="sr-only">Suchaufträge werden geladen …</span>
          </div>
        }
      >
        <SavedSearches searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

async function SavedSearches({ searchParams }: { searchParams: PageProps<"/suchauftraege">["searchParams"] }) {
  const [device, query] = await Promise.all([currentDevice(), searchParams]);
  const pool = getPool();
  const [searches, keys, quietNights, otherPushDevices] = await Promise.all([
    device ? listSavedSearches(pool, device.profileId) : Promise.resolve([]),
    getVapidKeys(pool),
    device ? getQuietNights(pool, device.profileId) : Promise.resolve(true),
    device
      ? pool
          .query<{ n: number }>("select count(*)::int as n from push_subscriptions where profile_id = $1 and device_id is distinct from $2", [
            device.profileId,
            device.deviceId,
          ])
          .then((result) => result.rows[0].n)
      : Promise.resolve(0),
  ]);

  return (
    <>
      {query.geloescht === "1" && (
        <p role="status" className="mt-4 rounded-md border border-line bg-accent-soft px-3 py-2 text-sm text-accent-strong">
          Suchauftrag gelöscht.
        </p>
      )}
      <section id="benachrichtigungen" aria-labelledby="push-title" className="mt-6 rounded-xl border border-line bg-surface p-5">
        <h2 id="push-title" className="font-semibold">
          Benachrichtigungen
        </h2>
        <p className="mb-3 mt-1 text-sm text-muted">
          Pro Gerät einzeln einschalten: Handy, PC, Tablet. Sie gelten für alle Suchaufträge und die Merkliste.
        </p>
        <PushSetup publicKey={keys.publicKey} otherDevices={otherPushDevices} />
        {device && (
          <form method="post" action="/api/profil/ruhezeit" className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-3 text-sm">
            <input type="hidden" name="on" value={quietNights ? "0" : "1"} />
            <span>
              Nachtruhe 22 bis 7 Uhr: <strong>{quietNights ? "an" : "aus"}</strong>
              <span className="text-muted">{quietNights ? " (was nachts reinkommt, kommt um 7 Uhr gesammelt)" : " (Benachrichtigungen auch nachts)"}</span>
            </span>
            <button type="submit" className="text-accent hover:underline">
              {quietNights ? "ausschalten" : "einschalten"}
            </button>
          </form>
        )}
        <p className="mt-3 text-sm text-muted">
          Handy und PC mit denselben Listen?{" "}
          <Link href="/geraete" className="text-accent hover:underline">
            Geräte verbinden
          </Link>
        </p>
      </section>

      {searches.length === 0 ? (
        <div className="mt-6 rounded-xl border border-line bg-surface p-8 text-center">
          <h2 className="text-lg font-semibold">Noch keine Suchaufträge</h2>
          <p className="mx-auto mt-1 max-w-md text-sm text-muted">
            Stell in der Suche deine Filter ein, zum Beispiel Marke, Preis und Umkreis, und tippe über den Ergebnissen auf „Suche
            speichern“. Dann zeigt AutoMeta hier, was neu dazukommt oder günstiger wird, und meldet sich auf Wunsch per Benachrichtigung.
          </p>
          <div className="mt-4 flex flex-wrap justify-center gap-3">
            <Link href="/" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong">
              Zur Suche
            </Link>
            {/* A route handler that redirects to the search with the visitor's settings, so a plain link. */}
            <a href="/flip" className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-accent">
              Zur Flip-Liste
            </a>
          </div>
        </div>
      ) : (
        <ul className="mt-6 space-y-4">
          {searches.map((search) => (
            <li key={search.id}>
              <SearchCard search={search} />
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function SearchCard({ search }: { search: SavedSearch }) {
  const sort = describeSort(search.filters);
  const action = `/api/suchauftraege/${search.id}`;
  return (
    <article id={`suche-${search.id}`} className="scroll-mt-4 rounded-xl border border-line bg-surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold [overflow-wrap:anywhere]">{search.name}</h2>
          {(search.description !== search.name || sort) && (
            <p className="mt-0.5 text-sm text-muted [overflow-wrap:anywhere]">
              {[search.description !== search.name ? search.description : null, sort].filter(Boolean).join(" · ")}
            </p>
          )}
        </div>
        {search.fresh > 0 && (
          <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-xs font-semibold text-on-accent">{formatNumber(search.fresh)} neu</span>
        )}
      </div>
      <p className="mt-2 text-sm">
        {formatNumber(search.total)} Treffer
        <span className="text-muted">
          {search.fresh > 0
            ? `, davon ${formatNumber(search.fresh)} neu oder günstiger seit ${formatDayTime(search.seenAt)}`
            : `, nichts Neues seit ${formatDayTime(search.seenAt)}`}
        </span>
      </p>
      {search.lastAlertAt && (
        <p className="mt-1 text-xs text-muted">
          Letzte Benachrichtigung {formatDayTime(search.lastAlertAt)} ({formatNumber(search.lastAlertCount ?? 0)})
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {search.fresh > 0 && (
          <a href={`/suchauftraege/${search.id}/neu`} className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-on-accent hover:bg-accent-strong">
            Neue ansehen
          </a>
        )}
        <Link href={`/?${search.query}`} className="rounded-md border border-line px-3 py-1.5 text-sm font-medium hover:border-accent">
          Alle Treffer
        </Link>
        <form method="post" action={action} className="ml-auto text-sm">
          <input type="hidden" name="action" value="notify" />
          <input type="hidden" name="notify" value={search.notify ? "0" : "1"} />
          <span className="text-muted">Benachrichtigung {search.notify ? "an" : "aus"} · </span>
          <button type="submit" className="text-accent hover:underline">
            {search.notify ? "ausschalten" : "einschalten"}
          </button>
        </form>
      </div>
      <details className="mt-2 text-sm">
        <summary className="cursor-pointer text-muted hover:text-accent">Umbenennen oder löschen</summary>
        <div className="mt-2 flex flex-wrap items-end gap-3">
          <form method="post" action={action} className="flex flex-wrap items-end gap-2">
            <input type="hidden" name="action" value="rename" />
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Name</span>
              <input
                name="name"
                defaultValue={search.name}
                maxLength={MAX_NAME_LENGTH}
                required
                className="w-64 max-w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent"
              />
            </label>
            <button type="submit" className="rounded-md border border-line px-3 py-1.5 hover:border-accent">
              Speichern
            </button>
          </form>
          <form method="post" action={action}>
            <input type="hidden" name="action" value="delete" />
            <button type="submit" className="rounded-md px-3 py-1.5 text-warn-text hover:underline">
              Suchauftrag löschen
            </button>
          </form>
        </div>
      </details>
    </article>
  );
}
