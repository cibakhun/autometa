import type { ChildNode, Element } from "domhandler";
import { findAll, getAttributeValue } from "domutils";
import { parseDocument } from "htmlparser2";
import { normalizeFuel, normalizeText, normalizeTransmission, parsePowerKw } from "@/core/normalize";
import type { Fuel, Transmission } from "@/core/types";

/**
 * Reads the entries of a portal's result list without knowing its class names: every link to a
 * detail page marks one entry, and the entry ("card") is the largest element around that link
 * which links to no other listing. The facts are then picked from the card's short text pieces
 * by their form ("12.990 €", "98.000 km", "03/2019", "150 PS", "10115 Berlin").
 *
 * Portals rename their CSS classes often but rarely change what a card says, so this survives
 * most redesigns. Adapters still check that a page they know has listings yields some.
 */

export interface TextPiece {
  text: string;
  /** Inside a crossed-out element, e.g. the old price next to a reduced one. */
  struck: boolean;
}

export interface Card {
  /** The listing's id as the adapter's detail matcher returned it. */
  id: string;
  /** Absolute URL of the detail page. */
  url: string;
  /** Text of the card's first heading, else of its longest link to the listing. */
  title: string | null;
  pieces: TextPiece[];
}

/** Returns the listing id for a link to a detail page, null for every other link. */
export type DetailMatcher = (url: URL) => string | null;

const SKIPPED = new Set(["script", "style", "noscript", "svg", "template", "button", "select", "option"]);
const STRUCK_TAGS = new Set(["s", "del", "strike"]);
const STRUCK_HINT = /line-through|strike|crossed|old[-_]*price|price[-_]*old|was[-_]*price|previous[-_]*price|price[-_]*before|streich/i;
const HEADINGS = new Set(["h1", "h2", "h3", "h4", "h5", "h6"]);

export function readCards(html: string, baseUrl: string, detail: DetailMatcher): Card[] {
  const doc = parseDocument(html);
  const links: { element: Element; id: string; url: string }[] = [];
  for (const element of findAll((node) => node.name === "a" && Boolean(node.attribs.href), doc.children)) {
    let url: URL;
    try {
      url = new URL(element.attribs.href, baseUrl);
    } catch {
      continue;
    }
    const id = detail(url);
    if (id) links.push({ element, id, url: url.href });
  }

  // For every element, the listings it links to (only those with a link inside matter).
  const idsBelow = new Map<Element, Set<string>>();
  for (const { element, id } of links) {
    for (let node: Element | null = element; node; node = parentElement(node)) {
      let ids = idsBelow.get(node);
      if (!ids) idsBelow.set(node, (ids = new Set()));
      ids.add(id);
    }
  }

  const cards: Card[] = [];
  const done = new Set<string>();
  for (const { element, id, url } of links) {
    if (done.has(id)) continue;
    done.add(id);
    let card = element;
    for (let parent = parentElement(card); parent && parent.name !== "body"; parent = parentElement(parent)) {
      if ((idsBelow.get(parent)?.size ?? 0) > 1) break;
      card = parent;
    }
    cards.push({ id, url, title: titleOf(card, links.filter((l) => l.id === id).map((l) => l.element)), pieces: piecesOf(card) });
  }
  return cards;
}

function parentElement(node: Element): Element | null {
  const parent = node.parent;
  return parent && parent.type === "tag" ? (parent as Element) : null;
}

const clean = (text: string) => text.replace(/\s+/g, " ").trim();

/** The card's first heading, else a title or label on its links, else the links' text. */
function titleOf(card: Element, anchors: Element[]): string | null {
  const joined = (element: Element) => piecesOf(element).map((p) => p.text).join(" ");
  const heading = findAll((node) => HEADINGS.has(node.name), [card])[0];
  const candidates = [
    heading ? joined(heading) : "",
    ...anchors.map((a) => clean(getAttributeValue(a, "title") ?? "") || clean(getAttributeValue(a, "aria-label") ?? "")),
    ...anchors.map(joined).sort((a, b) => b.length - a.length),
  ];
  return candidates.find(Boolean) ?? null;
}

