import { cookies } from "next/headers";
import { DEFAULT_FLIP_SETTINGS, parseFlipSettings, type FlipSettings } from "@/core/flip";

/**
 * The flip settings live in a cookie of the visitor's browser, not in the database: the site has
 * no accounts, and each flipper has their own level and costs.
 */
export const FLIP_COOKIE = "autometa_flip";
export const FLIP_COOKIE_MAX_AGE = 365 * 24 * 60 * 60;

export function parseFlipCookie(value: string | undefined): FlipSettings {
  if (!value) return DEFAULT_FLIP_SETTINGS;
  try {
    return parseFlipSettings(JSON.parse(value));
  } catch {
    return DEFAULT_FLIP_SETTINGS;
  }
}

/** The visitor's flip settings, the defaults when none are saved. Reads a cookie, so the caller is dynamic. */
export async function getFlipSettings(): Promise<FlipSettings> {
  return parseFlipCookie((await cookies()).get(FLIP_COOKIE)?.value);
}

/** The flip list: listings with damage hints the flipper can handle, best margin per hour first. */
export function flipListHref(settings: FlipSettings): string {
  const params = new URLSearchParams({
    zustand: "defekt",
    schwierigkeit: String(settings.level),
    margeMin: String(settings.minMarginEur),
    sort: "flip",
  });
  return `/?${params}`;
}
