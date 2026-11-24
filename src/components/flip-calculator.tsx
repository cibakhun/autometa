"use client";

import { useId, useState } from "react";
import type { DamageKind } from "@/core/damage";
import { coveredComponents, hiddenDefectRisk, type DefectProfile } from "@/core/defects";
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
  unclearDamageRisk,
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
  /** Defect profile for the hidden-defect risk: the model's own, or the average car of its age. */
  profile: DefectProfile | null;
  profileBasis: "model" | "average" | null;
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

/**
 * Middle of a parts or hours range, unrounded: the estimate on the page (countedJobs and the stored
 * risk buffer) counts it like this, so the calculator starts at the same margin and risk buffer.
 * Parts ranges are multiples of 10 euros, so the middle is a multiple of 5.
 */
const mid = ([from, to]: [number, number]) => (from + to) / 2;

/** A typed amount as a number string: German thousands dots ("1.700") and decimal comma ("4,5") allowed. */
function normalize(value: string): string {
  const text = value.trim().replace(/\s/g, "");
  return (/^\d{1,3}(\.\d{3})+(,\d*)?$/.test(text) ? text.replace(/\./g, "") : text).replace(",", ".");
}
/** Typed number, 0 when empty or invalid. */
const num = (value: string) => {
  const parsed = Number(normalize(value));
  return Number.isFinite(parsed) ? parsed : 0;
};
const invalid = (value: string) => value.trim() !== "" && !Number.isFinite(Number(normalize(value)));
/** A number for a field, with a German decimal comma: 4.5 -> "4,5". */
const field = (value: number) => String(value).replace(".", ",");

/** "ca. 25 Stunden": the hours are estimates, so whole hours from 10 on and half hours below. */
function formatHours(hours: number): string {
  const rounded = hours >= 10 ? Math.round(hours) : Math.round(hours * 2) / 2;
  return `ca. ${formatNumber(rounded)} ${rounded === 1 ? "Stunde" : "Stunden"}`;
}

const inputClass =
  "w-full rounded-md border border-line bg-surface py-1.5 pl-2 pr-7 text-sm tabular-nums outline-none focus:border-accent focus:ring-2 focus:ring-accent/20 aria-[invalid=true]:border-warn-text";
const labelClass = "mb-1 block text-xs font-medium text-muted";

/** A text field for an amount with its unit inside on the right; text, not number, so "4,5" works everywhere. */
function AmountInput({
  id,
  value,
  onChange,
  unit,
  label,
  describedBy,
  className = "",
}: {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  unit: "€" | "%" | "h";
  /** For fields without a visible label (the job rows). */
  label?: string;
  describedBy?: string;
  className?: string;
}) {
  return (
    <span className={`relative block ${className}`}>
      <input
        id={id}
        type="text"
        inputMode="decimal"
        autoComplete="off"
        enterKeyHint="done"
        aria-label={label}
        aria-describedby={describedBy}
        aria-invalid={invalid(value)}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className={inputClass}
      />
      <span aria-hidden="true" className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-xs text-muted">
        {unit}
      </span>
    </span>
  );
}

const UNIT_WORDS = { "€": "in Euro", "%": "in Prozent", h: "in Stunden" } as const;

/**
 * The flip calculation of one listing with every value editable: purchase price, market value,
 * discount, side costs, the repair jobs (prefilled from the catalog, middle of each range) and the
 * risk buffer (computed from the jobs, prices and defect profile until typed over).
 */
