import type { Metadata } from "next";
import { Suspense } from "react";
import { DEFAULT_FLIP_SETTINGS, type FlipSettings } from "@/core/flip";
import { DIFFICULTY_LABELS, type Difficulty } from "@/core/repairs";
import { getFlipSettings } from "@/lib/flip-settings";
import { formatEuro } from "@/lib/format";

export const metadata: Metadata = { title: "Flip-Einstellungen – AutoMeta" };

export default function SettingsPage({ searchParams }: PageProps<"/einstellungen">) {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="text-2xl font-bold">Flip-Einstellungen</h1>
      <p className="mt-2 text-sm text-muted">
        Damit rechnen die Flip-Liste und der Flip-Rechner auf den Angebotsseiten. Die Werte werden nur in diesem Browser gespeichert.
      </p>
      <Suspense fallback={<div className="mt-6 h-96 animate-pulse rounded-xl bg-surface" />}>
        <SettingsForm searchParams={searchParams} />
      </Suspense>
    </div>
  );
}

const fieldClass =
  "w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const labelClass = "mb-1 block text-sm font-medium";
const hintClass = "mt-1 text-xs text-muted";

async function SettingsForm({ searchParams }: { searchParams: PageProps<"/einstellungen">["searchParams"] }) {
  const [settings, query] = await Promise.all([getFlipSettings(), searchParams]);
  const saved = query.gespeichert === "1";

  const money = (name: keyof FlipSettings, label: string, hint: string) => (
    <div>
      <label htmlFor={name} className={labelClass}>{label}</label>
      <input
        id={name}
        name={name}
        type="number"
        min={0}
        max={100000}
        step={1}
        inputMode="numeric"
        defaultValue={settings[name]}
        aria-describedby={`${name}-hint`}
        className={fieldClass}
      />
      <p id={`${name}-hint`} className={hintClass}>
        {hint} Standard: {formatEuro(DEFAULT_FLIP_SETTINGS[name])}.
      </p>
    </div>
  );

  return (
    <form method="post" action="/api/einstellungen" className="mt-6 space-y-5 rounded-xl border border-line bg-surface p-6">
      {saved && (
        <p role="status" className="rounded-md border border-line bg-accent-soft px-3 py-2 text-sm font-medium text-accent-strong">
          Gespeichert.
        </p>
      )}
      <div>
        <label htmlFor="level" className={labelClass}>Was traust du dir zu?</label>
        <select id="level" name="level" defaultValue={settings.level} aria-describedby="level-hint" className={fieldClass}>
          {(Object.keys(DIFFICULTY_LABELS) as unknown as Difficulty[]).map((level) => (
            <option key={level} value={level}>
              bis Schwierigkeit {level}: {DIFFICULTY_LABELS[level]}
            </option>
          ))}
        </select>
        <p id="level-hint" className={hintClass}>
          Die Flip-Liste zeigt nur Autos, deren schwerste Arbeit du dir zutraust. Standard: Schwierigkeit {DEFAULT_FLIP_SETTINGS.level}.
        </p>
      </div>
      <div>
        <label htmlFor="discountPct" className={labelClass}>Verhandlungsabschlag beim Verkauf (%)</label>
        <input
          id="discountPct"
          name="discountPct"
          type="number"
          min={0}
          max={50}
          step={0.5}
          inputMode="decimal"
          defaultValue={settings.discountPct}
          aria-describedby="discountPct-hint"
          className={fieldClass}
        />
        <p id="discountPct-hint" className={hintClass}>
          Der Marktwert besteht aus Angebotspreisen; verkauft wird meist darunter. Standard: {DEFAULT_FLIP_SETTINGS.discountPct} %.
        </p>
      </div>
      <div className="grid gap-5 sm:grid-cols-2">
        {money("minMarginEur", "Mindestmarge (€)", "Darunter lohnt sich die Arbeit nicht; Filter der Flip-Liste.")}
        {money("huEur", "HU/TÜV (€)", "Prüfgebühr und Nachprüfung.")}
        {money("registrationEur", "Zulassung (€)", "An- und Abmelden, Kurzzeitkennzeichen.")}
        {money("transportEur", "Abholen, fahrbereit (€)", "Sprit, Bahnticket, Überführung.")}
        {money("towEur", "Abholen, nicht fahrbereit (€)", "Abschleppen oder Anhänger.")}
      </div>
      <div className="flex flex-wrap gap-2 pt-1">
        <button type="submit" className="rounded-md bg-accent px-4 py-2 text-sm font-semibold text-on-accent hover:bg-accent-strong">
          Speichern
        </button>
        <button type="submit" name="reset" value="1" formNoValidate className="rounded-md border border-line px-4 py-2 text-sm hover:border-accent">
          Auf Standard zurücksetzen
        </button>
        <a href="/flip" className="ml-auto self-center text-sm text-accent hover:underline">
          Zur Flip-Liste
        </a>
      </div>
    </form>
  );
}
