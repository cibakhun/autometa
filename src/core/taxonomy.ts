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
  /**
   * The last year the model was built, for models no longer made. A first registration years
   * later is a typo or the date of a later registration (see plausibleRegistration).
   */
  until?: number;
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

/** Codes that sellers also write with a space, e.g. Volvo "XC 60". */
const spacedCodes = (...names: string[]): ModelDef[] =>
  names.map((name) => m(name.toLowerCase(), name, { aliases: [name.toLowerCase().replace(/^([a-z]+)(\d+)$/, "$1 $2")] }));

/** Lexus "IS" also as "IS200" or "IS300h": the engine code follows the model letters. */
const lexus = (code: string): ModelDef => m(code.toLowerCase(), code, { firstWord: new RegExp(`^${code.toLowerCase()}\\d{3}[a-z]*$`) });

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
      m("transporter", "Transporter", { aliases: ["t2", "t3", "t4", "t5", "t6", "t6 1", "t7", "bus", "bulli"] }),
      m("multivan", "Multivan"),
      m("california", "California"),
      m("caravelle", "Caravelle"),
      m("id-3", "ID.3", { aliases: ["id 3", "id3"] }),
      m("id-4", "ID.4", { aliases: ["id 4", "id4"] }),
      m("id-5", "ID.5", { aliases: ["id 5", "id5"] }),
      m("id-buzz", "ID. Buzz", { aliases: ["id buzz"] }),
      m("id-7", "ID.7", { aliases: ["id 7", "id7"] }),
      m("tayron", "Tayron"),
      m("eos", "Eos"),
      m("lupo", "Lupo"),
      m("jetta", "Jetta"),
      m("bora", "Bora"),
      m("phaeton", "Phaeton"),
      m("crafter", "Crafter"),
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
      m("eqv", "EQV"),
      m("clk", "CLK"),
      m("slc", "SLC"),
      m("glk", "GLK"),
      m("gl", "GL"),
      m("amg-gt", "AMG GT", { aliases: ["amg gt"] }),
      m("amg-one", "AMG ONE", { aliases: ["amg one"] }),
      m("sls", "SLS AMG", { aliases: ["sls amg"], until: 2014 }),
      m("slr", "SLR McLaren", { aliases: ["slr mclaren", "mclaren slr"], until: 2010 }),
      m("marco-polo", "Marco Polo", { aliases: ["marco polo"] }),
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
      m("m6", "M6"),
      m("m8", "M8"),
      m("z3", "Z3"),
      m("i5", "i5"),
      m("i7", "i7"),
      m("ix2", "iX2"),
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
      ...codes("A2", "Q6", "S1", "S6", "S7", "S8", "SQ2", "SQ5", "SQ7", "SQ8", "RS5", "RS7", "RSQ3", "RSQ8"),
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
      m("vectra", "Vectra"),
      m("signum", "Signum"),
      m("tigra", "Tigra"),
      m("calibra", "Calibra"),
      m("cascada", "Cascada"),
      m("omega", "Omega"),
      m("antara", "Antara"),
      m("movano", "Movano"),
      m("frontera", "Frontera"),
      m("kadett", "Kadett"),
      m("ampera", "Ampera", { aliases: ["ampera e"] }),
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
      m("fusion", "Fusion"),
      m("escort", "Escort"),
      m("edge", "Edge"),
      m("explorer", "Explorer"),
      m("capri", "Capri"),
      m("taunus", "Taunus"),
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
      m("elroq", "Elroq"),
      m("felicia", "Felicia"),
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
      m("toledo", "Toledo"),
      m("cordoba", "Córdoba"),
      m("arosa", "Arosa"),
      m("exeo", "Exeo"),
      m("marbella", "Marbella"),
    ],
  },
  {
    slug: "cupra",
    name: "Cupra",
    models: [m("formentor", "Formentor"), m("born", "Born"), m("leon", "Leon"), m("ateca", "Ateca"), m("tavascan", "Tavascan"), m("terramar", "Terramar"), m("raval", "Raval")],
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
      m("master", "Master"),
      m("laguna", "Laguna"),
      m("modus", "Modus", { aliases: ["grand modus"] }),
      m("symbioz", "Symbioz"),
      m("rafale", "Rafale"),
      m("fluence", "Fluence"),
      m("wind", "Wind"),
      m("5", "R5", { aliases: ["r5"] }),
      m("19", "R19", { aliases: ["r19"], until: 2000 }),
    ],
  },
  {
    slug: "peugeot",
    name: "Peugeot",
    models: [
      ...codes("106", "107", "108", "205", "306", "406", "407", "408", "508", "607", "807", "1007", "4007", "4008"),
      m("206", "206", { aliases: ["206cc", "206sw"] }),
      m("207", "207", { aliases: ["207cc", "207sw"] }),
      m("208", "208", { aliases: ["e 208"] }),
      m("307", "307", { aliases: ["307cc", "307sw"] }),
      m("308", "308", { aliases: ["308cc", "308sw", "e 308"] }),
      m("2008", "2008", { aliases: ["e 2008"] }),
      m("3008", "3008", { aliases: ["e 3008"] }),
      m("5008", "5008", { aliases: ["e 5008"] }),
      ...codes("Partner", "Rifter", "Expert", "Boxer", "Traveller", "Bipper", "RCZ"),
    ],
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
      ...codes("C2", "C6", "C8"),
      m("spacetourer", "SpaceTourer"),
      m("jumper", "Jumper"),
      m("xsara", "Xsara"),
      m("saxo", "Saxo"),
    ],
  },
  {
    slug: "ds",
    name: "DS",
    aliases: ["ds automobiles", "ds automobile"],
    models: [
      m("ds3", "DS 3", { aliases: ["ds 3", "3", "citroen ds3", "citroen ds 3"] }),
      m("ds4", "DS 4", { aliases: ["ds 4", "4", "citroen ds4", "citroen ds 4"] }),
      m("ds5", "DS 5", { aliases: ["ds 5", "5", "citroen ds5", "citroen ds 5"] }),
      m("ds7", "DS 7", { aliases: ["ds 7", "7"] }),
      m("ds9", "DS 9", { aliases: ["ds 9", "9"] }),
    ],
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
      m("camry", "Camry"),
      m("celica", "Celica"),
      m("bz4x", "bZ4X"),
      m("urban-cruiser", "Urban Cruiser", { aliases: ["urban cruiser"] }),
      m("iq", "iQ"),
    ],
  },
  {
    slug: "lexus",
    name: "Lexus",
    models: [...["CT", "IS", "ES", "NX", "RX", "UX", "GS", "LS", "LC", "RC", "RZ"].map(lexus), m("lbx", "LBX"), m("lfa", "LFA", { aliases: ["lf a"], until: 2012 })],
  },
  {
    slug: "hyundai",
    name: "Hyundai",
    models: [
      m("i10", "i10"),
      m("i20", "i20", { aliases: ["i20n"] }),
      m("i30", "i30", { aliases: ["i30n"] }),
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
      m("getz", "Getz"),
      m("matrix", "Matrix"),
      m("accent", "Accent"),
      m("veloster", "Veloster"),
      m("h-1", "H-1", { aliases: ["h 1", "h1"] }),
      m("staria", "Staria"),
      m("inster", "Inster"),
      m("sonata", "Sonata"),
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
      m("ev3", "EV3"),
      m("ev4", "EV4"),
      m("k4", "K4"),
      m("optima", "Optima"),
      m("carnival", "Carnival"),
      m("magentis", "Magentis"),
      m("cerato", "Cerato"),
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
      m("600", "600", { aliases: ["600e"] }),
      m("scudo", "Scudo"),
      m("bravo", "Bravo"),
      m("stilo", "Stilo"),
      m("seicento", "Seicento"),
      m("sedici", "Sedici"),
      m("fiorino", "Fiorino"),
      m("multipla", "Multipla"),
      m("croma", "Croma"),
      m("freemont", "Freemont"),
      m("idea", "Idea"),
      m("ulysse", "Ulysse"),
      m("barchetta", "Barchetta"),
      m("uno", "Uno"),
    ],
  },
  {
    slug: "abarth",
    name: "Abarth",
    models: [m("500", "500", { aliases: ["595", "595c", "695", "695c", "500c"] }), m("124-spider", "124 Spider", { aliases: ["124 spider"] })],
  },
  {
    slug: "alfa-romeo",
    name: "Alfa Romeo",
    aliases: ["alfa"],
    models: [
      m("giulia", "Giulia"),
      m("giulietta", "Giulietta"),
      m("stelvio", "Stelvio"),
      m("mito", "MiTo"),
      m("tonale", "Tonale"),
      m("junior", "Junior"),
      m("spider", "Spider"),
      m("gtv", "GTV"),
      m("brera", "Brera"),
      m("gt", "GT"),
      ...codes("145", "146", "147", "156", "159", "164", "166", "4C"),
    ],
  },
  {
    slug: "dacia",
    name: "Dacia",
    models: [m("sandero", "Sandero"), m("duster", "Duster"), m("logan", "Logan", { aliases: ["logan mcv"] }), m("jogger", "Jogger"), m("spring", "Spring"), m("lodgy", "Lodgy"), m("dokker", "Dokker"), m("bigster", "Bigster")],
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
      m("5", "5", { aliases: ["mazda5"] }),
      m("cx-7", "CX-7", { aliases: ["cx 7", "cx7"] }),
      m("cx-80", "CX-80", { aliases: ["cx 80", "cx80"] }),
      m("cx-9", "CX-9", { aliases: ["cx 9", "cx9"] }),
      m("rx-8", "RX-8", { aliases: ["rx 8", "rx8"] }),
      m("323", "323"),
      m("626", "626"),
      m("premacy", "Premacy"),
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
      m("townstar", "Townstar"),
      m("almera", "Almera"),
      m("primastar", "Primastar"),
      m("pathfinder", "Pathfinder"),
      m("murano", "Murano"),
      m("patrol", "Patrol"),
      m("terrano", "Terrano"),
      m("350z", "350Z"),
      m("370z", "370Z"),
      m("gt-r", "GT-R", { aliases: ["gt r", "gtr"] }),
      m("nv200", "NV200", { aliases: ["e nv200"] }),
      m("cube", "Cube"),
      m("pixo", "Pixo"),
    ],
  },
  {
    slug: "honda",
    name: "Honda",
    models: [m("jazz", "Jazz"), m("civic", "Civic"), m("cr-v", "CR-V", { aliases: ["cr v", "crv"] }), m("hr-v", "HR-V", { aliases: ["hr v", "hrv"] }), m("zr-v", "ZR-V", { aliases: ["zr v", "zrv"] }), m("e", "e"),
      m("accord", "Accord"), m("fr-v", "FR-V", { aliases: ["fr v", "frv"] }), m("s2000", "S2000"), m("insight", "Insight"), m("stream", "Stream"),
      m("prelude", "Prelude"), m("cr-z", "CR-Z", { aliases: ["cr z", "crz"] }), m("legend", "Legend")],
  },
  {
    slug: "mitsubishi",
    name: "Mitsubishi",
    models: [m("space-star", "Space Star", { aliases: ["space star"] }), m("asx", "ASX"), m("outlander", "Outlander"), m("eclipse-cross", "Eclipse Cross", { aliases: ["eclipse cross"] }), m("colt", "Colt"), m("l200", "L200"),
      m("grandis", "Grandis"), m("pajero", "Pajero"), m("lancer", "Lancer"), m("galant", "Galant"), m("carisma", "Carisma"),
      m("i-miev", "i-MiEV", { aliases: ["i miev"] }), m("space-wagon", "Space Wagon", { aliases: ["space wagon"] })],
  },
  {
    slug: "suzuki",
    name: "Suzuki",
    models: [m("swift", "Swift"), m("vitara", "Vitara", { aliases: ["grand vitara"] }), m("sx4", "SX4", { aliases: ["sx4 s cross", "s cross"] }), m("ignis", "Ignis"), m("jimny", "Jimny"), m("alto", "Alto"), m("splash", "Splash"), m("celerio", "Celerio"),
      m("baleno", "Baleno"), m("wagon-r", "Wagon R", { aliases: ["wagon r"] }), m("liana", "Liana"), m("swace", "Swace"), m("across", "Across"), m("samurai", "Samurai")],
  },
  {
    slug: "subaru",
    name: "Subaru",
    models: [m("forester", "Forester"), m("outback", "Outback"), m("impreza", "Impreza"), m("xv", "XV", { aliases: ["crosstrek"] }), m("legacy", "Legacy"),
      m("justy", "Justy"), m("brz", "BRZ"), m("levorg", "Levorg"), m("trezia", "Trezia"), m("tribeca", "Tribeca"), m("solterra", "Solterra")],
  },
  {
    slug: "volvo",
    name: "Volvo",
    models: [
      ...spacedCodes("V40", "V50", "V60", "V70", "V90", "S40", "S60", "S70", "S80", "S90", "XC40", "XC60", "XC70", "XC90"),
      ...spacedCodes("EX30", "EX40", "EX90", "EC40", "C30", "C40", "C70"),
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
      m("model-3", "Model 3", { aliases: ["model 3", "modell 3", "model3", "3", "highland"] }),
      m("model-y", "Model Y", { aliases: ["model y", "modell y", "modely", "y", "juniper"] }),
      // "Model S75", "S85D": the battery size follows the letter.
      m("model-s", "Model S", { aliases: ["model s", "modell s", "s"], firstWord: /^s\d{2,3}d?$/ }),
      m("model-x", "Model X", { aliases: ["model x", "modell x", "x"], firstWord: /^x\d{2,3}d?$/ }),
    ],
  },
  {
    slug: "byd",
    name: "BYD",
    models: [m("atto-3", "Atto 3", { aliases: ["atto 3"] }), m("atto-2", "Atto 2", { aliases: ["atto 2"] }), m("sealion-7", "Sealion 7", { aliases: ["sealion 7", "sealion"] }), m("dolphin", "Dolphin"), m("seal", "Seal"), m("han", "Han"), m("tang", "Tang")],
  },
  {
    slug: "mg",
    name: "MG",
    aliases: ["mg motor", "mg roewe"],
    models: [m("mg4", "MG4", { aliases: ["4"] }), m("zs", "ZS"), m("hs", "HS"), m("mg5", "MG5", { aliases: ["5"] }), m("marvel-r", "Marvel R", { aliases: ["marvel r"] }),
      m("mg3", "MG3", { aliases: ["3"] }), m("ehs", "EHS"), m("mgf", "MGF", { aliases: ["f"] }), m("mgb", "MGB", { aliases: ["b"] }), m("midget", "Midget"), m("tf", "TF"),
      m("cyberster", "Cyberster")],
  },
  {
    slug: "porsche",
    name: "Porsche",
    models: [
      m("911", "911", { aliases: ["991", "992", "997", "996", "993", "964", "930", "carrera", "targa"] }),
      m("cayenne", "Cayenne"),
      m("macan", "Macan"),
      m("panamera", "Panamera"),
      m("taycan", "Taycan"),
      m("boxster", "Boxster", { aliases: ["718 boxster"] }),
      m("cayman", "Cayman", { aliases: ["718 cayman"] }),
      m("356", "356", { until: 1965 }),
      m("914", "914", { until: 1976 }),
      m("924", "924", { until: 1988 }),
      m("928", "928", { until: 1995 }),
      m("944", "944", { until: 1991 }),
      m("968", "968", { until: 1995 }),
      // A longer match than "carrera", which names the 911.
      m("carrera-gt", "Carrera GT", { aliases: ["carrera gt"], until: 2006 }),
      m("918", "918 Spyder", { aliases: ["918 spyder"], until: 2015 }),
      m("959", "959", { until: 1993 }),
      m("962", "962"),
      m("935", "935"),
    ],
  },
  {
    slug: "mini",
    name: "MINI",
    models: [
      m("cooper", "Cooper", { aliases: ["cooper s", "cooper se", "cooper d", "john cooper works"] }),
      // The portals list the One as a model of its own, below the Cooper.
      m("one", "One", { aliases: ["one d", "one first"] }),
      m("countryman", "Countryman", { aliases: ["cooper countryman", "cooper s countryman", "one countryman", "one d countryman", "cooper d countryman"] }),
      m("clubman", "Clubman", { aliases: ["cooper clubman", "cooper s clubman", "one clubman", "one d clubman"] }),
      m("cabrio", "Cabrio", { aliases: ["cooper cabrio", "cooper s cabrio", "one cabrio"] }),
      m("paceman", "Paceman"),
      m("aceman", "Aceman"),
      m("coupe", "Coupé"),
      m("roadster", "Roadster"),
    ],
  },
  {
    slug: "smart",
    name: "smart",
    models: [
      m("fortwo", "fortwo", { aliases: ["for two", "eq fortwo", "450", "451", "453", "city coupe", "cabrio"] }),
      m("forfour", "forfour", { aliases: ["for four", "eq forfour", "454"] }),
      m("roadster", "roadster"),
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
    models: [m("xe", "XE"), m("xf", "XF"), m("f-pace", "F-Pace", { aliases: ["f pace"] }), m("e-pace", "E-Pace", { aliases: ["e pace"] }), m("i-pace", "I-Pace", { aliases: ["i pace"] }), m("f-type", "F-Type", { aliases: ["f type"] }),
      m("xj", "XJ", { aliases: ["xj6", "xj8", "xj12", "xjr"] }), m("xk", "XK", { aliases: ["xk8", "xkr"] }), m("s-type", "S-Type", { aliases: ["s type"] }),
      m("x-type", "X-Type", { aliases: ["x type"] }), m("e-type", "E-Type", { aliases: ["e type"] })],
  },
  {
    slug: "jeep",
    name: "Jeep",
    models: [m("renegade", "Renegade"), m("compass", "Compass"), m("wrangler", "Wrangler"), m("grand-cherokee", "Grand Cherokee", { aliases: ["grand cherokee"] }), m("cherokee", "Cherokee"), m("avenger", "Avenger"), m("commander", "Commander"), m("patriot", "Patriot"), m("gladiator", "Gladiator")],
  },
  {
    slug: "chevrolet",
    name: "Chevrolet",
    models: [m("spark", "Spark"), m("aveo", "Aveo"), m("cruze", "Cruze"), m("captiva", "Captiva"), m("camaro", "Camaro"), m("corvette", "Corvette"),
      m("silverado", "Silverado"), m("orlando", "Orlando"), m("matiz", "Matiz"), m("kalos", "Kalos"), m("tahoe", "Tahoe"), m("trax", "Trax"),
      m("epica", "Epica"), m("lacetti", "Lacetti"), m("nubira", "Nubira"), m("suburban", "Suburban"), m("blazer", "Blazer")],
  },
];

