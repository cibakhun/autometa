export const FUELS = [
  "petrol",
  "diesel",
  "electric",
  "hybrid",
  "plugin_hybrid",
  "lpg",
  "cng",
  "hydrogen",
  "other",
] as const;
export type Fuel = (typeof FUELS)[number];

export const TRANSMISSIONS = ["manual", "automatic"] as const;
export type Transmission = (typeof TRANSMISSIONS)[number];

export const BODY_TYPES = ["small", "sedan", "estate", "suv", "van", "coupe", "convertible", "other"] as const;
export type BodyType = (typeof BODY_TYPES)[number];

export const SELLER_TYPES = ["dealer", "private"] as const;
export type SellerType = (typeof SELLER_TYPES)[number];

/** German labels for the UI. */
export const FUEL_LABELS: Record<Fuel, string> = {
  petrol: "Benzin",
  diesel: "Diesel",
  electric: "Elektro",
  hybrid: "Hybrid",
  plugin_hybrid: "Plug-in-Hybrid",
  lpg: "Autogas (LPG)",
  cng: "Erdgas (CNG)",
  hydrogen: "Wasserstoff",
  other: "Sonstige",
};

export const TRANSMISSION_LABELS: Record<Transmission, string> = {
  manual: "Schaltgetriebe",
  automatic: "Automatik",
};

export const BODY_TYPE_LABELS: Record<BodyType, string> = {
  small: "Kleinwagen",
  sedan: "Limousine",
  estate: "Kombi",
  suv: "SUV / Geländewagen",
  van: "Van / Kleinbus",
  coupe: "Coupé",
  convertible: "Cabrio",
  other: "Sonstige",
};

export const SELLER_TYPE_LABELS: Record<SellerType, string> = {
  dealer: "Händler",
  private: "Privat",
};

/** A listing after normalization, the single format every source is mapped to. */
export interface NormalizedListing {
  sourceId: string;
  externalId: string;
  url: string;
  title: string;
  makeSlug: string | null;
  modelSlug: string | null;
  makeRaw: string;
  modelRaw: string;
  variant: string | null;
  priceEur: number;
  mileageKm: number | null;
  /** First day of the month of first registration, ISO date (YYYY-MM-DD). */
  firstRegistration: string | null;
  fuel: Fuel | null;
  transmission: Transmission | null;
  powerKw: number | null;
  bodyType: BodyType | null;
  color: string | null;
  /** Null when the source does not say whether the seller is a dealer. */
  sellerType: SellerType | null;
  /** Company name for dealers. Always null for private sellers and unknown seller types. */
  sellerName: string | null;
  zip: string | null;
  city: string | null;
  lat: number | null;
  lng: number | null;
}
