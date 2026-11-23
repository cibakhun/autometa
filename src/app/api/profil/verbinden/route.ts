import { cookies } from "next/headers";
import { getPool } from "@/lib/db";
import { isCrossSite, seeOther, setProfileCookie } from "@/lib/profile";
import { deviceLabel, joinWithCode, PROFILE_COOKIE } from "@/profiles/store";

/** The code from another device: this browser now uses that profile (and brings along what it had). */
export async function POST(request: Request) {
  if (isCrossSite(request)) return new Response("Forbidden", { status: 403 });
  const form = await request.formData();
  const token = (await cookies()).get(PROFILE_COOKIE)?.value;
  const joined = await joinWithCode(getPool(), String(form.get("code") ?? ""), token, deviceLabel(request.headers.get("user-agent")));
  if (!joined) return seeOther("/geraete?fehler=code");
  const response = seeOther("/geraete?verbunden=1");
  setProfileCookie(response, joined.token);
  return response;
}
