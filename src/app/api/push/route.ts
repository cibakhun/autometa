import { NextResponse } from "next/server";
import { deleteSubscription, parseSubscription, saveSubscription } from "@/alerts/push";
import { getPool } from "@/lib/db";
import { currentDevice, ensureDevice, isCrossSite, setProfileCookie } from "@/lib/profile";

/** This browser allowed pushes: keep its subscription for the visitor's profile. */
export async function POST(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { subscription?: unknown; previousEndpoint?: unknown } | null;
  const subscription = parseSubscription(body?.subscription);
  if (!subscription) return NextResponse.json({ error: "Ungültiges Push-Abo" }, { status: 400 });
  const previous = typeof body?.previousEndpoint === "string" ? body.previousEndpoint : null;

  const device = await ensureDevice(request);
  await saveSubscription(getPool(), device.profileId, device.deviceId, subscription, previous);
  const response = NextResponse.json({ ok: true });
  if (device.token) setProfileCookie(response, device.token);
  return response;
}

/** Pushes switched off in this browser. */
export async function DELETE(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const body = (await request.json().catch(() => null)) as { endpoint?: unknown } | null;
  const device = await currentDevice();
  if (device && typeof body?.endpoint === "string") await deleteSubscription(getPool(), device.profileId, body.endpoint);
  return NextResponse.json({ ok: true });
}
