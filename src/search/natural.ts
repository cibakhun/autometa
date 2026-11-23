import { kwToPs, normalizeText } from "@/core/normalize";
import { MAKES, type MakeDef, type ModelDef } from "@/core/taxonomy";
import { BODY_TYPE_LABELS, BODY_TYPES, FUEL_LABELS, FUELS, type BodyType, type Fuel, type SellerType, type Transmission } from "@/core/types";
import { formatNumber } from "@/lib/format";
import { RADII_KM, type Condition, type HuFilter, type Sort } from "./filters";

/**
 * Search in your own words ("zuverlässiger Kombi für Familie bis 8.000 €"): turns a German
 * sentence into the search page's filters and sort. Rule-based, so it costs nothing per search
 * and always says what it understood: phrases it can turn into a filter, phrases it recognizes
 * but has no data for ("sparsam"), and words it does not know.
 *
 * The text is normalized character by character (lowercase, umlauts without dots), so every
 * position in the normalized text is the same position in what the visitor typed. Rules run in
 * a fixed order and blank out what they used, so a later rule never reads it again: make and
 * model first (so "Peugeot 2008" stays a model), then numbers with a unit or a qualifier, then
 * words, then a place name.
 */

export interface NaturalQuery {
  make?: string;
  model?: string;
  priceMin?: number;
  priceMax?: number;
  kmMax?: number;
  yearMin?: number;
  yearMax?: number;
  psMin?: number;
  fuel: Fuel[];
  body: BodyType[];
  transmission?: Transmission;
  seller?: SellerType;
  hu?: HuFilter;
  zustand?: Condition;
  schwierigkeit?: number;
  margeMin?: number;
  zip?: string;
  radius?: number;
  q?: string;
  source: string[];
  sort: Sort;
}

export interface NaturalSearch {
  query: NaturalQuery;
  /** What became a filter or the sort, in the order of the text. */
  understood: { text: string; label: string }[];
  /** Phrases that were recognized but cannot be a filter, with the reason. */
  ignored: { text: string; reason: string }[];
  /** Words that were not understood. */
  unknown: string[];
}

/** Finds a German town by name (case and umlauts as typed), e.g. from the postal code table. */
export type PlaceLookup = (name: string) => Promise<{ zip: string; city: string } | null>;

export const MAX_TEXT_LENGTH = 200;

// ---------------------------------------------------------------------------------------------
// Text handling

