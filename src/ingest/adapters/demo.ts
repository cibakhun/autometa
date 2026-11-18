import {
  normalizeBodyType,
  normalizeFuel,
  normalizeTransmission,
  parseFirstRegistration,
  parseInteger,
  parsePowerKw,
  resolveMakeModel,
} from "@/core/normalize";
import { PLACES } from "@/core/places";
import type { RawListing, SourceAdapter } from "../adapter";

/**
 * Generates realistic but fictional listings so search, filters and UI can be built
 * before the first real source is connected. The payload deliberately uses the messy
 * string formats real portals use ("12.990 €", "03/2018", "110 kW (150 PS)"),
 * so the normalization path is exercised end to end.
 */

interface DemoModel {
  make: string;
  model: string;
  body: string;
  /** Rough price when new, in EUR. */
  base: number;
  /** Consistent [fuel, kW, variant] combinations. */
  trims: [string, number, string][];
  /** First model year we generate. */
  from: number;
}

const B = "Benzin";
const D = "Diesel";
const E = "Elektro";
const H = "Hybrid (Benzin/Elektro)";
const P = "Plug-in-Hybrid";
const LPG = "Autogas (LPG)";
const CNG = "Erdgas (CNG)";

const DEMO_MODELS: DemoModel[] = [
  { make: "VW", model: "Golf", body: "Limousine", base: 30000, from: 2010, trims: [[B, 81, "1.0 TSI Life"], [B, 110, "1.5 TSI Style"], [D, 85, "2.0 TDI Comfortline"], [D, 110, "2.0 TDI Highline"], [P, 150, "GTE"]] },
  { make: "VW", model: "Polo", body: "Kleinwagen", base: 21000, from: 2010, trims: [[B, 48, "1.0 MPI Trendline"], [B, 70, "1.0 TSI Comfortline"], [D, 59, "1.6 TDI"]] },
  { make: "Volkswagen", model: "Passat Variant", body: "Kombi", base: 42000, from: 2012, trims: [[D, 110, "2.0 TDI Business"], [D, 140, "2.0 TDI Highline"], [B, 110, "1.5 TSI Elegance"], [P, 160, "GTE"]] },
  { make: "VW", model: "Tiguan", body: "SUV/Geländewagen", base: 40000, from: 2012, trims: [[B, 110, "1.5 TSI Life"], [D, 110, "2.0 TDI"], [D, 147, "2.0 TDI 4Motion R-Line"]] },
  { make: "VW", model: "Touran", body: "Van/Kleinbus", base: 33000, from: 2011, trims: [[B, 110, "1.5 TSI Comfortline"], [D, 85, "2.0 TDI Highline"]] },
  { make: "VW", model: "up!", body: "Kleinwagen", base: 14000, from: 2012, trims: [[B, 44, "move up!"], [B, 55, "high up!"], [E, 61, "e-up!"]] },
  { make: "VW", model: "ID.3", body: "Limousine", base: 40000, from: 2020, trims: [[E, 107, "Pure"], [E, 150, "Pro"], [E, 150, "Pro S"]] },
  { make: "Mercedes-Benz", model: "A 180", body: "Limousine", base: 34000, from: 2013, trims: [[B, 100, "Style"], [B, 100, "AMG Line"]] },
  { make: "Mercedes-Benz", model: "A 180 d", body: "Limousine", base: 35000, from: 2013, trims: [[D, 85, "Style"], [D, 85, "Progressive"]] },
  { make: "Mercedes", model: "C 220 d T-Modell", body: "Kombi", base: 50000, from: 2012, trims: [[D, 125, "Avantgarde"], [D, 147, "AMG Line"]] },
  { make: "Mercedes-Benz", model: "E-Klasse E 300 de", body: "Limousine", base: 62000, from: 2019, trims: [[P, 225, "Avantgarde"]] },
  { make: "BMW", model: "320d Touring", body: "Kombi", base: 48000, from: 2012, trims: [[D, 140, "Advantage"], [D, 140, "Sport Line"], [D, 140, "M Sport"]] },
  { make: "BMW", model: "118i", body: "Kleinwagen", base: 32000, from: 2012, trims: [[B, 100, "Advantage"], [B, 100, "Sport Line"]] },
  { make: "BMW", model: "X1", body: "SUV/Geländewagen", base: 40000, from: 2013, trims: [[B, 100, "sDrive18i Advantage"], [D, 110, "sDrive18d xLine"], [D, 140, "xDrive20d M Sport"]] },
  { make: "BMW", model: "i3", body: "Kleinwagen", base: 39000, from: 2014, trims: [[E, 125, "94 Ah"], [E, 125, "120 Ah"], [E, 135, "s 120 Ah"]] },
  { make: "Audi", model: "A3 Sportback", body: "Limousine", base: 35000, from: 2012, trims: [[B, 81, "30 TFSI"], [B, 110, "35 TFSI S line"], [D, 110, "35 TDI"]] },
  { make: "Audi", model: "A4 Avant", body: "Kombi", base: 46000, from: 2012, trims: [[D, 110, "2.0 TDI"], [D, 140, "40 TDI quattro"], [B, 150, "40 TFSI"]] },
  { make: "Audi", model: "Q5", body: "SUV/Geländewagen", base: 56000, from: 2013, trims: [[D, 140, "40 TDI quattro"], [B, 180, "45 TFSI quattro"]] },
  { make: "Opel", model: "Corsa", body: "Kleinwagen", base: 19000, from: 2010, trims: [[B, 55, "1.2 Edition"], [B, 74, "1.2 Turbo GS Line"], [E, 100, "-e Elegance"]] },
  { make: "Opel", model: "Astra Sports Tourer", body: "Kombi", base: 28000, from: 2011, trims: [[B, 96, "1.2 Turbo Elegance"], [D, 90, "1.5 Diesel Edition"]] },
  { make: "Opel", model: "Zafira Tourer", body: "Van/Kleinbus", base: 30000, from: 2011, trims: [[B, 103, "1.4 Turbo Edition"], [D, 125, "2.0 CDTI Innovation"], [CNG, 110, "1.6 CNG Turbo"]] },
  { make: "Ford", model: "Fiesta", body: "Kleinwagen", base: 19000, from: 2010, trims: [[B, 74, "1.0 EcoBoost Titanium"], [B, 52, "1.1 Trend"]] },
  { make: "Ford", model: "Focus Turnier", body: "Kombi", base: 29000, from: 2011, trims: [[B, 92, "1.0 EcoBoost Cool & Connect"], [D, 88, "1.5 EcoBlue ST-Line"]] },
  { make: "Ford", model: "Kuga", body: "SUV/Geländewagen", base: 35000, from: 2013, trims: [[B, 110, "1.5 EcoBoost Titanium"], [D, 140, "2.0 EcoBlue AWD"], [P, 165, "2.5 PHEV ST-Line"]] },
  { make: "Škoda", model: "Octavia Combi", body: "Kombi", base: 32000, from: 2010, trims: [[B, 110, "1.5 TSI Ambition"], [D, 110, "2.0 TDI Style"], [CNG, 96, "1.5 TSI G-TEC"]] },
  { make: "Skoda", model: "Fabia", body: "Kleinwagen", base: 18000, from: 2010, trims: [[B, 44, "1.0 MPI Active"], [B, 70, "1.0 TSI Style"]] },
  { make: "Skoda", model: "Kodiaq", body: "SUV/Geländewagen", base: 42000, from: 2017, trims: [[B, 110, "1.5 TSI Style"], [D, 140, "2.0 TDI 4x4 L&K"]] },
  { make: "Seat", model: "Leon ST", body: "Kombi", base: 28000, from: 2013, trims: [[B, 110, "1.5 TSI FR"], [D, 110, "2.0 TDI Xcellence"]] },
  { make: "Seat", model: "Ibiza", body: "Kleinwagen", base: 19000, from: 2010, trims: [[B, 70, "1.0 TSI Style"], [B, 59, "1.0 MPI Reference"]] },
  { make: "Renault", model: "Clio", body: "Kleinwagen", base: 18000, from: 2010, trims: [[B, 67, "TCe 90 Limited"], [D, 63, "dCi 85 Intens"], [LPG, 74, "TCe 100 LPG"]] },
  { make: "Renault", model: "ZOE", body: "Kleinwagen", base: 33000, from: 2014, trims: [[E, 80, "R110 Life"], [E, 100, "R135 Intens"]] },
  { make: "Peugeot", model: "208", body: "Kleinwagen", base: 20000, from: 2012, trims: [[B, 55, "PureTech 75 Active"], [D, 75, "BlueHDi 100 Allure"], [E, 100, "e-208 GT"]] },
  { make: "Peugeot", model: "3008", body: "SUV/Geländewagen", base: 35000, from: 2016, trims: [[B, 96, "PureTech 130 Allure"], [D, 96, "BlueHDi 130 GT Line"], [P, 221, "Hybrid4 300 GT"]] },
  { make: "Toyota", model: "Yaris", body: "Kleinwagen", base: 20000, from: 2011, trims: [[B, 53, "1.0 Comfort"], [H, 85, "1.5 Hybrid Team D"]] },
  { make: "Toyota", model: "Corolla Touring Sports", body: "Kombi", base: 32000, from: 2019, trims: [[H, 90, "1.8 Hybrid Team D"], [H, 135, "2.0 Hybrid Lounge"]] },
  { make: "Toyota", model: "RAV4", body: "SUV/Geländewagen", base: 42000, from: 2013, trims: [[H, 160, "2.5 Hybrid Comfort"], [H, 163, "2.5 Hybrid AWD Style"], [B, 129, "2.0 VVT-i"]] },
  { make: "Hyundai", model: "i30 Kombi", body: "Kombi", base: 27000, from: 2012, trims: [[B, 88, "1.4 Trend"], [D, 100, "1.6 CRDi Style"]] },
  { make: "Hyundai", model: "Kona", body: "SUV/Geländewagen", base: 30000, from: 2018, trims: [[B, 88, "1.0 T-GDI Trend"], [E, 150, "Elektro 64 kWh Premium"], [H, 104, "1.6 GDI Hybrid"]] },
  { make: "Kia", model: "Ceed SW", body: "Kombi", base: 27000, from: 2012, trims: [[B, 88, "1.4 Vision"], [D, 100, "1.6 CRDi Spirit"]] },
  { make: "Kia", model: "Sportage", body: "SUV/Geländewagen", base: 35000, from: 2011, trims: [[B, 97, "1.6 GDI Vision"], [D, 100, "1.6 CRDi Spirit"], [H, 169, "1.6 T-GDI Hybrid"]] },
  { make: "Fiat", model: "500", body: "Kleinwagen", base: 16000, from: 2010, trims: [[B, 51, "1.2 Lounge"], [H, 51, "1.0 Hybrid Dolcevita"], [E, 87, "e Icon"]] },
  { make: "Dacia", model: "Sandero", body: "Kleinwagen", base: 13000, from: 2012, trims: [[B, 54, "SCe 75 Essential"], [B, 67, "TCe 90 Stepway"], [LPG, 74, "ECO-G 100"]] },
  { make: "Dacia", model: "Duster", body: "SUV/Geländewagen", base: 19000, from: 2012, trims: [[B, 96, "TCe 130 Comfort"], [D, 85, "Blue dCi 115 4x4"], [LPG, 74, "ECO-G 100"]] },
  { make: "Mazda", model: "CX-5", body: "SUV/Geländewagen", base: 36000, from: 2012, trims: [[B, 121, "SKYACTIV-G 165 Exclusive-Line"], [D, 110, "SKYACTIV-D 150 AWD"]] },
  { make: "Volvo", model: "V60", body: "Kombi", base: 48000, from: 2011, trims: [[D, 140, "D4 Momentum"], [B, 145, "B4 Core"], [P, 250, "T6 Recharge"]] },
  { make: "Tesla", model: "Model 3", body: "Limousine", base: 47000, from: 2019, trims: [[E, 208, "Standard Range Plus"], [E, 324, "Long Range AWD"], [E, 377, "Performance"]] },
  { make: "Tesla", model: "Model Y", body: "SUV/Geländewagen", base: 50000, from: 2021, trims: [[E, 220, "Hinterradantrieb"], [E, 378, "Long Range AWD"]] },
];