export function FlipCalculator({ priceEur, marketEur, damage, facts, settings, profile, profileBasis }: FlipCalculatorProps) {
  const estimate = estimateRepairs(damage, facts);
  const initialJobs = (): JobRow[] =>
    estimate.jobs.map((j, i) => ({
      key: i,
      id: j.job.id,
      label: j.job.label,
      difficulty: j.job.difficulty,
      parts: field(mid(j.partsEur)),
      hours: field(mid(j.job.hours)),
    }));

  const ids = useId();
  const [purchase, setPurchase] = useState(String(priceEur));
  const [market, setMarket] = useState(marketEur === null ? "" : String(marketEur));
  const [discount, setDiscount] = useState(field(settings.discountPct));
  const [hu, setHu] = useState(String(settings.huEur));
  const [registration, setRegistration] = useState(String(settings.registrationEur));
  const [pickup, setPickup] = useState(String(estimate.needsTow ? settings.towEur : settings.transportEur));
  const [jobs, setJobs] = useState<JobRow[]>(initialJobs);
  const [nextKey, setNextKey] = useState(estimate.jobs.length);
  /** The risk buffer as typed; null while it follows the computed value. */
  const [riskTyped, setRiskTyped] = useState<string | null>(null);

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
      { key: nextKey, id, label: job.label, difficulty: job.difficulty, parts: field(mid(parts)), hours: field(mid(job.hours)) },
    ]);
    setNextKey((key) => key + 1);
  };
  const reset = () => {
    setPurchase(String(priceEur));
    setMarket(marketEur === null ? "" : String(marketEur));
    setDiscount(field(settings.discountPct));
    setHu(String(settings.huEur));
    setRegistration(String(settings.registrationEur));
    setPickup(String(estimate.needsTow ? settings.towEur : settings.transportEur));
    setJobs(initialJobs());
    setRiskTyped(null);
  };

  const partsSum = jobs.reduce((sum, row) => sum + num(row.parts), 0);
  const hoursSum = jobs.reduce((sum, row) => sum + num(row.hours), 0);
  const difficulty = jobs.length > 0 ? (Math.max(...jobs.map((row) => row.difficulty)) as Difficulty) : null;
  const pickupEur = num(pickup);
  // Jobs in the list cover their component groups and a worse case picked by hand; a market value
  // typed in changes how unclear damage looks.
  const hidden = hiddenDefectRisk(profile, estimate.vehicleClass, coveredComponents(jobs.map((row) => row.id)));
  const unclear =
    market.trim() === ""
      ? null
      : unclearDamageRisk(
          damage,
          { fuel: facts.fuel, vehicleClass: estimate.vehicleClass },
          num(purchase),
          num(market),
          jobs.map((row) => ({ id: row.id, partsEur: num(row.parts) })),
        );
  const riskComputed = (hidden?.eur ?? 0) + (unclear?.eur ?? 0);
  const risk = riskTyped ?? String(riskComputed);
  const result =
    market.trim() === ""
      ? null
      : calculateFlip(
          {
            purchaseEur: num(purchase),
            marketEur: num(market),
            partsEur: [partsSum, partsSum],
            hours: [hoursSum, hoursSum],
            needsTow: false,
            riskEur: num(risk),
          },
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

  const labelled = (id: string, label: string, value: string, set: (value: string) => void, unit: "€" | "%", hint?: string) => (
    <div>
      <label htmlFor={`${ids}-${id}`} className={labelClass}>
        {label}
        <span className="sr-only"> {UNIT_WORDS[unit]}</span>
      </label>
      <AmountInput id={`${ids}-${id}`} value={value} onChange={set} unit={unit} describedBy={hint ? `${ids}-${id}-hint` : undefined} />
      {hint && (
        <p id={`${ids}-${id}-hint`} className="mt-0.5 text-xs text-muted">
          {hint}
        </p>
      )}
    </div>
  );

  return (
    <div className="mt-3 space-y-5">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {labelled("purchase", "Kaufpreis", purchase, setPurchase, "€", "Angebotspreis, verhandelbar")}
        {labelled("market", "Marktwert intakt", market, setMarket, "€", marketEur === null ? "Kein Marktwert, selbst eintragen" : "Median der Vergleichsangebote")}
        {labelled("discount", "Verkaufsabschlag", discount, setDiscount, "%")}
        {labelled("hu", "HU/TÜV", hu, setHu, "€")}
        {labelled("registration", "Zulassung", registration, setRegistration, "€")}
        {labelled("pickup", estimate.needsTow ? "Abholen (Anhänger)" : "Abholen (fahrbereit)", pickup, setPickup, "€")}
      </div>

      <div>
        <label htmlFor={`${ids}-risk`} className={labelClass}>
          Risikopuffer<span className="sr-only"> in Euro</span>
        </label>
        <AmountInput id={`${ids}-risk`} value={risk} onChange={setRiskTyped} unit="€" describedBy={`${ids}-risk-hint`} className="sm:max-w-48" />
        <div id={`${ids}-risk-hint`} className="mt-1 text-xs text-muted">
          {riskTyped !== null ? (
            <p>
              Selbst eingetragen.{" "}
              <button type="button" onClick={() => setRiskTyped(null)} className="text-accent hover:underline">
                Wieder ausrechnen ({formatEuro(riskComputed)})
              </button>
            </p>
          ) : hidden || unclear ? (
            <ul className="space-y-0.5">
              {hidden && (
                <li>
                  <span className="font-medium text-foreground">Versteckte Mängel {formatEuro(hidden.eur)}</span>:{" "}
                  {profileBasis === "model" ? "aus der Modell-Akte" : "Durchschnitt gleich alter Autos"}
                </li>
              )}
              {unclear && (
                <li>
                  <span className="font-medium text-foreground">Unklarer Schaden {formatEuro(unclear.eur)}</span>: Preis{" "}
                  {Math.round(unclear.belowMarket * 100)} % unter Marktwert, schlimmerer Fall zu {Math.round(unclear.probability * 100)} %
                  angenommen ({unclear.label}
                  {unclear.basis === "price" &&
                    `, so teuer wie der Preisnachlass abzüglich Arbeit, Aufwand und Teilen: ${formatEuro(unclear.extraEur)}`}
                  )
                </li>
              )}
            </ul>
          ) : (
            <p>Keine Mängeldaten zu diesem Auto und kein Hinweis auf einen schlimmeren Schaden.</p>
          )}
        </div>
      </div>

      <div>
        <p id={`${ids}-jobs`} className={labelClass}>
          Arbeiten ({VEHICLE_CLASS_LABELS[estimate.vehicleClass]}, Teile und Stunden aus dem Katalog, Mitte der Spanne)
        </p>
        <div aria-hidden="true" className="hidden gap-2 border-b border-line pb-1 text-xs text-muted sm:flex">
          <span className="flex-1">Arbeit</span>
          <span className="w-28">Teile</span>
          <span className="w-24">Stunden</span>
          <span className="w-8" />
        </div>
        <ul aria-labelledby={`${ids}-jobs`} className="divide-y divide-line border-b border-line max-sm:border-t">
          {jobs.map((row) => (
            <li key={row.key} className="flex flex-wrap items-center gap-x-2 gap-y-1.5 py-2">
              <span className="min-w-0 basis-full sm:flex-1 sm:basis-0">
                {row.label}
                <span className="ml-1 whitespace-nowrap text-xs text-muted" title={DIFFICULTY_LABELS[row.difficulty]}>
                  Schwierigkeit {row.difficulty}
                </span>
              </span>
              <AmountInput
                value={row.parts}
                onChange={(parts) => updateJob(row.key, { parts })}
                unit="€"
                label={`Teile für ${row.label} in Euro`}
                className="min-w-0 flex-1 sm:w-28 sm:flex-none"
              />
              <AmountInput
                value={row.hours}
                onChange={(hours) => updateJob(row.key, { hours })}
                unit="h"
                label={`Stunden für ${row.label}`}
                className="min-w-0 flex-1 sm:w-24 sm:flex-none"
              />
              <button
                type="button"
                onClick={() => setJobs((rows) => rows.filter((r) => r.key !== row.key))}
                aria-label={`${row.label} entfernen`}
                title="Entfernen"
                className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-lg text-muted hover:bg-background hover:text-warn-text"
              >
                ×
              </button>
            </li>
          ))}
          {jobs.length === 0 && <li className="py-2 text-muted">Keine Arbeiten. Füge unten eine aus dem Katalog hinzu.</li>}
        </ul>
        <p className="flex gap-2 py-2 font-medium">
          <span className="flex-1">Summe</span>
          <span className="whitespace-nowrap sm:w-28">{formatEuro(Math.round(partsSum))}</span>
          <span className="whitespace-nowrap sm:w-24">{formatNumber(hoursSum)} h</span>
          <span className="hidden w-8 sm:block" />
        </p>
        <label htmlFor={`${ids}-add`} className={`${labelClass} mt-1`}>
          Arbeit hinzufügen
        </label>
        <select id={`${ids}-add`} value="" onChange={(event) => addJob(event.target.value)} className={`${inputClass} pr-2`}>
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

      <div className="rounded-lg border border-line p-4" aria-live="polite">
        {result ? (
          <dl data-flip-result className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-xs text-muted">Marge</dt>
              <dd className={`text-xl font-bold ${result.marginEur >= settings.minMarginEur ? "text-good-text" : result.marginEur < 0 ? "text-warn-text" : ""}`}>
                {formatSignedPrice(result.marginEur)}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Pro Stunde</dt>
              <dd className="text-xl font-bold">{result.perHourEur === null ? "–" : `ca. ${formatEuro(result.perHourEur)}`}</dd>
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
              Risikopuffer {formatEuro(Math.round(result.riskEur))} − Nebenkosten {formatEuro(result.sideCostsEur)}, bei{" "}
              {formatHours(hoursSum)} Arbeit.
              {result.marginEur < settings.minMarginEur && ` Unter deiner Mindestmarge von ${formatEuro(settings.minMarginEur)}.`}
            </p>
          </dl>
        ) : (
          <p className="text-sm text-muted">Trag einen Marktwert ein, dann rechnet der Rechner die Marge aus.</p>
        )}
      </div>
      <button type="button" onClick={reset} className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-accent">
        Alles zurücksetzen
      </button>
    </div>
  );
}
