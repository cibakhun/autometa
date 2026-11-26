import { MAKES } from "./taxonomy";
import type { BodyType } from "./types";

/**
 * The body a model is usually sold with, for listings whose title does not say (most of them:
 * live on 2026-11-26 only about 10 % of AutoScout24, Kleinanzeigen and Quoka listings had a body
 * type, so "SUV" found 62 of 13,491 Tiguans). Words in the title win ("Golf Variant" is an
 * estate, "Vito Kasten" a goods van); this is only the fallback.
 *
 * Compact hatchbacks such as the Golf count as "Limousine", as the portals file them. Models sold
 * with several bodies get the one most listings have (Octavia: the title says "Combi" when it is
 * one). Models without a clear main body (BMW 2er: Active Tourer, Coupé, Cabrio, Gran Coupé) have
 * none and stay unknown unless the title says.
 */
const S: BodyType = "small";
const L: BodyType = "sedan";
const K: BodyType = "estate";
const SUV: BodyType = "suv";
const V: BodyType = "van";
const C: BodyType = "coupe";
const R: BodyType = "convertible";

export const MODEL_BODY_TYPES: Record<string, Record<string, BodyType>> = {
  volkswagen: {
    golf: L, polo: S, passat: L, tiguan: SUV, touran: V, "t-roc": SUV, "t-cross": SUV, up: S, caddy: V, sharan: V,
    arteon: L, touareg: SUV, taigo: SUV, scirocco: C, beetle: L, fox: S, amarok: SUV, transporter: V, multivan: V,
    california: V, caravelle: V, "id-3": L, "id-4": SUV, "id-5": SUV, "id-buzz": V, "id-7": L, tayron: SUV, eos: R,
    lupo: S, jetta: L, bora: L, phaeton: L, crafter: V,
  },
  "mercedes-benz": {
    "a-klasse": L, "b-klasse": V, "c-klasse": L, "e-klasse": L, "s-klasse": L, "g-klasse": SUV, "v-klasse": V,
    cla: L, cls: L, gla: SUV, glb: SUV, glc: SUV, gle: SUV, gls: SUV, ml: SUV, slk: R, sl: R, vito: V, sprinter: V,
    citan: V, eqa: SUV, eqb: SUV, eqc: SUV, eqe: L, eqs: L, eqv: V, clk: C, slc: R, glk: SUV, gl: SUV, "amg-gt": C,
    "amg-one": C, sls: C, slr: C, "marco-polo": V,
  },
  bmw: {
    "1er": L, "3er": L, "4er": C, "5er": L, "6er": C, "7er": L, "8er": C, x1: SUV, x2: SUV, x3: SUV, x4: SUV, x5: SUV,
    x6: SUV, x7: SUV, z4: R, i3: S, i4: L, ix: SUV, ix1: SUV, ix3: SUV, m2: C, m3: L, m4: C, m5: L, m6: C, m8: C,
    z3: R, i5: L, i7: L, ix2: SUV,
  },
  audi: {
    a1: S, a3: L, a4: L, a5: C, a6: L, a7: L, a8: L, q2: SUV, q3: SUV, q4: SUV, q5: SUV, q7: SUV, q8: SUV, tt: C,
    r8: C, "e-tron": SUV, "e-tron-gt": L, s3: L, s4: L, s5: C, rs3: L, rs4: K, rs6: K, a2: S, q6: SUV, s1: S, s6: L,
    s7: L, s8: L, sq2: SUV, sq5: SUV, sq7: SUV, sq8: SUV, rs5: C, rs7: L, rsq3: SUV, rsq8: SUV,
  },
  opel: {
    corsa: S, astra: L, insignia: L, zafira: V, mokka: SUV, adam: S, karl: S, meriva: V, crossland: SUV,
    grandland: SUV, combo: V, vivaro: V, agila: S, vectra: L, signum: L, tigra: C, calibra: C, cascada: R, omega: L,
    antara: SUV, movano: V, frontera: SUV, kadett: L, ampera: L,
  },
  ford: {
    fiesta: S, focus: L, kuga: SUV, mondeo: L, "s-max": V, galaxy: V, "c-max": V, "b-max": V, ka: S, puma: SUV,
    ecosport: SUV, mustang: C, ranger: SUV, transit: V, fusion: V, escort: L, edge: SUV, explorer: SUV, capri: C,
    taunus: L,
  },
  skoda: {
    fabia: S, octavia: L, superb: L, karoq: SUV, kodiaq: SUV, kamiq: SUV, scala: L, rapid: L, citigo: S, yeti: SUV,
    roomster: V, enyaq: SUV, elroq: SUV, felicia: S,
  },
  seat: {
    ibiza: S, leon: L, ateca: SUV, alhambra: V, arona: SUV, tarraco: SUV, mii: S, altea: V, toledo: L, cordoba: L,
    arosa: S, exeo: L, marbella: S,
  },
  cupra: { formentor: SUV, born: L, leon: L, ateca: SUV, tavascan: SUV, terramar: SUV, raval: S },
  renault: {
    clio: S, megane: L, captur: SUV, scenic: V, zoe: S, twingo: S, kadjar: SUV, koleos: SUV, austral: SUV,
    arkana: SUV, kangoo: V, trafic: V, espace: V, talisman: L, master: V, laguna: L, modus: V, symbioz: SUV,
    rafale: SUV, fluence: L, wind: R, "5": S, "19": L,
  },
  peugeot: {
    "106": S, "107": S, "108": S, "205": S, "306": L, "406": L, "407": L, "408": L, "508": L, "607": L, "807": V,
    "1007": S, "4007": SUV, "4008": SUV, "206": S, "207": S, "208": S, "307": L, "308": L, "2008": SUV, "3008": SUV,
    "5008": SUV, partner: V, rifter: V, expert: V, boxer: V, traveller: V, bipper: V, rcz: C,
  },
  citroen: {
    c1: S, c3: S, c4: L, c5: L, "c3-aircross": SUV, "c5-aircross": SUV, "c4-picasso": V, berlingo: V, jumpy: V,
    ami: S, c2: S, c6: L, c8: V, spacetourer: V, jumper: V, xsara: L, saxo: S,
  },
  ds: { ds3: S, ds4: L, ds5: L, ds7: SUV, ds9: L },
  toyota: {
    yaris: S, corolla: L, auris: L, rav4: SUV, prius: L, "c-hr": SUV, aygo: S, avensis: L, verso: V,
    "land-cruiser": SUV, hilux: SUV, proace: V, gr86: C, supra: C, camry: L, celica: C, bz4x: SUV,
    "urban-cruiser": SUV, iq: S,
  },
  lexus: { ct: L, is: L, es: L, nx: SUV, rx: SUV, ux: SUV, gs: L, ls: L, lc: C, rc: C, rz: SUV, lbx: SUV, lfa: C },
  hyundai: {
    i10: S, i20: S, i30: L, i40: L, ix20: V, ix35: SUV, tucson: SUV, kona: SUV, "santa-fe": SUV, bayon: SUV, ioniq: L,
    "ioniq-5": SUV, "ioniq-6": L, getz: S, matrix: V, accent: S, veloster: C, "h-1": V, staria: V, inster: S, sonata: L,
  },
  kia: {
    picanto: S, rio: S, ceed: L, xceed: SUV, sportage: SUV, niro: SUV, sorento: SUV, stonic: SUV, soul: SUV, venga: V,
    carens: V, ev6: SUV, ev9: SUV, ev3: SUV, ev4: L, k4: L, optima: L, carnival: V, magentis: L, cerato: L,
  },
  fiat: {
    "500": S, "500x": SUV, "500l": V, panda: S, tipo: L, doblo: V, punto: S, ducato: V, qubo: V, "600": SUV, scudo: V,
    bravo: L, stilo: L, seicento: S, sedici: SUV, fiorino: V, multipla: V, croma: L, freemont: SUV, idea: V, ulysse: V,
    barchetta: R, uno: S,
  },
  abarth: { "500": S, "124-spider": R },
  "alfa-romeo": {
    giulia: L, giulietta: L, stelvio: SUV, mito: S, tonale: SUV, junior: SUV, spider: R, gtv: C, brera: C, gt: C,
    "145": L, "146": L, "147": L, "156": L, "159": L, "164": L, "166": L, "4c": C,
  },
  dacia: { sandero: S, duster: SUV, logan: L, jogger: V, spring: S, lodgy: V, dokker: V, bigster: SUV },
  mazda: {
    "2": S, "3": L, "6": L, "cx-3": SUV, "cx-30": SUV, "cx-5": SUV, "cx-60": SUV, "mx-5": R, "mx-30": SUV, "5": V,
    "cx-7": SUV, "cx-80": SUV, "cx-9": SUV, "rx-8": C, "323": L, "626": L, premacy: V,
  },
  nissan: {
    micra: S, juke: SUV, qashqai: SUV, "x-trail": SUV, leaf: L, note: S, navara: SUV, ariya: SUV, pulsar: L,
    townstar: V, almera: L, primastar: V, pathfinder: SUV, murano: SUV, patrol: SUV, terrano: SUV, "350z": C,
    "370z": C, "gt-r": C, nv200: V, cube: V, pixo: S,
  },
  honda: {
    jazz: S, civic: L, "cr-v": SUV, "hr-v": SUV, "zr-v": SUV, e: S, accord: L, "fr-v": V, s2000: R, insight: L,
    stream: V, prelude: C, "cr-z": C, legend: L,
  },
  mitsubishi: {
    "space-star": S, asx: SUV, outlander: SUV, "eclipse-cross": SUV, colt: S, l200: SUV, grandis: V, pajero: SUV,
    lancer: L, galant: L, carisma: L, "i-miev": S, "space-wagon": V,
  },
  suzuki: {
    swift: S, vitara: SUV, sx4: SUV, ignis: S, jimny: SUV, alto: S, splash: S, celerio: S, baleno: S, "wagon-r": S,
    liana: L, swace: K, across: SUV, samurai: SUV,
  },
  subaru: {
    forester: SUV, outback: K, impreza: L, xv: SUV, legacy: L, justy: S, brz: C, levorg: K, trezia: S, tribeca: SUV,
    solterra: SUV,
  },
  volvo: {
    v40: L, v50: K, v60: K, v70: K, v90: K, s40: L, s60: L, s70: L, s80: L, s90: L, xc40: SUV, xc60: SUV, xc70: SUV,
    xc90: SUV, ex30: SUV, ex40: SUV, ex90: SUV, ec40: SUV, c30: L, c40: SUV, c70: R,
  },
  polestar: { "2": L, "3": SUV, "4": SUV },
  tesla: { "model-3": L, "model-y": SUV, "model-s": L, "model-x": SUV },
  byd: { "atto-3": SUV, "atto-2": SUV, "sealion-7": SUV, dolphin: L, seal: L, han: L, tang: SUV },
  mg: {
    mg4: L, zs: SUV, hs: SUV, mg5: K, "marvel-r": SUV, mg3: S, ehs: SUV, mgf: R, mgb: R, midget: R, tf: R,
    cyberster: R,
  },
  porsche: {
    "911": C, cayenne: SUV, macan: SUV, panamera: L, taycan: L, boxster: R, cayman: C, "356": C, "914": R, "924": C,
    "928": C, "944": C, "968": C, "carrera-gt": R, "918": R, "959": C, "962": C, "935": C,
  },
  mini: { cooper: S, one: S, countryman: SUV, clubman: K, cabrio: R, paceman: SUV, aceman: SUV, coupe: C, roadster: R },
  smart: { fortwo: S, forfour: S, roadster: R, "1": SUV, "3": SUV },
  "land-rover": {
    "range-rover": SUV, "range-rover-sport": SUV, "range-rover-evoque": SUV, "range-rover-velar": SUV,
    discovery: SUV, "discovery-sport": SUV, defender: SUV, freelander: SUV,
  },
  jaguar: {
    xe: L, xf: L, "f-pace": SUV, "e-pace": SUV, "i-pace": SUV, "f-type": C, xj: L, xk: C, "s-type": L, "x-type": L,
    "e-type": C,
  },
  jeep: {
    renegade: SUV, compass: SUV, wrangler: SUV, "grand-cherokee": SUV, cherokee: SUV, avenger: SUV, commander: SUV,
    patriot: SUV, gladiator: SUV,
  },
  chevrolet: {
    spark: S, aveo: S, cruze: L, captiva: SUV, camaro: C, corvette: C, silverado: SUV, orlando: V, matiz: S, kalos: S,
    tahoe: SUV, trax: SUV, epica: L, lacetti: L, nubira: L, suburban: SUV, blazer: SUV,
  },
};

/** The body a model is usually sold with; null for unknown models and those without a main body. */
export function defaultBodyType(makeSlug: string | null, modelSlug: string | null): BodyType | null {
  if (!makeSlug || !modelSlug) return null;
  return MODEL_BODY_TYPES[makeSlug]?.[modelSlug] ?? null;
}

/** Models of the taxonomy without a default body; for the test that keeps the two in step. */
export function modelsWithoutBodyType(): string[] {
  return MAKES.flatMap((make) => make.models.filter((model) => !MODEL_BODY_TYPES[make.slug]?.[model.slug]).map((model) => `${make.slug}/${model.slug}`));
}
