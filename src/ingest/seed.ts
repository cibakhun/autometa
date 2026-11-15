import type { Pool } from "pg";
import { PLACES } from "@/core/places";
import { MAKES } from "@/core/taxonomy";

/** Writes the canonical make/model list and the known postal codes. Safe to run repeatedly. */
export async function seedReferenceData(pool: Pool): Promise<{ makes: number; models: number; postalCodes: number }> {
  let models = 0;
  for (const make of MAKES) {
    await pool.query(
      "insert into makes (slug, name) values ($1, $2) on conflict (slug) do update set name = excluded.name",
      [make.slug, make.name],
    );
    for (const model of make.models) {
      await pool.query(
        `insert into models (make_slug, slug, name) values ($1, $2, $3)
         on conflict (make_slug, slug) do update set name = excluded.name`,
        [make.slug, model.slug, model.name],
      );
      models += 1;
    }
  }
  for (const place of PLACES) {
    await pool.query(
      `insert into postal_codes (zip, city, lat, lng) values ($1, $2, $3, $4)
       on conflict (zip) do update set city = excluded.city, lat = excluded.lat, lng = excluded.lng`,
      [place.zip, place.city, place.lat, place.lng],
    );
  }
  return { makes: MAKES.length, models, postalCodes: PLACES.length };
}
