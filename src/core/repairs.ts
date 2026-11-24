import type { DamageKind } from "./damage";
import type { InspectionBasis } from "./inspection";
import type { BodyType, Fuel } from "./types";

/**
 * Repair catalog for flipping: typical jobs a hobby mechanic does, with hours, difficulty and
 * the price range of the parts. Every number is an estimate (no free, legal source has
 * labour times or parts prices), meant to be corrected by real flips later. Hours are for a
 * hobby mechanic with normal tools, slower than workshop book times. Parts prices are for a
 * compact car (Golf, Astra, Focus) from the aftermarket or a breaker's yard; other vehicle
 * classes scale them (VEHICLE_CLASSES).
 */

export const DIFFICULTY_LABELS = {
  1: "Verschleiß ohne Hebebühne",
  2: "Schrauben mit normalem Werkzeug",
  3: "Hebebühne oder Spezialwerkzeug",
  4: "Großer Eingriff, Motor oder Getriebe öffnen oder ausbauen",
  5: "Überholung, Hochvolt oder Herstellerdiagnose",
} as const;
export type Difficulty = keyof typeof DIFFICULTY_LABELS;

export const JOB_GROUPS = ["Allgemein", "Motor", "Antrieb", "Bremsen", "Fahrwerk", "Elektrik", "Kühlung und Klima", "Abgas", "Karosserie"] as const;
export type JobGroup = (typeof JOB_GROUPS)[number];

export interface RepairJob {
  id: string;
  label: string;
  group: JobGroup;
  /** Hours for a hobby mechanic, from and to. */
  hours: [number, number];
  difficulty: Difficulty;
  /** Parts and material in euros for a compact car, from and to. */
  partsEur: [number, number];
  /** Special tools or outside work the job needs. */
  tools?: string;
  /** Jobs this one makes unnecessary, e.g. a replacement engine includes a new timing chain. */
  replaces?: string[];
}

const job = (
  id: string,
  group: JobGroup,
  label: string,
  hours: [number, number],
  difficulty: Difficulty,
  partsEur: [number, number],
  extra: Pick<RepairJob, "tools" | "replaces"> = {},
): RepairJob => ({ id, group, label, hours, difficulty, partsEur, ...extra });