export function findMake(slug: string): MakeDef | undefined {
  return MAKES.find((make) => make.slug === slug);
}

export function findModel(makeSlug: string, modelSlug: string): ModelDef | undefined {
  return findMake(makeSlug)?.models.find((model) => model.slug === modelSlug);
}

/**
 * Generation codes sellers write in titles ("997.1", "E46", "W124", "Golf 4", "Astra G"), with the
 * last year the generation was built in any body style, or null while it is still built. Matched
 * on the lower-case title without accents and with its punctuation (see plausibleRegistration).
 * Codes that only one generation of one make uses; a code shared with an engine size ("Golf 2.0"),
 * a door count ("Golf 5-Türer"), a mileage or a price ("997 km", "993 €") does not count.
 */
export interface GenerationDef {
  make: string;
  /** Only listings of this model, where the code alone means something else elsewhere ("B6"). */
  model?: string;
  /** Codes of one family may match together ("997" and "997.1"); the earliest end counts. */
  family: string;
  pattern: RegExp;
  /** Last year built; null while still built (it then only tells another generation apart). */
  until: number | null;
}

const NOT_AN_AMOUNT = String.raw`(?![.,]\d)(?!\s*(?:(?:km|kilometer|tkm|ps|kw|ccm|cm|nm|eur|euro)\b|€|,-))`;
/** A code standing alone: "997", "e46", "w 124"; not part of "1.997" or "997 km". */
const code = (body: string) => new RegExp(String.raw`(?<![\d.,])\b(?:${body})\b${NOT_AN_AMOUNT}`);
/** Words after a number that make it something else than a generation: "5-Türer", "7-Sitzer", "1. Hand". */
const NOT_A_GENERATION = String.raw`(?:t|tur(?:er|ig)?|tuer(?:er|ig)?|sitzer|sitzig|gang|zoll|zylinder|zyl|hand|jahre?|monate?|km|tkm|ps|kw|personen)\b|motion`;
/** "Golf 4", "Golf IV", "Golf-4"; not "Golf 2.0", "Golf 5-Türer", "Golf 4 Motion" or "Golf 1. Hand". */
const named = (model: string, codes: string) =>
  new RegExp(String.raw`\b${model}[ -]?(?:${codes})\b(?![.,]\d)(?![.,]?\s*-?\s*(?:${NOT_A_GENERATION}))`);
