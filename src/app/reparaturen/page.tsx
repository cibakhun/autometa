import type { Metadata } from "next";
import { DAMAGE_LABELS, type DamageKind } from "@/core/damage";
import {
  CLASS_FACTORS,
  CONFIDENCE_LABELS,
  DAMAGE_JOBS,
  DIFFICULTY_LABELS,
  findJob,
  JOB_GROUPS,
  REPAIR_JOBS,
  VEHICLE_CLASS_LABELS,
  VEHICLE_CLASSES,
  type Difficulty,
} from "@/core/repairs";
import { formatEuro } from "@/lib/format";

export const metadata: Metadata = { title: "Reparaturkatalog – AutoMeta" };

const hours = ([from, to]: [number, number]) =>
  `${from.toLocaleString("de-DE")}${from === to ? "" : `–${to.toLocaleString("de-DE")}`} h`;
const euros = ([from, to]: [number, number]) => (from === to ? formatEuro(from) : `${formatEuro(from)} – ${formatEuro(to)}`);

export default function RepairCatalogPage() {
  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Reparaturkatalog</h1>
        <p className="mt-2 text-sm text-muted">
          Typische Arbeiten beim Flippen, mit Stunden für einen Hobbyschrauber mit normalem Werkzeug und Teilepreisen aus Zubehör
          oder vom Verwerter. <strong className="font-semibold text-foreground">Alle Werte sind Schätzungen</strong>, keine
          Herstellerzeiten; sie werden mit echten Flips genauer.
        </p>
      </div>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Schwierigkeit</h2>
        <ol className="mt-2 space-y-1 text-sm">
          {(Object.entries(DIFFICULTY_LABELS) as unknown as [Difficulty, string][]).map(([level, label]) => (
            <li key={level}>
              <span className="font-medium">{level}</span> {label}
            </li>
          ))}
        </ol>
        <h2 className="mt-4 font-semibold">Teilepreise nach Fahrzeugklasse</h2>
        <p className="mt-1 text-sm text-muted">
          Die Preise unten gelten für die Kompaktklasse. Die Klasse ergibt sich aus Leistung und Fahrzeugtyp, Premiummarken eine
          Klasse höher.
        </p>
        <ul className="mt-2 grid gap-1 text-sm sm:grid-cols-2">
          {VEHICLE_CLASSES.map((cls) => (
            <li key={cls}>
              {VEHICLE_CLASS_LABELS[cls]}: <span className="font-medium">× {CLASS_FACTORS[cls].toLocaleString("de-DE")}</span>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border border-line bg-surface p-5">
        <h2 className="font-semibold">Was ein Schadenshinweis im Titel bedeutet</h2>
        <div className="mt-2 overflow-x-auto">
          <table className="w-full min-w-[36rem] text-left text-sm">
            <thead className="text-xs text-muted">
              <tr className="border-b border-line">
                <th className="py-2 pr-3 font-medium">Hinweis</th>
                <th className="py-2 pr-3 font-medium">Gerechnet wird mit</th>
                <th className="py-2 pr-3 font-medium">Sicherheit</th>
                <th className="py-2 font-medium">Abholen</th>
              </tr>
            </thead>
            <tbody>
              {(Object.entries(DAMAGE_JOBS) as [DamageKind, (typeof DAMAGE_JOBS)[DamageKind]][]).map(([kind, rule]) => (
                <tr key={kind} className="border-b border-line last:border-0">
                  <td className="py-2 pr-3 font-medium">{DAMAGE_LABELS[kind]}</td>
                  <td className="py-2 pr-3">{rule.jobs.map((id) => findJob(id)?.label ?? id).join(", ")}</td>
                  <td className="py-2 pr-3">{CONFIDENCE_LABELS[rule.confidence]}</td>
                  <td className="py-2">{rule.drivable ? "fahrbereit" : "Anhänger"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Jedes Auto bekommt dazu „Aufbereitung, Fotos und Verkauf“, eines mit abgelaufener HU die HU-Vorbereitung. Bei Elektroautos
          zählt ein Motor- oder Getriebeschaden als Hochvolt-Fehler.
        </p>
      </section>

      {JOB_GROUPS.map((group) => {
        const jobs = REPAIR_JOBS.filter((job) => job.group === group);
        if (jobs.length === 0) return null;
        return (
          <section key={group} className="rounded-xl border border-line bg-surface p-5">
            <h2 className="font-semibold">{group}</h2>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[36rem] text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr className="border-b border-line">
                    <th className="py-2 pr-3 font-medium">Arbeit</th>
                    <th className="py-2 pr-3 font-medium">Stunden</th>
                    <th className="py-2 pr-3 font-medium">Schwierigkeit</th>
                    <th className="py-2 font-medium">Teile (Kompaktklasse)</th>
                  </tr>
                </thead>
                <tbody>
                  {jobs.map((job) => (
                    <tr key={job.id} className="border-b border-line align-top last:border-0">
                      <td className="py-2 pr-3">
                        <span className="font-medium">{job.label}</span>
                        {job.tools && <span className="block text-xs text-muted">Braucht: {job.tools}</span>}
                      </td>
                      <td className="whitespace-nowrap py-2 pr-3">{hours(job.hours)}</td>
                      <td className="py-2 pr-3">{job.difficulty} von 5</td>
                      <td className="whitespace-nowrap py-2">{euros(job.partsEur)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
    </div>
  );
}
