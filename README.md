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
| `npm run db:prepare` | `db:seed`, solange die Datenbank keine Angebote hat die Demo-Daten importieren, Schadenshinweise alter Angebote nachtragen, Marktwerte und Reparaturschätzungen berechnen (läuft bei jedem Start) |
| `npm run ingest -- autoscout24 kleinanzeigen` | Quellen einmal importieren, danach Dubletten neu gruppieren und Marktwerte berechnen (`demo` für Demo-Daten) |
| `npm run worker` | Hintergrund-Job: importiert und prüft die Quellen aus `SCRAPE_SOURCES` alle `SCRAPE_INTERVAL_MINUTES` Minuten (je höchstens `SCRAPE_RUN_MINUTES`) und baut nebenher die Mängelprofile aus RDW-Daten |
| `npm run defects` | Ein Lauf der Mängelprofile (sonst macht das der Worker), danach die Risikopuffer neu |
| `npm test` | Tests; mit `TEST_DATABASE_URL` auch gegen eine echte Datenbank |
| `npm run lint` / `npm run typecheck` / `npm run build` | Prüfungen wie in der CI |

## Aufbau

```
supabase/migrations/   Datenbankschema (läuft auf Postgres und Supabase)
src/core/              Datenmodell, Marken-/Modellliste, Normalisierung, Geo-Funktionen
src/ingest/            Adapter-Schnittstelle, Import-Lauf, Dubletten, Segmente, Migrationen, Seed
src/ingest/adapters/   ein Adapter je Quelle (autoscout24, kleinanzeigen, quoka, autohero, autode, demo), Einzelprüfung listing-check
src/ingest/http/       PoliteFetcher (Abstand, robots.txt, Abbruch bei Sperren), HTML-Helfer
src/search/            Filter aus der URL lesen, SQL-Suche, PLZ-Auflösung
src/app/               Next.js-Seiten: Suche, Detailseite /angebot/[id], Weiterleitung /go/[id], API /api/search
scripts/               Kommandozeilen-Einstiege für Migration, Seed, Import, Worker und Start
data/                  Postleitzahlen mit Koordinaten (GeoNames, CC BY 4.0)
```

So fließen die Daten: Adapter ruft ab → Rohdaten landen in `raw_listings` → Normalisierung auf das einheitliche Format → `listings`. Jede Quelle wird in einem eigenen Lauf importiert (`ingest_runs`); zwei Läufe derselben Quelle können sich nicht überschneiden. Nach jedem Import gruppiert `updateDuplicates` dasselbe Fahrzeug auf mehreren Börsen (gleiche Marke, Modell und Erstzulassung, km ±2 %, Preis ±8 %, höchstens 25 km entfernt, keine widersprüchliche Leistung, Kraftstoff oder Getriebe). Die Suche zeigt es einmal, zum günstigsten Preis, mit „Auch bei …“ für die anderen Börsen.

Danach berechnet `updateMarketValues` (`src/ingest/market.ts`) für jedes aktive Angebot einen Marktwert: den Median der Preise vergleichbarer intakter Angebote (gleiche Marke und gleiches Modell, Erstzulassung ±1 Jahr, km ±25 % oder mindestens ±15.000 km, gleicher Kraftstoff und gleiches Getriebe, Leistung ±20 %), dazu die mittlere Hälfte als übliche Spanne. Vergleichbar sind aktive und in den letzten 90 Tagen verschwundene Angebote ab 500 € ohne Schadenshinweis und ohne abgelaufene HU, jedes Fahrzeug nur einmal. Unter 5 vergleichbaren Angeboten gibt es keinen Wert. Es sind Angebotspreise, keine Verkaufspreise. Schadenshinweise liest `detectDamage` (`src/core/damage.ts`) aus dem Titel („Motorschaden“, „Getriebe defekt“, „springt nicht an“, „Unfallwagen“, „für Bastler“ …), verneinte und reparierte Schäden („kein Rost“, „Motorschaden behoben“) zählen nicht. Die Suche filtert danach („Zustand laut Titel“) und sortiert nach dem Abstand zum Marktwert. Jede Preisänderung eines Angebots landet per Trigger in `listing_prices` (Preisverlauf auf der Detailseite).

