# AutoMeta

Eine Suche für Gebrauchtwagen aus vielen Fahrzeugbörsen: Suchkriterien einmal eingeben, Angebote aus verschiedenen Quellen in einer einheitlichen Liste vergleichen und per Klick zur Originalanzeige springen.

**Stand:** Phase 2. Echte Angebote kommen von AutoScout24, Kleinanzeigen, Quoka, Autohero und auto.de (siehe „Quellen“). Ohne eingeschaltete Quellen zeigt die Seite generierte Demo-Daten und sagt das oben auch.

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
src/ingest/adapters/   ein Adapter je Quelle: autoscout24, kleinanzeigen, demo
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
| Kleinanzeigen | Kategorie „Autos“, je Marke und gesamt die ersten 5 Seiten (mehr erlaubt die robots.txt nicht, Filter auch nicht) | nur die neuesten Anzeigen; ob privat oder Händler, steht nicht in der Liste. Autos „Zu verschenken“ stehen mit 0 € drin (Anzeige „Zu verschenken“, finden mit „Preis bis 0“). Die Rubrik „Verschenken“ außerhalb von „Autos“ bleibt draußen: Dort stehen fast nur Reifen, Kindersitze und Spielzeug. | 14 Tagen ohne Sichtung |
| Quoka | Kategorie „Automarkt“: die Markenlisten, die die Kategorie verlinkt, und die Kategorie selbst, je die ersten 5 Seiten (`?pag=N`, robots.txt erlaubt Listen und Anzeigen). Schickt Quoka die Kategorie ohne Markenmenü, werden unsere Marken-Slugs als Pfade versucht. | nur die neuesten Anzeigen; Teile und Zubehör ohne Kilometer oder Baujahr fallen weg; ob privat oder Händler, steht nicht in der Liste | 14 Tagen ohne Sichtung |
| Autohero | Die Suche `/de/search/` (zeigt einem Bot nur die ersten rund 20 Autos) und die Modellseiten aus `sitemap_make-model-tree.xml` (`/de/auto/<marke-modell>/`, je bis zu rund 25 Autos), je Lauf 300 davon reihum (robots.txt erlaubt beides) | rund 1.000 Modellseiten, alle paar Stunden einmal durch; Autohero verkauft selbst und bundesweit, daher Händler „Autohero“ und kein Ort | 3 Tagen ohne Sichtung |
| auto.de | Die Angebotsseiten aus `/angebot/sitemap.xml` (`/angebot/<marke>/<modell>/…`), je Lauf 300 davon reihum. Gelesen werden die Daten, die jede Seite für Suchmaschinen mitliefert (schema.org `Car`, rund 15 Autos je Seite). Die Suche `/search/` verbietet die robots.txt, sie wird nie aufgerufen. | rund 2.150 Angebotsseiten, innerhalb eines Tages einmal durch; nur Händlerautos, Neuwagen fallen weg; Ort und Händlername stehen nicht auf diesen Seiten | 3 Tagen ohne Sichtung |
| pkw.de | nichts | Die Seite lädt ihre Angebote erst im Browser über `/api/`, und genau das verbietet ihre robots.txt. | |
| mobile.de | nichts | Die robots.txt verbietet die Suche, und die Seite sperrt unseren Bot (403). | |

Der Bot hält die robots.txt jeder Börse ein (Entscheidung vom 15.11.2026). Gespeichert werden nur Fakten, keine Beschreibungen, Fahrgestellnummern oder Namen privater Verkäufer. Fotos werden nie kopiert: Von jedem Angebot merkt sich AutoMeta nur die Adresse des Vorschaubilds, das die Börse selbst in ihrer Liste zeigt, und zwar nur, wenn es auf dem Bildserver der Börse liegt. Der Browser lädt das Bild direkt von dort. Liefert die Börse es nicht aus, steht ein Platzhalter da. Hat ein Angebot kein Bild, ein Duplikat desselben Fahrzeugs auf einer anderen Börse aber schon, wird dessen Bild gezeigt. Bestehende Angebote bekommen ihr Bild, sobald ein Lauf sie wieder sieht. TÜV/HU: Keine Börse nennt das HU-Datum in ihrer Ergebnisliste als eigenes Feld (auch Kleinanzeigens eigenen TÜV-Filter verbietet die robots.txt). AutoMeta liest es deshalb aus dem Titel („TÜV 05/2027“, „HU bis 5.27“, „TÜV neu“, „2 Jahre TÜV“, „HU abgelaufen“, `src/core/inspection.ts`). „Neu“ zählt ab dem ersten Fund 24 Monate. Steht nichts im Titel und ist das Auto jünger als 3 Jahre, gilt die erste HU 36 Monate nach der Erstzulassung, aber nur bei mindestens 3.000 € und höchstens 10.000 km pro Monat seit der Erstzulassung (sonst ist es Zubehör in der Autorubrik oder ein vertipptes Datum). Der Filter „TÜV/HU“ zeigt nur Angebote mit bekanntem Datum. Such- und Ankaufanzeigen („Suche Golf 7“, „Ankauf aller Fahrzeuge“) und Leasingübernahmen fallen bei Kleinanzeigen und Quoka weg. Marke und Modell werden auch hinter ein paar einleitenden Wörtern erkannt („2023 Skoda Superb“, „Verkaufe Polo“). Hat eine Börse ihr Seitenformat geändert, bricht der Lauf mit einer klaren Meldung ab, statt leere Daten zu speichern, und legt die Seite unter `/admin/quellen` ab. Quoka und Autohero werden ohne feste CSS-Klassen gelesen (`src/ingest/http/cards.ts`): Jeder Link auf eine Anzeige markiert einen Eintrag, Preis, Kilometer, Erstzulassung, Kraftstoff und Ort werden an ihrer Form erkannt („12.990 €“, „98.000 km“, „03/2019“, „10115 Berlin“). Das übersteht die meisten Umbauten einer Börse.

