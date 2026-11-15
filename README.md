# AutoMeta

Eine Suche für Gebrauchtwagen aus vielen Fahrzeugbörsen: Suchkriterien einmal eingeben, Angebote aus verschiedenen Quellen in einer einheitlichen Liste vergleichen und per Klick zur Originalanzeige springen.

**Stand:** Phase 2. Echte Angebote kommen von AutoScout24 und Kleinanzeigen (siehe „Quellen“). Ohne eingeschaltete Quellen zeigt die Seite generierte Demo-Daten und sagt das oben auch.

## Schnellstart

Voraussetzungen: Node.js 22 und eine Postgres-Datenbank (lokal per Docker oder Supabase).

```bash
npm install
cp .env.example .env.local      # DATABASE_URL anpassen, falls nötig
docker compose up -d            # lokale Postgres-Datenbank (optional)
npm run db:setup                # Schema anlegen, Marken/Modelle/PLZ laden, Demo-Daten importieren
npm run dev                     # http://localhost:3000
```

## Befehle

| Befehl | Zweck |
| --- | --- |
| `npm run dev` | Entwicklungsserver |
| `npm run db:migrate` | SQL-Migrationen aus `supabase/migrations` anwenden |
| `npm run db:seed` | Marken- und Modellliste sowie bekannte Postleitzahlen schreiben |
| `npm run db:prepare` | `db:seed` und, solange die Datenbank keine Angebote hat, die Demo-Daten importieren (läuft bei jedem Start) |
| `npm run ingest -- autoscout24 kleinanzeigen` | Quellen einmal importieren, danach Dubletten neu gruppieren (`demo` für Demo-Daten) |
| `npm run worker` | Hintergrund-Job: importiert die Quellen aus `SCRAPE_SOURCES` alle `SCRAPE_INTERVAL_MINUTES` Minuten |
| `npm test` | Tests; mit `TEST_DATABASE_URL` auch gegen eine echte Datenbank |
| `npm run lint` / `npm run typecheck` / `npm run build` | Prüfungen wie in der CI |

## Aufbau

```
supabase/migrations/   Datenbankschema (läuft auf Postgres und Supabase)
src/core/              Datenmodell, Marken-/Modellliste, Normalisierung, Geo-Funktionen
src/ingest/            Adapter-Schnittstelle, Import-Lauf, Dubletten, Segmente, Migrationen, Seed
src/ingest/adapters/   ein Adapter je Quelle: autoscout24, kleinanzeigen, mobilede (offizielle API), demo
src/ingest/http/       PoliteFetcher (Abstand, robots.txt, Abbruch bei Sperren), HTML-Helfer
src/search/            Filter aus der URL lesen, SQL-Suche, PLZ-Auflösung
src/app/               Next.js-Seiten: Suche, Detailseite /angebot/[id], Weiterleitung /go/[id], API /api/search
scripts/               Kommandozeilen-Einstiege für Migration, Seed, Import, Worker und Start
data/                  Postleitzahlen mit Koordinaten (GeoNames, CC BY 4.0)
```

So fließen die Daten: Adapter ruft ab → Rohdaten landen in `raw_listings` → Normalisierung auf das einheitliche Format → `listings`. Jede Quelle wird in einem eigenen Lauf importiert (`ingest_runs`); zwei Läufe derselben Quelle können sich nicht überschneiden. Nach jedem Import gruppiert `updateDuplicates` dasselbe Fahrzeug auf mehreren Börsen (gleiche Marke, Modell und Erstzulassung, km ±2 %, Preis ±8 %, höchstens 25 km entfernt, keine widersprüchliche Leistung, Kraftstoff oder Getriebe). Die Suche zeigt es einmal, zum günstigsten Preis, mit „Auch bei …“ für die anderen Börsen.

Wann ein Angebot aus der Suche verschwindet:

- Liest ein Adapter den ganzen Bestand (`fullSnapshot`), zählt jedes fehlende Angebot als verpasst. Liest er nur Teile, zählen Fehlende nur in den Teilen, die er vollständig gelesen hat (`completedSegments`). Nach zwei verpassten Läufen hintereinander gilt ein Angebot als verkauft.
- Zusätzlich verschwindet ein Angebot, das ein Adapter `staleAfterDays` Tage nicht mehr gesehen hat.

## Quellen

