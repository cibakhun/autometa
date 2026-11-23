"use client";

import { useEffect, useState } from "react";
import { serialFetch } from "@/lib/serial-fetch";

type State =
  | "checking"
  /** No service worker or Push API (old browser, or iPhone without "Zum Home-Bildschirm"). */
  | "unsupported"
  | "off"
  | "on"
  | "denied";

function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function register(): Promise<ServiceWorkerRegistration> {
  await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

const postSubscription = (subscription: PushSubscription) =>
  serialFetch("/api/push", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ subscription: subscription.toJSON() }),
  });

/**
 * Switches pushes on or off for this browser. Pushes come through the browser's own push service
 * (Web Push), so nothing to install besides, except on an iPhone: there only from the home screen.
 */
export function PushSetup({ publicKey, otherDevices }: { publicKey: string; otherDevices: number }) {
  const [state, setState] = useState<State>("checking");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [ios, setIos] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function check() {
      const isIos = /iPhone|iPad|iPod/.test(navigator.userAgent);
      if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return { isIos, state: "unsupported" as const };
      if (Notification.permission === "denied") return { isIos, state: "denied" as const };
      const registration = await register();
      const subscription = await registration.pushManager.getSubscription();
      // The server may not know it (yet): after joining another profile, for example.
      // Best effort: offline or a server error must not hide the switch.
      if (subscription) await postSubscription(subscription).catch(() => undefined);
      return { isIos, state: subscription && Notification.permission === "granted" ? ("on" as const) : ("off" as const) };
    }
    check()
      .catch(() => ({ isIos: false, state: "unsupported" as const }))
      .then((result) => {
        if (cancelled) return;
        setIos(result.isIos);
        setState(result.state);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function enable() {
    setBusy(true);
    setMessage(null);
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        return;
      }
      const registration = await register();
      const subscription =
        (await registration.pushManager.getSubscription()) ??
        (await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) }));
      const response = await postSubscription(subscription);
      if (!response.ok) throw new Error("Der Server hat das Abo nicht angenommen.");
      setState("on");
      setMessage("Benachrichtigungen sind an. Tipp auf „Test senden“, um es auszuprobieren.");
    } catch (reason) {
      setMessage(`Hat nicht geklappt: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function disable() {
    setBusy(true);
    setMessage(null);
    try {
      const registration = await navigator.serviceWorker.ready;
      const subscription = await registration.pushManager.getSubscription();
      if (subscription) {
        const response = await fetch("/api/push", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ endpoint: subscription.endpoint }),
        });
        if (!response.ok) throw new Error("Der Server hat das Abo nicht entfernt.");
        await subscription.unsubscribe();
      }
      setState("off");
    } catch (reason) {
      setMessage(`Hat nicht geklappt: ${reason instanceof Error ? reason.message : String(reason)}`);
    } finally {
      setBusy(false);
    }
  }

  async function test() {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/push/test", { method: "POST" });
      const data = (await response.json()) as { sent: number; failed: number; error?: string };
      setMessage(
        data.error
          ? data.error
          : data.sent > 0
          ? `Gesendet an ${data.sent} ${data.sent === 1 ? "Gerät" : "Geräte"}${data.failed > 0 ? `, ${data.failed} nicht erreicht` : ""}. Kommt nichts an, prüfe die Mitteilungs-Einstellungen des Geräts.`
          : "Kein Gerät erreicht. Schalte die Benachrichtigungen aus und wieder ein.",
      );
    } catch {
      setMessage("Test fehlgeschlagen.");
    } finally {
      setBusy(false);
    }
  }

  const button = "rounded-md px-3 py-1.5 text-sm font-medium disabled:opacity-60";
  return (
    <div>
      {state === "checking" && <p className="text-sm text-muted">Prüfe, ob dieser Browser Benachrichtigungen kann …</p>}
      {state === "unsupported" &&
        (ios ? (
          <p className="text-sm">
            Auf dem iPhone kommen Benachrichtigungen nur über die Home-Bildschirm-App: in Safari auf <strong>Teilen</strong> tippen, dann{" "}
            <strong>„Zum Home-Bildschirm“</strong>, AutoMeta von dort öffnen und hier einschalten (ab iOS 16.4).
          </p>
        ) : (
          <p className="text-sm">Dieser Browser kann keine Benachrichtigungen empfangen. Chrome, Edge, Firefox und Safari können es.</p>
        ))}
      {state === "denied" && (
        <p className="text-sm">
          Benachrichtigungen sind für AutoMeta in diesem Browser blockiert. Erlaube sie in den Website-Einstellungen (Schloss-Symbol neben der
          Adresse) und lade die Seite neu.
        </p>
      )}
      {state === "off" && (
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={enable} disabled={busy} className={`${button} bg-accent text-on-accent hover:bg-accent-strong`}>
            Benachrichtigungen auf diesem Gerät einschalten
          </button>
          {otherDevices > 0 && <span className="text-sm text-muted">An auf {otherDevices} anderen {otherDevices === 1 ? "Gerät" : "Geräten"}.</span>}
        </div>
      )}
      {state === "on" && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="inline-flex items-center gap-1.5 text-sm font-medium text-good-text">
            <svg viewBox="0 0 24 24" className="h-4 w-4" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M5 12.5l4.5 4.5L19 7.5" />
            </svg>
            An auf diesem Gerät
          </span>
          <button type="button" onClick={test} disabled={busy} className={`${button} border border-line hover:border-accent`}>
            Test senden
          </button>
          <button type="button" onClick={disable} disabled={busy} className={`${button} text-muted hover:text-accent`}>
            Ausschalten
          </button>
        </div>
      )}
      {message && (
        <p role="status" className="mt-2 text-sm text-muted">
          {message}
        </p>
      )}
    </div>
  );
}