function isStruck(element: Element): boolean {
  if (STRUCK_TAGS.has(element.name)) return true;
  const hint = `${element.attribs.class ?? ""} ${element.attribs.style ?? ""} ${element.attribs["data-testid"] ?? ""}`;
  return STRUCK_HINT.test(hint);
}

/** The card's text nodes in order, skipping scripts, styles, icons and form controls. */
export function piecesOf(root: Element): TextPiece[] {
  const pieces: TextPiece[] = [];
  const walk = (nodes: ChildNode[], struck: boolean) => {
    for (const node of nodes) {
      if (node.type === "text") {
        const text = clean(node.data);
        if (text) pieces.push({ text, struck });
      } else if (node.type === "tag") {
        const element = node as Element;
        if (SKIPPED.has(element.name)) continue;
        walk(element.children, struck || isStruck(element));
      }
    }
  };
  walk(root.children, isStruck(root));
  return pieces;
}

/** Facts read from a card's text pieces. Anything the card does not say clearly stays null. */
export interface CardFacts {
  price: number | null;
  mileageKm: number | null;
  /** "MM/YYYY" or "YYYY", ready for parseFirstRegistration. */
  firstRegistration: string | null;
  powerKw: number | null;
  fuel: Fuel | null;
  transmission: Transmission | null;
  zip: string | null;
  city: string | null;
}