| Börse | Was gelesen wird | Abdeckung | Aus der Suche nach |
| --- | --- | --- | --- |
| AutoScout24 | Ergebnislisten `/lst/<marke>` (robots.txt erlaubt sie, Detailseiten nicht) | Je Lauf erst die neuesten Angebote je Marke, dann reihum Marke × Preisbereich. Hat ein Bereich mehr Treffer, als die Liste durchblättern lässt, wird er geteilt (`crawl_segments`). | zwei vollständigen Läufen seines Preisbereichs ohne das Angebot, spätestens 30 Tagen |
| Kleinanzeigen | Kategorie „Autos“, je Marke und gesamt die ersten 5 Seiten (mehr erlaubt die robots.txt nicht, Filter auch nicht) | nur die neuesten Anzeigen; ob privat oder Händler, steht nicht in der Liste | 14 Tagen ohne Sichtung |
| mobile.de | nur über die offizielle [Search-API](https://services.mobile.de/docs/search-api.html) mit einem API-Account von mobile.de | wie AutoScout24: neueste Änderungen je Marke, dann Marke × Preisbereich (höchstens 2000 Treffer je Abfrage, 100 je Seite). Läuft erst, wenn `MOBILE_DE_API_USER` und `MOBILE_DE_API_PASSWORD` gesetzt sind. | zwei vollständigen Läufen seines Preisbereichs ohne das Angebot, spätestens 30 Tagen |

Der Bot hält die robots.txt jeder Börse ein (Entscheidung vom 15.11.2026). Gespeichert werden nur Fakten, keine Fotos, Beschreibungen oder Namen privater Verkäufer. Hat eine Börse ihr Seitenformat geändert, bricht der Lauf mit einer klaren Meldung ab, statt leere Daten zu speichern.

mobile.de wird nie gescrapt: Die AGB verbieten es (§ 11), die robots.txt sperrt die Suche, und die Seite sperrt Bots (403). Den API-Account vergibt der mobile.de-Kundenservice ([API-Übersicht](https://services.mobile.de/)). Die API liefert auch Telefonnummern und E-Mail-Adressen der Verkäufer; der Adapter speichert sie nicht.

Wie weit AutoScout24 pro Lauf kommt, hängt vom Budget ab: Bei 5 Sekunden Abstand und 500 Abrufen dauert ein Lauf gut 40 Minuten. Bei mobile.de liegen standardmäßig 1 Sekunde zwischen zwei Abfragen und höchstens 1000 Abfragen je Lauf (`MOBILE_DE_MIN_DELAY_MS`, `MOBILE_DE_MAX_REQUESTS`), das sind bis zu 100.000 Angebote. Mit `AUTOSCOUT24_MAKES`, `KLEINANZEIGEN_MAKES` und `MOBILE_DE_MAKES` lassen sich die Marken eingrenzen (Slugs wie `volkswagen,bmw`).

## Eine neue Quelle anbinden

1. Datei in `src/ingest/adapters/` anlegen, die `SourceAdapter` aus `src/ingest/adapter.ts` erfüllt (`fetch` liefert Rohdaten, `normalize` bringt sie ins einheitliche Format).
2. In `src/ingest/adapters/index.ts` registrieren.
3. `npm run ingest -- <quelle>` ausführen.

Regeln für jeden Adapter:

- Nur Fakten speichern (Marke, Modell, Preis, km, Erstzulassung, Ort). Keine Fotos und keine Beschreibungstexte kopieren.
- Keine Namen oder Kontaktdaten privater Verkäufer speichern.
- Niemals Bot-Schutz, Captchas oder Logins umgehen.
- Jedes Angebot verlinkt auf die Originalanzeige.

Zusätzlich für Scraper (Quellen ohne Schnittstelle):

- Webseiten nur über `PoliteFetcher` aus `src/ingest/http/fetcher.ts` abrufen. Er nennt sich ehrlich (`SCRAPE_USER_AGENT`), wartet zwischen zwei Abrufen bei derselben Börse (`SCRAPE_MIN_DELAY_MS`, mindestens 1 Sekunde, längeres `Crawl-delay` gewinnt), hält die robots.txt ein (`SCRAPE_RESPECT_ROBOTS`) und begrenzt die Abrufe pro Lauf (`SCRAPE_MAX_REQUESTS`).
- Meldet eine Börse 401, 403 oder 429, zeigt ein Captcha oder leitet auf eine Anmeldung um, bricht der Lauf sofort ab (`BlockedError`). Das gilt auch, wenn schon die robots.txt so antwortet. Nicht erneut versuchen, keine anderen IPs oder Browser-Kennungen.
- Weiterleitungen folgt der Fetcher selbst (höchstens 5). Jeder Schritt zählt als eigener Abruf, wartet seinen Abstand ab und muss von der robots.txt seines Hosts erlaubt sein.
- `kind: "scrape"` setzen und `fullSnapshot: false`, solange der Adapter nicht wirklich den ganzen Bestand liest. Sonst würden nicht gelesene Angebote fälschlich als verkauft markiert.

## Deployment (Coolify über AgencyOS)

AutoMeta läuft wie die anderen AgencyOS-Projekte als Coolify-App, die AgencyOS beim Anlegen des Projekts erstellt hat: Branch `main`, Nixpacks, Port 3000.

- **Build:** `nixpacks.toml` legt wie bei AgencyOS Node 22, `npm ci`, `npm run build` und `npm run start` fest. Der Build braucht keine Datenbank.
- **Datenbank:** eine PostgreSQL-Ressource im selben Coolify-Projekt. Ihre interne URL kommt als `DATABASE_URL` in die Umgebungsvariablen der App, in Coolify oder im AgencyOS-Projekt.
- **Start:** `npm run start` führt die Migrationen aus, schreibt Marken, Modelle und PLZ und importiert die Demo-Angebote, solange die Datenbank noch keine Angebote hat. Danach startet Next.js und, wenn `SCRAPE_SOURCES` gesetzt ist, daneben der Import-Worker. Schlägt ein Schritt vor dem Start fehl, startet der neue Container nicht und die alte Version läuft weiter. Ein Terminal oder ein Pre-deployment command ist nicht nötig.
- **Ausrollen:** den Pull Request in AgencyOS mit „Merge to Main“ zusammenführen und danach unter „Deployments“ ein Deployment starten. AgencyOS legt die App ohne GitHub-Webhook an, ein Push auf `main` allein rollt also nichts aus, solange in Coolify keiner eingerichtet ist.
- **Domain:** die automatische sslip.io-Adresse ist von außen nicht erreichbar. Für eine öffentliche Adresse eine Subdomain in Cloudflare (proxied) auf den Server zeigen lassen und dieselbe Adresse bei der App als Domain eintragen.
- **Echte Angebote einschalten:** in den Umgebungsvariablen der App `SCRAPE_SOURCES=autoscout24,kleinanzeigen` setzen und neu ausrollen. Der Worker läuft im selben Container, importiert sofort und dann alle `SCRAPE_INTERVAL_MINUTES` Minuten (Standard 60). Stürzt er ab, startet ihn der Container neu, die Website läuft davon unabhängig. Sobald eine echte Quelle Angebote geliefert hat, löscht der Import die Demo-Daten. Die Logs der App zeigen jeden Lauf (`[autoscout24] …`, `duplicates: …`).
- **mobile.de einschalten:** sobald mobile.de einen API-Account freigeschaltet hat, `MOBILE_DE_API_USER` und `MOBILE_DE_API_PASSWORD` in den Umgebungsvariablen der App setzen (als Secret), `mobilede` zu `SCRAPE_SOURCES` hinzufügen und neu ausrollen. Fehlen die Zugangsdaten, meldet der Lauf das im Log, die anderen Quellen laufen weiter. Lehnt mobile.de die Zugangsdaten ab (401/403) oder bremst (429), bricht der Lauf sofort ab.

Alternativ funktioniert jede andere Postgres-Datenbank, zum Beispiel Supabase. Dort kann die App den gepoolten Connection-String (Transaction-Modus, Port 6543) nutzen. Migrationen brauchen aber eine direkte Verbindung oder den Session-Modus (Port 5432), weil sie eine Sperre über mehrere Transaktionen halten. Dafür `MIGRATION_DATABASE_URL` setzen. Mit Port 6543 bricht `db:migrate` absichtlich ab. Dasselbe gilt für den Import-Worker: Er sperrt jede Quelle über eine Sitzungs-Sperre und braucht deshalb eine direkte Verbindung oder den Session-Modus. Auf Coolify ist die interne Postgres-URL direkt, dort passt alles.