const gen = (make: string, family: string, pattern: RegExp, until: number | null, model?: string): GenerationDef =>
  model ? { make, model, family, pattern, until } : { make, family, pattern, until };

const PORSCHE: [string, number | null][] = [
  ["930", 1989], ["964", 1994], ["993", 1998], ["996", 2006], ["991", 2019], ["992", null],
  ["986", 2004], ["987", 2013], ["981", 2016], ["982", null], ["955", 2007], ["957", 2010], ["958", 2018], ["970", 2016], ["971", null],
];
const BMW: [string, number | null][] = [
  ["e3", 1977], ["e9", 1975], ["e12", 1981], ["e21", 1983], ["e24", 1989], ["e28", 1988], ["e30", 1994], ["e31", 1999], ["e34", 1997],
  ["e36", 2002], ["e38", 2001], ["e39", 2004], ["e46", 2006], ["e53", 2006], ["e60|e61", 2010], ["e63|e64", 2010], ["e65|e66", 2008],
  ["e70", 2013], ["e71", 2014], ["e81|e87", 2011], ["e82|e88", 2013], ["e83", 2010], ["e84", 2015], ["e85|e86", 2008], ["e89", 2016],
  ["e90|e91|e92|e93", 2013], ["f01|f02", 2015], ["f06|f12|f13", 2018], ["f07|f10|f11", 2017], ["f15", 2018], ["f16", 2019],
  ["f20|f21", 2019], ["f22|f23", 2021], ["f25", 2017], ["f26", 2018], ["f30|f31", 2019], ["f32|f33|f36", 2020], ["f34", 2020],
  ["f45|f46", 2022], ["f48", 2022], ["f80", 2018], ["f82|f83", 2020], ["f87", 2021], [String.raw`g\d{2}`, null],
];
/** Mercedes-Benz chassis codes, with the letters sellers put before them (W saloon, S estate, C coupé, A cabrio, R roadster). */
const MERCEDES: [string, string, number | null][] = [
  ["w ?", "108|109", 1972], ["w ?", "110", 1968], ["w ?", "111|113", 1971], ["w ?", "114|115", 1976], ["w ?", "116", 1980],
  ["w ?|s|c", "123", 1986], ["w ?|s|c|a", "124", 1997], ["w ?|c", "126", 1991], ["w ?|c", "140", 1998], ["w ?", "201", 1993],
  ["w ?|s", "202", 2001], ["w ?|s", "203", 2008], ["w ?|s|c", "204", 2015], ["w ?|s|c|a", "205", 2023], ["w ?|s|c|a", "206", null],
  ["w ?|s", "210", 2003], ["w ?|s", "211", 2009], ["w ?|s|c|a", "212", 2016], ["w ?|s", "213", 2024], ["w ?|s", "214", null],
  ["w ?", "220", 2005], ["w ?", "221", 2013], ["w ?", "222", 2020], ["w ?", "223", null], ["w ?", "168", 2004], ["w ?", "169", 2012],
  ["w ?", "176", 2018], ["w ?", "177", null], ["w ?", "245", 2011], ["w ?", "246", 2018], ["w ?", "247", null], ["w ?", "163", 2005],
  ["w ?", "164", 2011], ["w ?", "639", 2014], ["c|a", "208", 2003], ["c|a", "209", 2010], ["r ?", "107", 1989], ["r ?", "129", 2001],
  ["r ?", "170", 2004], ["r ?", "171", 2011], ["r ?", "230", 2012],
];
const GOLF = [["1|i", 1993], ["2|ii", 1992], ["3|iii", 2002], ["4|iv", 2006], ["5|v", 2009], ["6|vi", 2016], ["7|vii", 2021], ["8|viii", null]] as const;
const POLO = [["86c?", 1994], ["6n[12]?", 2002], ["9n[23]?", 2009], ["6r", 2014], ["6c", 2017], ["aw", null]] as const;
const PASSAT = [["b3", 1993], ["b4", 1997], [String.raw`b5(?:[.,]5)?`, 2005], ["b6", 2012], ["b7", 2015], ["b8", 2024], ["b9", null]] as const;
const AUDI_A3 = [["8l", 2003], ["8pa?", 2013], ["8va?", 2020], ["8y", null]] as const;
const AUDI_A4 = [["b5", 2001], ["b6", 2005], ["b7", 2009], ["b8", 2016], ["b9", null]] as const;
const AUDI_A6 = [["c4", 1997], ["c5", 2006], ["c6", 2011], ["c7", 2018], ["c8", null]] as const;
const ASTRA = [["f", 2000], ["g", 2009], ["h", 2014], ["j", 2018], ["k", 2022], ["l", null]] as const;
// No Corsa E: "Corsa-e" is the electric Corsa F.
const CORSA = [["a", 1993], ["b", 2001], ["c", 2007], ["d", 2015], ["f", null]] as const;

