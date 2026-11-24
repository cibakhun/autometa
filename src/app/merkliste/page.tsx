import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ResultCard } from "@/components/result-card";
import { getPool } from "@/lib/db";
import { getFlipSettings } from "@/lib/flip-settings";
import { formatDayTime, formatEuro, formatSignedPrice } from "@/lib/format";
import { currentDevice } from "@/lib/profile";
import { getFavorites, type WatchedListing } from "@/profiles/favorites";

export const metadata: Metadata = { title: "Merkliste – AutoMeta" };

export default function WatchListPage() {
  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-bold">Merkliste</h1>
        <p className="mt-2 text-sm text-muted">
          Autos, die du mit dem Herz-Symbol gemerkt hast. Sinkt ein Preis oder verschwindet eine Anzeige, sagt dir AutoMeta Bescheid, wenn du unter{" "}
          <Link href="/suchauftraege#benachrichtigungen" className="text-accent hover:underline">
            Suchaufträge
          </Link>{" "}
          Benachrichtigungen eingeschaltet hast.
        </p>
      </div>
      <Suspense
        fallback={
          <div aria-busy="true" className="h-64 animate-pulse rounded-xl bg-surface">
            <span className="sr-only">Merkliste wird geladen …</span>
          </div>
        }
      >
        <WatchList />
      </Suspense>
    </div>
  );
}

async function WatchList() {
  const [device, settings] = await Promise.all([currentDevice(), getFlipSettings()]);
  const listings = device ? await getFavorites(getPool(), device.profileId, settings) : [];
  if (listings.length === 0) {
    return (
      <div className="rounded-xl border border-line bg-surface p-8 text-center">
        <h2 className="text-lg font-semibold">Noch nichts gemerkt</h2>
        <p className="mx-auto mt-1 max-w-md text-sm text-muted">
          Tippe in der Suche auf das Herz eines Autos oder auf einer Angebotsseite auf „Merken“. Dann steht es hier, mit dem Preis von
          dem Tag, an dem du es gemerkt hast.
        </p>
        <Link href="/" className="mt-4 inline-block rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong">
          Zur Suche
        </Link>
        <p className="mt-4 text-sm text-muted">
          Auf einem anderen Gerät gemerkt?{" "}
          <Link href="/geraete" className="text-accent hover:underline">
            Geräte verbinden
          </Link>
        </p>
      </div>
    );
  }
  return (
    <ul className="grid gap-4 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {listings.map((listing) => (
        <li key={listing.id}>
          <ResultCard listing={listing} minMarginEur={settings.minMarginEur} favorite note={<SavedNote listing={listing} />} />
        </li>
      ))}
    </ul>
  );
}

const GONE_TEXT = {
  checked: "laut Anzeige verkauft oder gelöscht",
  missed: "nicht mehr in der Liste der Börse",
  stale: "länger nicht mehr bestätigt",
  filtered: "aussortiert, etwa als Gesuch, Tausch oder wegen eines unplausiblen Preises",
} as const;

/** Since when the car is on the list, and how its price moved since then, or that it is gone. */
function SavedNote({ listing }: { listing: WatchedListing }) {
  if (listing.status === "gone") {
    return (
      <p className="mb-2 rounded-md border border-warn-line bg-warn-bg px-2 py-1 text-xs font-medium text-warn-text">
        Nicht mehr online{listing.goneAt ? ` seit ${formatDayTime(listing.goneAt)}` : ""}
        {listing.goneReason ? ` (${GONE_TEXT[listing.goneReason]})` : ""}
      </p>
    );
  }
  const change = listing.priceEur - listing.savedPriceEur;
  return (
    <p className="mb-2 text-xs text-muted">
      Gemerkt {formatDayTime(listing.savedAt)} für {formatEuro(listing.savedPriceEur)}
      {change !== 0 && (
        <span className={change < 0 ? "font-medium text-good-text" : "font-medium"}> · seitdem {formatSignedPrice(change)}</span>
      )}
    </p>
  );
}
