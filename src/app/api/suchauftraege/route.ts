import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { getFlipSettings } from "@/lib/flip-settings";
import { ensureDevice, isCrossSite, setProfileCookie } from "@/lib/profile";
import { saveSearch, TooManySearchesError } from "@/profiles/searches";

const body = z.object({ query: z.string().max(2000) });

/** "Suche speichern": keeps the current search (with the visitor's flip settings) as a saved search. */
export async function POST(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });

  const device = await ensureDevice(request);
  let response: NextResponse;
  try {
    const saved = await saveSearch(getPool(), device.profileId, parsed.data.query, await getFlipSettings());
    response = NextResponse.json(saved);
  } catch (error) {
    if (!(error instanceof TooManySearchesError)) throw error;
    response = NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (device.token) setProfileCookie(response, device.token);
  return response;
}
