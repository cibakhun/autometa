import { NextResponse } from "next/server";
import { pushToProfile } from "@/alerts/push";
import { getPool } from "@/lib/db";
import { currentDevice, isCrossSite } from "@/lib/profile";

/** "Test senden": a notification to every push device of the visitor's profile. */
export async function POST(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const device = await currentDevice();
  if (!device) return NextResponse.json({ sent: 0, failed: 0 });
  const result = await pushToProfile(getPool(), device.profileId, {
    title: "AutoMeta: Benachrichtigungen funktionieren",
    body: "So sieht es aus, wenn ein Suchauftrag etwas Neues findet.",
    url: "/suchauftraege",
    tag: "test",
  });
  return NextResponse.json(result);
}
