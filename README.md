# AutoMeta

Eine Suche für Gebrauchtwagen aus vielen Fahrzeugbörsen: Suchkriterien einmal eingeben, Angebote aus verschiedenen Quellen in einer einheitlichen Liste vergleichen und per Klick zur Originalanzeige springen.

**Stand:** Phase 1. Suche, Filter, Detailseite und Weiterleitung laufen mit generierten Demo-Daten. Echte Quellen folgen, sobald der Datenzugang geklärt ist.

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
| `npm run ingest -- demo` | Eine Quelle importieren (hier: Demo-Daten) |
| `npm test` | Tests; mit `TEST_DATABASE_URL` auch gegen eine echte Datenbank |
| `npm run lint` / `npm run typecheck` / `npm run build` | Prüfungen wie in der CI |

## Aufbau

```
supabase/migrations/   Datenbankschema (läuft auf Postgres und Supabase)
src/core/              Datenmodell, Marken-/Modellliste, Normalisierung, Geo-Funktionen
src/ingest/            Adapter-Schnittstelle, Import-Lauf, Migrationen, Seed
src/ingest/adapters/   ein Adapter je Quelle (aktuell: demo)
src/search/            Filter aus der URL lesen, SQL-Suche, PLZ-Auflösung
src/app/               Next.js-Seiten: Suche, Detailseite /angebot/[id], Weiterleitung /go/[id], API /api/search
scripts/               Kommandozeilen-Einstiege für Migration, Seed und Import
```

So fließen die Daten: Adapter ruft ab → Rohdaten landen in `raw_listings` → Normalisierung auf das einheitliche Format → `listings`. Jede Quelle wird in einem eigenen Lauf importiert (`ingest_runs`). Fehlt ein Angebot in zwei vollständigen Läufen hintereinander, gilt es als verkauft und verschwindet aus der Suche.

## Eine neue Quelle anbinden

1. Datei in `src/ingest/adapters/` anlegen, die `SourceAdapter` aus `src/ingest/adapter.ts` erfüllt (`fetch` liefert Rohdaten, `normalize` bringt sie ins einheitliche Format).
2. In `src/ingest/adapters/index.ts` registrieren.
3. `npm run ingest -- <quelle>` ausführen.

Regeln für jeden Adapter:

- Nur Fakten speichern (Marke, Modell, Preis, km, Erstzulassung, Ort). Keine Fotos und keine Beschreibungstexte kopieren.
- Keine Namen oder Kontaktdaten privater Verkäufer speichern.
- Nur Quellen mit Erlaubnis oder offizieller Schnittstelle. Niemals Bot-Schutz, Captchas oder Logins umgehen.
- Jedes Angebot verlinkt auf die Originalanzeige.

## Deployment (Coolify über AgencyOS)

AutoMeta läuft wie die anderen AgencyOS-Projekte als Coolify-App, die AgencyOS beim Anlegen des Projekts erstellt hat: Branch `main`, Nixpacks, Port 3000.

- **Build:** `nixpacks.toml` legt wie bei AgencyOS Node 22, `npm ci`, `npm run build` und `npm run start` fest. Der Build braucht keine Datenbank.
- **Datenbank:** eine PostgreSQL-Ressource im selben Coolify-Projekt. Ihre interne URL kommt als `DATABASE_URL` in die Umgebungsvariablen der App, in Coolify oder im AgencyOS-Projekt.
- **Start:** `npm run start` führt die Migrationen aus, schreibt Marken, Modelle und PLZ und importiert die Demo-Angebote, solange die Datenbank noch keine Angebote hat. Erst danach startet Next.js. Schlägt ein Schritt fehl, startet der neue Container nicht und die alte Version läuft weiter. Ein Terminal oder ein Pre-deployment command ist nicht nötig.
- **Ausrollen:** den Pull Request in AgencyOS mit „Merge to Main“ zusammenführen und danach unter „Deployments“ ein Deployment starten. AgencyOS legt die App ohne GitHub-Webhook an, ein Push auf `main` allein rollt also nichts aus, solange in Coolify keiner eingerichtet ist.
- **Domain:** die automatische sslip.io-Adresse ist von außen nicht erreichbar. Für eine öffentliche Adresse eine Subdomain in Cloudflare (proxied) auf den Server zeigen lassen und dieselbe Adresse bei der App als Domain eintragen.
- **Importe regelmäßig:** in Coolify unter „Scheduled Tasks“ je Quelle einen Befehl wie `npm run ingest -- demo` mit einem Cron-Ausdruck anlegen.

Alternativ funktioniert jede andere Postgres-Datenbank, zum Beispiel Supabase. Dort kann die App den gepoolten Connection-String (Transaction-Modus, Port 6543) nutzen. Migrationen brauchen aber eine direkte Verbindung oder den Session-Modus (Port 5432), weil sie eine Sperre über mehrere Transaktionen halten. Dafür `MIGRATION_DATABASE_URL` setzen. Mit Port 6543 bricht `db:migrate` absichtlich ab.