/** One character of the visitor's text in the form the rules read; always one character. */
function normalizeChar(char: string): string {
  if (char.length !== 1) return " ".repeat(char.length);
  const lower = char.toLowerCase();
  if (lower === "ß") return "s";
  if (lower === "€") return "€";
  if (lower === "–" || lower === "—") return "-";
  const base = lower.normalize("NFKD").replace(/[̀-ͯ]/g, "");
  if (base.length !== 1) return " ";
  return /[a-z0-9.,\-/+#<>]/.test(base) ? base : " ";
}

class Text {
  readonly norm: string;
  private readonly rest: string[];

  constructor(readonly original: string) {
    this.norm = Array.from(original, normalizeChar).join("");
    this.rest = this.norm.split("");
  }

  get remaining(): string {
    return this.rest.join("");
  }

  consume(start: number, end: number) {
    for (let i = start; i < end; i += 1) this.rest[i] = " ";
  }

  /** The visitor's own words at these positions. */
  slice(start: number, end: number): string {
    return this.original.slice(start, end).trim().replace(/\s+/g, " ");
  }

  /** Every match in the text not used yet; a match is used up when fn returns true. */
  scan(pattern: string, fn: (match: RegExpExecArray) => boolean) {
    const re = new RegExp(pattern, "g");
    for (const match of [...this.remaining.matchAll(re)]) {
      if (fn(match)) this.consume(match.index, match.index + match[0].length);
    }
  }

  /** Words not used yet, with their positions. */
  tokens(): Token[] {
    return [...this.remaining.matchAll(/[a-z0-9]+/g)].map((m) => ({ word: m[0], start: m.index, end: m.index + m[0].length }));
  }
}

interface Token {
  word: string;
  start: number;
  end: number;
}

/** A phrase as a pattern: "ä" also as "ae", "ß" also as "ss", spaces also as hyphens or nothing. */
function term(phrase: string): string {
  return phrase
    .toLowerCase()
    .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
    .replace(/ä/g, "ae?")
    .replace(/ö/g, "oe?")
    .replace(/ü/g, "ue?")
    .replace(/ß/g, "s{1,2}")
    .replace(/[ -]/g, "[\\s-]*");
}

const alt = (...phrases: string[]) => `(?:${[...phrases].sort((a, b) => b.length - a.length).map(term).join("|")})`;
const B0 = "(?<![a-z0-9])";
const B1 = "(?![a-z0-9])";
const words = (...phrases: string[]) => `${B0}${alt(...phrases)}${B1}`;

/** A number as people write it: "8000", "8.000", "8,5", "8k", "8 tsd", "8 tausend". */
const NUM = "\\d[\\d.,]*(?:\\s*(?:k|tsd|tausend)(?![a-z0-9])\\.?)?";
const EUR = "(?:€|eur(?:o|os)?(?![a-z0-9])|teuro(?![a-z0-9]))";
const MAXQ = alt("bis", "bis zu", "bis max", "bis maximal", "unter", "unterhalb von", "max", "maximal", "höchstens", "nicht mehr als", "nicht über",
  "weniger als", "kleiner als", "budget", "budget von", "budget bis", "budget max", "preis bis", "preislich bis", "für max", "für maximal", "für bis zu");
const MINQ = alt("ab", "über", "mehr als", "mindestens", "mind", "min", "größer als", "wenigstens");
const APPROXQ = alt("ca", "circa", "zirka", "etwa", "ungefähr", "rund", "um die", "so um die", "in etwa", "so etwa", "budget ca", "budget etwa", "budget um die");
const YEAR = "(?:19[5-9]\\d|20[0-4]\\d)";
const YEARWORD = alt("baujahr", "bj", "ez", "erstzulassung", "jahrgang", "modelljahr", "zulassung", "zugelassen");
const NOT_A_PRICE = `(?!\\s*(?:km|kilometer|tkm|ps|kw|jahre?|monate?|sitzer|türer|türig|gang|zoll|liter|ccm|cm|m)${B1})`;

/** Parses "8.000", "8,5", "8k", "150 tsd" (dots as thousands, a comma or dot with 1-2 digits as decimals). */
export function parseAmount(raw: string): number | null {
  let text = raw.trim();
  let factor = 1;
  const suffix = /\s*(k|tsd\.?|tausend)$/.exec(text);
  if (suffix) {
    factor = 1000;
    text = text.slice(0, suffix.index);
  }
  text = text.replace(/[.,]+$/, "");
  if (/^\d{1,3}(\.\d{3})+$/.test(text)) text = text.replace(/\./g, "");
  else if (/^\d{1,3}(,\d{3})+$/.test(text)) text = text.replace(/,/g, "");
  else if (/^\d+[.,]\d{1,2}$/.test(text)) text = text.replace(",", ".");
  else if (!/^\d+$/.test(text)) return null;
  const value = Number(text) * factor;
  return Number.isFinite(value) ? value : null;
}

const hasFactor = (raw: string) => /(k|tsd\.?|tausend)$/.test(raw.trim());
const roundTo = (value: number, step: number) => Math.round(value / step) * step;
const euro = (value: number) => `${formatNumber(value)} €`;

// ---------------------------------------------------------------------------------------------
// Vocabulary

const FUEL_WORDS: [Fuel, string[]][] = [
  ["plugin_hybrid", ["plug in hybrid", "plugin hybrid", "plug in", "plugin", "phev", "steckdosenhybrid"]],
  ["hybrid", ["hybrid", "vollhybrid", "hybridauto", "mildhybrid", "mild hybrid"]],
  ["electric", ["elektro", "elektroauto", "elektrisch", "vollelektrisch", "e auto", "eauto", "stromer", "bev", "elektrofahrzeug", "e fahrzeug", "elektrowagen"]],
  ["diesel", ["diesel", "dieselfahrzeug", "selbstzünder", "tdi", "cdi", "crdi", "hdi", "bluehdi", "dci", "tdci", "cdti", "d4d", "jtd", "multijet", "tdi motor"]],
  ["petrol", ["benzin", "benziner", "ottomotor", "tsi", "tfsi", "fsi", "ecoboost", "super"]],
  ["lpg", ["lpg", "autogas", "gasanlage", "flüssiggas"]],
  ["cng", ["cng", "erdgas"]],
  ["hydrogen", ["wasserstoff", "brennstoffzelle"]],
];

const BODY_WORDS: [BodyType, string[]][] = [
  ["estate", ["kombi", "kombis", "kombiwagen", "combi", "turnier", "sw", "variant", "avant", "touring", "tourer", "sports tourer", "sportstourer", "sportswagon", "estate", "t modell", "kombilimousine"]],
  ["small", ["kleinwagen", "kleinstwagen", "kleines auto", "kleiner wagen", "kleinen wagen", "stadtauto", "stadtflitzer", "cityflitzer", "flitzer"]],
  ["sedan", ["limousine", "limo", "stufenheck"]],
  ["suv", ["suv", "suvs", "geländewagen", "offroader", "gelände", "crossover", "jeep artig"]],
  ["van", ["van", "vans", "minivan", "kleinbus", "bus", "familienvan", "großraumlimousine", "großraumvan", "transporter", "camper", "wohnmobil", "kastenwagen"]],
  ["coupe", ["coupe", "coupé", "sportwagen", "sportcoupe"]],
  ["convertible", ["cabrio", "cabriolet", "cabrios", "roadster", "spider", "spyder"]],
];

const SOURCE_WORDS: [string, string, string[]][] = [
  ["autoscout24", "AutoScout24", ["autoscout24", "autoscout", "as24"]],
  ["kleinanzeigen", "Kleinanzeigen", ["kleinanzeigen", "ebay kleinanzeigen", "ebay"]],
  ["quoka", "Quoka", ["quoka"]],
  ["autohero", "Autohero", ["autohero"]],
  ["autode", "auto.de", ["auto de", "autode"]],
];

/** Equipment and trim words that usually stand in the title as written here. */
const TITLE_WORDS: [string, string[]][] = [
  ["GTI", ["gti"]],
  ["GTD", ["gtd"]],
  ["AMG", ["amg"]],
  ["quattro", ["quattro"]],
  ["4MOTION", ["4motion", "4 motion"]],
  ["xDrive", ["xdrive", "x drive"]],
  ["4MATIC", ["4matic", "4 matic"]],
  ["4x4", ["4x4"]],
  ["S line", ["s line", "sline"]],
  ["R-Line", ["r line", "rline"]],
  ["ST-Line", ["st line"]],
  ["GT Line", ["gt line"]],
  ["M Sport", ["m sport", "m sportpaket"]],
  ["Standheizung", ["standheizung"]],
  ["AHK", ["ahk"]],
  ["Anhängerkupplung", ["anhängerkupplung"]],
  ["Navi", ["navi", "navigation", "navigationssystem"]],
  ["Leder", ["leder", "lederausstattung", "ledersitze"]],
  ["Pano", ["panorama", "panoramadach", "pano"]],
  ["Xenon", ["xenon"]],
  ["Sitzheizung", ["sitzheizung"]],
  ["Tempomat", ["tempomat"]],
  ["Klima", ["klima", "klimaanlage", "klimaautomatik"]],
  ["Schiebedach", ["schiebedach"]],
  ["Allrad", ["allrad", "allradantrieb"]],
];

/** Common words in a search sentence that carry no filter. */
const STOPWORDS = new Set(
  `ich wir suche suchen such gesucht brauche brauchen benotige benoetige benotigen hatte haette gern gerne mochte moechte mochten will wollen
   wurde wuerde mir mich mein meine meinen meiner meinem uns unser unsere ein eine einen einem einer eines der die das den dem des und oder
   aber mit fur fuer von vom zum zur zu am an auf im in bei um aus nach als sehr moglichst moeglichst wenn gut gute guter gutes guten
   schon schoen schone schoene schones schoenes schonen schoenen bitte auto autos wagen fahrzeug fahrzeuge pkw gebrauchtwagen gebraucht
   gebrauchten gebrauchter gebrauchtes karre kiste etwas was so noch nur auch mal irgendein irgendeinen egal beliebig ist sein soll sollte
   sollen darf kann konnen koennen haben hat hab habe es er sie man alle jeder viel viele mehr sowie inkl inklusive plus preis liebsten
   idealerweise eher lieber ganz wirklich besonders vielleicht ohne nicht kein keine keinen keiner dass da hier gibt finden find zeig zeige
   zeigt angebot angebote anzeige anzeigen inserat inserate modell marke typ art sorte neues neuen neue ja dann weil fahren fahre fahrt
   unbedingt muss mussen muessen am bis ab unter uber ueber max maximal mindestens mind min ca circa etwa rund ungefahr ungefaehr`.split(/\s+/),
);

/** Model names that are also common words; they count as a model only together with the make. */
const COMMON_WORD_MODELS = new Set([
  "karl", "adam", "zoe", "partner", "master", "expert", "note", "spring", "idea", "bravo", "uno", "blazer", "insight", "across", "boxer",
  "alto", "leaf", "soul", "eclipse", "patriot", "commander", "avenger", "compass", "defender", "discovery", "jumper", "one", "kalos",
  "life", "family", "city", "space", "sport", "line", "cross", "plus", "auto", "bus", "cabrio", "coupe", "roadster", "transporter",
  "ami", "ka", "up", "fox", "eos", "e", "model", "life", "spring", "kombi", "combi", "variant", "touring", "tourer",
]);

// ---------------------------------------------------------------------------------------------
// Parsing

interface Draft {
  query: NaturalQuery;
  fuelOut: Set<Fuel>;
  bodyOut: Set<BodyType>;
  fuel: Set<Fuel>;
  body: Set<BodyType>;
  q: string[];
  sort?: Sort;
  reliable: boolean;
  deal: boolean;
  flip: boolean;
  family: boolean;
  understood: { at: number; text: string; label: string }[];
  ignored: { at: number; text: string; reason: string }[];
}

export async function parseNaturalSearch(input: string, findPlace: PlaceLookup | null = null, now = new Date()): Promise<NaturalSearch> {
  const text = new Text(input.slice(0, MAX_TEXT_LENGTH));
  const year = now.getUTCFullYear();
  const draft: Draft = {
    query: { fuel: [], body: [], source: [], sort: "empfehlung" },
    fuelOut: new Set(),
    bodyOut: new Set(),
    fuel: new Set(),
    body: new Set(),
    q: [],
    reliable: false,
    deal: false,
    flip: false,
    family: false,
    understood: [],
    ignored: [],
  };
  const understood = (m: RegExpExecArray | { index: number; 0: string }, label: string) => {
    draft.understood.push({ at: m.index, text: text.slice(m.index, m.index + m[0].length), label });
    return true;
  };
  const ignored = (m: RegExpExecArray | { index: number; 0: string }, reason: string) => {
    draft.ignored.push({ at: m.index, text: text.slice(m.index, m.index + m[0].length), reason });
    return true;
  };
  const q = draft.query;

  findMakeAndModel(text, draft);

  // --- Numbers and phrases that would otherwise look like prices or years.

  // HU/TÜV
  const HU = alt("tüv", "hu", "tüv hu", "hu au", "tüv au", "hauptuntersuchung");
  text.scan(`${B0}(?:${alt("neuer", "neuen", "neuem", "neu", "frischer", "frischen", "frischem", "frisch")}\\s+${HU}|${HU}\\s+${alt("neu", "frisch", "neu gemacht", "frisch gemacht", "gerade neu")})${B1}`, (m) => {
    q.hu = "neu";
    return understood(m, "TÜV/HU neu (nur Angebote mit HU im Titel)");
  });
  text.scan(`${B0}${alt("ohne", "kein", "keinen")}\\s+${HU}${B1}|${B0}${HU}\\s+${alt("abgelaufen", "fällig", "überfällig", "vorbei")}${B1}`, (m) =>
    ignored(m, "Für „ohne TÜV“ gibt es keinen Filter."),
  );
  text.scan(`${B0}${HU}\\s*(?:${alt("bis", "gültig bis", "bis mind", "bis mindestens")}\\.?\\s*)?(?:(\\d{1,2})\\s*[./]\\s*)?(20[2-4]\\d)(?![\\d])`, (m) => {
    const month = m[1] ? Math.min(12, Math.max(1, Number(m[1]))) : 1;
    const months = (Number(m[2]) - year) * 12 + (month - (now.getUTCMonth() + 1));
    const hu = huFromMonths(months);
    if (!hu) return ignored(m, "Dieses HU-Datum ist schon vorbei.");
    q.hu = hu;
    return understood(m, huLabel(hu));
  });
  text.scan(
    `${B0}(?:${HU}\\s+(?:noch\\s+)?(?:${alt("mind", "mindestens", "min")}\\.?\\s+)?(\\d{1,2})\\s*(${alt("monate", "monat", "jahre", "jahr")})|(?:noch\\s+)?(?:${alt("mind", "mindestens", "min")}\\.?\\s+)?(\\d{1,2})\\s*(${alt("monate", "monat", "jahre", "jahr")})\\s+(?:noch\\s+)?${HU})${B1}`,
    (m) => {
      const amount = Number(m[1] ?? m[3]);
      const unit = m[2] ?? m[4];
      const hu = huFromMonths(unit.startsWith("j") ? amount * 12 : amount);
      if (!hu) return false;
      q.hu = hu;
      return understood(m, huLabel(hu));
    },
  );
  text.scan(`${B0}(?:${alt("mit", "inkl", "inklusive", "und", "plus", "gültigem", "gültiger", "gültigen", "frischem")}\\.?\\s+)?${HU}${B1}`, (m) => {
    if (q.hu) return true;
    q.hu = "6";
    return understood(m, huLabel("6"));
  });

  // Flip margin: "Marge ab 1.000 €", "mind. 1000 € Gewinn"
  const MARGIN = alt("marge", "gewinn", "verdienst", "profit", "gewinnmarge", "überschuss");
  text.scan(
    `${B0}(?:${MARGIN}\\s+(?:von\\s+)?(?:(?:${MINQ})\\.?\\s+)?(${NUM})\\s*${EUR}?|(?:(?:${MINQ})\\.?\\s+)?(${NUM})\\s*${EUR}?\\s+${MARGIN})${B1}`,
    (m) => {
      const value = parseAmount(m[1] ?? m[2]);
      if (value === null) return false;
      q.margeMin = roundTo(value, 10);
      draft.flip = true;
      return understood(m, `Flip-Marge ab ${euro(q.margeMin)}`);
    },
  );

  // Seats and doors
  text.scan(`${B0}(?:([5-9])[\\s-]*sitzer|${alt("fünfsitzer")}|(${alt("siebensitzer", "achtsitzer", "neunsitzer", "sieben sitzer", "acht sitzer", "neun sitzer")})|([6-9])[\\s-]*${alt("sitze", "sitzen", "sitzplätze", "sitzplätzen", "plätze", "plätzen")})${B1}`, (m) => {
    const seats = Number(m[1] ?? m[3] ?? (m[2] ? 7 : 5));
    if (seats < 6) return ignored(m, "Die Sitzzahl steht in keinem Angebot.");
    draft.body.add("van");
    return understood(m, `${seats}-Sitzer → ${BODY_TYPE_LABELS.van} (die Sitzzahl selbst ist kein Filter)`);
  });
  text.scan(`${B0}(?:[2-5][\\s-]*${alt("türer", "türig", "türen", "tür")}|${alt("dreitürer", "fünftürer", "viertürer", "zweitürer")})${B1}`, (m) =>
    ignored(m, "Die Türenzahl steht in keinem Angebot."),
  );

  // Radius: "im Umkreis von 30 km", "50 km um München", "max. 100 km entfernt"
  text.scan(
    `${B0}(?:(?:im\\s+)?${alt("umkreis", "radius", "entfernung", "umgebung")}\\s+(?:von\\s+)?(?:(?:${MAXQ})\\.?\\s+)?(${NUM})\\s*km|(?:(?:${MAXQ})\\.?\\s+)?(${NUM})\\s*km\\s+${alt("umkreis", "radius", "entfernt", "entfernung", "weg", "fahrt", "anfahrt", "fahrtweg")}|(${NUM})\\s*km(?=\\s+${alt("um", "rund um", "von", "bei", "ab")}\\s))${B1}`,
    (m) => {
      const value = parseAmount(m[1] ?? m[2] ?? m[3]);
      if (value === null || value <= 0) return false;
      q.radius = snapRadius(value);
      return understood(m, `Umkreis ${q.radius} km`);
    },
  );

  // Mileage
  const KM = alt("km", "kilometer", "kilometern", "tkm", "kilometerstand");
  text.scan(`${B0}(?:(${MAXQ}|${MINQ})\\.?\\s+)?(${NUM})\\s*(${KM})${B1}`, (m) => {
    let value = parseAmount(m[2]);
    if (value === null) return false;
    if (m[3] === "tkm" && value < 2000) value *= 1000;
    if (m[1] && new RegExp(`^${MINQ}$`).test(m[1])) return ignored(m, "Eine Mindest-Laufleistung ist kein Filter.");
    q.kmMax = roundTo(value, 1000) || roundTo(value, 1);
    return understood(m, `bis ${formatNumber(q.kmMax)} km`);
  });
  text.scan(`${B0}${alt("laufleistung", "kilometerstand", "km stand", "tacho", "tachostand")}\\s+(?:(${MAXQ})\\.?\\s+)?(${NUM})${B1}`, (m) => {
    const value = parseAmount(m[2]);
    if (value === null) return false;
    q.kmMax = value < 1000 ? value * 1000 : roundTo(value, 1000);
    return understood(m, `bis ${formatNumber(q.kmMax)} km`);
  });
  text.scan(words("wenig km", "wenig kilometer", "wenig gelaufen", "kaum gelaufen", "wenig gefahren", "kaum gefahren", "geringe laufleistung",
    "niedrige laufleistung", "wenig laufleistung", "niedriger kilometerstand", "geringer kilometerstand", "wenige kilometer"), (m) => {
    if (q.kmMax === undefined) q.kmMax = 100_000;
    return understood(m, `wenig gelaufen → bis ${formatNumber(q.kmMax)} km`);
  });

  // Power
  text.scan(`${B0}(?:(${MAXQ}|${MINQ})\\.?\\s+)?(${NUM})\\s*(ps|kw|pferdestärken)${B1}`, (m) => {
    const value = parseAmount(m[2]);
    if (value === null || value <= 0) return false;
    if (m[1] && !new RegExp(`^${MINQ}$`).test(m[1])) return ignored(m, "Eine Höchstleistung ist kein Filter.");
    q.psMin = Math.round(m[3] === "kw" ? kwToPs(value) : value);
    return understood(m, `ab ${q.psMin} PS`);
  });

  // Age: "nicht älter als 10 Jahre", "max. 8 Jahre alt", "Oldtimer"
  const YEARS = alt("jahre", "jahr", "jahren", "j");
  text.scan(`${B0}(?:${alt("nicht älter als", "jünger als", "höchstens", "max", "maximal", "bis", "unter", "weniger als", "bis zu")}\\.?\\s+(\\d{1,2})\\s*${YEARS}(?:\\s+alt)?|(\\d{1,2})\\s*${YEARS}\\s+alt|${alt("nicht älter als", "jünger als")}\\s+(\\d{1,2}))${B1}`, (m) => {
    const age = Number(m[1] ?? m[2] ?? m[3]);
    q.yearMin = year - age;
    return understood(m, `höchstens ${age} Jahre alt → Erstzulassung ab ${q.yearMin}`);
  });
  text.scan(`${B0}(?:${alt("älter als", "mindestens", "mind", "über")}\\.?\\s+(\\d{1,2})\\s*${YEARS}(?:\\s+alt)?)${B1}`, (m) => {
    const age = Number(m[1]);
    q.yearMax = year - age;
    return understood(m, `älter als ${age} Jahre → Erstzulassung bis ${q.yearMax}`);
  });
  text.scan(words("oldtimer", "h kennzeichen", "historisch"), (m) => {
    q.yearMax = year - 30;
    return understood(m, `Oldtimer → Erstzulassung bis ${q.yearMax}`);
  });
  text.scan(words("youngtimer"), (m) => {
    q.yearMin = year - 30;
    q.yearMax = year - 20;
    return understood(m, `Youngtimer → Erstzulassung ${q.yearMin}–${q.yearMax}`);
  });
  text.scan(words("jahreswagen", "jungwagen", "neuwertig", "fast neu", "wie neu"), (m) => {
    q.yearMin = year - 2;
    return understood(m, `fast neu → Erstzulassung ab ${q.yearMin}`);
  });

  // Year ranges: "Baujahr 2012-2016", "zwischen 2012 und 2016"
  const NOT_PRICE_UNIT = `(?!\\s*(?:${EUR}|k${B1}|tsd|tausend|km|kilometer|tkm|ps|kw))`;
  text.scan(
    `${B0}(?:${YEARWORD}\\.?\\s*)?(?:${alt("zwischen", "von")}\\s+)?(${YEAR})\\s*(?:-|bis|und)\\s*(${YEAR})(?![\\d.,]\\d)${B1}${NOT_PRICE_UNIT}`,
    (m) => {
      const [from, to] = [Number(m[1]), Number(m[2])].sort((a, b) => a - b);
      q.yearMin = from;
      q.yearMax = to;
      return understood(m, `Erstzulassung ${from}–${to}`);
    },
  );
  // Single years: "ab 2015", "Baujahr bis 2012", "BJ 2015", "2015"
  const YEAR_MIN = alt("ab", "nach", "seit", "neuer als", "jünger als", "frühestens", "von", "mindestens", "mind", "min");
  const YEAR_MAX = alt("bis", "vor", "älter als", "spätestens", "max", "maximal", "höchstens");
  text.scan(
    `${B0}(?:(${YEAR_MIN}|${YEAR_MAX}|${APPROXQ}|um)\\.?\\s+)?(?:(${YEARWORD})\\.?\\s*)?(?:(${YEAR_MIN}|${YEAR_MAX})\\.?\\s+)?(${YEAR})(?![\\d])(?![.,]\\d)${NOT_PRICE_UNIT}`,
    (m) => {
      const value = Number(m[4]);
      const qualifier = m[3] ?? m[1];
      const yearWord = m[2] !== undefined;
      if (qualifier && new RegExp(`^(?:${APPROXQ}|um)$`).test(qualifier)) return false;
      if (!yearWord && !qualifier && (value < 1980 || value > year + 1)) return false;
      if (!qualifier) {
        q.yearMin = value;
        q.yearMax = value;
        return understood(m, `Erstzulassung ${value}`);
      }
      if (new RegExp(`^${YEAR_MIN}$`).test(qualifier)) {
        q.yearMin = /^(nach|neuer|junger|juenger)/.test(qualifier) ? value + 1 : value;
        return understood(m, `Erstzulassung ab ${q.yearMin}`);
      }
      // "bis 2000" without "Baujahr" is a price, "bis 2015" a year; "vor" and "älter als" always mean a year.
      if (!yearWord && /^(bis|max|maximal|hochstens|hoechstens)/.test(qualifier) && value % 50 === 0) return false;
      q.yearMax = /^(vor|alter|aelter)/.test(qualifier) ? value - 1 : value;
      return understood(m, `Erstzulassung bis ${q.yearMax}`);
    },
  );

  // Postal code: "PLZ 80331", "in 80331", "um 10115"
  text.scan(`${B0}(?:(${alt("plz", "postleitzahl", "in", "bei", "um", "nahe", "nähe", "raum", "umgebung", "aus", "rund um", "nähe von", "im raum")})\\s+)?(\\d{5})(?![\\d.,]\\d)${B1}(?!\\s*(?:${EUR}|km|kilometer|ps|kw|k${B1}|tsd))`, (m) => {
    const before = text.norm.slice(0, m.index).trimEnd();
    if (!m[1] && new RegExp(`(?:${MAXQ}|${MINQ}|${APPROXQ})\\.?$`).test(before)) return false;
    q.zip = m[2];
    q.radius ??= 50;
    return understood(m, `PLZ ${m[2]}`);
  });

  // Prices
  text.scan(
    `${B0}(?:(${alt("zwischen", "von")})\\s+)?(${NUM})\\s*(${EUR})?\\s*(?:-|bis|und)\\s*(${NUM})\\s*(${EUR})?${NOT_A_PRICE}`,
    (m) => {
      const [a, b] = [parseAmount(m[2]), parseAmount(m[4])];
      if (a === null || b === null) return false;
      const unit = m[3] !== undefined || m[5] !== undefined || hasFactor(m[2]) || hasFactor(m[4]);
      if (!unit && !(m[1] && a >= 500 && b >= 500)) return false;
      const lo = hasFactor(m[4]) && !hasFactor(m[2]) && a < 1000 ? a * 1000 : a;
      [q.priceMin, q.priceMax] = [Math.round(Math.min(lo, b)), Math.round(Math.max(lo, b))];
      return understood(m, `${euro(q.priceMin)} bis ${euro(q.priceMax)}`);
    },
  );
  text.scan(`${B0}(?:${APPROXQ}|um)\\.?\\s+(${NUM})\\s*(${EUR})?${NOT_A_PRICE}`, (m) => {
    const value = parseAmount(m[1]);
    if (value === null) return false;
    if (!m[2] && !hasFactor(m[1]) && (value < 500 || (value >= 1950 && value <= year + 1))) return false;
    q.priceMin = roundTo(value * 0.85, 100);
    q.priceMax = roundTo(value * 1.15, 100);
    return understood(m, `um ${euro(Math.round(value))} → ${euro(q.priceMin)} bis ${euro(q.priceMax)}`);
  });
  text.scan(`${B0}(${MAXQ}|${MINQ})\\.?\\s+(?:zu\\s+)?(${NUM})\\s*(${EUR})?${NOT_A_PRICE}`, (m) => {
    const value = parseAmount(m[2]);
    if (value === null) return false;
    if (!m[3] && !hasFactor(m[2]) && value < 100) return false;
    if (new RegExp(`^${MINQ}$`).test(m[1])) {
      q.priceMin = Math.round(value);
      return understood(m, `Preis ab ${euro(q.priceMin)}`);
    }
    q.priceMax = Math.round(value);
    return understood(m, `Preis bis ${euro(q.priceMax)}`);
  });
  text.scan(`${B0}(?:(${NUM})\\s*${EUR}|(\\d[\\d.,]*\\s*(?:k|tsd|tausend))\\.?${B1}${NOT_A_PRICE})`, (m) => {
    const value = parseAmount(m[1] ?? m[2]);
    if (value === null) return false;
    q.priceMax = Math.round(value);
    return understood(m, `Preis bis ${euro(q.priceMax)}`);
  });
  text.scan(words("zu verschenken", "verschenken", "geschenkt", "umsonst", "gratis", "kostenlos", "für lau", "für umsonst"), (m) => {
    q.priceMin = undefined;
    q.priceMax = 0;
    return understood(m, "zu verschenken (Preis 0 €)");
  });
  text.scan(`${B0}\\d[.,]\\d\\s*(?:${alt("l", "liter", "ltr")}${B1})?(?!\\s*(?:k|tsd|tausend|${EUR}))`, (m) => ignored(m, "Der Hubraum ist kein Filter."));

  // --- Words

  // Negations first, so "kein Diesel" is not read as "Diesel".
  const NOT = alt("kein", "keine", "keinen", "ohne", "nicht", "bloß kein", "bitte kein", "bitte keinen", "bitte keine", "lieber kein", "lieber keinen", "nicht als");
  for (const [fuel, phrases] of FUEL_WORDS) {
    text.scan(`${B0}${NOT}\\s+${alt(...phrases)}${B1}`, (m) => {
      draft.fuelOut.add(fuel);
      return understood(m, `kein ${FUEL_LABELS[fuel]}`);
    });
  }
  for (const [body, phrases] of BODY_WORDS) {
    text.scan(`${B0}${NOT}\\s+${alt(...phrases)}${B1}`, (m) => {
      draft.bodyOut.add(body);
      return understood(m, `kein ${BODY_TYPE_LABELS[body]}`);
    });
  }
  text.scan(`${B0}${NOT}\\s+${alt("automatik", "automatikgetriebe", "automatic", "dsg")}${B1}`, (m) => {
    q.transmission = "manual";
    return understood(m, "Schaltgetriebe");
  });
  text.scan(`${B0}${NOT}\\s+${alt("schalter", "schaltgetriebe", "schaltung", "handschaltung", "handschalter", "kupplung", "manuell")}${B1}`, (m) => {
    q.transmission = "automatic";
    return understood(m, "Automatik");
  });
  text.scan(`${B0}(?:${NOT}|nicht vom|nicht von)\\s+${alt("händler", "händlern", "autohaus", "gewerblich", "gewerblichen")}${B1}`, (m) => {
    q.seller = "private";
    return understood(m, "von Privat");
  });
  text.scan(`${B0}(?:${NOT}|nicht von)\\s+${alt("privat", "privaten", "privatanbieter", "privatverkauf", "privatleuten")}${B1}`, (m) => {
    q.seller = "dealer";
    return understood(m, "vom Händler");
  });
  text.scan(
    `${B0}(?:${NOT}\\s+${alt("unfall", "unfallschaden", "schaden", "schäden", "mängel", "mangel", "defekt", "defekte", "bastler", "bastlerauto", "motorschaden", "rost")}|${alt(
      "unfallfrei", "schadenfrei", "schadensfrei", "mängelfrei", "mangelfrei", "rostfrei", "intakt", "top zustand", "topzustand", "guter zustand",
      "gutem zustand", "sehr guter zustand", "sehr gutem zustand", "einwandfrei", "fahrbereit", "voll fahrbereit", "fahrbereiter", "fahrbereites",
      "gepflegt", "gepflegter", "gepflegtes", "gepflegten", "unfallfreier", "unfallfreies", "unfallfreien", "ohne probleme",
    )})${B1}`,
    (m) => {
      if (/^nicht\s*fahrbereit/.test(m[0])) return false;
      q.zustand = "intakt";
      return understood(m, "ohne Schadenshinweis im Titel");
    },
  );

  // Flip and damage
  text.scan(words("zum flippen", "flippen", "flip", "flipper", "zum weiterverkaufen", "weiterverkaufen", "weiterverkauf", "mit gewinn",
    "gewinn machen", "reparieren und verkaufen", "herrichten und verkaufen", "zum herrichten", "zum aufbereiten", "aufbereiten", "schrauberauto",
    "schrauber", "für schrauber", "schrauberprojekt", "projektauto", "bastlerauto", "bastlerfahrzeug", "bastler", "für bastler", "an bastler", "zum basteln"), (m) => {
    draft.flip = true;
    return understood(m, "zum Flippen → mit Schadenshinweis, sortiert nach Flip-Stundenlohn");
  });
  text.scan(words("defekt", "defekte", "defekter", "defektes", "defekten", "kaputt", "kaputte", "kaputtes", "kaputten", "motorschaden", "getriebeschaden",
    "unfallwagen", "unfallauto", "unfallfahrzeug", "unfall", "unfallschaden", "mit unfall", "reparaturbedürftig", "springt nicht an",
    "nicht fahrbereit", "export", "ausschlachten", "zum ausschlachten", "teileträger", "mit mängeln", "mängel", "wasserschaden", "hagelschaden"), (m) => {
    q.zustand = "defekt";
    return understood(m, "mit Schadenshinweis (defekt, Bastler)");
  });
  text.scan(words("einfach zu reparieren", "leicht zu reparieren", "leichte reparatur", "einfache reparatur", "kleine reparatur", "kleiner schaden",
    "kleine schäden", "wenig arbeit", "anfängerfreundlich", "für anfänger", "für hobbyschrauber", "ohne großen aufwand", "ohne viel aufwand"), (m) => {
    q.schwierigkeit = 2;
    draft.flip = true;
    return understood(m, "leichte Reparatur → Schwierigkeit bis 2 von 5");
  });

  // Fuel, body, transmission, seller, sources
  for (const [fuel, phrases] of FUEL_WORDS) {
    text.scan(words(...phrases), (m) => {
      draft.fuel.add(fuel);
      return understood(m, FUEL_LABELS[fuel]);
    });
  }
  text.scan(words("familie", "familien", "familienauto", "familienwagen", "familienkutsche", "familienfreundlich", "kinder", "kind", "kindern",
    "kinderwagen", "hund", "hunde", "hunden", "viel platz", "platz", "geräumig", "großer kofferraum", "großen kofferraum", "viel stauraum", "urlaub"), (m) => {
    draft.family = true;
    return understood(m, FAMILY);
  });
  text.scan(words("stadt", "für die stadt", "innenstadt", "city", "parkplatzsuche", "einparken"), (m) => {
    draft.body.add("small");
    return understood(m, "Stadt → Kleinwagen");
  });
  for (const [body, phrases] of BODY_WORDS) {
    text.scan(words(...phrases), (m) => {
      draft.body.add(body);
      return understood(m, BODY_TYPE_LABELS[body]);
    });
  }
  text.scan(words("automatik", "automatikgetriebe", "automatic", "automat", "dsg", "s tronic", "stronic", "tiptronic", "steptronic", "doppelkupplung",
    "wandler", "wandlerautomatik", "cvt"), (m) => {
    q.transmission = "automatic";
    return understood(m, "Automatik");
  });
  text.scan(words("schaltgetriebe", "schalter", "handschalter", "handschaltung", "manuell", "manuelles getriebe", "gangschaltung", "schaltwagen"), (m) => {
    q.transmission = "manual";
    return understood(m, "Schaltgetriebe");
  });
  text.scan(words("von privat", "privat", "privatverkauf", "privatanbieter", "privatperson", "privatverkäufer", "privatleuten"), (m) => {
    q.seller = "private";
    return understood(m, "von Privat");
  });
  text.scan(words("vom händler", "händler", "autohaus", "gewerblich", "mit garantie", "garantie", "händlergarantie"), (m) => {
    q.seller = "dealer";
    return understood(m, "vom Händler");
  });
  for (const [id, name, phrases] of SOURCE_WORDS) {
    text.scan(`${B0}(?:${alt("nur", "von", "auf", "bei", "aus", "nur von", "nur auf", "nur bei")}\\s+)?${alt(...phrases)}${B1}`, (m) => {
      if (!draft.query.source.includes(id)) draft.query.source.push(id);
      return understood(m, `nur ${name}`);
    });
  }

  // What the ranking should favour
  text.scan(words("zuverlässig", "zuverlässige", "zuverlässiger", "zuverlässiges", "zuverlässigen", "zuverlässigkeit", "robust", "robuste", "robuster",
    "robustes", "robusten", "langlebig", "langlebige", "langlebiger", "langlebiges", "langlebigen", "problemlos", "problemlose", "problemloser",
    "problemloses", "solide", "solider", "solides", "soliden", "unkaputtbar", "haltbar", "sorgenfrei", "wenig mängel", "wenige mängel",
    "wenig reparaturen", "wenig probleme", "keine probleme", "wenig werkstatt", "selten kaputt", "qualität", "hohe qualität", "verlässlich",
    "verlässliche", "verlässlicher", "verlässliches", "verlässlichen"), (m) => {
    draft.reliable = true;
    return understood(m, "zuverlässig → wenig HU-Mängel zuerst (Modell-Akte), ohne Schadenshinweis");
  });
  text.scan(words("günstig", "günstige", "günstiger", "günstiges", "günstigen", "billig", "billige", "billiger", "billiges", "billigen", "preiswert",
    "preiswerte", "preiswerter", "preiswertes", "preiswerten", "schnäppchen", "unter marktwert", "unter wert", "guter preis", "gutem preis",
    "preis leistung", "preisleistung", "bezahlbar", "bezahlbare", "bezahlbaren", "erschwinglich", "deal", "deals", "low budget"), (m) => {
    draft.deal = true;
    return understood(m, "günstig → weit unter Marktwert zuerst");
  });
  const explicitSort = (phrases: string[], sort: Sort, label: string) =>
    text.scan(words(...phrases), (m) => {
      draft.sort = sort;
      return understood(m, `Sortierung: ${label}`);
    });
  explicitSort(["billigste", "billigsten", "günstigste", "günstigsten", "billigste zuerst", "günstigste zuerst", "nach preis", "preis aufsteigend",
    "am billigsten", "am günstigsten"], "price_asc", "Preis aufsteigend");
  explicitSort(["neueste", "neuesten", "neu eingestellt", "frisch eingestellt", "zuletzt eingestellt", "neueste zuerst", "neueste angebote"], "newest", "neueste zuerst");
  explicitSort(["wenigste km", "wenigsten km", "wenigste kilometer", "wenigsten kilometer", "niedrigster kilometerstand"], "km_asc", "Kilometer aufsteigend");
  explicitSort(["jüngste", "jüngsten", "neuestes baujahr", "neuestes modell", "neueste baujahre"], "year_desc", "Erstzulassung, neueste zuerst");
  explicitSort(["nächste", "nächsten", "am nächsten", "nächstgelegene", "nächstgelegenen", "kürzeste anfahrt"], "distance", "Entfernung");
  explicitSort(["höchste marge", "meiste marge", "meisten gewinn", "höchster gewinn", "höchsten gewinn"], "margin", "Flip: höchste Marge");
  explicitSort(["stundenlohn", "höchster stundenlohn", "bester stundenlohn"], "flip", "Flip: höchster Stundenlohn");

  // Recognized, but nothing to filter on
  const noFilter = (phrases: string[], reason: string) => text.scan(words(...phrases), (m) => ignored(m, reason));
  noFilter(["sparsam", "sparsame", "sparsamer", "sparsames", "sparsamen", "wenig verbrauch", "geringer verbrauch", "niedriger verbrauch",
    "verbrauchsarm", "spritsparend", "spritsparer", "spritsparer", "wenig sprit", "günstig im unterhalt", "günstig im verbrauch",
    "niedrige unterhaltskosten", "geringe unterhaltskosten", "wenig unterhalt", "niedrige kosten", "geringe kosten", "wenig steuer",
    "niedrige steuer", "günstige versicherung", "günstig in der versicherung", "wenig versicherung"],
  "Verbrauch, Steuer und Versicherung stehen in keinem Angebot.");
  noFilter(["schwarz", "schwarzer", "schwarze", "schwarzes", "weiß", "weißer", "weiße", "weißes", "silber", "silberner", "silberne", "grau",
    "grauer", "graue", "graues", "rot", "roter", "rote", "rotes", "blau", "blauer", "blaue", "blaues", "grün", "grüner", "grüne", "grünes",
    "gelb", "gelber", "gelbe", "gelbes", "orange", "braun", "brauner", "braune", "beige", "farbe"], "Die Farbe ist (noch) kein Filter.");
  noFilter(["1 hand", "erste hand", "aus erster hand", "erstbesitz", "erstbesitzer", "ein vorbesitzer", "wenig vorbesitzer", "wenige vorbesitzer",
    "wenig halter", "1 halter"], "Die Zahl der Vorbesitzer steht in keinem Angebot.");
  noFilter(["scheckheft", "scheckheftgepflegt", "scheckheft gepflegt", "lückenlos", "serviceheft"], "Das Scheckheft steht kaum in Titeln.");
  noFilter(["fahranfänger", "anfänger", "erstes auto", "erste auto", "führerscheinneuling", "fahranfängerin"],
    "Kein eigener Filter; Kleinwagen mit wenig PS sind meist günstig in der Versicherung.");
  noFilter(["langstrecke", "langstrecken", "autobahn", "pendeln", "pendler", "vielfahrer", "viel fahren"], "Kein eigener Filter; für viele Kilometer passt oft Diesel.");
  noFilter(["sportlich", "sportliche", "sportlicher", "sportliches", "schnell", "schnelle", "schneller", "schnelles", "stark", "starke", "starker",
    "kräftig", "kräftiger", "viel leistung", "viel ps", "spaß", "fahrspaß"], "Gib die Leistung als Zahl an, z. B. „ab 150 PS“.");

  for (const [title, phrases] of TITLE_WORDS) {
    text.scan(words(...phrases), (m) => {
      if (draft.q.length < 3 && !draft.q.includes(title)) draft.q.push(title);
      return understood(m, `„${title}“ im Titel`);
    });
  }

  findModelWithoutMake(text, draft);
  if (findPlace && !q.zip) await findPlaceName(text, draft, findPlace);
  if (!q.zip) {
    noFilter(["in der nähe", "in meiner nähe", "in der umgebung", "in meiner umgebung", "nähe", "umgebung", "nahe", "in der gegend"],
      "Ohne Ort oder PLZ gibt es keinen Umkreis. Schreib z. B. „bei 10115“ oder „um München“.");
  }

  // --- What is left
  const unknown: string[] = [];
  for (const token of text.tokens()) {
    if (STOPWORDS.has(token.word)) continue;
    const original = text.slice(token.start, token.end);
    // Codes such as "GTI" or "TDCi" written in capitals often stand in the title as written.
    if (/^[A-Z][A-Z0-9]{1,5}$/.test(original) && draft.q.length < 3) {
      draft.q.push(original);
      draft.understood.push({ at: token.start, text: original, label: `„${original}“ im Titel` });
      continue;
    }
    if ((token.word.length >= 2 || /\d/.test(token.word)) && unknown.length < 12) unknown.push(original);
  }

  const query = finish(draft, year);
  const familyLabel = `Familie → ${query.body.map((body) => BODY_TYPE_LABELS[body]).join(", ") || "jeder Typ"}`;
  const seen = new Set<string>();
  const understoodOnce = sortByPosition(draft.understood)
    .map((item) => (item.label === FAMILY ? { ...item, label: familyLabel } : item))
    .filter((item) => !seen.has(item.label) && seen.add(item.label));
  return { query, understood: understoodOnce, ignored: sortByPosition(draft.ignored), unknown };
}

/** Placeholder label of the family wish, replaced once the body types are known. */
const FAMILY = "\u0000family";

function sortByPosition<T extends { at: number }>(items: T[]): Omit<T, "at">[] {
  return items
    .sort((a, b) => a.at - b.at)
    .map((item) => {
      const { at, ...rest } = item;
      void at;
      return rest;
    });
}

function huFromMonths(months: number): HuFilter | null {
  if (months < 0) return null;
  if (months >= 21) return "neu";
  if (months >= 18) return "18";
  if (months >= 12) return "12";
  return "6";
}

const huLabel = (hu: HuFilter) =>
  `TÜV/HU ${hu === "neu" ? "neu" : `noch mind. ${hu} Monate`} (nur Angebote mit HU im Titel)`;

/** The next radius the form offers, at most the largest. */
function snapRadius(km: number): number {
  return RADII_KM.find((radius) => radius >= km) ?? RADII_KM[RADII_KM.length - 1];
}

/** Turns the collected wishes into filters, with defaults: family cars, reliable means intact, flipping means damaged. */
function finish(draft: Draft, year: number): NaturalQuery {
  const q = draft.query;
  q.fuel = draft.fuel.size > 0 ? [...draft.fuel] : draft.fuelOut.size > 0 ? FUELS.filter((f) => !draft.fuelOut.has(f) && f !== "other") : [];
  if (draft.body.size > 0) q.body = [...draft.body];
  else if (draft.bodyOut.size > 0) q.body = BODY_TYPES.filter((b) => !draft.bodyOut.has(b));
  else if (draft.family) q.body = ["estate", "van", "suv"];
  if (draft.q.length > 0) q.q = draft.q.join(" ");
  if (draft.flip) q.zustand = "defekt";
  if (draft.reliable && !q.zustand) q.zustand = "intakt";
  if (q.yearMin !== undefined && q.yearMax !== undefined && q.yearMin > q.yearMax) [q.yearMin, q.yearMax] = [q.yearMax, q.yearMin];
  if (q.yearMax !== undefined && q.yearMax > year + 1) q.yearMax = undefined;
  if (q.priceMin !== undefined && q.priceMax !== undefined && q.priceMin > q.priceMax) [q.priceMin, q.priceMax] = [q.priceMax, q.priceMin];
  q.sort =
    draft.sort ??
    (q.zustand === "defekt" ? "flip" : draft.reliable ? "empfehlung" : draft.deal ? "below_market" : "empfehlung");
  return q;
}

// ---------------------------------------------------------------------------------------------
// Makes, models and places

interface Key {
  words: string[];
  make: MakeDef;
  model?: ModelDef;
}

const keyWords = (value: string) => normalizeText(value).split(" ").filter(Boolean);
const unique = <T>(values: T[]) => [...new Set(values)];

const MAKE_KEYS: Key[] = MAKES.flatMap((make) =>
  unique([make.slug, make.name, ...(make.aliases ?? [])].map((key) => keyWords(key).join(" ")))
    .filter(Boolean)
    .map((key) => ({ words: key.split(" "), make })),
);

const modelKeys = (make: MakeDef, model: ModelDef): Key[] =>
  unique([model.slug, model.name, ...(model.aliases ?? [])].map((key) => keyWords(key).join(" ")))
    .filter(Boolean)
    .map((key) => ({ words: key.split(" "), make, model }));

/** Model keys that name one make's model, usable without the make: "Octavia", "A4", "3er", "X5". */
const LONE_MODEL_KEYS: Key[] = (() => {
  const all = MAKES.flatMap((make) => make.models.flatMap((model) => modelKeys(make, model)));
  const makesPerKey = new Map<string, Set<string>>();
  for (const key of all) {
    const id = key.words.join(" ");
    makesPerKey.set(id, (makesPerKey.get(id) ?? new Set()).add(key.make.slug));
  }
  return all.filter((key) => {
    const id = key.words.join(" ");
    if (makesPerKey.get(id)!.size > 1 || COMMON_WORD_MODELS.has(id)) return false;
    if (/^[\d ]+$/.test(id)) return false;
    const mixed = /\d/.test(id) && /[a-z]/.test(id);
    return mixed ? id.replace(/ /g, "").length >= 2 : key.words.every((word) => word.length >= 3) && id.length >= 4;
  });
})();

/** Whether `words` stand at tokens[i…], with only spaces, hyphens, dots or slashes between them. */
function matchAt(text: Text, tokens: Token[], i: number, words: string[]): boolean {
  if (i + words.length > tokens.length) return false;
  for (let k = 0; k < words.length; k += 1) {
    if (tokens[i + k].word !== words[k]) return false;
    if (k > 0 && !/^[\s.\-/]*$/.test(text.norm.slice(tokens[i + k - 1].end, tokens[i + k].start))) return false;
  }
  return true;
}

function longestAt(text: Text, tokens: Token[], i: number, keys: Key[]): Key | null {
  let best: Key | null = null;
  for (const key of keys) {
    if ((!best || key.words.length > best.words.length) && matchAt(text, tokens, i, key.words)) best = key;
  }
  return best;
}

const GENERATION = /^(?:[1-9]|i{1,3}|iv|v|vi{1,3}|mk[1-9])$/;
const UNIT_AFTER = /^(?:jahre?|km|ps|kw|eur|euro|monate?|turer|sitzer|gang|tsd|tausend|k|tkm)$/;

function findMakeAndModel(text: Text, draft: Draft) {
  const tokens = text.tokens();
  const hits: { key: Key; start: number; end: number }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const key = longestAt(text, tokens, i, MAKE_KEYS);
    if (!key) continue;
    // "Mini-Van" is a van, not a MINI.
    if (key.make.slug === "mini" && /^(van|vans|bus)$/.test(tokens[i + 1]?.word ?? "")) continue;
    hits.push({ key, start: i, end: i + key.words.length });
    i += key.words.length - 1;
  }
  if (hits.length === 0) return;
  const make = hits[0].key.make;
  for (const hit of hits) {
    if (hit.key.make !== make) {
      ignoredTokens(text, draft, tokens, hit.start, hit.end, `Nur eine Marke je Suche: ${make.name} genommen.`);
    } else {
      consumeTokens(text, tokens, hit.start, hit.end);
      draft.understood.push({ at: tokens[hit.start].start, text: text.slice(tokens[hit.start].start, tokens[hit.end - 1].end), label: make.name });
    }
  }
  draft.query.make = make.slug;

  // The make's model: anywhere, except bare numbers and single letters, which must follow the make ("Peugeot 2008", "Mercedes A 180").
  const keys = make.models.flatMap((model) => modelKeys(make, model));
  const afterMake = new Set(hits.filter((hit) => hit.key.make === make).map((hit) => hit.end));
  const found: { model: ModelDef; start: number; end: number }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    if (hits.some((hit) => i >= hit.start && i < hit.end)) continue;
    const key = longestAt(text, tokens, i, keys);
    const short = key && (/^[\d ]+$/.test(key.words.join(" ")) || key.words.join("").length < 2);
    if (key && (!short || afterMake.has(i))) {
      found.push({ model: key.model!, start: i, end: i + key.words.length });
      i += key.words.length - 1;
      continue;
    }
    // Engine codes: "320d" is a 3er, "C220" a C-Klasse; "180tkm" or "150 PS" are not.
    const word = tokens[i].word;
    if (UNIT_AFTER.test(tokens[i + 1]?.word ?? "") || /(km|tkm|ps|kw|k|tsd|eur|euro)$/.test(word)) continue;
    const byPattern = make.models.find((model) => model.firstWord?.test(word));
    if (byPattern && (afterMake.has(i) || (word.length >= 3 && /\d/.test(word)))) found.push({ model: byPattern, start: i, end: i + 1 });
  }
  addModels(text, draft, tokens, make, found);
}

