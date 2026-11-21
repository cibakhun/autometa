import type { ProbeOutcome } from "@/ingest/probe";
import { PROBE_DOMAINS } from "@/ingest/probe";
import type { SampleInfo } from "@/ingest/samples";
import type { RunInfo, SourceHealth } from "@/ingest/status";
import { escapeHtml as e } from "./admin";

/** Plain server-rendered HTML for the admin pages: no client code, works in any browser. */

const STYLE = `
  :root { color-scheme: light dark; --muted: #6b7280; --line: #d1d5db; --bad: #b91c1c; --ok: #15803d; }
  @media (prefers-color-scheme: dark) { :root { --muted: #9ca3af; --line: #374151; --bad: #f87171; --ok: #4ade80; } }
  body { font: 14px/1.45 system-ui, sans-serif; margin: 0 auto; max-width: 1200px; padding: 16px; }
  h1 { font-size: 20px; } h2 { font-size: 16px; margin-top: 28px; }
  table { border-collapse: collapse; width: 100%; font-variant-numeric: tabular-nums; }
  th, td { border-bottom: 1px solid var(--line); padding: 4px 8px; text-align: left; vertical-align: top; }
  td.n { text-align: right; } .muted { color: var(--muted); } .bad { color: var(--bad); } .ok { color: var(--ok); }
  .url { word-break: break-all; } form { display: flex; gap: 8px; flex-wrap: wrap; align-items: center; }
  input[type=url] { flex: 1 1 420px; padding: 6px; } button { padding: 6px 12px; }
  .scroll { overflow-x: auto; }
`;

function page(title: string, body: string): string {
  return `<!doctype html><html lang="de"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>${e(title)}</title><style>${STYLE}</style></head><body>${body}</body></html>`;
}

function time(value: string | null): string {
  if (!value) return "–";
  return new Date(value).toLocaleString("de-DE", { timeZone: "Europe/Berlin", dateStyle: "short", timeStyle: "medium" });
}

function withToken(path: string, token: string, params: Record<string, string> = {}): string {
  const search = new URLSearchParams({ ...params, token });
  return `${path}?${search.toString()}`;
}

const num = (n: number) => n.toLocaleString("de-DE");
const share = (part: number, whole: number) => (whole > 0 ? `${Math.floor((part / whole) * 100)} %` : "–");

function runCells(run: RunInfo | null): string {
  if (!run) return `<td colspan="6" class="muted">noch kein Lauf</td>`;
  const state = run.error
    ? `<span class="bad">Fehler: ${e(run.error.slice(0, 300))}</span>`
    : run.finishedAt
      ? `<span class="ok">fertig</span>`
      : "läuft";
  return `<td>${time(run.startedAt)}</td><td class="n">${run.fetched}</td><td class="n">${run.upserted}</td><td class="n">${run.checked}</td><td class="n">${run.gone}</td><td>${state}</td>`;
}

/** How fresh a source's listings are and how its crawl plan is doing. */
function checkCells(s: SourceHealth): string {
  const gone = s.goneLastDay;
  const plan = s.plan
    ? `${num(s.plan.readLastDay)} von ${num(s.plan.segments)} Bereichen in 24 h ganz gelesen (${num(s.plan.listed)} Angebote laut Börse)` +
      (s.plan.neverRead > 0 ? `, ${num(s.plan.neverRead)} noch nie ganz` : `, ältester ${time(s.plan.oldestReadAt)}`)
    : "–";
  return `<td class="n">${num(s.checked24h)} (${share(s.checked24h, s.activeListings)})</td><td>${time(s.oldestCheckAt)}</td><td class="n">${num(gone.missed)} / ${num(gone.checked)} / ${num(gone.stale)}</td><td>${plan}</td>`;
}

