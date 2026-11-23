import { NextResponse } from "next/server";
import { pushToProfile } from "@/alerts/push";
import { getPool } from "@/lib/db";
import { currentDevice, isCrossSite } from "@/lib/profile";

/** One test per profile within this time; repeated clicks would only send the same again. */
const TEST_COOLDOWN_MS = 15_000;
const lastTest = new Map<number, number>();

/** "Test senden": a notification to every push device of the visitor's profile. */
export async function POST(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const device = await currentDevice();
  if (!device) return NextResponse.json({ sent: 0, failed: 0 });
  const now = Date.now();
  const last = lastTest.get(device.profileId);
  if (last !== undefined && now - last < TEST_COOLDOWN_MS) {
    return NextResponse.json({ sent: 0, failed: 0, error: "Gerade erst gesendet. Bitte ein paar Sekunden warten." }, { status: 429 });
  }
  lastTest.set(device.profileId, now);
  for (const [profileId, at] of lastTest) if (now - at >= TEST_COOLDOWN_MS) lastTest.delete(profileId);

  const result = await pushToProfile(getPool(), device.profileId, {
    title: "AutoMeta: Benachrichtigungen funktionieren",
    body: "So sieht es aus, wenn ein Suchauftrag etwas Neues findet.",
    url: "/suchauftraege",
    tag: "test",
  });
  return NextResponse.json(result);
}
