/**
 * Canonical makes and models. Every source maps its own spelling onto these slugs.
 * Aliases are matched against the normalized start of the raw model string
 * (see resolveMakeModel in normalize.ts).
 */
export interface ModelDef {
  slug: string;
  name: string;
  /** Extra spellings, normalized form (lowercase, words separated by single spaces). */
  aliases?: string[];
  /** Pattern for the first word of the raw model, e.g. BMW "320d" -> 3er. */
  firstWord?: RegExp;
}

export interface MakeDef {
  slug: string;
  name: string;
  aliases?: string[];
  models: ModelDef[];
}

const m = (slug: string, name: string, extra: Omit<ModelDef, "slug" | "name"> = {}): ModelDef => ({
  slug,
  name,
  ...extra,
});

const mercedesClass = (letter: string): ModelDef =>
  m(`${letter}-klasse`, `${letter.toUpperCase()}-Klasse`, {
    aliases: [`${letter} klasse`, `${letter}klasse`],
    firstWord: new RegExp(`^${letter}$`),
  });

const bmwSeries = (n: number): ModelDef =>
  m(`${n}er`, `${n}er`, { aliases: [`${n}er reihe`], firstWord: new RegExp(`^${n}\\d\\d[a-z]*$`) });

export const MAKES: MakeDef[] = [
  {
    slug: "volkswagen",
    name: "Volkswagen",
    aliases: ["vw"],
    models: [
      m("golf", "Golf"),
      m("polo", "Polo"),
      m("passat", "Passat"),
      m("tiguan", "Tiguan"),
      m("touran", "Touran"),
      m("t-roc", "T-Roc", { aliases: ["t roc", "troc"] }),
      m("up", "up!", { aliases: ["up"] }),
      m("caddy", "Caddy"),
      m("sharan", "Sharan"),
      m("id-3", "ID.3", { aliases: ["id 3", "id3"] }),
      m("id-4", "ID.4", { aliases: ["id 4", "id4"] }),
    ],
  },
  {
    slug: "mercedes-benz",
    name: "Mercedes-Benz",
    aliases: ["mercedes", "mercedes benz", "mb"],
    models: [
      mercedesClass("a"),
      mercedesClass("b"),
      mercedesClass("c"),
      mercedesClass("e"),
      m("gla", "GLA"),
      m("glc", "GLC"),
      m("vito", "Vito"),
    ],
  },
  {
    slug: "bmw",
    name: "BMW",
    models: [bmwSeries(1), bmwSeries(2), bmwSeries(3), bmwSeries(5), m("x1", "X1"), m("x3", "X3"), m("i3", "i3")],
  },
  {
    slug: "audi",
    name: "Audi",
    models: [m("a1", "A1"), m("a3", "A3"), m("a4", "A4"), m("a6", "A6"), m("q3", "Q3"), m("q5", "Q5")],
  },
  {
    slug: "opel",
    name: "Opel",
    models: [m("corsa", "Corsa"), m("astra", "Astra"), m("insignia", "Insignia"), m("zafira", "Zafira"), m("mokka", "Mokka")],
  },
  {
    slug: "ford",
    name: "Ford",
    models: [m("fiesta", "Fiesta"), m("focus", "Focus"), m("kuga", "Kuga"), m("mondeo", "Mondeo"), m("s-max", "S-Max", { aliases: ["s max", "smax"] })],
  },
  {
    slug: "skoda",
    name: "Škoda",
    models: [m("fabia", "Fabia"), m("octavia", "Octavia"), m("superb", "Superb"), m("karoq", "Karoq"), m("kodiaq", "Kodiaq")],
  },
  {
    slug: "seat",
    name: "SEAT",
    models: [m("ibiza", "Ibiza"), m("leon", "Leon"), m("ateca", "Ateca"), m("alhambra", "Alhambra")],
  },
  {
    slug: "renault",
    name: "Renault",
    models: [m("clio", "Clio"), m("megane", "Mégane"), m("captur", "Captur"), m("scenic", "Scénic"), m("zoe", "ZOE")],
  },
  {
    slug: "peugeot",
    name: "Peugeot",
    models: [m("208", "208"), m("308", "308"), m("2008", "2008"), m("3008", "3008"), m("5008", "5008")],
  },
  {
    slug: "toyota",
    name: "Toyota",
    models: [m("yaris", "Yaris"), m("corolla", "Corolla"), m("auris", "Auris"), m("rav4", "RAV4", { aliases: ["rav 4"] }), m("prius", "Prius"), m("c-hr", "C-HR", { aliases: ["c hr", "chr"] })],
  },
  {
    slug: "hyundai",
    name: "Hyundai",
    models: [m("i10", "i10"), m("i20", "i20"), m("i30", "i30"), m("tucson", "Tucson"), m("kona", "Kona")],
  },
  {
    slug: "kia",
    name: "Kia",
    models: [m("picanto", "Picanto"), m("rio", "Rio"), m("ceed", "Ceed", { aliases: ["cee d"] }), m("sportage", "Sportage"), m("niro", "Niro")],
  },
  {
    slug: "fiat",
    name: "Fiat",
    models: [m("500", "500"), m("panda", "Panda"), m("tipo", "Tipo"), m("doblo", "Doblò")],
  },
  {
    slug: "dacia",
    name: "Dacia",
    models: [m("sandero", "Sandero"), m("duster", "Duster"), m("logan", "Logan"), m("jogger", "Jogger")],
  },
  {
    slug: "mazda",
    name: "Mazda",
    models: [m("2", "2", { aliases: ["mazda2"] }), m("3", "3", { aliases: ["mazda3"] }), m("6", "6", { aliases: ["mazda6"] }), m("cx-5", "CX-5", { aliases: ["cx 5", "cx5"] })],
  },
  {
    slug: "volvo",
    name: "Volvo",
    models: [m("v40", "V40"), m("v60", "V60"), m("xc60", "XC60"), m("xc90", "XC90")],
  },
  {
    slug: "tesla",
    name: "Tesla",
    models: [m("model-3", "Model 3", { aliases: ["model 3"] }), m("model-y", "Model Y", { aliases: ["model y"] })],
  },
];

export function findMake(slug: string): MakeDef | undefined {
  return MAKES.find((make) => make.slug === slug);
}

export function findModel(makeSlug: string, modelSlug: string): ModelDef | undefined {
  return findMake(makeSlug)?.models.find((model) => model.slug === modelSlug);
}
