import { MAKES, type MakeDef } from "./taxonomy";
import type { BodyType, Fuel, Transmission } from "./types";

/** Lowercase, strip accents, turn every non-alphanumeric run into one space. */
export function normalizeText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/** Parses German or plain number strings: "12.990 €", "123.456 km", "12990" -> number. */
export function parseInteger(value: string | number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? Math.round(value) : null;
  // Keep digits and separators, drop a German decimal part (",00"), then the thousands dots.
  const digits = value
    .replace(/[^\d.,-]/g, "")
    .replace(/,\d*$/, "")
    .replace(/[.,]/g, "");
  if (!digits || digits === "-") return null;
  const parsed = Number.parseInt(digits, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function psToKw(ps: number): number {
  return Math.round(ps * 0.73549875);
}

export function kwToPs(kw: number): number {
  return Math.round(kw / 0.73549875);
}

/** "110 kW (150 PS)" -> 110, "150 PS" -> 110, "110 kW" -> 110. */
export function parsePowerKw(value: string | null | undefined): number | null {
  if (!value) return null;
  const kw = value.match(/(\d+(?:[.,]\d+)?)\s*kw/i);
  if (kw) return Math.round(Number(kw[1].replace(",", ".")));
  const ps = value.match(/(\d+(?:[.,]\d+)?)\s*(ps|hp|cv)/i);
  if (ps) return psToKw(Number(ps[1].replace(",", ".")));
  return null;
}

/** "03/2018", "3.2018", "2018-03", "2018" -> "2018-03-01" (month defaults to January). */
export function parseFirstRegistration(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  let year: number | undefined;
  let month = 1;
  let match = trimmed.match(/^(\d{1,2})[./-](\d{4})$/);
  if (match) {
    month = Number(match[1]);
    year = Number(match[2]);
  } else if ((match = trimmed.match(/^(\d{4})-(\d{1,2})(?:-\d{1,2})?$/))) {
    year = Number(match[1]);
    month = Number(match[2]);
  } else if ((match = trimmed.match(/^(\d{4})$/))) {
    year = Number(match[1]);
  }
  if (!year || year < 1900 || year > 2100 || month < 1 || month > 12) return null;
  return `${year}-${String(month).padStart(2, "0")}-01`;
}

const FUEL_RULES: [RegExp, Fuel][] = [
  [/plug ?in|phev/, "plugin_hybrid"],
  [/hybrid|hev/, "hybrid"],
  // AutoScout24 writes hybrids as "Elektro/Benzin" or "Elektro/Diesel".
  [/elektro (benzin|diesel)|(benzin|diesel) elektro/, "hybrid"],
  [/elektr|electric|^ev$|bev/, "electric"],
  [/diesel|tdi|cdi|hdi|dci/, "diesel"],
  [/autogas|lpg/, "lpg"],
  [/erdgas|cng/, "cng"],
  [/wasserstoff|hydrogen/, "hydrogen"],
  [/benzin|petrol|gasoline|super|otto/, "petrol"],
];

export function normalizeFuel(value: string | null | undefined): Fuel | null {
  if (!value) return null;
  const text = normalizeText(value);
  for (const [pattern, fuel] of FUEL_RULES) {
    if (pattern.test(text)) return fuel;
  }
  return "other";
}

/**
 * Words in a free-text title that reliably name the fuel. Unlike normalizeFuel, which reads a
 * dedicated fuel field, this returns null when the title does not say.
 */
const TITLE_FUEL_RULES: [RegExp, Fuel][] = [
  [/\b(plug ?in|phev|gte|e hybrid|ehybrid)\b/, "plugin_hybrid"],
  [/\bhybrid\b/, "hybrid"],
  [/\b(elektro (benzin|diesel)|(benzin|diesel) elektro)\b/, "hybrid"],
  [/\b(elektro|electric|e tron|bev)\b/, "electric"],
  [/\b(diesel|tdi|cdi|crdi|hdi|bluehdi|dci|tdci|cdti|d4d|jtd|multijet|\d{3}d|\d{2}d)\b/, "diesel"],
  [/\b(autogas|lpg)\b/, "lpg"],
  [/\b(erdgas|cng|tgi)\b/, "cng"],
  [/\b(benzin|benziner|tsi|tfsi|fsi|mpi|ecoboost|\d{3}i)\b/, "petrol"],
];

export function detectFuel(text: string | null | undefined): Fuel | null {
  if (!text) return null;
  const normalized = normalizeText(text);
  for (const [pattern, fuel] of TITLE_FUEL_RULES) {
    if (pattern.test(normalized)) return fuel;
  }
  return null;
}

/** Like detectFuel, for the gearbox: only clear words count ("Auto" alone does not). */
export function detectTransmission(text: string | null | undefined): Transmission | null {
  if (!text) return null;
  const normalized = normalizeText(text);
  if (/\b(automatik|automatic|dsg|s tronic|tiptronic|steptronic|cvt|doppelkupplung)\b/.test(normalized)) return "automatic";
  if (/\b(schaltgetriebe|schalter|handschalter|manuell|6 gang|5 gang)\b/.test(normalized)) return "manual";
  return null;
}

export function normalizeTransmission(value: string | null | undefined): Transmission | null {
  if (!value) return null;
  const text = normalizeText(value);
  if (/automat|dsg|cvt|tiptronic|steptronic|s tronic|doppelkupplung|auto/.test(text)) return "automatic";
  if (/schalt|manuell|manual|handschalt/.test(text)) return "manual";
  return null;
}

const BODY_RULES: [RegExp, BodyType][] = [
  [/kleinwagen|small|hatchback/, "small"],
  [/kombi|estate|touring|avant|variant|sportswagon|wagon/, "estate"],
  [/suv|gelande|offroad|crossover/, "suv"],
  [/van|bus|mpv/, "van"],
  [/cabrio|roadster|convertible/, "convertible"],
  [/coupe|sportwagen/, "coupe"],
  [/limousine|sedan|saloon/, "sedan"],
];

export function normalizeBodyType(value: string | null | undefined): BodyType | null {
  if (!value) return null;
  const text = normalizeText(value);
  for (const [pattern, body] of BODY_RULES) {
    if (pattern.test(text)) return body;
  }
  return "other";
}

const TITLE_BODY_RULES: [RegExp, BodyType][] = [
  [/\b(kombi|estate|touring|avant|variant|sportswagon|sports tourer|tourer|wagon|t modell|sw)\b/, "estate"],
  [/\b(cabrio|cabriolet|roadster|convertible|spider|spyder)\b/, "convertible"],
  [/\b(coupe|coupé)\b/, "coupe"],
  [/\b(suv|gelandewagen|offroad|crossover)\b/, "suv"],
  [/\b(van|kleinbus|bus|bulli|mpv|minivan|camper|wohnmobil)\b/, "van"],
  [/\b(limousine|lim|sedan|saloon)\b/, "sedan"],
  [/\b(kleinwagen)\b/, "small"],
];

/** Body type named in a free-text title or model line, or null when it does not say. */
export function detectBodyType(text: string | null | undefined): BodyType | null {
  if (!text) return null;
  const normalized = normalizeText(text);
  for (const [pattern, body] of TITLE_BODY_RULES) {
    if (pattern.test(normalized)) return body;
  }
  return null;
}

export function resolveMake(raw: string): MakeDef | null {
  const text = normalizeText(raw);
  if (!text) return null;
  return (
    MAKES.find(
      (make) =>
        normalizeText(make.slug) === text ||
        normalizeText(make.name) === text ||
        (make.aliases ?? []).some((alias) => normalizeText(alias) === text),
    ) ?? null
  );
}

/**
 * Finds a make at the start of a free-text title: "Mercedes Benz V250 4Matic" -> Mercedes-Benz
 * with the rest "V250 4Matic". The longest matching name or alias wins.
 */
export function findMakeInTitle(title: string): { make: MakeDef; rest: string } | null {
  const rawWords = title.trim().split(/\s+/).filter(Boolean);
  const words = normalizeText(title).split(" ").filter(Boolean);
  let best: { make: MakeDef; length: number } | null = null;
  for (const make of MAKES) {
    for (const key of [make.slug, make.name, ...(make.aliases ?? [])].map(normalizeText)) {
      const keyWords = key.split(" ").filter(Boolean);
      const matches = keyWords.length > 0 && keyWords.every((word, i) => words[i] === word);
      if (matches && (!best || keyWords.length > best.length)) best = { make, length: keyWords.length };
    }
  }
  if (!best) return null;
  return { make: best.make, rest: restAfter(rawWords, best.length) };
}

export interface ResolvedMakeModel {
  makeSlug: string | null;
  modelSlug: string | null;
  /** The rest of the raw model string after the model name, e.g. "1.4 TSI Highline". */
  variant: string | null;
}

/**
 * Maps a source's make and model strings onto the canonical taxonomy.
 * "VW" + "Golf VII 1.4 TSI" -> volkswagen / golf, variant "VII 1.4 TSI".
 * The longest matching model name or alias wins.
 */
export function resolveMakeModel(makeRaw: string, modelRaw: string): ResolvedMakeModel {
  const make = resolveMake(makeRaw);
  if (!make) return { makeSlug: null, modelSlug: null, variant: modelRaw.trim() || null };

  const words = normalizeText(modelRaw).split(" ").filter(Boolean);
  const rawWords = modelRaw.trim().split(/\s+/).filter(Boolean);
  let best: { slug: string; length: number } | null = null;

  for (const model of make.models) {
    const keys = [model.slug, model.name, ...(model.aliases ?? [])].map(normalizeText);
    for (const key of keys) {
      const keyWords = key.split(" ").filter(Boolean);
      const matches = keyWords.length > 0 && keyWords.every((word, i) => words[i] === word);
      if (matches && (!best || keyWords.length > best.length)) best = { slug: model.slug, length: keyWords.length };
    }
    if (!best && model.firstWord && words[0] && model.firstWord.test(words[0])) {
      // Pattern hits (e.g. "320d") keep the matched word as part of the variant.
      best = { slug: model.slug, length: 0 };
    }
  }

  if (!best) return { makeSlug: make.slug, modelSlug: null, variant: modelRaw.trim() || null };

  // Drop as many original words as the matched key had (handles "T-Roc" vs "t roc").
  const variant = restAfter(rawWords, best.length);
  return { makeSlug: make.slug, modelSlug: best.slug, variant: variant || null };
}

/**
 * The raw text after the first `normalizedCount` normalized words. A raw word that holds more than
 * the match keeps its rest as written: "VW-Golf-1.4 TSI" after one word is "Golf-1.4 TSI".
 */
function restAfter(rawWords: string[], normalizedCount: number): string {
  let covered = 0;
  for (let index = 0; index < rawWords.length; index += 1) {
    if (covered >= normalizedCount) return rawWords.slice(index).join(" ");
    const parts = normalizeText(rawWords[index]).split(" ").filter(Boolean).length;
    if (covered + parts > normalizedCount) {
      const tail = afterWordRuns(rawWords[index], normalizedCount - covered);
      return [tail, ...rawWords.slice(index + 1)].filter(Boolean).join(" ");
    }
    covered += parts;
  }
  return "";
}

/**
 * The part of one raw word after its first `count` runs of letters or digits, as normalizeText
 * splits them, without the separator in between: ("Golf-1.4", 1) -> "1.4".
 */
function afterWordRuns(word: string, count: number): string {
  const chars = Array.from(word.normalize("NFC"));
  let runs = 0;
  let inRun = false;
  for (let index = 0; index < chars.length; index += 1) {
    const isWordChar = normalizeText(chars[index]) !== "";
    if (isWordChar && !inRun) {
      if (runs === count) return chars.slice(index).join("");
      runs += 1;
    }
    inRun = isWordChar;
  }
  return "";
}