Flip-Bewertung: Der Reparaturkatalog (`src/core/repairs.ts`, Seite `/reparaturen`) beschreibt rund 55 typische Arbeiten mit Stunden für einen Hobbyschrauber, Schwierigkeit 1 bis 5 und Teilepreisen für die Kompaktklasse; alle Werte sind Schätzungen. Jeder Schadenshinweis führt zu Arbeiten (Motorschaden → Gebrauchtmotor, Kupplung → Kupplungssatz …), dazu Aufbereitung und bei abgelaufener HU die HU-Vorbereitung; die Fahrzeugklasse aus Leistung, Typ und Marke skaliert die Teilepreise. `updateRepairEstimates` (`src/ingest/repairs.ts`) speichert für jedes aktive Angebot mit Schadenshinweis Teile, Stunden, Schwierigkeit, Sicherheit und ob es abgeschleppt werden muss. Die Marge rechnet `calculateFlip` (`src/core/flip.ts`): Marktwert × (1 − Verhandlungsabschlag) − Kaufpreis − Teile − Nebenkosten (HU, Zulassung, Abholen oder Abschleppen), geteilt durch die Stunden ergibt den Stundenlohn. Dieselbe Formel steht in SQL für die Sortierungen „Flip: höchster Stundenlohn“ und „Flip: höchste Marge“ und die Filter „Schwierigkeit bis“ und „Flip-Marge ab“. Abschlag, Nebenkosten, Level und Mindestmarge stellt jeder unter `/einstellungen` ein (Cookie im Browser, keine Konten); `/flip` öffnet die Suche mit diesen Werten. Auf der Detailseite rechnet der Flip-Rechner mit änderbaren Werten nach.

Risikopuffer und Modell-Akte (Phase 3): Von der Marge geht ein Risikopuffer ab, gespeichert in `repair_risk_hidden_eur` und `repair_risk_unclear_eur`. **Versteckte Mängel:** `src/ingest/defects` zieht je Modell und Altersgruppe (5–7, 8–10, 11–13, 14–17, 18–25 Jahre) über die offizielle API der niederländischen Zulassungsbehörde RDW (opendata.rdw.nl, CC0) eine Stichprobe von 300 zugelassenen Autos mit gültiger HU und zählt, welche bei der APK der letzten 24 Monate einen Mangel hatten, je Baugruppe (Bremsen, Rost, Fahrwerk …; Zuordnung der niederländischen Mängelnamen in `src/core/defect-codes.ts`). Gespeichert werden nur diese Zählungen (`model_defect_profiles`). Puffer = Anteil mit Mangel × übliche Teilekosten aus dem Katalog, ohne Baugruppen, die die geplante Reparatur abdeckt; ohne Profil zählt der Durchschnitt gleich alter Autos. **Unklarer Schaden:** Bei Hinweisen ohne Ausmaß (Unfall, springt nicht an, Defekt …) gilt ein schlimmerer Fall (`SEVERE_CASES` in `src/core/repairs.ts`) ab 30 % unter Marktwert als zunehmend wahrscheinlich, ab 70 % als sicher. Die Detailseite zeigt die Modell-Akte mit Mängelquoten gegen den Durchschnitt, Schwachstellen und Links zu Forum, ADAC und Videos (nur Links). Der Worker baut die Profile nebenher: höchstens `RDW_MAX_REQUESTS` Abfragen pro Lauf (Standard 600, `RDW_MIN_DELAY_MS` Pause, Standard 2 s, robots.txt wie bei den Börsen), stündlich weiter, solange Profile fehlen, sonst täglich; Profile älter als 90 Tage werden erneuert. `RDW_PROFILES=false` schaltet das ab. Stand und letzter Fehler stehen auf `/reparaturen`.