const NUMBER = String.raw`(?:\d{1,3}(?:[.\s  ]\d{3})+|\d+)(?:[.,]\d{1,2})?`;
const PRICE = new RegExp(String.raw`^(${NUMBER})\s*(?:€|EUR|Euro)(?:\s*\(?VB\)?)?$`, "i");
const MILEAGE = new RegExp(String.raw`^(${NUMBER})\s*km$`, "i");
const REGISTRATION = /^(?:EZ:?\s*)?((?:0?[1-9]|1[0-2])[./](?:19|20)\d{2})$/i;
const YEAR = /^(?:EZ:?\s*|Bj\.?:?\s*|Baujahr:?\s*)?((?:19|20)\d{2})$/i;
const POWER = /^\d{2,4}(?:[.,]\d)?\s*(?:kW|PS)\b/i;
const PLACE = /^(\d{5})\s+([^\d,|/()]{2,60}?)(?:\s*[,(].*)?$/;
/**
 * Words that make an amount something other than the price: monthly rates, down payments and
 * savings, in the amount's own text, as a label right after it ("447 €", "mtl. Leasing") or as a
 * prefix right before it ("Spare", "1.340 €").
 */
const NOT_THE_PRICE = /mtl|monat|\/\s*m\b|rate\b|anzahlung|leasing|finanzier|spare|sparen|ersparnis|statt|uvp|neupreis|preisvorteil|rabatt/i;
const LABEL_AFTER = /^(\/|mtl|monatl|pro monat|im monat|anzahlung|rate\b|leasing|finanzier|ersparnis|gespart|rabatt|unter marktpreis)/i;
const PREFIX_BEFORE = /(spare|sparen|ersparnis|statt|uvp|neupreis|preisvorteil|rabatt|anzahlung|ab)\s*:?$/i;
const FUEL_WORDS = new Set([
  "benzin", "super", "diesel", "elektro", "elektrisch", "hybrid", "plug in hybrid", "hybrid benzin", "hybrid diesel",
  "benzin elektro", "diesel elektro", "elektro benzin", "elektro diesel", "autogas", "lpg", "erdgas", "cng", "wasserstoff",
  "petrol", "electric", "mild hybrid", "voll hybrid", "vollhybrid",
]);
const TRANSMISSIONS = /^(automatik|automatikgetriebe|automatic|schaltgetriebe|manuell|schaltung|halbautomatik|manual)$/i;

/** Splits pieces such as "2018 | diesel | 96020 km" or "10.000 km·10/2025" into single facts. */
export function tokens(pieces: TextPiece[]): TextPiece[] {
  const out: TextPiece[] = [];
  for (const piece of pieces) {
    for (const part of piece.text.split(/\s*[|·•]\s*|(?<=€|EUR)\s+(?=\d)/)) {
      const text = part.trim();
      if (text) out.push({ text, struck: piece.struck });
    }
  }
  return out;
}

/** "12.990 €", "21 990 EUR", "15550.0 EUR", "8.500 € VB" -> whole euros. */
export function parseEuro(text: string): number | null {
  const match = text.trim().match(PRICE);
  return match ? parseAmount(match[1]) : null;
}

function parseAmount(raw: string): number | null {
  // A one- or two-digit tail after a dot or comma is cents ("15550.0", "1.234,50"), never thousands.
  const whole = raw.replace(/[.,]\d{1,2}$/, "").replace(/[.\s  ]/g, "");
  const value = Number.parseInt(whole, 10);
  return Number.isFinite(value) ? value : null;
}

export function cardFacts(pieces: TextPiece[], now = new Date()): CardFacts {
  const list = tokens(pieces);
  const facts: CardFacts = {
    price: null,
    mileageKm: null,
    firstRegistration: null,
    powerKw: null,
    fuel: null,
    transmission: null,
    zip: null,
    city: null,
  };
  let year: string | null = null;
  const latestYear = now.getFullYear() + 1;

  list.forEach((token, i) => {
    const text = token.text;
    if (facts.price === null && !token.struck) {
      const price = parseEuro(text);
      const labelled =
        NOT_THE_PRICE.test(text) || LABEL_AFTER.test(list[i + 1]?.text ?? "") || PREFIX_BEFORE.test(list[i - 1]?.text ?? "");
      if (price !== null && price >= 100 && !labelled) facts.price = price;
    }
    const mileage = text.match(MILEAGE);
    if (mileage && facts.mileageKm === null) facts.mileageKm = parseAmount(mileage[1]);
    const registration = text.match(REGISTRATION);
    if (registration && facts.firstRegistration === null) facts.firstRegistration = registration[1].replace(".", "/");
    const yearMatch = text.match(YEAR);
    if (yearMatch && year === null && Number(yearMatch[1]) >= 1950 && Number(yearMatch[1]) <= latestYear) year = yearMatch[1];
    if (POWER.test(text) && facts.powerKw === null) {
      const kw = parsePowerKw(text);
      if (kw !== null && kw >= 20 && kw <= 1000) facts.powerKw = kw;
    }
    if (facts.fuel === null && text.length <= 30 && FUEL_WORDS.has(normalizeText(text))) facts.fuel = normalizeFuel(text);
    if (facts.transmission === null && TRANSMISSIONS.test(text)) facts.transmission = normalizeTransmission(text);
    const place = text.match(PLACE);
    if (place && facts.zip === null && !/^km\b/i.test(place[2])) {
      facts.zip = place[1];
      facts.city = place[2].trim();
    }
  });
  facts.firstRegistration ??= year;
  return facts;
}

/**
 * Objects from the page's JSON-LD blocks, with @graph and ItemList entries unpacked. Many portals
 * describe their listings this way for search engines.
 */
export function readJsonLd(html: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const visit = (value: unknown) => {
    if (Array.isArray(value)) return value.forEach(visit);
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    out.push(object);
    if (object["@graph"]) visit(object["@graph"]);
    if (object.itemListElement) visit(object.itemListElement);
    if (object.item && typeof object.item === "object") visit(object.item);
  };
  for (const match of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      visit(JSON.parse(match[1].trim()));
    } catch {
      // a broken block says nothing
    }
  }
  return out;
}
