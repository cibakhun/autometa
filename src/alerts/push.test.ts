import { createDecipheriv, createECDH, hkdfSync, randomBytes, type ECDH } from "node:crypto";
import webpush from "web-push";
import { describe, expect, it } from "vitest";
import { isPushServiceHost, parseSubscription, pushOptions } from "./push";

describe("parseSubscription", () => {
  const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

  it("accepts what PushSubscription.toJSON() gives", () => {
    expect(parseSubscription({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", expirationTime: null, keys })).toEqual({
      endpoint: "https://fcm.googleapis.com/fcm/send/abc",
      keys,
    });
  });

  it("rejects anything that cannot be a push subscription", () => {
    expect(parseSubscription(null)).toBeNull();
    expect(parseSubscription({ endpoint: "http://example.com/push", keys })).toBeNull();
    expect(parseSubscription({ endpoint: "not a url", keys })).toBeNull();
    expect(parseSubscription({ endpoint: "https://push.example/x", keys: { p256dh: "a b", auth: "x" } })).toBeNull();
    expect(parseSubscription({ endpoint: "https://push.example/x" })).toBeNull();
  });

  it("only takes endpoints of the browsers' push services", () => {
    for (const endpoint of [
      "https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
      "https://web.push.apple.com/QGuQyavXutnMH",
      "https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
    ]) {
      expect(parseSubscription({ endpoint, keys })?.endpoint).toBe(endpoint);
    }
    for (const endpoint of [
      "https://push.example/x",
      "https://localhost/push",
      "https://10.0.0.5/push",
      "https://fcm.googleapis.com.evil.example/x",
      "https://evilpush.apple.com.example/x",
      "https://fcm.googleapis.com:8443/fcm/send/abc",
      "https://user:pw@fcm.googleapis.com/fcm/send/abc",
    ]) {
      expect(parseSubscription({ endpoint, keys })).toBeNull();
    }
    expect(parseSubscription({ endpoint: "https://push.example/x", keys }, ["push.example"])?.endpoint).toBe("https://push.example/x");
  });

  it("matches push service hosts exactly or below a domain", () => {
    expect(isPushServiceHost("FCM.googleapis.com")).toBe(true);
    expect(isPushServiceHost("web.push.apple.com")).toBe(true);
    expect(isPushServiceHost("push.apple.com")).toBe(false);
    expect(isPushServiceHost("xpush.apple.com")).toBe(false);
    expect(isPushServiceHost("googleapis.com")).toBe(false);
  });
});

/** RFC 8291 (Web Push, aes128gcm), the browser's side: what a push service hands the browser, decrypted. */
function decryptPush(body: Buffer, browser: ECDH, auth: Buffer): string {
  const salt = body.subarray(0, 16);
  const idLength = body[20];
  const serverKey = body.subarray(21, 21 + idLength);
  const record = body.subarray(21 + idLength);
  const secret = browser.computeSecret(serverKey);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), browser.getPublicKey(), serverKey]);
  const ikm = Buffer.from(hkdfSync("sha256", secret, auth, keyInfo, 32));
  const key = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const decipher = createDecipheriv("aes-128-gcm", key, nonce);
  decipher.setAuthTag(record.subarray(record.length - 16));
  const padded = Buffer.concat([decipher.update(record.subarray(0, record.length - 16)), decipher.final()]);
  // The last record ends with the delimiter 0x02, then padding zeros.
  return padded.subarray(0, padded.lastIndexOf(2)).toString("utf8");
}

describe("push request", () => {
  it("is encrypted for the browser's keys and signed with our VAPID key", async () => {
    const browser = createECDH("prime256v1");
    browser.generateKeys();
    const auth = randomBytes(16);
    const vapid = webpush.generateVAPIDKeys();
    const subscription = {
      endpoint: "https://push.example/send/123",
      keys: { p256dh: browser.getPublicKey().toString("base64url"), auth: auth.toString("base64url") },
    };
    const payload = JSON.stringify({ title: "3 neu: VW Golf", body: "Golf · 2.500 €", url: "/suchauftraege/1/neu" });

    const request = webpush.generateRequestDetails(subscription, payload, pushOptions(vapid));
    expect(request.endpoint).toBe(subscription.endpoint);
    expect(request.headers.TTL).toBe(12 * 3600);
    expect(request.headers.Urgency).toBe("high");
    expect(String(request.headers.Authorization)).toMatch(new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`));

    expect(JSON.parse(decryptPush(request.body as Buffer, browser, auth))).toEqual(JSON.parse(payload));
  });
});
