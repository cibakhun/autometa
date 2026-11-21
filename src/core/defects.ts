import { findJob, scaledParts, type VehicleClass } from "./repairs";

/**
 * Defect profiles per model ("Modell-Akte"): how often cars of a model and age had a defect in
 * a component group at the periodic inspection. The numbers come from the Dutch vehicle
 * authority RDW (open data, CC0): its APK (the Dutch HU) records every defect found per
 * number plate, and its vehicle register says which model a plate is. src/ingest/defects
 * samples cars per model and age and counts, per component group, how many of them had such a
 * defect in the last WINDOW_MONTHS. Only these counts are stored.
 *
 * Dutch cars are used a little differently from German ones, so the rates show tendencies (this
 * model rusts more than others of its age), not exact German figures.
 */

export const DEFECT_COMPONENTS = [
  "brakes",
  "brake_lines",
  "tyres",
  "suspension",
  "steering",
  "wheel_bearing",
  "driveshaft",
  "exhaust",
  "emissions",
  "leaks",
  "rust",
  "glass",
  "lights",
] as const;
export type DefectComponent = (typeof DEFECT_COMPONENTS)[number];

export interface ComponentInfo {
  label: string;
  /** The catalog job (src/core/repairs.ts) whose parts price such a defect usually costs. */
  job: string;
}

export const COMPONENT_INFO: Record<DefectComponent, ComponentInfo> = {
  brakes: { label: "Bremsen (Scheiben, Beläge, Sättel, Handbremse)", job: "brakes_front" },
  brake_lines: { label: "Bremsleitungen und -schläuche", job: "brake_lines" },
  tyres: { label: "Reifen und Räder", job: "tyres" },
  suspension: { label: "Federn und Stoßdämpfer", job: "shocks" },
  steering: { label: "Lenkung, Achsgelenke und Querlenker", job: "control_arm" },
  wheel_bearing: { label: "Radlager", job: "wheel_bearing" },
  driveshaft: { label: "Antriebswellen und Manschetten", job: "driveshaft" },
  exhaust: { label: "Auspuff", job: "exhaust" },
  emissions: { label: "Abgaswerte und Motorkontrollleuchte", job: "lambda" },
  leaks: { label: "Öl- und Flüssigkeitsverlust", job: "oil_leak" },
  rust: { label: "Rost an Karosserie und Unterboden", job: "rust_welding" },
  glass: { label: "Scheiben", job: "windshield" },
  lights: { label: "Beleuchtung, Wischer und Kleinkram", job: "hu_prep" },
};

/** Defects found in this many months before the data was fetched count. */
export const WINDOW_MONTHS = 24;
/** A profile needs this many sampled cars before it is shown or priced in. */
export const MIN_SAMPLE = 100;

/**
 * Age groups in years since first registration. Younger cars are left out: a Dutch car has its
 * first periodic inspection after three (diesel) or four (petrol) years.
 */
export const AGE_BUCKETS: [number, number][] = [
  [5, 7],
  [8, 10],
  [11, 13],
  [14, 17],
  [18, 25],
];

/** The age group of a car first registered on this date (YYYY-MM-DD or YYYY), or null. */
export function ageBucket(firstRegistration: string | null | undefined, now = new Date()): number | null {
  if (!firstRegistration) return null;
  const year = Number(firstRegistration.slice(0, 4));
  if (!Number.isInteger(year)) return null;
  const age = now.getUTCFullYear() - year;
  const index = AGE_BUCKETS.findIndex(([from, to]) => age >= from && age <= to);
  return index === -1 ? null : index;
}

export function ageBucketLabel(bucket: number): string {
  const [from, to] = AGE_BUCKETS[bucket];
  return `${from} bis ${to} Jahre`;
}

/** First registration years of an age group: [oldest, youngest]. */
export function bucketYears(bucket: number, now = new Date()): [number, number] {
  const [from, to] = AGE_BUCKETS[bucket];
  const year = now.getUTCFullYear();
  return [year - to, year - from];
}

/** Counts for one model and age group: how many sampled cars had a defect, per component. */
export interface DefectProfile {
  sample: number;
  /** Cars with any defect in the window, including ones in no component group. */
  anyDefect: number;
  components: Partial<Record<DefectComponent, number>>;
}

/** Share of cars with a defect in a component (0 to 1). */
export function componentRate(profile: DefectProfile, component: DefectComponent): number {
  return profile.sample > 0 ? (profile.components[component] ?? 0) / profile.sample : 0;
}

