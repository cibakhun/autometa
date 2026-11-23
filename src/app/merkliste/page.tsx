import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { ResultCard } from "@/components/result-card";
import { getPool } from "@/lib/db";
import { getFlipSettings } from "@/lib/flip-settings";
import { formatDayTime, formatPrice, formatSignedPrice } from "@/lib/format";
import { currentDevice } from "@/lib/profile";
import { getFavorites, type WatchedListing } from "@/profiles/favorites";

export const metadata: Metadata = { title: "Merkliste – AutoMeta" };

export default function WatchListPage() {
  return (
    <div>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-2xl font-bold">Merkliste</h1>
        <p className="mt-2 text-sm text-muted">
          Autos, die du mit dem Herz gemerkt hast. Sinkt ein Preis oder verschwindet eine Anzeige, sagt dir AutoMeta Bescheid, wenn du unter{" "}
          <Link href="/suchauftraege#benachrichtigungen" className="text-accent hover:underline">
            Suchaufträge
          </Link>{" "}
          Benachrichtigungen eingeschaltet hast.
        </p>
      </div>
      <Suspense fallback={<div className="h-64 animate-pulse rounded-xl bg-surface" />}>
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
        <p className="font-medium">Noch nichts gemerkt.</p>
        <p className="mt-1 text-sm text-muted">
          Tippe in der{" "}
          <Link href="/" className="text-accent hover:underline">
            Suche
          </Link>{" "}
          auf das Herz eines Autos. Auf einem anderen Gerät gemerkt?{" "}
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
      Gemerkt {formatDayTime(listing.savedAt)} für {formatPrice(listing.savedPriceEur)}
      {change !== 0 && (
        <span className={change < 0 ? "font-medium text-good-text" : "font-medium"}> · seitdem {formatSignedPrice(change)}</span>
      )}
    </p>
  );
}
