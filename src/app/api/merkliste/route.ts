import { NextResponse } from "next/server";
import { z } from "zod";
import { getPool } from "@/lib/db";
import { ensureDevice, isCrossSite, setProfileCookie } from "@/lib/profile";
import { setFavorite, TooManyError } from "@/profiles/favorites";

const body = z.object({ listingId: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), saved: z.boolean() });

/** The heart on a listing: puts it on the visitor's watch list or takes it off. */
export async function POST(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const parsed = body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Ungültige Anfrage" }, { status: 400 });

  const device = await ensureDevice(request);
  let response: NextResponse;
  try {
    const saved = await setFavorite(getPool(), device.profileId, parsed.data.listingId, parsed.data.saved);
    response = NextResponse.json({ saved });
  } catch (error) {
    if (!(error instanceof TooManyError)) throw error;
    response = NextResponse.json({ error: error.message }, { status: 409 });
  }
  if (device.token) setProfileCookie(response, device.token);
  return response;
}