export const REPAIR_JOBS: RepairJob[] = [
  job("prep", "Allgemein", "Aufbereitung, Fotos und Verkauf", [3, 6], 1, [30, 80]),
  job("hu_prep", "Allgemein", "HU-Vorbereitung (Lampen, Wischer, Kleinkram)", [1, 3], 1, [30, 150]),
  job("service", "Allgemein", "Inspektion (Öl, Filter, Zündkerzen)", [1, 3], 1, [80, 200]),
  job("diagnosis", "Allgemein", "Fehlersuche mit Diagnosegerät", [1, 4], 2, [0, 50], { tools: "OBD-Diagnosegerät" }),
  job("project", "Allgemein", "Viele kleine Mängel, Umfang unbekannt (Bastlerfahrzeug)", [8, 24], 3, [300, 1500]),
  job("unknown_defect", "Allgemein", "Defekt unbekannter Art", [2, 10], 3, [100, 1000], { tools: "OBD-Diagnosegerät" }),

  job("ignition", "Motor", "Zündspulen und Zündkerzen", [0.5, 1.5], 1, [40, 200]),
  job("glow_plugs", "Motor", "Glühkerzen (Diesel)", [1, 4], 3, [40, 120], { tools: "Ausdrehwerkzeug für abgerissene Kerzen" }),
  job("injectors", "Motor", "Injektoren (Diesel)", [2, 5], 3, [300, 1200], { tools: "Anlernen per Diagnosegerät" }),
  job("egr", "Motor", "AGR-Ventil", [1, 4], 2, [80, 300]),
  job("oil_leak", "Motor", "Ölverlust beheben (Dichtungen)", [2, 6], 2, [30, 150]),
  job("fuel_pump", "Motor", "Kraftstoffpumpe", [1.5, 3], 2, [80, 300]),
  job("turbo", "Motor", "Turbolader tauschen", [3, 7], 3, [400, 1200]),
  job("timing_belt", "Motor", "Zahnriemen mit Wasserpumpe", [3, 6], 3, [150, 350], { tools: "Motor-Arretierwerkzeug" }),
  job("timing_chain", "Motor", "Steuerkette oder Zahnriemen nach Schaden", [6, 14], 4, [300, 900], {
    tools: "Motor-Arretierwerkzeug",
    replaces: ["timing_belt"],
  }),
  job("head_gasket", "Motor", "Zylinderkopfdichtung, Kopf planen lassen", [8, 16], 4, [250, 700], { tools: "Drehmomentschlüssel, Kopf planen (Fremdleistung)" }),
  job("engine_used", "Motor", "Gebrauchtmotor einbauen", [12, 24], 4, [900, 2500], {
    tools: "Motorkran, Getriebeheber",
    replaces: ["timing_chain", "timing_belt", "head_gasket", "turbo", "oil_leak", "no_start", "unknown_defect"],
  }),
  job("engine_rebuild", "Motor", "Motor überholen", [25, 50], 5, [800, 2500], {
    tools: "Motorkran, Messwerkzeug, Kopfbearbeitung (Fremdleistung)",
    replaces: ["engine_used", "timing_chain", "timing_belt", "head_gasket", "oil_leak"],
  }),

  job("clutch", "Antrieb", "Kupplungssatz", [5, 9], 3, [200, 450], { tools: "Getriebeheber" }),
  job("dual_mass", "Antrieb", "Zweimassenschwungrad mit Kupplung", [6, 10], 3, [450, 900], { tools: "Getriebeheber", replaces: ["clutch"] }),
  job("gearbox_used", "Antrieb", "Gebrauchtgetriebe einbauen", [6, 12], 4, [400, 1500], { tools: "Getriebeheber" }),
  job("mechatronics", "Antrieb", "Mechatronik oder Steuerung des Automatikgetriebes", [3, 6], 4, [500, 1500], { tools: "Anlernen per Diagnosegerät" }),
  job("driveshaft", "Antrieb", "Antriebswelle", [1.5, 3], 2, [80, 250]),

  job("brakes_front", "Bremsen", "Bremsscheiben und -beläge vorne", [1, 2], 1, [80, 200]),
  job("brakes_rear", "Bremsen", "Bremsen hinten", [1.5, 3], 2, [80, 220]),
  job("brake_caliper", "Bremsen", "Bremssattel", [1, 2], 2, [60, 180]),
  job("brake_lines", "Bremsen", "Bremsleitungen erneuern", [3, 6], 3, [40, 120], { tools: "Bördelgerät" }),

  job("shocks", "Fahrwerk", "Stoßdämpfer und Federn einer Achse", [2, 4], 2, [120, 350], { tools: "Federspanner" }),
  job("control_arm", "Fahrwerk", "Querlenker einer Seite", [1, 2], 2, [40, 150]),
  job("tie_rod", "Fahrwerk", "Spurstangenkopf oder Koppelstange", [0.5, 1.5], 1, [20, 60]),
  job("wheel_bearing", "Fahrwerk", "Radlager", [1.5, 3], 3, [50, 150], { tools: "Radlager-Abzieher oder Presse" }),
  job("alignment", "Fahrwerk", "Achsvermessung (Fremdleistung)", [0.5, 1], 1, [60, 120]),
  job("tyres", "Fahrwerk", "Vier Reifen, montiert und gewuchtet", [0.5, 1], 1, [180, 400]),

  job("battery", "Elektrik", "Batterie", [0.3, 1], 1, [80, 200]),
  job("starter", "Elektrik", "Anlasser", [1, 3], 2, [80, 250]),
  job("alternator", "Elektrik", "Lichtmaschine", [1, 3], 2, [100, 300]),
  job("no_start", "Elektrik", "Fehlersuche: springt nicht an (Batterie, Anlasser, Kraftstoff, Zündung)", [1, 6], 2, [50, 500], {
    tools: "Multimeter, OBD-Diagnosegerät",
  }),
  job("electrical_fault", "Elektrik", "Elektrikfehler (Kabel, Stecker, Relais)", [2, 8], 3, [20, 200], { tools: "Multimeter, Schaltplan" }),
  job("control_unit", "Elektrik", "Steuergerät tauschen und codieren", [2, 5], 5, [150, 600], { tools: "Herstellerdiagnose zum Codieren" }),
  job("high_voltage", "Elektrik", "Hochvolt-System (Elektro oder Hybrid)", [5, 15], 5, [1000, 5000], { tools: "HV-Schulung, Isolationswerkzeug" }),

  job("water_pump", "Kühlung und Klima", "Wasserpumpe oder Thermostat", [1.5, 4], 2, [60, 200]),
  job("radiator", "Kühlung und Klima", "Kühler", [1.5, 3], 2, [80, 250]),
  job("ac", "Kühlung und Klima", "Klimaanlage (Kompressor oder Leck)", [2, 5], 3, [150, 600], { tools: "Klimaservice (Fremdleistung)" }),

  job("exhaust", "Abgas", "Auspuff (Mittel- oder Endschalldämpfer)", [1, 2.5], 2, [60, 250]),
  job("dpf_cat", "Abgas", "Dieselpartikelfilter oder Katalysator", [2, 4], 2, [300, 1000]),
  job("lambda", "Abgas", "Lambdasonde", [0.5, 1.5], 1, [40, 120]),

  job("body_panels", "Karosserie", "Unfallschaden: Anbauteile tauschen (Stoßfänger, Kotflügel, Scheinwerfer)", [6, 16], 3, [300, 1200]),
  job("accident_heavy", "Karosserie", "Schwerer Unfallschaden: Airbags, Träger, Rahmen richten (Fremdleistung)", [15, 35], 5, [1500, 4000], {
    tools: "Richtbank und Vermessung (Fremdleistung), Airbag-Steuergerät codieren",
    replaces: ["body_panels"],
  }),
  job("paint", "Karosserie", "Teile lackieren lassen (Fremdleistung)", [0.5, 1], 1, [300, 900]),
  job("rust_welding", "Karosserie", "Rost schweißen (Schweller, Radlauf)", [4, 12], 4, [50, 250], { tools: "Schweißgerät" }),
  job("hail", "Karosserie", "Hagelschaden ausbeulen lassen (Fremdleistung)", [1, 2], 1, [800, 2500]),
  job("windshield", "Karosserie", "Frontscheibe (Fremdleistung)", [0.5, 1], 1, [200, 500]),
  job("water_damage", "Karosserie", "Wasserschaden: trocknen, Teppich und Elektrik prüfen", [6, 20], 3, [100, 1200]),
];