export const GENERATIONS: GenerationDef[] = [
  ...PORSCHE.map(([c, until]) => gen("porsche", c, code(c), until)),
  gen("porsche", "997", code("997"), 2013),
  gen("porsche", "997", code(String.raw`997[.,]1`), 2009),
  gen("porsche", "991", code(String.raw`991[.,]1`), 2016),
  ...BMW.map(([c, until]) => gen("bmw", c, code(c), until)),
  ...MERCEDES.map(([letters, c, until]) => gen("mercedes-benz", c, code(`(?:${letters})(?:${c})`), until)),
  ...GOLF.map(([c, until]) => gen("volkswagen", `golf-${c}`, named("golf", c), until)),
  ...POLO.map(([c, until]) => gen("volkswagen", `polo-${c}`, code(c), until, "polo")),
  ...PASSAT.map(([c, until]) => gen("volkswagen", `passat-${c}`, code(c), until, "passat")),
  ...AUDI_A3.map(([c, until]) => gen("audi", `a3-${c}`, code(c), until, "a3")),
  ...AUDI_A4.map(([c, until]) => gen("audi", `a4-${c}`, code(c), until, "a4")),
  ...AUDI_A6.map(([c, until]) => gen("audi", `a6-${c}`, code(c), until, "a6")),
  ...ASTRA.map(([c, until]) => gen("opel", `astra-${c}`, named("astra", c), until)),
  ...CORSA.map(([c, until]) => gen("opel", `corsa-${c}`, named("corsa", c), until)),
];
