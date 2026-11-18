import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Pool } from "pg";
import { PLACES, type Place } from "@/core/places";
import { MAKES } from "@/core/taxonomy";

/** German postal codes with centre coordinates (GeoNames, CC BY 4.0), see the file header. */
export const POSTAL_CODES_FILE = path.join(process.cwd(), "data", "postal-codes-de.tsv");

/** Reads the postal code file: one "zip<TAB>city<TAB>lat<TAB>lng" line per code, "#" starts a comment. */
export function parsePostalCodes(text: string): Place[] {
  const places: Place[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line || line.startsWith("#")) continue;
    const [zip, city, lat, lng] = line.split("\t");
    const place = { zip, city, lat: Number(lat), lng: Number(lng) };
    if (!/^\d{5}$/.test(zip) || !city || !Number.isFinite(place.lat) || !Number.isFinite(place.lng)) {
      throw new Error(`Invalid postal code line: "${line}"`);
    }
    places.push(place);
  }
  return places;
}

/** Writes the canonical make/model list and the postal codes. Safe to run repeatedly. */
export async function seedReferenceData(
  pool: Pool,
  postalCodesFile = POSTAL_CODES_FILE,
): Promise<{ makes: number; models: number; postalCodes: number }> {
  const models = MAKES.flatMap((make) => make.models.map((model) => ({ make: make.slug, ...model })));
  await pool.query(
    `insert into makes (slug, name) select * from unnest($1::text[], $2::text[])
     on conflict (slug) do update set name = excluded.name`,
    [MAKES.map((make) => make.slug), MAKES.map((make) => make.name)],
  );
  await pool.query(
    `insert into models (make_slug, slug, name) select * from unnest($1::text[], $2::text[], $3::text[])
     on conflict (make_slug, slug) do update set name = excluded.name`,
    [models.map((model) => model.make), models.map((model) => model.slug), models.map((model) => model.name)],
  );

  // The full list first, then the demo cities, so demo coordinates stay what the demo data uses.
  const byZip = new Map<string, Place>();
  for (const place of parsePostalCodes(await readFile(postalCodesFile, "utf8"))) byZip.set(place.zip, place);
  for (const place of PLACES) byZip.set(place.zip, place);
  const places = [...byZip.values()];
  await pool.query(
    `insert into postal_codes (zip, city, lat, lng)
     select * from unnest($1::text[], $2::text[], $3::float8[], $4::float8[])
     on conflict (zip) do update set city = excluded.city, lat = excluded.lat, lng = excluded.lng`,
    [places.map((p) => p.zip), places.map((p) => p.city), places.map((p) => p.lat), places.map((p) => p.lng)],
  );
  return { makes: MAKES.length, models: models.length, postalCodes: places.length };
}