function addModels(text: Text, draft: Draft, tokens: Token[], make: MakeDef, found: { model: ModelDef; start: number; end: number }[]) {
  if (found.length === 0) return;
  const models = unique(found.map((f) => f.model));
  for (const f of found) {
    consumeTokens(text, tokens, f.start, f.end);
    const at = tokens[f.start].start;
    const spelled = text.slice(at, tokens[f.end - 1].end);
    if (models.length > 1) {
      draft.ignored.push({ at, text: spelled, reason: `Nur ein Modell je Suche, daher alle ${make.name}.` });
      continue;
    }
    const makeNamed = draft.understood.some((item) => item.label === make.name);
    draft.understood.push({ at, text: spelled, label: makeNamed ? f.model.name : `${make.name} ${f.model.name}` });
    const next = tokens[f.end];
    if (next && GENERATION.test(next.word) && !UNIT_AFTER.test(tokens[f.end + 1]?.word ?? "")) {
      consumeTokens(text, tokens, f.end, f.end + 1);
      draft.ignored.push({ at: next.start, text: text.slice(next.start, next.end), reason: "Die Modellgeneration ist kein Filter; gib dafür das Baujahr an." });
    }
  }
  if (models.length === 1) draft.query.model = models[0].slug;
}

function findModelWithoutMake(text: Text, draft: Draft) {
  if (draft.query.model) return;
  const tokens = text.tokens();
  const found: { key: Key; start: number; end: number }[] = [];
  for (let i = 0; i < tokens.length; i += 1) {
    const key = longestAt(text, tokens, i, LONE_MODEL_KEYS);
    if (!key) continue;
    found.push({ key, start: i, end: i + key.words.length });
    i += key.words.length - 1;
  }
  if (found.length === 0) return;
  const make = draft.query.make ? MAKES.find((m) => m.slug === draft.query.make)! : found[0].key.make;
  const own = found.filter((f) => f.key.make === make);
  for (const f of found.filter((f) => f.key.make !== make)) {
    ignoredTokens(text, draft, tokens, f.start, f.end, `Nur eine Marke je Suche: ${make.name} genommen.`);
  }
  if (own.length === 0) return;
  if (!draft.query.make) draft.query.make = make.slug;
  addModels(text, draft, tokens, make, own.map((f) => ({ model: f.key.model!, start: f.start, end: f.end })));
}