Tägliche Prüfung: Jedes Angebot soll einmal am Tag geprüft werden, also in der Liste der Börse wieder gesehen oder auf seiner eigenen Seite bestätigt (`last_seen_at`, in der Suche als „geprüft …“, auf der Detailseite als „Zuletzt geprüft“). AutoScout24 liest dafür seinen ganzen Bestand jeden Tag einmal durch (siehe unten). Kleinanzeigen und Quoka lassen per robots.txt nur ihre neuesten Seiten lesen; dort prüft jeder Lauf nach den neuesten Seiten für den Rest seiner Zeit Angebote, die seit 20 Stunden nicht gesehen wurden, einzeln auf ihrer eigenen Seite (`checkListings`, `src/ingest/adapters/listing-check.ts`), die am längsten ungeprüften zuerst. Gespeichert wird davon nur das Ergebnis, nie die Seite (dort stehen Beschreibung und Name privater Verkäufer). 404/410, eine Weiterleitung weg von der Anzeige oder der Hinweis „gelöscht“/„nicht mehr verfügbar“ der Börse (nicht im Text des Verkäufers) heißt verkauft; trägt die Seite die Nummer der Anzeige, ist sie bestätigt; Unklares bleibt, wie es ist, und kommt erst einen Tag später wieder dran (`checked_at`). Sagt eine Gruppe von 25 Prüfungen fast nur „weg“, glaubt der Lauf ihr nicht und hört auf (dann antwortet die Börse vermutlich anders als erwartet). Sperrt die Börse eine Anzeigenseite (401/403/429, Captcha), geht in diesem Lauf keine Anfrage mehr hinaus; was die Listen gezeigt haben, zählt trotzdem, und der Lauf vermerkt „Einzelprüfung abgebrochen“. Der Hinweis über der Suche zeigt je Börse, wie viel Prozent ihrer Angebote in den letzten 24 Stunden geprüft wurden (`sources.checked_24h`, nach jeder Runde gezählt), `/admin/quellen` zeigt dazu die älteste Prüfung, wie viele Angebote in 24 Stunden aus welchem Grund raus sind und wie weit der AutoScout24-Durchlauf ist.

Wann ein Angebot aus der Suche verschwindet (`listings.gone_reason`, `gone_at`):

- Liest ein Adapter den ganzen Bestand (`fullSnapshot`), zählt jedes fehlende Angebot als verpasst. Liest er nur Teile, zählen Fehlende nur in den Teilen, die er vollständig gelesen hat (`completedSegments`). Nach zwei verpassten Läufen hintereinander gilt ein Angebot als verkauft (`missed`).
- Sagt die eigene Seite des Angebots, dass es weg ist, verschwindet es sofort (`checked`).
- Ein Angebot, das `staleAfterDays` Tage weder gesehen noch bestätigt wurde, verschwindet ebenfalls (`stale`): bei AutoScout24 nach 3 Tagen, bei allen anderen nach 2. Ob es verkauft ist, wissen wir dann nicht; die Detailseite sagt das so, und für die Standzeit im Marktwert zählt es nicht.
- Taucht es wieder in einer Liste auf, ist es wieder in der Suche.

## Quellen

