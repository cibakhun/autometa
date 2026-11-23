import { getPool } from "@/lib/db";
import { ensureDevice, isCrossSite, seeOther, setProfileCookie } from "@/lib/profile";
import { createLinkCode } from "@/profiles/store";

/** A code to use this profile on another device; shown on /geraete. */
export async function POST(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const device = await ensureDevice(request);
  const { code, expiresAt } = await createLinkCode(getPool(), device.profileId);
  const response = seeOther(`/geraete?${new URLSearchParams({ code, bis: expiresAt })}`);
  if (device.token) setProfileCookie(response, device.token);
  return response;
}