Wie weit AutoScout24 pro Lauf kommt, hängt vom Budget ab: Bei 5 Sekunden Abstand und 500 Abrufen dauert ein Lauf gut 40 Minuten. Autohero und auto.de lesen je Lauf 300 Seiten, also rund 25 Minuten; alle Quellen laufen gleichzeitig. Mit `AUTOSCOUT24_MAKES`, `KLEINANZEIGEN_MAKES` und `QUOKA_MAKES` lassen sich die Marken eingrenzen (Slugs wie `volkswagen,bmw`).

## Eine neue Quelle anbinden

1. Datei in `src/ingest/adapters/` anlegen, die `SourceAdapter` aus `src/ingest/adapter.ts` erfüllt (`fetch` liefert Rohdaten, `normalize` bringt sie ins einheitliche Format).
2. In `src/ingest/adapters/index.ts` registrieren.
3. `npm run ingest -- <quelle>` ausführen.

Regeln für jeden Adapter:

- Nur Fakten speichern (Marke, Modell, Preis, km, Erstzulassung, Ort). Keine Beschreibungstexte und keine Fotos kopieren; die Adresse des Vorschaubilds aus der Liste darf als `imageUrl` mit, geprüft mit `sourceImageUrl(adresse, "<bildserver-domain>")`.
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
- **Echte Angebote:** `nixpacks.toml` setzt für das Deployment `SCRAPE_SOURCES=autoscout24,kleinanzeigen,quoka,autohero,autode`, der Worker läuft also nach jedem Ausrollen ohne weiteren Schritt. Ein eigener Wert für `SCRAPE_SOURCES` in den Umgebungsvariablen der App in Coolify geht vor (zum Beispiel nur `autoscout24`). Der Worker läuft im selben Container, importiert sofort und dann alle `SCRAPE_INTERVAL_MINUTES` Minuten (Standard 60). Stürzt er ab, startet ihn der Container neu, die Website läuft davon unabhängig. Sobald eine echte Quelle Angebote geliefert hat, löscht der Import die Demo-Daten. Die Logs der App zeigen jeden Lauf (`[autoscout24] …`, `duplicates: …`).

- **Quellen-Status:** Mit `ADMIN_TOKEN` (mindestens 16 Zeichen, in den Umgebungsvariablen der App) zeigt `/admin/quellen?token=<ADMIN_TOKEN>` je Quelle die aktiven Angebote, den letzten Lauf mit Fehlermeldung und die letzten Läufe. Ohne `ADMIN_TOKEN` antworten alle `/admin`-Adressen mit 404.
- **Testabruf vom Server:** Auf derselben Seite lässt sich eine Seite der bekannten Börsen (AutoScout24, Kleinanzeigen, Quoka, Autohero, auto.de, pkw.de) über den Server abrufen, auf Wunsch mit den eigenen Skripten der Seite. Es gelten dieselben Regeln wie beim Import (robots.txt, Abstand, Abbruch bei Sperren). Die Antwort wird in `scrape_samples` gespeichert (die neuesten 80) und lässt sich als Text lesen, mit `&grep=` nur um die Treffer herum. So sieht man, was eine Börse unserem Bot wirklich schickt, bevor man einen Adapter baut oder repariert.

Alternativ funktioniert jede andere Postgres-Datenbank, zum Beispiel Supabase. Dort kann die App den gepoolten Connection-String (Transaction-Modus, Port 6543) nutzen. Migrationen brauchen aber eine direkte Verbindung oder den Session-Modus (Port 5432), weil sie eine Sperre über mehrere Transaktionen halten. Dafür `MIGRATION_DATABASE_URL` setzen. Mit Port 6543 bricht `db:migrate` absichtlich ab. Dasselbe gilt für den Import-Worker: Er sperrt jede Quelle über eine Sitzungs-Sperre und braucht deshalb eine direkte Verbindung oder den Session-Modus. Auf Coolify ist die interne Postgres-URL direkt, dort passt alles.