export function renderStatusPage(input: {
  token: string;
  sources: SourceHealth[];
  runs: RunInfo[];
  samples: SampleInfo[];
}): string {
  const { token } = input;
  const sources = input.sources
    .map(
      (s) =>
        `<tr><td><b>${e(s.name)}</b><br><span class="muted">${e(s.id)} · ${e(s.kind)}</span></td><td class="n">${num(s.activeListings)}</td><td class="n">${num(s.goneListings)}</td><td>${time(s.lastSuccessAt)}</td>${runCells(s.lastRun)}</tr>`,
    )
    .join("");
  const checks = input.sources.map((s) => `<tr><td><b>${e(s.name)}</b></td>${checkCells(s)}</tr>`).join("");
  const runs = input.runs
    .map((r) => `<tr><td>${e(r.sourceId)}</td>${runCells(r)}<td>${time(r.finishedAt)}</td></tr>`)
    .join("");
  const samples = input.samples
    .map(
      (s) =>
        `<tr><td class="n">${s.id}</td><td>${time(s.capturedAt)}</td><td>${e(s.reason)}${s.sourceId ? ` (${e(s.sourceId)})` : ""}</td><td class="n">${s.status}</td><td class="n">${s.length.toLocaleString("de-DE")}${s.truncated ? " (gekürzt)" : ""}</td><td class="url"><a href="${e(withToken(`/admin/quellen/samples/${s.id}`, token))}">${e(s.url)}</a></td></tr>`,
    )
    .join("");

  return page(
    "Quellen-Status",
    `<h1>Quellen-Status</h1>
<p class="muted">Zeiten in deutscher Zeit. Diese Seite ist nur mit dem Admin-Token erreichbar.</p>
<div class="scroll"><table><thead><tr><th>Quelle</th><th>aktiv</th><th>weg</th><th>letzter Import mit Daten</th><th>letzter Lauf</th><th>gelesen</th><th>gespeichert</th><th>einzeln geprüft</th><th>weg</th><th>Zustand</th></tr></thead><tbody>${sources || `<tr><td colspan="10" class="muted">keine Quellen</td></tr>`}</tbody></table></div>

<h2 id="pruefung">Tägliche Prüfung</h2>
<p class="muted">Geprüft heißt: in der Liste der Börse gesehen oder auf der Anzeige selbst bestätigt. Raus in 24 h: in vollständig gelesenen Bereichen zweimal gefehlt (verkauft) / laut eigener Seite gelöscht / zu lange nicht bestätigt.</p>
<div class="scroll"><table><thead><tr><th>Quelle</th><th>in 24 h geprüft</th><th>älteste Prüfung</th><th>raus in 24 h</th><th>Durchlauf der Bereiche</th></tr></thead><tbody>${checks || `<tr><td colspan="5" class="muted">keine Quellen</td></tr>`}</tbody></table></div>

<h2 id="probe">Testabruf vom Server</h2>
<p class="muted">Holt eine Seite über denselben höflichen Abruf wie der Import (robots.txt, Abstand, Abbruch bei Sperren) und speichert sie unten. Erlaubt: ${e(PROBE_DOMAINS.join(", "))}.</p>
<form method="get" action="/admin/quellen/probe"><input type="hidden" name="token" value="${e(token)}"><input type="url" name="url" required placeholder="https://www.quoka.de/anzeigen/auto-motorrad/automarkt/"><label><input type="checkbox" name="scripts" value="1"> Skripte mitladen</label><button>Abrufen</button></form>

<h2 id="samples">Gespeicherte Seiten</h2>
<p class="muted">Ansicht als Text; <code>&amp;grep=Muster</code> zeigt nur die Stellen um die Treffer, <code>&amp;from=…&amp;len=…</code> einen Ausschnitt.</p>
<div class="scroll"><table><thead><tr><th>#</th><th>Zeit</th><th>Anlass</th><th>HTTP</th><th>Zeichen</th><th>URL</th></tr></thead><tbody>${samples || `<tr><td colspan="6" class="muted">noch keine</td></tr>`}</tbody></table></div>

<h2>Letzte Läufe</h2>
<div class="scroll"><table><thead><tr><th>Quelle</th><th>Start</th><th>gelesen</th><th>gespeichert</th><th>einzeln geprüft</th><th>weg</th><th>Zustand</th><th>Ende</th></tr></thead><tbody>${runs || `<tr><td colspan="8" class="muted">noch keine</td></tr>`}</tbody></table></div>`,
  );
}

export function renderProbeResult(input: { token: string; url: string; outcomes: ProbeOutcome[] }): string {
  const rows = input.outcomes
    .map((o) =>
      o.error
        ? `<tr><td class="url">${e(o.url)}</td><td class="bad">${e(o.error)}</td></tr>`
        : `<tr><td class="url"><a href="${e(withToken(`/admin/quellen/samples/${o.sampleId}`, input.token))}">${e(o.url)}</a></td><td class="ok">HTTP ${o.status}, gespeichert als #${o.sampleId}</td></tr>`,
    )
    .join("");
  return page(
    "Testabruf",
    `<h1>Testabruf</h1><p class="url">${e(input.url)}</p><table><tbody>${rows}</tbody></table><p><a href="${e(withToken("/admin/quellen", input.token))}#samples">Zurück zum Quellen-Status</a></p>`,
  );
}