| Börse | Was gelesen wird | Abdeckung | Aus der Suche nach |
| --- | --- | --- | --- |
| AutoScout24 | Ergebnislisten `/lst/<marke>` (robots.txt erlaubt sie, Detailseiten nicht) | Je Lauf erst die neuesten Angebote je Marke, dann reihum Marke × Preisbereich, so schnell, dass alle Bereiche in 24 Stunden einmal gelesen sind. Hat ein Bereich mehr Treffer, als die Liste durchblättern lässt, wird er geteilt (`crawl_segments`). | zwei vollständigen Läufen seines Preisbereichs ohne das Angebot, spätestens 3 Tagen ohne Sichtung |
| Kleinanzeigen | Kategorie „Autos“, je Marke, die Suche „verschenken“ und gesamt jeweils die ersten 5 Seiten (mehr erlaubt die robots.txt nicht, Filter auch nicht) | die neuesten Anzeigen; ältere werden einzeln auf ihrer Seite `/s-anzeige/…` geprüft (robots.txt erlaubt sie), etwa 13.000 am Tag; ob privat oder Händler, steht nicht in der Liste. Autos „Zu verschenken“ stehen mit 0 € drin (finden mit „Preis bis 0“). Sie sind selten und rutschen schnell aus den neuesten Seiten, deshalb sucht jeder Lauf in „Autos“ eigens nach „verschenken“. Übernommen wird ein verschenktes Angebot nur, wenn der Titel Marke und Modell nennt und es weder ein Teil (Reifen, Felgen, Sitze, Türen …) noch ein Gesuch ist. Die Rubrik „Verschenken“ außerhalb von „Autos“ bleibt draußen: Auch nach Marken gesucht stehen dort fast nur Teile, Reifen und Spielzeug. | gelöscht laut Anzeige, spätestens 2 Tagen ohne Sichtung oder Bestätigung |
| Quoka | Kategorie „Automarkt“: die Markenlisten, die die Kategorie verlinkt, und die Kategorie selbst, je die ersten 5 Seiten (`?pag=N`, robots.txt erlaubt Listen und Anzeigen). Schickt Quoka die Kategorie ohne Markenmenü, werden unsere Marken-Slugs als Pfade versucht. | die neuesten Anzeigen; ältere werden einzeln auf ihrer Anzeigenseite geprüft (Weiterleitung auf `/Detailansicht-AdNotFound/` heißt weg); Teile und Zubehör ohne Kilometer oder Baujahr fallen weg; ob privat oder Händler, steht nicht in der Liste | gelöscht laut Anzeige, spätestens 2 Tagen ohne Sichtung oder Bestätigung |
| Autohero | Die Suche `/de/search/` (zeigt einem Bot nur die ersten rund 20 Autos) und die Modellseiten aus `sitemap_make-model-tree.xml` (`/de/auto/<marke-modell>/`, je bis zu rund 25 Autos), je Lauf 300 davon reihum (robots.txt erlaubt beides) | rund 1.000 Modellseiten, alle paar Stunden einmal durch; Autohero verkauft selbst und bundesweit, daher Händler „Autohero“ und kein Ort | 2 Tagen ohne Sichtung |
| auto.de | Die Angebotsseiten aus `/angebot/sitemap.xml` (`/angebot/<marke>/<modell>/…`), je Lauf 300 davon reihum. Gelesen werden die Daten, die jede Seite für Suchmaschinen mitliefert (schema.org `Car`, rund 15 Autos je Seite). Die Suche `/search/` verbietet die robots.txt, sie wird nie aufgerufen. | rund 2.150 Angebotsseiten, innerhalb eines Tages einmal durch; nur Händlerautos, Neuwagen fallen weg; Ort und Händlername stehen nicht auf diesen Seiten | 2 Tagen ohne Sichtung |
| pkw.de | nichts | Die Seite lädt ihre Angebote erst im Browser über `/api/`, und genau das verbietet ihre robots.txt. | |
| mobile.de | nichts | Die robots.txt verbietet die Suche, und die Seite sperrt unseren Bot (403). | |