const JOBS_BY_ID = new Map(REPAIR_JOBS.map((j) => [j.id, j]));

export function findJob(id: string): RepairJob | undefined {
  return JOBS_BY_ID.get(id);
}

/**
 * How well a title's damage is known: high when a concrete part is named, medium when the
 * cause is unclear ("Motorschaden"), low when anything could be behind it ("springt nicht an").
 */
export const CONFIDENCES = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCES)[number];
export const CONFIDENCE_LABELS: Record<Confidence, string> = { high: "hoch", medium: "mittel", low: "niedrig" };

interface DamageRule {
  jobs: string[];
  confidence: Confidence;
  /** False when the car most likely has to be towed or trailered. */
  drivable: boolean;
}

/** What each damage kind from the title (src/core/damage.ts) usually takes to fix. */
export const DAMAGE_JOBS: Record<DamageKind, DamageRule> = {
  engine: { jobs: ["engine_used"], confidence: "medium", drivable: false },
  timing: { jobs: ["timing_chain"], confidence: "medium", drivable: false },
  head_gasket: { jobs: ["head_gasket"], confidence: "high", drivable: false },
  turbo: { jobs: ["turbo"], confidence: "high", drivable: true },
  gearbox: { jobs: ["gearbox_used"], confidence: "medium", drivable: false },
  clutch: { jobs: ["clutch"], confidence: "high", drivable: true },
  electrics: { jobs: ["electrical_fault"], confidence: "low", drivable: true },
  accident: { jobs: ["body_panels", "paint"], confidence: "low", drivable: false },
  rust: { jobs: ["rust_welding"], confidence: "medium", drivable: true },
  hail: { jobs: ["hail"], confidence: "high", drivable: true },
  water: { jobs: ["water_damage"], confidence: "low", drivable: false },
  not_running: { jobs: ["no_start"], confidence: "low", drivable: false },
  project: { jobs: ["project"], confidence: "low", drivable: false },
  defect: { jobs: ["unknown_defect"], confidence: "low", drivable: true },
};

