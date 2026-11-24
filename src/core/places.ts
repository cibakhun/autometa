/**
 * Approximate city-centre coordinates of larger German cities.
 * Used for demo data and as the starting set of postal codes for the radius search.
 * Phase 2 replaces this with a full postal code dataset (e.g. GeoNames, CC BY 4.0).
 */
export interface Place {
  zip: string;
  city: string;
  lat: number;
  lng: number;
}

export const PLACES: Place[] = [
  { zip: "10115", city: "Berlin", lat: 52.52, lng: 13.405 },
  { zip: "20095", city: "Hamburg", lat: 53.5511, lng: 9.9937 },
  { zip: "80331", city: "München", lat: 48.1351, lng: 11.582 },
  { zip: "50667", city: "Köln", lat: 50.9375, lng: 6.9603 },
  { zip: "60311", city: "Frankfurt am Main", lat: 50.1109, lng: 8.6821 },
  { zip: "70173", city: "Stuttgart", lat: 48.7758, lng: 9.1829 },
  { zip: "40213", city: "Düsseldorf", lat: 51.2277, lng: 6.7735 },
  { zip: "44135", city: "Dortmund", lat: 51.5136, lng: 7.4653 },
  { zip: "45127", city: "Essen", lat: 51.4556, lng: 7.0116 },
  { zip: "04109", city: "Leipzig", lat: 51.3397, lng: 12.3731 },
  { zip: "28195", city: "Bremen", lat: 53.0793, lng: 8.8017 },
  { zip: "01067", city: "Dresden", lat: 51.0504, lng: 13.7373 },
  { zip: "30159", city: "Hannover", lat: 52.3759, lng: 9.732 },
  { zip: "90402", city: "Nürnberg", lat: 49.4521, lng: 11.0767 },
  { zip: "47051", city: "Duisburg", lat: 51.4344, lng: 6.7623 },
  { zip: "44787", city: "Bochum", lat: 51.4818, lng: 7.2162 },
  { zip: "42103", city: "Wuppertal", lat: 51.2562, lng: 7.1508 },
  { zip: "33602", city: "Bielefeld", lat: 52.0302, lng: 8.5325 },
  { zip: "53111", city: "Bonn", lat: 50.7374, lng: 7.0982 },
  { zip: "48143", city: "Münster", lat: 51.9607, lng: 7.6261 },
  { zip: "76133", city: "Karlsruhe", lat: 49.0069, lng: 8.4037 },
  { zip: "68159", city: "Mannheim", lat: 49.4875, lng: 8.466 },
  { zip: "86150", city: "Augsburg", lat: 48.3705, lng: 10.8978 },
  { zip: "65183", city: "Wiesbaden", lat: 50.0782, lng: 8.2398 },
  { zip: "41061", city: "Mönchengladbach", lat: 51.1805, lng: 6.4428 },
  { zip: "38100", city: "Braunschweig", lat: 52.2689, lng: 10.5268 },
  { zip: "24103", city: "Kiel", lat: 54.3233, lng: 10.1228 },
  { zip: "09111", city: "Chemnitz", lat: 50.8278, lng: 12.9214 },
  { zip: "06108", city: "Halle (Saale)", lat: 51.4825, lng: 11.9697 },
  { zip: "39104", city: "Magdeburg", lat: 52.1205, lng: 11.6276 },
  { zip: "79098", city: "Freiburg im Breisgau", lat: 47.999, lng: 7.8421 },
  { zip: "23552", city: "Lübeck", lat: 53.8655, lng: 10.6866 },
  { zip: "26122", city: "Oldenburg", lat: 53.1435, lng: 8.2146 },
  { zip: "55116", city: "Mainz", lat: 49.9929, lng: 8.2473 },
  { zip: "18055", city: "Rostock", lat: 54.0924, lng: 12.0991 },
  { zip: "99084", city: "Erfurt", lat: 50.9848, lng: 11.0299 },
  { zip: "34117", city: "Kassel", lat: 51.3127, lng: 9.4797 },
  { zip: "93047", city: "Regensburg", lat: 49.0134, lng: 12.1016 },
  { zip: "85049", city: "Ingolstadt", lat: 48.7665, lng: 11.4258 },
  { zip: "97070", city: "Würzburg", lat: 49.7913, lng: 9.9534 },
  { zip: "89073", city: "Ulm", lat: 48.4011, lng: 9.9876 },
  { zip: "66111", city: "Saarbrücken", lat: 49.2402, lng: 6.9969 },
  { zip: "14467", city: "Potsdam", lat: 52.3906, lng: 13.0645 },
  { zip: "19053", city: "Schwerin", lat: 53.6355, lng: 11.4012 },
  { zip: "54290", city: "Trier", lat: 49.7499, lng: 6.6371 },
  { zip: "49074", city: "Osnabrück", lat: 52.2799, lng: 8.0472 },
  { zip: "37073", city: "Göttingen", lat: 51.5413, lng: 9.9158 },
  { zip: "87435", city: "Kempten (Allgäu)", lat: 47.7286, lng: 10.3158 },
];

