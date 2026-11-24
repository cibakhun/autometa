import { GENERATIONS, MAKES, type MakeDef } from "./taxonomy";
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
/**
 * A link to a listing's preview photo, or null. Only https links to the source's own image
 * servers (`host` or one of its subdomains) are kept, so a page cannot slip in other addresses.
 */
export function sourceImageUrl(value: unknown, host: string): string | null {
  if (typeof value !== "string" || value.length > 1000) return null;
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    return null;
  }
  if (url.protocol === "http:") url.protocol = "https:";
  if (url.protocol !== "https:" || url.username || url.password) return null;
  const hostname = url.hostname.toLowerCase();
  return hostname === host || hostname.endsWith(`.${host}`) ? url.href : null;
}

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

/**
 * Whether a first registration names only the year ("2018"). parseFirstRegistration stores it as
 * January of that year, which must not count as a known month.
 */
export function isYearOnlyRegistration(value: string | null | undefined): boolean {
  return typeof value === "string" && /^\d{4}$/.test(value.trim()) && parseFirstRegistration(value) !== null;
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

/** How many words may come before the make in a title: "2023 Skoda Superb", "Verkaufe meinen VW Golf". */
const MAX_WORDS_BEFORE_MAKE = 3;

/**
 * Finds a make near the start of a free-text title: "Mercedes Benz V250 4Matic" -> Mercedes-Benz
 * with the rest "V250 4Matic"; "2023 Skoda Superb" -> Škoda with "Superb". The earliest match
 * wins, and the longest name or alias at that position.
 */
export function findMakeInTitle(title: string): { make: MakeDef; rest: string } | null {
  const rawWords = title.trim().split(/\s+/).filter(Boolean);
  const words = normalizeText(title).split(" ").filter(Boolean);
  for (let start = 0; start <= MAX_WORDS_BEFORE_MAKE && start < words.length; start += 1) {
    let best: { make: MakeDef; length: number } | null = null;
    for (const make of MAKES) {
      for (const key of [make.slug, make.name, ...(make.aliases ?? [])].map(normalizeText)) {
        const keyWords = key.split(" ").filter(Boolean);
        const matches = keyWords.length > 0 && keyWords.every((word, i) => words[start + i] === word);
        if (matches && (!best || keyWords.length > best.length)) best = { make, length: keyWords.length };
      }
    }
    if (best) return { make: best.make, rest: restAfter(rawWords, start + best.length) };
  }
  return null;
}

/**
 * The model in a title that does not start with it, for a known make: "Verkaufe Polo R-Line"
 * or "E46 330i Touring" (BMW). Tries the first few words as the start of the model. Words of
 * one character and engine sizes are skipped, so "1. Hand" never becomes smart #1 and
 * "Tribute 3.0 V6" never a Mazda 3.
 */
export function resolveModelInTitle(makeName: string, title: string): ResolvedMakeModel {
  const rawWords = title.trim().split(/\s+/).filter(Boolean);
  const direct = resolveMakeModel(makeName, title);
  if (direct.modelSlug || !direct.makeSlug) return direct;
  for (let start = 1; start <= MAX_WORDS_BEFORE_MAKE && start < rawWords.length; start += 1) {
    if (normalizeText(rawWords[start]).length < 2 || /^\d+[.,]\d/.test(rawWords[start])) continue;
    const resolved = resolveMakeModel(makeName, rawWords.slice(start).join(" "));
    if (resolved.modelSlug) return resolved;
  }
  return direct;
}

/**
 * Ads that offer no car for sale: wanted ads ("Suche Golf 7", "Suchen Golf 3 für Bastler",
 * "AMG GT ab 2015 *Suche*"), dealers buying up cars ("Ankauf aller Fahrzeuge"), lease takeovers,
 * whose price is a monthly rate, and swaps of something else for a car ("iPhone tausche gegen
 * Transporter"). Sale ads that also take a swap ("Tausch möglich", "Golf 4, Tausch gegen Bus")
 * stay: dropping a real offer is worse than keeping a wanted ad.
 */
export function isNotForSale(title: string): boolean {
  const text = normalizeText(title);
  return (
    // At the start only: sale ads may say "neuer Besitzer gesucht" or "Ankauf möglich" later on.
    (/^(?:\S+ )?(?:suche|ich suche|wir suchen|kaufe|wir kaufen|kaufgesuch|ankauf)\b/.test(text) && !offersCarToBuyer(text) && !SEARCH_NOUN.test(text)) ||
    // "Suchen Sie einen Kombi?" is a dealer's sale ad.
    /^(?:suchen|gesucht)\b(?! sie\b)/.test(text) ||
    /\b(?:leasingubernahme|leasing ubernahme)\b/.test(text) ||
    hasWantedMarker(title) ||
    endsWithSuche(text) ||
    isBuyerAd(title) ||
    seeksCar(title) ||
    offersNoCarInSwap(text)
  );
}

/** Who a sale ad looks for instead of a car: "neuer Besitzer gesucht", "suche Käufer", "Tausch suche". */
const BUYER_WORDS = String.raw`(?:besitzer|eigentumer|liebhaber|bastler|schrauber|abholer|zuhause|heim|kaufer|kaeufer|abnehmer|interessent\w*|nachfolger|halter|tausch\w*)`;

/** "Ihre Suche hat ein Ende": the search as a noun, the buyer's, in a dealer's sale ad. */
const SEARCH_NOUN = /^(?:ihre|deine|eure|die|der|zur|ihrer|deiner|unsere|ende der) suche\b/;
const SEARCH_NOUN_BEFORE = new Set(["ihre", "deine", "eure", "die", "der", "zur", "ihrer", "deiner", "unsere"]);

/** "Suche neuen Besitzer für meinen Golf": the search word looks for a buyer, the ad offers a car. */
function offersCarToBuyer(text: string): boolean {
  return new RegExp(String.raw`^(?:\S+ )?(?:suche|ich suche|wir suchen)(?: \S+){0,2} ${BUYER_WORDS}\b`).test(text);
}

/**
 * A dealer's sale ad may end in its own slogan after the car's facts, behind stars or pluses:
 * "Opel Astra *AHK *PDC *AU/HU *KFZ ANKAUF AS FAIR", "Ford Focus *PDC*KLIMA *Wir Kaufen dein KFZ".
 * The head is the title up to that list (or its first part, for "+++ Autoankauf +++").
 */
function headOf(title: string): string {
  return title.split(/[*+]/).find((part) => normalizeText(part) !== "") ?? "";
}

/** "Ankauf" also at the end of a compound ("Autoankauf", "KFZ-Ankauf", "Sofortankauf") and as the typo "Anakuf"; not "Ankaufstest". */
const BUYING_WORD = /\b\w*(?:ankauf|anakuf)\b/;
/** Sale ads that name buying as a service besides the sale: "Inzahlungnahme und Ankauf möglich", "Ankauf-Check". */
const BUYING_ASIDE = /\b(?:ankauf|anakuf) (?:moglich|check|test|gutachten|untersuchung)\b|\binzahlungnahme\w*\b|\bin zahlung\b/;
/** Who a buyer wants to buy from or what: "kauft Ihr Auto", "kaufen alle Fahrzeuge", "kaufe jedes Auto". */
const BUY_FROM = /\bkauf(?:e|en|t) (?:ihr|ihre|ihren|dein|deine|deinen|euer|eure|alle|jedes|jeden|jede)\b/;
/** Cars in the plural after "kaufen", as buyers write: "ich suchen und kaufen Autos"; not "Autos zu kaufen". */
const BUY_CARS = /(?<!\bzu )\bkauf(?:e|en) (?:\S+ )?(?:autos|fahrzeuge|pkws|kfzs|gebrauchtwagen|unfallwagen|unfallautos|wohnmobile)\b/;

/**
 * Dealers buying up cars: "Autoankauf Unfallautos Ankauf Kfz Ankauf Wohnmobil", "BMW X5 & BMW X3
 * ANKAUF AB BAUJAHR 2012", "Toyota Corolla, Yaris, Auris - Ankauf - Wir kaufen Ihren Toyota!",
 * "Ihr Auto verkaufen?". Only the head of the title counts (see headOf), and buying named as a
 * service beside the sale ("Inzahlungnahme und Ankauf möglich") does not.
 */
export function isBuyerAd(title: string): boolean {
  const head = normalizeText(headOf(title));
  const words = head.split(" ");
  const buying = words.filter((word) => BUYING_WORD.test(word)).length;
  // "Autoankauf & Inzahlungnahme" or "Ankauf Unfallwagen Ankauf Motorschaden" buy whatever else they say.
  if (buying >= 2 || words.slice(0, 2).some((word) => BUYING_WORD.test(word))) return true;
  if (buying === 1 && !BUYING_ASIDE.test(head)) return true;
  return (
    /\bwir kaufen\b(?! uns\b)/.test(head) ||
    BUY_FROM.test(head) ||
    BUY_CARS.test(head) ||
    /\b(?:ihr|ihren|dein|deinen) (?:altes |gebrauchtes )?(?:auto|altauto|fahrzeug|pkw|kfz|wagen|wohnmobil|gebrauchtwagen|unfallwagen) (?:verkaufen|loswerden)\b/.test(head)
  );
}

/**
 * Wanted ads that name the search later in the title: "Skoda Octavia gesucht Motorschaden
 * Getriebeschaden", "Volvo V70 von privat gesucht", "Porsche 992 Turbo S Cabriolet SUCHE , SUCHE",
 * "Mercedes-Benz E 220 ich suchen und kaufen Autos". Not when the search is for a buyer ("neuer
 * Besitzer gesucht", "suche Käufer") or a question ("Weihnachtsgeschenk gesucht? Smart fortwo"),
 * and not in swap ads, which offer a car as well ("TAUSCH bevorzugt / 7-Sitzer gesucht").
 */
export function seeksCar(title: string): boolean {
  const text = normalizeText(title);
  if (/\btausch\w*\b/.test(text)) return false;
  const words = text.split(" ");
  const questions = new Set(
    [...title.matchAll(/\b(?:gesucht|suche|suchen)\b\s*\?/gi)].map((match) => normalizeText(match[0])),
  );
  return words.some((word, i) => {
    const seeking = word === "gesucht" || (word === "suche" && i > 1) || ((word === "suche" || word === "suchen") && words[i - 1] === "ich");
    if (!seeking || questions.has(word) || SEARCH_NOUN_BEFORE.has(words[i - 1])) return false;
    // Who is sought stands before "gesucht" ("neuer Besitzer gesucht") and after or before "suche"
    // ("suche neuen Besitzer", "Käufer suche"); "gesucht für Bastler" still seeks a car.
    const sought = [...words.slice(Math.max(0, i - 3), i), ...(word === "gesucht" ? [] : words.slice(i + 1, i + 4))].join(" ");
    return !new RegExp(String.raw`(?:^| )${BUYER_WORDS}(?: |$)`).test(sought);
  });
}

/**
 * The start of a seller's description, as dealers buying up cars write it: "KFZ Handel Berlin
 * kauft ihr Auto auf. Wir kaufen Gebrauchtwagen …", "Autoankauf aller Marken", "Ankauf von
 * Unfallwagen". Only the opening counts: dealers' sale ads often end with "Wir kaufen auch Ihr
 * Fahrzeug". The text is looked at, never kept.
 */
export function isBuyerText(description: string | null | undefined): boolean {
  if (!description) return false;
  // Sentence by sentence: "… ein neues kaufe. Ihr bekommt …" is no "kaufe Ihr".
  return description
    .slice(0, 300)
    .split(/[.!?;:\n]+/)
    .map(normalizeText)
    .some(
      (sentence) =>
        /\bkauf(?:e|en|t) (?:\S+ )?(?:ihr|ihre|ihren|dein|deine|deinen|euer|eure|alle|jedes|jeden|jede)\b/.test(sentence) ||
        /\bwir kaufen\b(?! (?:uns|mir|ein|eine|einen)\b)/.test(sentence) ||
        /\b\w+(?:ankauf|anakuf)\b/.test(sentence) ||
        /\b(?:ankauf|anakuf) (?:von|aller|alle|jeglicher|ihres|deines|gegen)\b/.test(sentence),
    );
}

/**
 * A listing whose description opens like a buyer's (see isBuyerText) and whose title names no
 * make: "Unfallwagen | Motorschaden | Getriebeschaden" with "Wir kaufen Ihr Auto …". A title that
 * names a car keeps the listing, since dealers' sale ads may open with their buying slogan too.
 */
export function isBuyerListing(title: string, description: string | null | undefined): boolean {
  return isBuyerText(description) && findMakeInTitle(headOf(title)) === null;
}

/** "*Suche*", "(Suche)", "[SUCHE]", "!!Suche!!": sellers mark wanted ads like this anywhere in the title. */
export function hasWantedMarker(text: string): boolean {
  return /[*#!([{<]+\s*such(?:e|en)\s*[*#!)\]}>]+/i.test(text);
}

/** Words before a final "suche" that look for a buyer or a swap, not for a car: "Käufer suche", "Tausch suche". */
const SEEKS_BUYER = /(?:^| )(?:besitzer|eigentumer|liebhaber|bastler|schrauber|abholer|zuhause|heim|kaufer|kaeufer|abnehmer|interessent\w*|nachfolger|halter|tausch\w*) suche$/;

function endsWithSuche(text: string): boolean {
  const before = text.split(" ").at(-2) ?? "";
  return / suche$/.test(text) && !SEEKS_BUYER.test(text) && !SEARCH_NOUN_BEFORE.has(before);
}

const SWAP = /^(.*?)\b(?:tausch|tausche|tauschen|wechsel|wechsle|wechseln|weschel|weschle)\b((?: \S+){0,4}?) gegen\b/;
/** Words around a swap that say nothing about what is offered: "Biete Tausch gegen …", "1.500 € oder Tausch gegen …". */
const SWAP_FILLERS = new Set(
  `biete bieten ich wir mein meine meinen meinem ein eine einen einem der die das den dem verkauf verkaufe verkaufen oder und auch
   nur evtl eventuell moglich gerne gern zum zur im in mit vb festpreis preis euro eur suche`.split(/\s+/),
);
/** Words that name a car without its make: "Auto tausche gegen Transporter" offers a car. */
const CAR_WORDS =
  /\b(?:auto|autos|pkw|kfz|fahrzeug|wagen|kombi|limousine|cabrio|cabriolet|coupe|suv|transporter|bus|bulli|van|kastenwagen|wohnmobil|camper|oldtimer|youngtimer|sportwagen|kleinwagen|gelandewagen|pickup|jeep)\b/;

/**
 * A swap whose offered side names no car: "iphone 18 pro max weschel gegen eine transporter".
 * The offered side is what stands before the swap word and between it and "gegen". Without any
 * offered word ("Tausch gegen Golf") nothing is known, so the ad stays.
 */
function offersNoCarInSwap(text: string): boolean {
  const swap = text.match(SWAP);
  if (!swap) return false;
  const offered = `${swap[1]} ${swap[2]}`.split(" ").filter((word) => word && !SWAP_FILLERS.has(word));
  // Only numbers ("1.500 € oder Tausch gegen …") offer nothing known; numbers next to words may
  // be a model ("911 Turbo Tausch gegen Golf").
  if (offered.every((word) => /^\d+$/.test(word))) return false;
  return !mentionsCar(offered.join(" "));
}

let carKeys: { makes: string[][]; models: string[][] } | null = null;

/**
 * Things offered in a swap that are no car, whose names a model shares: "Xbox One" (MINI One),
 * "Samsung Galaxy S24" (Ford Galaxy). Next to one of them only a make or a word like "Auto" counts.
 */
const NON_CAR_PRODUCTS =
  /\b(?:iphone|ipad|macbook|apple|samsung|galaxy s\d+|xbox|playstation|ps[2-5]|nintendo|konsole|handy|smartphone|laptop|notebook|tablet|fernseher|rolex|uhr|fahrrad|e ?bike|pedelec|motorrad|roller|quad)\b/;

/** Words that follow a product's name as its model ("15 pro max", "one", "galaxy note"), never a car's name. */
const PRODUCT_MODEL_WORDS = String.raw`(?: (?:\S*\d\S*|pro|max|mini|plus|ultra|air|one|series|lite|slim|switch|watch|edge|note|fold|flip|galaxy|tab))*`;

const toKeys = (keys: string[]) =>
  keys
    .map((key) => normalizeText(key))
    .filter((key) => key.length >= 2 && !/^\d{1,2}$/.test(key))
    .map((key) => key.split(" "));

/**
 * Whether a text names a car anywhere: a make, a model of any make, a model code like "320d", a
 * generation code like "E46" or a word like "Auto". Model names of one letter or of one or two
 * digits do not count, they say nothing on their own; nor do model names next to a product that
 * is no car ("Xbox One").
 */
export function mentionsCar(text: string): boolean {
  const words = normalizeText(text).split(" ").filter(Boolean);
  const joined = words.join(" ");
  if (CAR_WORDS.test(joined)) return true;
  carKeys ??= {
    makes: toKeys(MAKES.flatMap((make) => [make.slug, make.name, ...(make.aliases ?? [])])),
    models: toKeys(MAKES.flatMap((make) => make.models.flatMap((model) => [model.slug, model.name, ...(model.aliases ?? [])]))),
  };
  const found = (keys: string[][], within: string[]) =>
    keys.some((key) => within.some((_, start) => key.every((word, i) => within[start + i] === word)));
  if (found(carKeys.makes, words)) return true;
  // A product and its model words after it ("xbox one", "samsung galaxy note 10") are no model;
  // the rest still is, before or after the product ("golf 4 mit e bike", "e bike und golf 4").
  const rest = joined.replace(new RegExp(String.raw`${NON_CAR_PRODUCTS.source}${PRODUCT_MODEL_WORDS}`, "g"), " ");
  const restWords = rest.split(" ").filter(Boolean);
  if (found(carKeys.models, restWords)) return true;
  // "320d", "a180": model codes (with a digit, so a lone "e" or "s" says nothing); "E46", "W124".
  const coded = MAKES.some((make) =>
    make.models.some((model) => model.firstWord && restWords.some((word) => /\d/.test(word) && word.length >= 3 && model.firstWord!.test(word))),
  );
  if (coded) return true;
  // Generation codes on the title as written ("997.1", "€ 993"), or on the rest beside a product.
  const target = NON_CAR_PRODUCTS.test(joined) ? rest : text.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  return GENERATIONS.some((generation) => generation.pattern.test(target));
}

/** Model names portals use for "not in their list": AutoScout24's "Sonstige", "Others", "ANDERE". */
export function isPlaceholderModel(model: string | null | undefined): boolean {
  return /^(?:sonstige|sonstiges|andere|anderes|other|others|diverse|weitere|unbekannt|unknown)$/.test(normalizeText(model ?? ""));
}

/**
 * Joins the parts of a title, leaving out words a part repeats from the parts before it: "Ford",
 * "Focus", "Focus" gives "Ford Focus"; "Mercedes-Benz", "V 300", "V 300 d kompakt" gives
 * "Mercedes-Benz V 300 d kompakt". A repeated run counts when it has two words or more, or one of
 * at least two letters or digits, so a lone "d" stays. Repeats inside one part stay as well:
 * "ohne Rost ohne Unfall" says two things.
 */
export function joinWithoutRepeats(parts: (string | null | undefined)[]): string {
  const said: string[] = [];
  const out: string[] = [];
  for (const part of parts) {
    const words = (part ?? "").trim().split(/\s+/).filter(Boolean);
    const keys = words.map((word) => normalizeText(word).replace(/ /g, ""));
    const kept: number[] = [];
    for (let i = 0; i < words.length; ) {
      const run = repeatedRun(keys, i, said);
      if (run > 0) {
        i += run;
        continue;
      }
      kept.push(i);
      i += 1;
    }
    // Punctuation left at the edges of what remains ("- Bodykit") goes as well.
    while (kept.length > 0 && keys[kept[0]] === "") kept.shift();
    while (kept.length > 0 && keys[kept[kept.length - 1]] === "") kept.pop();
    out.push(...kept.map((i) => words[i]));
    said.push(...kept.map((i) => keys[i]));
  }
  return out.join(" ");
}

/** Length of the longest run of words from keys[start] on that stands in `said` as well, if it counts. */
function repeatedRun(keys: string[], start: number, said: string[]): number {
  let longest = 0;
  for (let from = 0; from < said.length; from += 1) {
    let length = 0;
    while (start + length < keys.length && keys[start + length] !== "" && said[from + length] === keys[start + length]) length += 1;
    longest = Math.max(longest, length);
  }
  return longest >= 2 || (longest === 1 && keys[start].length >= 2) ? longest : 0;
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