/** An electric car's "Motorschaden" or "Getriebe defekt" is a drive unit or high-voltage fault. */
const ELECTRIC_JOBS: Partial<Record<DamageKind, string[]>> = {
  engine: ["high_voltage"],
  gearbox: ["high_voltage"],
  timing: [],
  head_gasket: [],
  turbo: [],
  clutch: [],
};

export const VEHICLE_CLASSES = ["small", "compact", "mid", "large"] as const;
export type VehicleClass = (typeof VEHICLE_CLASSES)[number];
export const VEHICLE_CLASS_LABELS: Record<VehicleClass, string> = {
  small: "Kleinwagen",
  compact: "Kompaktklasse",
  mid: "Mittelklasse",
  large: "Oberklasse, großer SUV oder Transporter",
};
/** Parts cost relative to a compact car. */
export const CLASS_FACTORS: Record<VehicleClass, number> = { small: 0.8, compact: 1, mid: 1.3, large: 1.8 };

/** Makes whose parts cost about one class more than their size suggests. */
const PREMIUM_MAKES = new Set([
  "audi", "bmw", "mercedes-benz", "porsche", "jaguar", "land-rover", "lexus", "volvo", "tesla", "polestar", "ds",
]);

export interface VehicleFacts {
  makeSlug: string | null;
  powerKw: number | null;
  bodyType: BodyType | null;
  fuel: Fuel | null;
}

/** A rough size class from power and body, one class up for premium makes. */
export function vehicleClass(facts: VehicleFacts): VehicleClass {
  let index: number;
  if (facts.powerKw !== null) index = facts.powerKw < 60 ? 0 : facts.powerKw < 90 ? 1 : facts.powerKw < 130 ? 2 : 3;
  else index = facts.bodyType === "small" ? 0 : facts.bodyType === "suv" || facts.bodyType === "van" ? 2 : 1;
  if ((facts.bodyType === "suv" || facts.bodyType === "van") && index < 2) index = 2;
  if (facts.makeSlug && PREMIUM_MAKES.has(facts.makeSlug)) index += 1;
  return VEHICLE_CLASSES[Math.min(index, VEHICLE_CLASSES.length - 1)];
}

export interface EstimatedJob {
  job: RepairJob;
  /** Parts for this vehicle's class, rounded to 10 euros. */
  partsEur: [number, number];
  /** The damage kind it comes from, or null for jobs every flip has. */
  from: DamageKind | null;
}

export interface RepairEstimate {
  vehicleClass: VehicleClass;
  jobs: EstimatedJob[];
  partsEur: [number, number];
  hours: [number, number];
  difficulty: Difficulty;
  confidence: Confidence;
  /** The car most likely has to be towed or trailered. */
  needsTow: boolean;
}

