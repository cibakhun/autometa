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
    // "A", "A180", "C220d", "E300de", "V250"; not "GLC", which is its own model.
    firstWord: new RegExp(`^${letter}(\\d{2,3}[a-z]*)?$`),
  });

const bmwSeries = (n: number): ModelDef =>
  m(`${n}er`, `${n}er`, { aliases: [`${n}er reihe`], firstWord: new RegExp(`^${n}\\d\\d[a-z]*$`) });

/** Models whose name is just a code, e.g. Peugeot "308" or Audi "A4". */
const codes = (...names: string[]): ModelDef[] => names.map((name) => m(name.toLowerCase(), name));

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
      m("t-cross", "T-Cross", { aliases: ["t cross", "tcross"] }),
      m("up", "up!", { aliases: ["up"] }),
      m("caddy", "Caddy"),
      m("sharan", "Sharan"),
      m("arteon", "Arteon"),
      m("touareg", "Touareg"),
      m("taigo", "Taigo"),
      m("scirocco", "Scirocco"),
      m("beetle", "Beetle", { aliases: ["kaefer", "kafer", "new beetle"] }),
      m("fox", "Fox"),
      m("amarok", "Amarok"),
      m("transporter", "Transporter", { aliases: ["t4", "t5", "t6", "t6 1", "t7", "bus", "bulli"] }),
      m("multivan", "Multivan"),
      m("california", "California"),
      m("caravelle", "Caravelle"),
      m("id-3", "ID.3", { aliases: ["id 3", "id3"] }),
      m("id-4", "ID.4", { aliases: ["id 4", "id4"] }),
      m("id-5", "ID.5", { aliases: ["id 5", "id5"] }),
      m("id-buzz", "ID. Buzz", { aliases: ["id buzz"] }),
    ],
  },
  {
    slug: "mercedes-benz",
    name: "Mercedes-Benz",
    aliases: ["mercedes", "mercedes benz", "mb", "daimler benz"],
    models: [
      mercedesClass("a"),
      mercedesClass("b"),
      mercedesClass("c"),
      mercedesClass("e"),
      mercedesClass("s"),
      mercedesClass("g"),
      mercedesClass("v"),
      m("cla", "CLA"),
      m("cls", "CLS"),
      m("gla", "GLA"),
      m("glb", "GLB"),
      m("glc", "GLC"),
      m("gle", "GLE"),
      m("gls", "GLS"),
      m("ml", "ML", { aliases: ["m klasse"] }),
      m("slk", "SLK"),
      m("sl", "SL"),
      m("vito", "Vito"),
      m("sprinter", "Sprinter"),
      m("citan", "Citan"),
      m("eqa", "EQA"),
      m("eqb", "EQB"),
      m("eqc", "EQC"),
      m("eqe", "EQE"),
      m("eqs", "EQS"),
    ],
  },
  {
    slug: "bmw",
    name: "BMW",
    models: [
      bmwSeries(1),
      bmwSeries(2),
      bmwSeries(3),
      bmwSeries(4),
      bmwSeries(5),
      bmwSeries(6),
      bmwSeries(7),
      bmwSeries(8),
      ...codes("X1", "X2", "X3", "X4", "X5", "X6", "X7", "Z4"),
      m("i3", "i3"),
      m("i4", "i4"),
      m("ix", "iX"),
      m("ix1", "iX1"),
      m("ix3", "iX3"),
      m("m2", "M2"),
      m("m3", "M3"),
      m("m4", "M4"),
      m("m5", "M5"),
    ],
  },
  {
    slug: "audi",
    name: "Audi",
    models: [
      ...codes("A1", "A3", "A4", "A5", "A6", "A7", "A8", "Q2", "Q3", "Q4", "Q5", "Q7", "Q8", "TT", "R8"),
      m("e-tron", "e-tron", { aliases: ["e tron", "etron"] }),
      m("e-tron-gt", "e-tron GT", { aliases: ["e tron gt"] }),
      ...codes("S3", "S4", "S5", "RS3", "RS4", "RS6"),
    ],
  },
  {
    slug: "opel",
    name: "Opel",
    models: [
      m("corsa", "Corsa"),
      m("astra", "Astra"),
      m("insignia", "Insignia"),
      m("zafira", "Zafira"),
      m("mokka", "Mokka"),
      m("adam", "Adam"),
      m("karl", "Karl"),
      m("meriva", "Meriva"),
      m("crossland", "Crossland", { aliases: ["crossland x"] }),
      m("grandland", "Grandland", { aliases: ["grandland x"] }),
      m("combo", "Combo"),
      m("vivaro", "Vivaro"),
      m("agila", "Agila"),
    ],
  },
  {
    slug: "ford",
    name: "Ford",
    models: [
      m("fiesta", "Fiesta"),
      m("focus", "Focus"),
      m("kuga", "Kuga"),
      m("mondeo", "Mondeo"),
      m("s-max", "S-Max", { aliases: ["s max", "smax"] }),
      m("galaxy", "Galaxy"),
      m("c-max", "C-Max", { aliases: ["c max", "cmax", "grand c max"] }),
      m("b-max", "B-Max", { aliases: ["b max", "bmax"] }),
      m("ka", "Ka"),
      m("puma", "Puma"),
      m("ecosport", "EcoSport"),
      m("mustang", "Mustang", { aliases: ["mustang mach e"] }),
      m("ranger", "Ranger"),
      m("transit", "Transit", { aliases: ["transit custom", "tourneo", "tourneo custom"] }),
    ],
  },
  {
    slug: "skoda",
    name: "Škoda",
    models: [
      m("fabia", "Fabia"),
      m("octavia", "Octavia"),
      m("superb", "Superb"),
      m("karoq", "Karoq"),
      m("kodiaq", "Kodiaq"),
      m("kamiq", "Kamiq"),
      m("scala", "Scala"),
      m("rapid", "Rapid"),
      m("citigo", "Citigo"),
      m("yeti", "Yeti"),
      m("roomster", "Roomster"),
      m("enyaq", "Enyaq"),
    ],
  },
  {
    slug: "seat",
    name: "SEAT",
    models: [
      m("ibiza", "Ibiza"),
      m("leon", "Leon"),
      m("ateca", "Ateca"),
      m("alhambra", "Alhambra"),
      m("arona", "Arona"),
      m("tarraco", "Tarraco"),
      m("mii", "Mii"),
      m("altea", "Altea"),
    ],
  },
  {
    slug: "cupra",
    name: "Cupra",
    models: [m("formentor", "Formentor"), m("born", "Born"), m("leon", "Leon"), m("ateca", "Ateca"), m("tavascan", "Tavascan")],
  },
  {
    slug: "renault",
    name: "Renault",
    models: [
      m("clio", "Clio"),
      m("megane", "Mégane"),
      m("captur", "Captur"),
      m("scenic", "Scénic", { aliases: ["grand scenic"] }),
      m("zoe", "ZOE"),
      m("twingo", "Twingo"),
      m("kadjar", "Kadjar"),
      m("koleos", "Koleos"),
      m("austral", "Austral"),
      m("arkana", "Arkana"),
      m("kangoo", "Kangoo"),
      m("trafic", "Trafic"),
      m("espace", "Espace"),
      m("talisman", "Talisman"),
    ],
  },
  {
    slug: "peugeot",
    name: "Peugeot",
    models: codes("107", "108", "206", "207", "208", "307", "308", "407", "508", "2008", "3008", "5008", "Partner", "Rifter", "Expert"),
  },
  {
    slug: "citroen",
    name: "Citroën",
    models: [
      ...codes("C1", "C3", "C4", "C5"),
      m("c3-aircross", "C3 Aircross", { aliases: ["c3 aircross"] }),
      m("c5-aircross", "C5 Aircross", { aliases: ["c5 aircross"] }),
      m("c4-picasso", "C4 Picasso", { aliases: ["c4 picasso", "grand c4 picasso", "c4 spacetourer", "grand c4 spacetourer"] }),
      m("berlingo", "Berlingo"),
      m("jumpy", "Jumpy"),
      m("ami", "Ami"),
    ],
  },
  {
    slug: "ds",
    name: "DS",
    aliases: ["ds automobiles"],
    models: [m("ds3", "DS 3", { aliases: ["ds 3", "3"] }), m("ds4", "DS 4", { aliases: ["ds 4", "4"] }), m("ds7", "DS 7", { aliases: ["ds 7", "7"] })],
  },
  {
    slug: "toyota",
    name: "Toyota",
    models: [
      m("yaris", "Yaris", { aliases: ["yaris cross"] }),
      m("corolla", "Corolla"),
      m("auris", "Auris"),
      m("rav4", "RAV4", { aliases: ["rav 4"] }),
      m("prius", "Prius"),
      m("c-hr", "C-HR", { aliases: ["c hr", "chr"] }),
      m("aygo", "Aygo", { aliases: ["aygo x"] }),
      m("avensis", "Avensis"),
      m("verso", "Verso"),
      m("land-cruiser", "Land Cruiser", { aliases: ["land cruiser"] }),
      m("hilux", "Hilux"),
      m("proace", "Proace"),
      m("gr86", "GR86", { aliases: ["gt86", "gr 86"] }),
      m("supra", "Supra"),
    ],
  },
  {
    slug: "lexus",
    name: "Lexus",
    models: codes("CT", "IS", "ES", "NX", "RX", "UX", "LBX"),
  },
  {
    slug: "hyundai",
    name: "Hyundai",
    models: [
      m("i10", "i10"),
      m("i20", "i20"),
      m("i30", "i30"),
      m("i40", "i40"),
      m("ix20", "ix20"),
      m("ix35", "ix35"),
      m("tucson", "Tucson"),
      m("kona", "Kona"),
      m("santa-fe", "Santa Fe", { aliases: ["santa fe"] }),
      m("bayon", "Bayon"),
      m("ioniq", "IONIQ"),
      m("ioniq-5", "IONIQ 5", { aliases: ["ioniq 5"] }),
      m("ioniq-6", "IONIQ 6", { aliases: ["ioniq 6"] }),
    ],
  },
  {
    slug: "kia",
    name: "Kia",
    models: [
      m("picanto", "Picanto"),
      m("rio", "Rio"),
      m("ceed", "Ceed", { aliases: ["cee d", "proceed", "pro ceed"] }),
      m("xceed", "XCeed"),
      m("sportage", "Sportage"),
      m("niro", "Niro", { aliases: ["e niro"] }),
      m("sorento", "Sorento"),
      m("stonic", "Stonic"),
      m("soul", "Soul"),
      m("venga", "Venga"),
      m("carens", "Carens"),
      m("ev6", "EV6"),
      m("ev9", "EV9"),
    ],
  },
  {
    slug: "fiat",
    name: "Fiat",
    models: [
      m("500", "500", { aliases: ["500c", "500e"] }),
      m("500x", "500X"),
      m("500l", "500L"),
      m("panda", "Panda"),
      m("tipo", "Tipo"),
      m("doblo", "Doblò"),
      m("punto", "Punto", { aliases: ["grande punto"] }),
      m("ducato", "Ducato"),
      m("qubo", "Qubo"),
    ],
  },
  {
    slug: "abarth",
    name: "Abarth",
    models: [m("500", "500", { aliases: ["595", "695", "500c"] }), m("124-spider", "124 Spider", { aliases: ["124 spider"] })],
  },
  {
    slug: "alfa-romeo",
    name: "Alfa Romeo",
    aliases: ["alfa"],
    models: [m("giulia", "Giulia"), m("giulietta", "Giulietta"), m("stelvio", "Stelvio"), m("mito", "MiTo"), m("tonale", "Tonale"), m("159", "159")],
  },
  {
    slug: "dacia",
    name: "Dacia",
    models: [m("sandero", "Sandero"), m("duster", "Duster"), m("logan", "Logan", { aliases: ["logan mcv"] }), m("jogger", "Jogger"), m("spring", "Spring"), m("lodgy", "Lodgy"), m("dokker", "Dokker")],
  },
  {
    slug: "mazda",
    name: "Mazda",
    models: [
      m("2", "2", { aliases: ["mazda2"] }),
      m("3", "3", { aliases: ["mazda3"] }),
      m("6", "6", { aliases: ["mazda6"] }),
      m("cx-3", "CX-3", { aliases: ["cx 3", "cx3"] }),
      m("cx-30", "CX-30", { aliases: ["cx 30", "cx30"] }),
      m("cx-5", "CX-5", { aliases: ["cx 5", "cx5"] }),
      m("cx-60", "CX-60", { aliases: ["cx 60", "cx60"] }),
      m("mx-5", "MX-5", { aliases: ["mx 5", "mx5"] }),
      m("mx-30", "MX-30", { aliases: ["mx 30", "mx30"] }),
    ],
  },
  {
    slug: "nissan",
    name: "Nissan",
    models: [
      m("micra", "Micra"),
      m("juke", "Juke"),
      m("qashqai", "Qashqai"),
      m("x-trail", "X-Trail", { aliases: ["x trail", "xtrail"] }),
      m("leaf", "Leaf"),
      m("note", "Note"),
      m("navara", "Navara"),
      m("ariya", "Ariya"),
      m("pulsar", "Pulsar"),
    ],
  },
  {
    slug: "honda",
    name: "Honda",
    models: [m("jazz", "Jazz"), m("civic", "Civic"), m("cr-v", "CR-V", { aliases: ["cr v", "crv"] }), m("hr-v", "HR-V", { aliases: ["hr v", "hrv"] }), m("zr-v", "ZR-V", { aliases: ["zr v", "zrv"] }), m("e", "e")],
  },
  {
    slug: "mitsubishi",
    name: "Mitsubishi",
    models: [m("space-star", "Space Star", { aliases: ["space star"] }), m("asx", "ASX"), m("outlander", "Outlander"), m("eclipse-cross", "Eclipse Cross", { aliases: ["eclipse cross"] }), m("colt", "Colt"), m("l200", "L200")],
  },
  {
    slug: "suzuki",
    name: "Suzuki",
    models: [m("swift", "Swift"), m("vitara", "Vitara"), m("sx4", "SX4", { aliases: ["sx4 s cross", "s cross"] }), m("ignis", "Ignis"), m("jimny", "Jimny"), m("alto", "Alto"), m("splash", "Splash"), m("celerio", "Celerio")],
  },
  {
    slug: "subaru",
    name: "Subaru",
    models: [m("forester", "Forester"), m("outback", "Outback"), m("impreza", "Impreza"), m("xv", "XV", { aliases: ["crosstrek"] }), m("legacy", "Legacy")],
  },
  {
    slug: "volvo",
    name: "Volvo",
    models: [
      ...codes("V40", "V50", "V60", "V70", "V90", "S60", "S90", "XC40", "XC60", "XC70", "XC90", "EX30", "C30"),
    ],
  },
  {
    slug: "polestar",
    name: "Polestar",
    models: [m("2", "2", { aliases: ["polestar 2"] }), m("3", "3", { aliases: ["polestar 3"] }), m("4", "4", { aliases: ["polestar 4"] })],
  },
  {
    slug: "tesla",
    name: "Tesla",
    models: [
      m("model-3", "Model 3", { aliases: ["model 3"] }),
      m("model-y", "Model Y", { aliases: ["model y"] }),
      m("model-s", "Model S", { aliases: ["model s"] }),
      m("model-x", "Model X", { aliases: ["model x"] }),
    ],
  },
  {
    slug: "byd",
    name: "BYD",
    models: [m("atto-3", "Atto 3", { aliases: ["atto 3"] }), m("dolphin", "Dolphin"), m("seal", "Seal"), m("han", "Han"), m("tang", "Tang")],
  },
  {
    slug: "mg",
    name: "MG",
    aliases: ["mg motor", "mg roewe"],
    models: [m("mg4", "MG4", { aliases: ["4"] }), m("zs", "ZS"), m("hs", "HS"), m("mg5", "MG5", { aliases: ["5"] }), m("marvel-r", "Marvel R", { aliases: ["marvel r"] })],
  },
  {
    slug: "porsche",
    name: "Porsche",
    models: [
      m("911", "911"),
      m("cayenne", "Cayenne"),
      m("macan", "Macan"),
      m("panamera", "Panamera"),
      m("taycan", "Taycan"),
      m("boxster", "Boxster", { aliases: ["718 boxster"] }),
      m("cayman", "Cayman", { aliases: ["718 cayman"] }),
    ],
  },
  {
    slug: "mini",
    name: "MINI",
    models: [
      m("cooper", "Cooper", { aliases: ["one", "cooper s", "cooper se", "cooper d", "john cooper works"] }),
      m("countryman", "Countryman", { aliases: ["cooper countryman", "cooper s countryman", "one countryman", "cooper d countryman"] }),
      m("clubman", "Clubman", { aliases: ["cooper clubman", "cooper s clubman", "one clubman"] }),
      m("cabrio", "Cabrio", { aliases: ["cooper cabrio", "cooper s cabrio", "one cabrio"] }),
      m("paceman", "Paceman"),
    ],
  },
  {
    slug: "smart",
    name: "smart",
    models: [
      m("fortwo", "fortwo", { aliases: ["for two", "eq fortwo"] }),
      m("forfour", "forfour", { aliases: ["for four", "eq forfour"] }),
      m("1", "#1", { aliases: ["1", "hashtag 1"] }),
      m("3", "#3", { aliases: ["3", "hashtag 3"] }),
    ],
  },
  {
    slug: "land-rover",
    name: "Land Rover",
    aliases: ["landrover"],
    models: [
      m("range-rover", "Range Rover", { aliases: ["range rover"] }),
      m("range-rover-sport", "Range Rover Sport", { aliases: ["range rover sport"] }),
      m("range-rover-evoque", "Range Rover Evoque", { aliases: ["range rover evoque", "evoque"] }),
      m("range-rover-velar", "Range Rover Velar", { aliases: ["range rover velar", "velar"] }),
      m("discovery", "Discovery"),
      m("discovery-sport", "Discovery Sport", { aliases: ["discovery sport"] }),
      m("defender", "Defender"),
      m("freelander", "Freelander"),
    ],
  },
  {
    slug: "jaguar",
    name: "Jaguar",
    models: [m("xe", "XE"), m("xf", "XF"), m("f-pace", "F-Pace", { aliases: ["f pace"] }), m("e-pace", "E-Pace", { aliases: ["e pace"] }), m("i-pace", "I-Pace", { aliases: ["i pace"] }), m("f-type", "F-Type", { aliases: ["f type"] })],
  },
  {
    slug: "jeep",
    name: "Jeep",
    models: [m("renegade", "Renegade"), m("compass", "Compass"), m("wrangler", "Wrangler"), m("grand-cherokee", "Grand Cherokee", { aliases: ["grand cherokee"] }), m("cherokee", "Cherokee"), m("avenger", "Avenger")],
  },
  {
    slug: "chevrolet",
    name: "Chevrolet",
    models: [m("spark", "Spark"), m("aveo", "Aveo"), m("cruze", "Cruze"), m("captiva", "Captiva"), m("camaro", "Camaro"), m("corvette", "Corvette")],
  },
];

export function findMake(slug: string): MakeDef | undefined {
  return MAKES.find((make) => make.slug === slug);
}

export function findModel(makeSlug: string, modelSlug: string): ModelDef | undefined {
  return findMake(makeSlug)?.models.find((model) => model.slug === modelSlug);
}
