"use client";

import { useId, useState } from "react";
import type { DamageKind } from "@/core/damage";
import { calculateFlip, type FlipSettings } from "@/core/flip";
import type { InspectionBasis } from "@/core/inspection";
import {
  CONFIDENCE_LABELS,
  DIFFICULTY_LABELS,
  estimateRepairs,
  findJob,
  JOB_GROUPS,
  REPAIR_JOBS,
  scaledParts,
  VEHICLE_CLASS_LABELS,
  type Difficulty,
  type VehicleFacts,
} from "@/core/repairs";
import { formatEuro, formatNumber, formatSignedPrice } from "@/lib/format";

export interface FlipCalculatorProps {
  priceEur: number;
  marketEur: number | null;
  damage: DamageKind[];
  facts: VehicleFacts & { huBasis: InspectionBasis | null; huUntil: string | null };
  settings: FlipSettings;
}

interface JobRow {
  key: number;
  id: string;
  label: string;
  difficulty: Difficulty;
  /** Euros and hours as typed, so a field can be empty while editing. */
  parts: string;
  hours: string;
}

const mid = ([from, to]: [number, number]) => (from + to) / 2;
const round10 = (value: number) => Math.round(value / 10) * 10;
/** Typed number, 0 when empty or invalid. Accepts a German decimal comma. */
const num = (value: string) => {
  const parsed = Number(value.replace(",", "."));
  return Number.isFinite(parsed) ? parsed : 0;
};

const fieldClass =
  "w-full rounded-md border border-line bg-surface px-2 py-1 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";
const labelClass = "mb-1 block text-xs font-medium text-muted";

/**
 * The flip calculation of one listing with every value editable: purchase price, market value,
 * discount, side costs and the repair jobs (prefilled from the catalog, middle of each range).
 */