/** The pooled profile of many: the average car of that age group. */
export function poolProfiles(profiles: Iterable<DefectProfile>): DefectProfile {
  const pooled: DefectProfile = { sample: 0, anyDefect: 0, components: {} };
  for (const profile of profiles) {
    if (profile.sample < MIN_SAMPLE) continue;
    pooled.sample += profile.sample;
    pooled.anyDefect += profile.anyDefect;
    for (const component of DEFECT_COMPONENTS) {
      const count = profile.components[component];
      if (count) pooled.components[component] = (pooled.components[component] ?? 0) + count;
    }
  }
  return pooled;
}

/** Which component groups a catalog job takes care of, so their hidden risk is not counted twice. */
const JOB_COMPONENTS: Record<string, DefectComponent[] | "all"> = {
  project: "all",
  hu_prep: ["lights"],
  brakes_front: ["brakes"],
  brakes_rear: ["brakes"],
  brake_caliper: ["brakes"],
  brake_lines: ["brake_lines"],
  tyres: ["tyres"],
  shocks: ["suspension"],
  control_arm: ["steering"],
  tie_rod: ["steering"],
  wheel_bearing: ["wheel_bearing"],
  driveshaft: ["driveshaft"],
  exhaust: ["exhaust"],
  dpf_cat: ["emissions", "exhaust"],
  lambda: ["emissions"],
  egr: ["emissions"],
  oil_leak: ["leaks"],
  engine_used: ["leaks", "emissions"],
  engine_rebuild: ["leaks", "emissions"],
  head_gasket: ["leaks"],
  rust_welding: ["rust"],
  windshield: ["glass"],
  water_damage: ["lights"],
};

/** Component groups the given jobs already cover. */
export function coveredComponents(jobIds: Iterable<string>): Set<DefectComponent> {
  const covered = new Set<DefectComponent>();
  for (const id of jobIds) {
    const components = JOB_COMPONENTS[id];
    if (components === "all") return new Set(DEFECT_COMPONENTS);
    for (const component of components ?? []) covered.add(component);
  }
  return covered;
}

export interface HiddenRiskItem {
  component: DefectComponent;
  rate: number;
  /** Middle of the parts range of the component's job for the vehicle class. */
  costEur: number;
  /** rate × cost, in euros. */
  riskEur: number;
}

export interface HiddenRisk {
  /** Sum of the items, rounded to 10 euros. */
  eur: number;
  items: HiddenRiskItem[];
}

const round10 = (value: number) => Math.round(value / 10) * 10;

/**
 * Expected parts cost of defects the next inspection finds: for each component group not
 * covered by the known repair jobs, the share of such cars with a defect there times what fixing
 * it usually costs. Null without a profile of at least MIN_SAMPLE cars.
 */
export function hiddenDefectRisk(
  profile: DefectProfile | null | undefined,
  cls: VehicleClass,
  covered: ReadonlySet<DefectComponent> = new Set(),
): HiddenRisk | null {
  if (!profile || profile.sample < MIN_SAMPLE) return null;
  const items: HiddenRiskItem[] = [];
  for (const component of DEFECT_COMPONENTS) {
    if (covered.has(component)) continue;
    const rate = componentRate(profile, component);
    if (rate <= 0) continue;
    const job = findJob(COMPONENT_INFO[component].job);
    if (!job) continue;
    const [from, to] = scaledParts(job, cls);
    const costEur = (from + to) / 2;
    items.push({ component, rate, costEur, riskEur: rate * costEur });
  }
  items.sort((a, b) => b.riskEur - a.riskEur);
  return { eur: round10(items.reduce((sum, item) => sum + item.riskEur, 0)), items };
}

export interface ComponentComparison {
  component: DefectComponent;
  rate: number;
  /** Rate of the average car of the same age, or null without one. */
  averageRate: number | null;
  /** Clearly more often than average: a weak point of the model. */
  weak: boolean;
}

/** A component counts as a weak point at this multiple of the average rate, and at least WEAK_MIN_RATE. */
export const WEAK_RATIO = 1.3;
export const WEAK_MIN_RATE = 0.03;

/** Every component group with its rate next to the average car of the same age, most frequent first. */
export function compareWithAverage(profile: DefectProfile, average: DefectProfile | null): ComponentComparison[] {
  return DEFECT_COMPONENTS.map((component) => {
    const rate = componentRate(profile, component);
    const averageRate = average && average.sample >= MIN_SAMPLE ? componentRate(average, component) : null;
    const weak = averageRate !== null && rate >= WEAK_MIN_RATE && rate >= averageRate * WEAK_RATIO;
    return { component, rate, averageRate, weak };
  }).sort((a, b) => b.rate - a.rate);
}