function consumeTokens(text: Text, tokens: Token[], start: number, end: number) {
  text.consume(tokens[start].start, tokens[end - 1].end);
}

function ignoredTokens(text: Text, draft: Draft, tokens: Token[], start: number, end: number, reason: string) {
  const at = tokens[start].start;
  draft.ignored.push({ at, text: text.slice(at, tokens[end - 1].end), reason });
  consumeTokens(text, tokens, start, end);
}

const PLACE_MARKER = new RegExp(
  `${B0}(?:${alt("in der nähe von", "in der umgebung von", "in der gegend um", "in der gegend von", "nähe von", "nahe von", "nähe", "nahe",
    "rund um", "im raum", "raum", "umgebung von", "umgebung", "region", "im umkreis von", "umkreis von", "in", "bei", "um", "aus", "nach")})\\s+$`,
);

/** "in München", "um Frankfurt am Main", "bei Köln": up to four words after such a word, longest town first. */
async function findPlaceName(text: Text, draft: Draft, findPlace: PlaceLookup) {
  const tokens = text.tokens();
  for (let i = 0; i < tokens.length; i += 1) {
    const before = text.remaining.slice(0, tokens[i].start);
    const marker = PLACE_MARKER.exec(before);
    if (!marker || STOPWORDS.has(tokens[i].word) || /^\d/.test(tokens[i].word)) continue;
    for (let n = Math.min(4, tokens.length - i); n >= 1; n -= 1) {
      const [from, to] = [tokens[i].start, tokens[i + n - 1].end];
      // Only neighbouring words that no rule used: "in Köln, Diesel" never tries "Köln Diesel".
      if (n > 1 && (/[,;/]/.test(text.norm.slice(from, to)) || text.remaining.slice(from, to) !== text.norm.slice(from, to))) continue;
      const name = text.slice(from, to);
      const place = await findPlace(name);
      if (!place) continue;
      draft.query.zip = place.zip;
      draft.query.radius ??= 50;
      text.consume(marker.index, tokens[i + n - 1].end);
      draft.understood.push({ at: marker.index, text: text.slice(marker.index, tokens[i + n - 1].end), label: `${draft.query.radius} km um ${place.city} (${place.zip})` });
      return;
    }
  }
}

// ---------------------------------------------------------------------------------------------
// Output

/** The search page's query parameters for a parsed text, with the text itself as "ki". */
export function naturalSearchParams(search: NaturalSearch, text: string): URLSearchParams {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(search.query)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) value.forEach((item) => params.append(key, String(item)));
    else params.set(key, String(value));
  }
  params.set("ki", text.trim().slice(0, MAX_TEXT_LENGTH));
  return params;
}