export function FlipCalculator({ priceEur, marketEur, damage, facts, settings }: FlipCalculatorProps) {
  const estimate = estimateRepairs(damage, facts);
  const initialJobs = (): JobRow[] =>
    estimate.jobs.map((j, i) => ({
      key: i,
      id: j.job.id,
      label: j.job.label,
      difficulty: j.job.difficulty,
      parts: String(round10(mid(j.partsEur))),
      hours: String(mid(j.job.hours)),
    }));

  const ids = useId();
  const [purchase, setPurchase] = useState(String(priceEur));
  const [market, setMarket] = useState(marketEur === null ? "" : String(marketEur));
  const [discount, setDiscount] = useState(String(settings.discountPct));
  const [hu, setHu] = useState(String(settings.huEur));
  const [registration, setRegistration] = useState(String(settings.registrationEur));
  const [pickup, setPickup] = useState(String(estimate.needsTow ? settings.towEur : settings.transportEur));
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);
  const [nextKey, setNextKey] = useState(estimate.jobs.length);

  const updateJob = (key: number, patch: Partial<JobRow>) =>
    setJobs((rows) => rows.map((row) => (row.key === key ? { ...row, ...patch } : row)));
  /** A job that a bigger one replaces (a replacement engine includes the timing chain) is dropped. */
  const addJob = (id: string) => {
    const job = findJob(id);
    if (!job) return;
    const parts = scaledParts(job, estimate.vehicleClass);
    const replaced = new Set(job.replaces ?? []);
    setJobs((rows) => [
      ...rows.filter((row) => !replaced.has(row.id)),
      { key: nextKey, id, label: job.label, difficulty: job.difficulty, parts: String(round10(mid(parts))), hours: String(mid(job.hours)) },
    ]);
    setNextKey((key) => key + 1);
  };
  const reset = () => {
    setPurchase(String(priceEur));
    setMarket(marketEur === null ? "" : String(marketEur));
    setDiscount(String(settings.discountPct));
    setHu(String(settings.huEur));
    setRegistration(String(settings.registrationEur));
    setPickup(String(estimate.needsTow ? settings.towEur : settings.transportEur));
    setJobs(initialJobs());
  };

  const partsSum = jobs.reduce((sum, row) => sum + num(row.parts), 0);
  const hoursSum = jobs.reduce((sum, row) => sum + num(row.hours), 0);
  const difficulty = jobs.length > 0 ? (Math.max(...jobs.map((row) => row.difficulty)) as Difficulty) : null;
  const pickupEur = num(pickup);
  const result =
    market.trim() === ""
      ? null
      : calculateFlip(
          { purchaseEur: num(purchase), marketEur: num(market), partsEur: [partsSum, partsSum], hours: [hoursSum, hoursSum], needsTow: false },
          {
            ...settings,
            discountPct: num(discount),
            huEur: num(hu),
            registrationEur: num(registration),
            transportEur: pickupEur,
            towEur: pickupEur,
          },
        );
  // Not offered: jobs already listed, and jobs a listed one includes.
  const included = new Set(jobs.flatMap((row) => [row.id, ...(findJob(row.id)?.replaces ?? [])]));
  const available = REPAIR_JOBS.filter((job) => !included.has(job.id));

  const field = (id: string, label: string, value: string, set: (value: string) => void, hint?: string) => (
    <div>
      <label htmlFor={`${ids}-${id}`} className={labelClass}>{label}</label>
      <input
        id={`${ids}-${id}`}
        type="number"
        inputMode="decimal"
        min={0}
        step="any"
        value={value}
        onChange={(event) => set(event.target.value)}
        className={fieldClass}
      />
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
    </div>
  );

  return (
    <div className="mt-3 space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {field("purchase", "Kaufpreis (€)", purchase, setPurchase, "Angebotspreis, verhandelbar")}
        {field("market", "Marktwert intakt (€)", market, setMarket, marketEur === null ? "Kein Marktwert, selbst eintragen" : "Median der Vergleichsangebote")}
        {field("discount", "Abschlag beim Verkauf (%)", discount, setDiscount)}
        {field("hu", "HU/TÜV (€)", hu, setHu)}
        {field("registration", "Zulassung (€)", registration, setRegistration)}
        {field("pickup", estimate.needsTow ? "Abholen mit Anhänger (€)" : "Abholen, fahrbereit (€)", pickup, setPickup)}
      </div>

      <div>
        <table className="w-full text-left text-sm">
          <caption className="mb-1 text-left text-xs font-medium text-muted">
            Arbeiten ({VEHICLE_CLASS_LABELS[estimate.vehicleClass]}, Teile und Stunden aus dem Katalog, Mitte der Spanne)
          </caption>
          <thead className="text-xs text-muted">
            <tr className="border-b border-line">
              <th className="py-1.5 pr-2 font-medium">Arbeit</th>
              <th className="w-20 py-1.5 pr-2 font-medium sm:w-28">Teile (€)</th>
              <th className="w-16 py-1.5 pr-2 font-medium sm:w-24">Stunden</th>
              <th className="w-8 py-1.5" aria-label="Entfernen" />
            </tr>
          </thead>
          <tbody>
            {jobs.map((row) => (
              <tr key={row.key} className="border-b border-line">
                <td className="py-1.5 pr-2">
                  {row.label}
                  <span className="block text-xs text-muted sm:ml-1 sm:inline" title={DIFFICULTY_LABELS[row.difficulty]}>
                    Schwierigkeit {row.difficulty}
                  </span>
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    aria-label={`Teile für ${row.label} in Euro`}
                    value={row.parts}
                    onChange={(event) => updateJob(row.key, { parts: event.target.value })}
                    className={fieldClass}
                  />
                </td>
                <td className="py-1.5 pr-2">
                  <input
                    type="number"
                    inputMode="decimal"
                    min={0}
                    step="any"
                    aria-label={`Stunden für ${row.label}`}
                    value={row.hours}
                    onChange={(event) => updateJob(row.key, { hours: event.target.value })}
                    className={fieldClass}
                  />
                </td>
                <td className="py-1.5 text-right">
                  <button
                    type="button"
                    onClick={() => setJobs((rows) => rows.filter((r) => r.key !== row.key))}
                    aria-label={`${row.label} entfernen`}
                    className="rounded px-1.5 text-muted hover:text-warn-text"
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
            <tr className="font-medium">
              <td className="py-1.5 pr-2">Summe</td>
              <td className="whitespace-nowrap py-1.5 pr-2">{formatEuro(Math.round(partsSum))}</td>
              <td className="whitespace-nowrap py-1.5 pr-2">{formatNumber(hoursSum)} h</td>
              <td />
            </tr>
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-0 flex-1">
          <label htmlFor={`${ids}-add`} className={labelClass}>Arbeit hinzufügen</label>
          <select
            id={`${ids}-add`}
            value=""
            onChange={(event) => addJob(event.target.value)}
            className={fieldClass}
          >
            <option value="">Aus dem Katalog wählen …</option>
            {JOB_GROUPS.map((group) => (
              <optgroup key={group} label={group}>
                {available
                  .filter((job) => job.group === group)
                  .map((job) => (
                    <option key={job.id} value={job.id}>
                      {job.label}
                    </option>
                  ))}
              </optgroup>
            ))}
          </select>
        </div>
        <button type="button" onClick={reset} className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent">
          Zurücksetzen
        </button>
      </div>

      <div className="rounded-lg border border-line p-4" aria-live="polite">
        {result ? (
          <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Marge</dt>
              <dd className={`text-xl font-bold ${result.marginEur >= settings.minMarginEur ? "text-good-text" : result.marginEur < 0 ? "text-warn-text" : ""}`}>
                {formatSignedPrice(result.marginEur)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Pro Stunde</dt>
              <dd className="text-xl font-bold">{result.perHourEur === null ? "–" : `${formatEuro(result.perHourEur)}`}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Schwierigkeit</dt>
              <dd className="text-xl font-bold" title={difficulty ? DIFFICULTY_LABELS[difficulty] : undefined}>
                {difficulty ?? "–"} <span className="text-sm font-normal text-muted">von 5</span>
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Sicherheit</dt>
              <dd className="text-xl font-bold" title="Wie genau der Anzeigentitel den Schaden beschreibt">
                {damage.length > 0 ? CONFIDENCE_LABELS[estimate.confidence] : "–"}
              </dd>
            </div>
            <p className="col-span-2 text-xs text-muted sm:col-span-4">
              Verkauf ca. {formatEuro(result.salePriceEur)} − Kauf {formatEuro(num(purchase))} − Teile {formatEuro(Math.round(partsSum))} −
              Nebenkosten {formatEuro(result.sideCostsEur)}, bei {formatNumber(hoursSum)} Stunden Arbeit.
              {result.marginEur < settings.minMarginEur && ` Unter deiner Mindestmarge von ${formatEuro(settings.minMarginEur)}.`}
            </p>
          </dl>
        ) : (
          <p className="text-sm text-muted">Trag einen Marktwert ein, dann rechnet der Rechner die Marge aus.</p>
        )}
      </div>
    </div>
  );
}
