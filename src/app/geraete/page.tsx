import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { getPool } from "@/lib/db";
import { formatDayTime } from "@/lib/format";
import { currentDevice } from "@/lib/profile";
import { formatLinkCode, LINK_CODE_MINUTES, listDevices, normalizeLinkCode } from "@/profiles/store";

export const metadata: Metadata = { title: "Geräte verbinden – AutoMeta" };

export default function DevicesPage({ searchParams }: PageProps<"/geraete">) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Geräte verbinden</h1>
      <p className="mt-2 text-sm text-muted">
        AutoMeta kommt ohne Anmeldung aus: Merkliste und Suchaufträge hängen an diesem Browser. Mit einem Code nutzt ein zweites Gerät
        dieselben Listen, zum Beispiel Handy und PC. Wer eigene Listen will (etwa ein zweiter Nutzer), verbindet einfach nicht.
      </p>
      <Suspense fallback={<div className="mt-6 h-72 animate-pulse rounded-xl bg-surface" />}>
        <Devices searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const fieldClass =
  "w-40 rounded-md border border-line bg-surface px-2.5 py-1.5 font-mono text-base uppercase tracking-widest outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

async function Devices({ searchParams }: { searchParams: PageProps<"/geraete">["searchParams"] }) {
  const [device, query] = await Promise.all([currentDevice(), searchParams]);
  const devices = device ? await listDevices(getPool(), device) : [];
  const code = typeof query.code === "string" ? normalizeLinkCode(query.code) : null;
  const until = typeof query.bis === "string" && !Number.isNaN(Date.parse(query.bis)) ? query.bis : null;
  const prefill = typeof query.eingabe === "string" ? (normalizeLinkCode(query.eingabe) ?? "") : "";

  return (
    <div className="mt-6 space-y-5">
      {query.verbunden === "1" && (
        <p role="status" className="rounded-md border border-line bg-accent-soft px-3 py-2 text-sm font-medium text-accent-strong">
          Verbunden. Dieses Gerät nutzt jetzt dieselbe Merkliste und dieselben Suchaufträge.{" "}
          <Link href="/suchauftraege#benachrichtigungen" className="underline">
            Benachrichtigungen hier einschalten
          </Link>
        </p>
      )}
      {query.fehler === "code" && (
        <p role="alert" className="rounded-md border border-warn-line bg-warn-bg px-3 py-2 text-sm text-warn-text">
          Der Code stimmt nicht oder ist abgelaufen. Erzeuge auf dem anderen Gerät einen neuen.
        </p>
      )}

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">1. Auf dem Gerät mit deinen Listen: Code erzeugen</h2>
        {code && device ? (
          <div className="mt-3">
            <p className="font-mono text-3xl font-bold tracking-widest">{formatLinkCode(code)}</p>
            <p className="mt-2 text-sm text-muted">
              Gültig {until ? `bis ${formatDayTime(until).split(", ")[1]} Uhr` : `${LINK_CODE_MINUTES} Minuten`}, einmal verwendbar. Öffne auf dem
              anderen Gerät diese Seite (Menü: Suchaufträge → Geräte verbinden) und gib ihn unten ein.
            </p>
          </div>
        ) : (
          <form method="post" action="/api/profil/code" className="mt-3">
            <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong">
              Code erzeugen
            </button>
          </form>
        )}
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">2. Auf dem anderen Gerät: Code eingeben</h2>
        <p className="mt-1 text-sm text-muted">Was dieses Gerät schon gemerkt oder gespeichert hat, wandert mit.</p>
        <form method="post" action="/api/profil/verbinden" className="mt-3 flex flex-wrap items-center gap-2">
          <label htmlFor="code" className="sr-only">
            Code
          </label>
          <input
            id="code"
            name="code"
            required
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            placeholder="XXXX-XXXX"
            defaultValue={prefill ? formatLinkCode(prefill) : ""}
            maxLength={12}
            className={fieldClass}
          />
          <button type="submit" className="rounded-md border border-line px-4 py-2 text-sm font-medium hover:border-accent">
            Verbinden
          </button>
        </form>
      </section>

      {devices.length > 0 && (
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="font-semibold">Verbundene Geräte</h2>
          <ul className="mt-3 divide-y divide-line text-sm">
            {devices.map((item) => (
              <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <span>
                  <span className="font-medium">{item.label}</span>
                  {item.current && <span className="text-muted"> (dieses Gerät)</span>}
                  <span className="block text-xs text-muted">
                    zuletzt {formatDayTime(item.lastSeenAt)}
                    {item.pushes > 0 ? " · Benachrichtigungen an" : ""}
                  </span>
                </span>
                {!item.current && (
                  <form method="post" action={`/api/profil/geraete/${item.id}`}>
                    <button type="submit" className="text-sm text-warn-text hover:underline">
                      Entfernen
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