const COLORS = ["Schwarz", "Weiß", "Silber", "Grau", "Blau", "Rot", "Grün", "Braun"];
const DEALER_NAMES = ["Demo-Autohaus Nord", "Demo-Autohaus Süd", "Demo Automobile", "Demo-Gebrauchtwagenzentrum", "Demo Auto & Service"];

/** Small deterministic PRNG (mulberry32) so demo data is identical on every run. */
export function createRandom(seed: number) {
  let state = seed >>> 0;
  const next = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    int: (min: number, max: number) => min + Math.floor(next() * (max - min + 1)),
    pick: <T>(items: readonly T[]): T => items[Math.floor(next() * items.length)],
  };
}

const formatGermanInt = (value: number) => value.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");

export interface DemoPayload {
  id: string;
  make: string;
  model: string;
  price: string;
  mileage: string;
  firstRegistration: string;
  power: string;
  fuel: string;
  gearbox: string;
  body: string;
  color: string;
  seller: { type: string; name?: string };
  location: { zip: string; city: string };
}

export function generateDemoPayload(index: number, seed: number, currentYear: number): DemoPayload {
  const rnd = createRandom(seed * 1_000_003 + index);
  const model = rnd.pick(DEMO_MODELS);
  const year = rnd.int(Math.max(model.from, currentYear - 15), currentYear);
  const month = year === currentYear ? rnd.int(1, 10) : rnd.int(1, 12);
  const age = currentYear - year + (12 - month) / 12;
  const mileage = Math.max(500, Math.round((age * rnd.int(7000, 22000) + rnd.int(0, 5000)) / 100) * 100);
  const [fuel, kw, variant] = rnd.pick(model.trims);
  const automatic = fuel === E || fuel === H || fuel === P || rnd.next() < 0.35;
  const depreciation = 0.85 * Math.pow(0.92, age);
  const mileageFactor = 1 - Math.min(0.25, mileage / 800_000);
  const price = Math.max(990, Math.round((model.base * depreciation * mileageFactor * (0.9 + rnd.next() * 0.2)) / 100) * 100 - 10);
  const place = rnd.pick(PLACES);
  const dealer = rnd.next() < 0.75;

  return {
    id: `demo-${index}`,
    make: model.make,
    model: `${model.model} ${variant}`,
    price: `${formatGermanInt(price)} €`,
    mileage: `${formatGermanInt(mileage)} km`,
    firstRegistration: `${String(month).padStart(2, "0")}/${year}`,
    power: `${kw} kW (${Math.round(kw / 0.73549875)} PS)`,
    fuel,
    gearbox: automatic ? "Automatik" : "Schaltgetriebe",
    body: model.body,
    color: rnd.pick(COLORS),
    seller: dealer ? { type: "Händler", name: `${rnd.pick(DEALER_NAMES)} ${place.city}` } : { type: "Privat" },
    location: { zip: place.zip, city: place.city },
  };
}