/** The HU has run out: the listing says so, or its last valid month lies before this month. */
export function huExpired(basis: InspectionBasis | null | undefined, until: string | null | undefined, now = new Date()): boolean {
  if (basis === "expired") return true;
  if (!until) return false;
  const thisMonth = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}-01`;
  return until < thisMonth;
}

const round10 = (value: number) => Math.round(value / 10) * 10;
const roundHalf = (value: number) => Math.round(value * 2) / 2;

/** Parts of a job for a vehicle class, rounded to 10 euros. */
export function scaledParts(job: RepairJob, cls: VehicleClass): [number, number] {
  const factor = CLASS_FACTORS[cls];
  return [round10(job.partsEur[0] * factor), round10(job.partsEur[1] * factor)];
}

/**
 * The jobs a listing probably needs: those for each damage kind in its title, plus preparing
 * it for sale, plus HU preparation when the HU has run out. Jobs another job replaces (a
 * replacement engine includes the timing chain) are left out.
 */
export function estimateRepairs(
  damage: readonly DamageKind[],
  facts: VehicleFacts & { huBasis?: InspectionBasis | null; huUntil?: string | null },
  now = new Date(),
): RepairEstimate {
  const cls = vehicleClass(facts);
  const picked = new Map<string, DamageKind | null>();
  let confidence: Confidence = "high";
  let needsTow = false;
  for (const kind of damage) {
    const rule = DAMAGE_JOBS[kind];
    const jobs = facts.fuel === "electric" ? (ELECTRIC_JOBS[kind] ?? rule.jobs) : rule.jobs;
    for (const id of jobs) if (!picked.has(id)) picked.set(id, kind);
    if (CONFIDENCES.indexOf(rule.confidence) > CONFIDENCES.indexOf(confidence)) confidence = rule.confidence;
    if (!rule.drivable) needsTow = true;
  }
  if (huExpired(facts.huBasis, facts.huUntil, now)) picked.set("hu_prep", null);
  picked.set("prep", null);

  const replaced = new Set([...picked.keys()].flatMap((id) => findJob(id)?.replaces ?? []));
  const jobs: EstimatedJob[] = [...picked]
    .filter(([id]) => !replaced.has(id))
    .map(([id, from]) => {
      const repairJob = findJob(id)!;
      return { job: repairJob, partsEur: scaledParts(repairJob, cls), from };
    });

  return {
    vehicleClass: cls,
    jobs,
    partsEur: [jobs.reduce((sum, j) => sum + j.partsEur[0], 0), jobs.reduce((sum, j) => sum + j.partsEur[1], 0)],
    hours: [roundHalf(jobs.reduce((sum, j) => sum + j.job.hours[0], 0)), roundHalf(jobs.reduce((sum, j) => sum + j.job.hours[1], 0))],
    difficulty: Math.max(...jobs.map((j) => j.job.difficulty)) as Difficulty,
    confidence,
    needsTow,
  };
}

/**
 * Damage whose extent a title does not tell, and the much worse case it can turn out to be: an
 * "Unfallwagen" may need new panels or a straightened frame, a car that "springt nicht an" a new
 * battery or a new engine. Kinds that already assume the worse case (Motorschaden counts as a
 * replacement engine) or that name the part (Kupplung) have none here; for them only a price far
 * below market points to more (LABOR_AND_HASSLE_EUR).
 */
export const SEVERE_CASES: Partial<Record<DamageKind, { jobs: string[]; label: string }>> = {
  accident: { jobs: ["accident_heavy"], label: "schwerer Unfallschaden (Airbags, Träger, Rahmen)" },
  timing: { jobs: ["engine_used"], label: "Ventile beschädigt, Motor tauschen" },
  not_running: { jobs: ["engine_used"], label: "Motor defekt" },
  defect: { jobs: ["engine_used"], label: "Motor- oder Getriebeschaden" },
  project: { jobs: ["engine_used"], label: "Motor- oder Getriebeschaden zusätzlich" },
  electrics: { jobs: ["control_unit"], label: "Steuergerät tauschen und codieren" },
  water: { jobs: ["control_unit"], label: "Steuergeräte durch Wasser zerstört" },
};

/**
 * How far below the market value the asking price must be before it points to the worse case:
 * not at all up to SEVERE_FROM below market, certainly from SEVERE_CERTAIN, in a straight line
 * between. The seller knows the damage better than the title says, and prices it in.
 */
export const SEVERE_FROM = 0.3;
export const SEVERE_CERTAIN = 0.7;

/**
 * The part of a damaged car's discount that labor at a workshop and the hassle of selling it
 * explain. What the discount goes beyond this and the parts already counted can be damage the
 * title does not name, so the worse case costs at least that much: a 34,000 euro car offered
 * for 6,000 has damage of about that size, whatever the catalog's worse case costs on average.
 */
export const LABOR_AND_HASSLE_EUR = 3000;

/** The worse case of a damage kind without one in SEVERE_CASES, when only the price points to it. */
export const PRICE_SEVERE_LABEL = "größerer Schaden, als der Titel nennt";

export interface UnclearRisk {
  kind: DamageKind;
  label: string;
  /** Share of the market value the price lies below it (0 to 1). */
  belowMarket: number;
  /** Probability of the worse case derived from belowMarket (0 to 1). */
  probability: number;
  /** What the worse case costs in parts on top of the estimate. */
  extraEur: number;
  /** Catalog: the worse case's jobs. Price: the discount beyond labor, hassle and counted parts. */
  basis: "catalog" | "price";
  /** probability × extra, rounded to 10 euros. */
  eur: number;
}

/** A job already in the estimate or calculator, with the parts cost counted for it. */
export interface CountedJob {
  id: string;
  partsEur: number;
}

/** The jobs of an estimate with the middle of their parts range. */
export const countedJobs = (estimate: RepairEstimate): CountedJob[] =>
  estimate.jobs.map((j) => ({ id: j.job.id, partsEur: (j.partsEur[0] + j.partsEur[1]) / 2 }));

/** Middle of a job's parts range for a vehicle class. */
const partsMid = (id: string, cls: VehicleClass) => {
  const found = findJob(id);
  if (!found) return 0;
  const [from, to] = scaledParts(found, cls);
  return (from + to) / 2;
};

/**
 * The extra parts cost to expect because a damage's extent is unclear, times how likely the price
 * makes the worse case. The worse case costs the more of two: the catalog's (SEVERE_CASES, beyond
 * the jobs it replaces) and the price's (the discount on the market value beyond
 * LABOR_AND_HASSLE_EUR and all counted parts), so it grows with the car's value. The biggest of
 * the damage kinds counts (one car has one worst case). counted are the jobs already counted with
 * their parts cost: the whole estimate, or the rows in the calculator as typed. A catalog worse
 * case among them, or replaced by one of them, costs nothing extra; the jobs it replaces are
 * credited at their counted cost. Null when nothing applies or there is no market value to
 * compare the price with.
 */
export function unclearDamageRisk(
  damage: readonly DamageKind[],
  facts: { fuel: Fuel | null; vehicleClass: VehicleClass },
  priceEur: number,
  marketEur: number | null,
  counted: readonly CountedJob[],
): UnclearRisk | null {
  if (marketEur === null || marketEur <= 0) return null;
  const belowMarket = Math.max(0, Math.min(1, 1 - priceEur / marketEur));
  const probability = Math.max(0, Math.min(1, (belowMarket - SEVERE_FROM) / (SEVERE_CERTAIN - SEVERE_FROM)));
  if (probability === 0) return null;
  const covered = new Set(counted.flatMap(({ id }) => [id, ...(findJob(id)?.replaces ?? [])]));
  const countedEur = counted.reduce((sum, job) => sum + job.partsEur, 0);
  const priceExtraEur = Math.max(0, marketEur - priceEur - LABOR_AND_HASSLE_EUR - countedEur);
  let worst: UnclearRisk | null = null;
  for (const kind of damage) {
    const severe = SEVERE_CASES[kind];
    const severeJobs = (severe?.jobs ?? []).map((id) => (facts.fuel === "electric" && id === "engine_used" ? "high_voltage" : id));
    // Another hint can have brought the catalog's worse case into the estimate (engine and not running).
    const missing = severeJobs.filter((id) => !covered.has(id));
    // An electric car's high-voltage fault stands in for the replacement engine, with what that replaces.
    const replaced = new Set([...(severe?.jobs ?? []), ...severeJobs].flatMap((id) => [id, ...(findJob(id)?.replaces ?? [])]));
    const catalogExtraEur =
      missing.length === 0
        ? 0
        : Math.max(
            0,
            missing.reduce((sum, id) => sum + partsMid(id, facts.vehicleClass), 0) -
              counted.filter(({ id }) => replaced.has(id)).reduce((sum, job) => sum + job.partsEur, 0),
          );
    const basis = priceExtraEur > catalogExtraEur ? "price" : "catalog";
    const extraEur = Math.max(catalogExtraEur, priceExtraEur);
    const eur = round10(probability * extraEur);
    // On a tie, a kind with its own worse case names it better than the generic label.
    const better = !worst || eur > worst.eur || (eur === worst.eur && severe !== undefined && SEVERE_CASES[worst.kind] === undefined);
    if (eur > 0 && better) {
      const label = severe?.label ?? PRICE_SEVERE_LABEL;
      worst = { kind, label, belowMarket, probability, extraEur: round10(extraEur), basis, eur };
    }
  }
  return worst;
}
