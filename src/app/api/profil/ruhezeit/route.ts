import { getPool } from "@/lib/db";
import { currentDevice, isCrossSite, seeOther } from "@/lib/profile";
import { setQuietNights } from "@/profiles/store";

/** Night rest for pushes on or off. */
export async function POST(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const device = await currentDevice();
  if (device) await setQuietNights(getPool(), device.profileId, form.get("on") === "1");
  return seeOther("/suchauftraege#benachrichtigungen");
}