Der Bot hält die robots.txt jeder Börse ein (Entscheidung vom 15.11.2026). Gespeichert werden nur Fakten, keine Beschreibungen, Fahrgestellnummern oder Namen privater Verkäufer. Fotos werden nie kopiert: Von jedem Angebot merkt sich AutoMeta nur die Adresse des Vorschaubilds, das die Börse selbst in ihrer Liste zeigt, und zwar nur, wenn es auf dem Bildserver der Börse liegt. Der Browser lädt das Bild direkt von dort. Liefert die Börse es nicht aus, steht ein Platzhalter da. Hat ein Angebot kein Bild, ein Duplikat desselben Fahrzeugs auf einer anderen Börse aber schon, wird dessen Bild gezeigt. Bestehende Angebote bekommen ihr Bild, sobald ein Lauf sie wieder sieht. TÜV/HU: Keine Börse nennt das HU-Datum in ihrer Ergebnisliste als eigenes Feld (auch Kleinanzeigens eigenen TÜV-Filter verbietet die robots.txt). AutoMeta liest es deshalb aus dem Titel („TÜV 05/2027“, „HU bis 5.27“, „TÜV neu“, „2 Jahre TÜV“, „HU abgelaufen“, `src/core/inspection.ts`). „Neu“ zählt ab dem ersten Fund 24 Monate. Steht nichts im Titel und ist das Auto jünger als 3 Jahre, gilt die erste HU 36 Monate nach der Erstzulassung, aber nur bei mindestens 3.000 €, einer Erstzulassung nicht nach dem aktuellen Monat und, wenn die Kilometer bekannt sind, höchstens 10.000 km pro Monat seit der Erstzulassung (sonst ist es Zubehör in der Autorubrik oder ein vertipptes Datum). Der Filter „TÜV/HU“ zeigt nur Angebote mit bekanntem Datum. Such- und Ankaufanzeigen („Suche Golf 7“, „Ankauf aller Fahrzeuge“) und Leasingübernahmen fallen bei Kleinanzeigen und Quoka weg. Marke und Modell werden auch hinter ein paar einleitenden Wörtern erkannt („2023 Skoda Superb“, „Verkaufe Polo“). Hat eine Börse ihr Seitenformat geändert, bricht der Lauf mit einer klaren Meldung ab, statt leere Daten zu speichern, und legt die Seite unter `/admin/quellen` ab. Quoka und Autohero werden ohne feste CSS-Klassen gelesen (`src/ingest/http/cards.ts`): Jeder Link auf eine Anzeige markiert einen Eintrag, Preis, Kilometer, Erstzulassung, Kraftstoff und Ort werden an ihrer Form erkannt („12.990 €“, „98.000 km“, „03/2019“, „10115 Berlin“). Das übersteht die meisten Umbauten einer Börse.

Tempo: Alle Quellen laufen gleichzeitig, jede höchstens `SCRAPE_RUN_MINUTES` (Standard 50) von jeder Runde aus `SCRAPE_INTERVAL_MINUTES` (Standard 60); der Rest der Runde gehört Dubletten, Marktwerten und Reparaturschätzungen. AutoScout24 wählt seinen Abstand selbst: so kurz, dass alle Bereiche in `SCRAPE_CYCLE_HOURS` (Standard 24) einmal gelesen sind, berechnet aus den zuletzt gemeldeten Trefferzahlen, aber nie unter `SCRAPE_MIN_DELAY_MS` (Standard 2 s) und nie über 5 s. Bei rund 440.000 Angeboten (22.000 Seiten) sind das etwa 2 bis 3 Sekunden. Reicht selbst die Untergrenze nicht, dauert der Durchlauf länger als einen Tag; `/admin/quellen` zeigt das. Kleinanzeigen und Quoka fragen alle 3 Sekunden (rund 15 Minuten neueste Seiten, danach rund 35 Minuten Einzelprüfung, also etwa 550 Anzeigen pro Runde und Börse), Autohero und auto.de alle 5 Sekunden (300 Seiten, rund 25 Minuten). Keine Börse nennt in ihrer robots.txt ein `Crawl-delay` für alle Bots (Stand 21.11.2026); nennt eine eines, gilt das längere. Mit `AUTOSCOUT24_MAKES`, `KLEINANZEIGEN_MAKES` und `QUOKA_MAKES` lassen sich die Marken eingrenzen (Slugs wie `volkswagen,bmw`).

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

- Webseiten nur über `PoliteFetcher` aus `src/ingest/http/fetcher.ts` abrufen. Er nennt sich ehrlich (`SCRAPE_USER_AGENT`), wartet zwischen zwei Abrufen bei derselben Börse (je Quelle eigener Abstand, nie unter `SCRAPE_MIN_DELAY_MS`, das selbst mindestens 1 Sekunde sein muss; längeres `Crawl-delay` gewinnt), hält die robots.txt ein (`SCRAPE_RESPECT_ROBOTS`) und begrenzt jeden Lauf auf `SCRAPE_RUN_MINUTES` Minuten und `SCRAPE_MAX_REQUESTS` Abrufe.
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
