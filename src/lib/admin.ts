import { timingSafeEqual } from "node:crypto";

/**
 * Access to the admin pages (/admin/...). They exist only when ADMIN_TOKEN is set (at least 16
 * characters); otherwise every admin URL answers 404. The token comes as ?token=... and is
 * compared in constant time.
 */

export const MIN_TOKEN_LENGTH = 16;

export function adminToken(value = process.env.ADMIN_TOKEN): string | null {
  const token = value?.trim();
  return token && token.length >= MIN_TOKEN_LENGTH ? token : null;
}

export function isAdminRequest(request: Request, expected = adminToken()): boolean {
  if (!expected) return false;
  const given = new URL(request.url).searchParams.get("token") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Headers for every admin answer: never cached, never indexed, no token in a Referer. */
export const ADMIN_HEADERS = {
  "Cache-Control": "no-store",
  "X-Robots-Tag": "noindex, nofollow",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
} as const;

export function notFound(): Response {
  return new Response("Not found", { status: 404, headers: ADMIN_HEADERS });
}

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