/**
 * Designations official place names carry after a comma, as AutoScout24 passes them on:
 * "Bad Kreuznach, Stadt", "Beilngries, St", "Pöttmes, M" (Markt), "Erding, GKSt", "Lübeck, Hansestadt".
 */
const DESIGNATION = /,\s*(?:st\.?|m\.?|gkst|gem\.?|stadt|markt|gemeinde|flecken|\p{L}*stadt)\s*$/iu;
/** Words that stay lower case inside a place name: "Frankfurt am Main", "Weil der Stadt". */
const LOWER_CASE_WORDS = new Set(["am", "an", "auf", "bei", "das", "dem", "den", "der", "die", "im", "in", "ob", "unter", "vom", "von", "vor", "zu", "zum", "zur"]);

/**
 * A place name as people write it. Drops designations after a comma, and takes the name the
 * postal code data has for the listing's postal code when it is the same place written another
 * way ("Gross kreutz" → "Groß Kreutz", "viersen" → "Viersen") or when the portal's name was cut or
 * abbreviated and starts like it ("Vohburg a.d.Donau" → "Vohburg an der Donau", "Pfaffenhofen
 * (bei Münche" → "Pfaffenhofen an der Ilm"). A name of its own stays, since the postal code data
 * often names the district ("Dresden", not "Dresden Innere Altstadt"). Names written all in lower
 * or upper case get capitals.
 */
export function cleanCity(city: string | null | undefined, placeName?: string | null): string | null {
  const place = placeName?.trim() || null;
  const name = (city ?? "").replace(/\s+/g, " ").trim().replace(DESIGNATION, "").trim();
  if (!name) return place;
  if (place) {
    if (placeKey(name) === placeKey(place)) return place;
    if (looksCut(name) && placeKey(firstWord(name)) === placeKey(firstWord(place)) && sameRest(name, place)) return place;
  }
  return /\p{Ll}/u.test(name) && /\p{Lu}/u.test(name) ? name : capitalize(name);
}

/** Compares place names without case, accents, "ß" and "ue" spellings, or punctuation. */
function placeKey(name: string): string {
  return name
    .toLowerCase()
    .replace(/ß/g, "ss")
    .normalize("NFKD")
    .replace(/\p{M}/gu, "")
    .replace(/([aou])e/g, "$1")
    .replace(/[^a-z0-9]+/g, "");
}

const firstWord = (name: string) => name.split(/[\s(/.,-]/)[0];

/** Small words and abbreviations in place names that say nothing about which place it is. */
const PLACE_FILLERS = new Set(["a", "an", "am", "d", "der", "die", "den", "dem", "des", "i", "im", "in", "b", "bei", "o", "ob", "u", "und", "v", "vor", "st", "stadt", "ot"]);

const restWords = (name: string) =>
  name
    .slice(firstWord(name).length)
    .split(/[^\p{L}\d]+/u)
    .map(placeKey)
    .filter((word) => word && !PLACE_FILLERS.has(word));

/**
 * Whether the rest of a cut or abbreviated name fits the postal name: "Vohburg a.d.Donau" fits
 * "Vohburg an der Donau", "Frankfurt a.Main" does not fit "Frankfurt (Oder)". An unclosed bracket
 * is dropped first ("Pfaffenhofen (bei Münche"), since it was cut off and may only describe the place.
 */
function sameRest(name: string, place: string): boolean {
  const placeRest = restWords(place);
  return restWords(name.replace(/\([^)]*$/, "")).every((word) => placeRest.some((other) => other.startsWith(word)));
}

/** An opened bracket that is never closed, or abbreviations like "a.d.", "a.Main", "i. OB". */
function looksCut(name: string): boolean {
  const opened = (name.match(/\(/g) ?? []).length;
  const closed = (name.match(/\)/g) ?? []).length;
  return opened !== closed || /(?:^|[\s(])[abdiouv]\.\s?\p{L}/iu.test(name);
}

function capitalize(name: string): string {
  return name
    .toLowerCase()
    .split(/(\s+|-|\()/)
    .map((word, i) => (i > 0 && LOWER_CASE_WORDS.has(word) ? word : word.charAt(0).toUpperCase() + word.slice(1)))
    .join("");
}