export interface DemoAdapterOptions {
  count?: number;
  seed?: number;
  currentYear?: number;
}

export function createDemoAdapter(options: DemoAdapterOptions = {}): SourceAdapter {
  const count = options.count ?? 3000;
  const seed = options.seed ?? 42;
  const currentYear = options.currentYear ?? 2026;

  return {
    source: { id: "demo", name: "Demo-Börse", kind: "demo", websiteUrl: null },
    fullSnapshot: true,

    async *fetch() {
      for (let index = 1; index <= count; index += 1) {
        const payload = generateDemoPayload(index, seed, currentYear);
        yield { externalId: payload.id, payload: { ...payload } } satisfies RawListing;
      }
    },

    normalize(raw) {
      const p = raw.payload as unknown as DemoPayload;
      const priceEur = parseInteger(p.price);
      if (priceEur === null) return null;
      const { makeSlug, modelSlug, variant } = resolveMakeModel(p.make, p.model);
      const isDealer = p.seller.type === "Händler";

      return {
        sourceId: "demo",
        externalId: raw.externalId,
        url: `/demo/${encodeURIComponent(raw.externalId)}`,
        title: `${p.make} ${p.model}`,
        makeSlug,
        modelSlug,
        makeRaw: p.make,
        modelRaw: p.model,
        variant,
        priceEur,
        mileageKm: parseInteger(p.mileage),
        firstRegistration: parseFirstRegistration(p.firstRegistration),
        fuel: normalizeFuel(p.fuel),
        transmission: normalizeTransmission(p.gearbox),
        powerKw: parsePowerKw(p.power),
        bodyType: normalizeBodyType(p.body),
        color: p.color,
        sellerType: isDealer ? "dealer" : "private",
        sellerName: isDealer ? (p.seller.name ?? null) : null,
        zip: p.location.zip,
        city: p.location.city,
        lat: null,
        lng: null,
        imageUrl: null,
      };
    },
  };
}
