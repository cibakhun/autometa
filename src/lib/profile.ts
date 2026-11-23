import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getPool } from "@/lib/db";
import { createProfile, deviceLabel, findDevice, PROFILE_COOKIE, PROFILE_COOKIE_MAX_AGE, type Device } from "@/profiles/store";

/** The visitor's device and profile, or null before they saved anything. Reads a cookie, so the caller is dynamic. */
export async function currentDevice(): Promise<Device | null> {
  const token = (await cookies()).get(PROFILE_COOKIE)?.value;
  return token ? findDevice(getPool(), token) : null;
}

/**
 * For route handlers that save something: the visitor's device, created with a new profile when
 * the browser has none yet. `token` is set when the cookie has to be (re)written.
 */
export async function ensureDevice(request: Request): Promise<Device & { token: string | null }> {
  const pool = getPool();
  const existing = (await cookies()).get(PROFILE_COOKIE)?.value;
  const device = existing ? await findDevice(pool, existing) : null;
  // Renewed on every write, so a profile in use never runs out.
  if (device) return { ...device, token: existing! };
  const created = await createProfile(pool, deviceLabel(request.headers.get("user-agent")));
  return created;
}

export function setProfileCookie(response: NextResponse, token: string) {
  response.cookies.set(PROFILE_COOKIE, token, {
    path: "/",
    maxAge: PROFILE_COOKIE_MAX_AGE,
    sameSite: "lax",
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  });
}

/** A form or fetch from another site must not change anything. */
export const isCrossSite = (request: Request) => request.headers.get("sec-fetch-site") === "cross-site";

/** A relative redirect after a form POST, because behind the proxy request.url carries the internal host. */
export const seeOther = (location: string) => new NextResponse(null, { status: 303, headers: { Location: location } });
