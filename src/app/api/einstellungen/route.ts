import { NextResponse } from "next/server";
import { DEFAULT_FLIP_SETTINGS, parseFlipSettings } from "@/core/flip";
import { getPool } from "@/lib/db";
import { FLIP_COOKIE, FLIP_COOKIE_MAX_AGE } from "@/lib/flip-settings";
import { currentDevice } from "@/lib/profile";
import { updateSearchSettings } from "@/profiles/searches";

/** POST from the settings form: saves the flip settings in a cookie (and for the saved searches) and goes back to the form. */
export async function POST(request: Request) {
  // A form on another site must not change the settings.
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response("Forbidden", { status: 403 });

  const form = await request.formData();
  const settings = form.get("reset") ? DEFAULT_FLIP_SETTINGS : parseFlipSettings(Object.fromEntries(form));
  // Saved searches (and their pushes) count with the settings last saved.
  const device = await currentDevice();
  if (device) await updateSearchSettings(getPool(), device.profileId, settings);
  // A relative Location, because behind the proxy request.url carries the internal host.
  const response = new NextResponse(null, { status: 303, headers: { Location: "/einstellungen?gespeichert=1" } });
  response.cookies.set(FLIP_COOKIE, JSON.stringify(settings), {
    path: "/",
    maxAge: FLIP_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
  return response;
}
