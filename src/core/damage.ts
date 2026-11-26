import { normalizeText } from "./normalize";

/**
 * Damage a listing's title mentions. Only the kind is stored, never the text. The specific kinds
 * are what a later repair catalog maps to jobs; "defect" is the catch-all for a title that says
 * "defekt", "Schaden" or "Mängel" without naming a part we know.
 */
export const DAMAGE_KINDS = [
  "engine",
  "timing",
  "head_gasket",
  "turbo",
  "gearbox",
  "clutch",
  "electrics",
  "accident",
  "rust",
  "hail",
  "water",
  "not_running",
  "project",
  "defect",
] as const;
export type DamageKind = (typeof DAMAGE_KINDS)[number];

export const DAMAGE_LABELS: Record<DamageKind, string> = {
  engine: "Motorschaden",
  timing: "Steuerkette/Zahnriemen",
  head_gasket: "Zylinderkopfdichtung",
  turbo: "Turbolader",
  gearbox: "Getriebe",
  clutch: "Kupplung",
  electrics: "Elektrik",
  accident: "Unfallschaden",
  rust: "Rost",
  hail: "Hagelschaden",
  water: "Wasserschaden",
  not_running: "nicht fahrbereit",
  project: "Bastler/Export",
  defect: "Defekt",
};

// Matching runs on normalizeText output: lower case, umlauts without dots ("fährt" -> "fahrt"),
// everything else a single space.
const BROKEN = String.raw`(?: ist| sind)? (?:defekt|kaputt)`;

interface Rule {
  kind: DamageKind;
  pattern: RegExp;
  /** False when the pattern carries its own negation ("springt nicht an"). */
  negatable?: boolean;
}

const RULES: Rule[] = [
  { kind: "engine", pattern: /\bmotor(?:schaden|problem|probleme|platzer|storung)\b/g },
  { kind: "engine", pattern: /\bmotor (?:problem|probleme|storung)\b/g },
  { kind: "engine", pattern: new RegExp(String.raw`\bmotor(?:${BROKEN}| (?:ist )?(?:fest|tot)| klopft| macht gerausche)\b`, "g") },
  { kind: "engine", pattern: /\b(?:kolbenfresser|pleuellagerschaden|pleuelschaden|lagerschaden)\b/g },
  { kind: "engine", pattern: /\bohne motor\b/g, negatable: false },
  {
    kind: "timing",
    pattern: /\b(?:steuerkette|zahnriemen)(?: ist)? (?:gerissen|defekt|kaputt|gelangt|rasselt|ubergesprungen|ubersprungen)\b/g,
  },
  { kind: "timing", pattern: /\b(?:steuerkettenschaden|zahnriemenschaden|zahnriemenriss)\b/g },
  { kind: "head_gasket", pattern: new RegExp(String.raw`\b(?:zylinderkopfdichtung|kopfdichtung|zkd)(?:${BROKEN}| undicht)\b`, "g") },
  { kind: "head_gasket", pattern: /\bzylinderkopfschaden\b/g },
  { kind: "turbo", pattern: new RegExp(String.raw`\bturbo(?:lader)?(?:${BROKEN})\b`, "g") },
  { kind: "turbo", pattern: /\bturbo(?:lader)?schaden\b/g },
  { kind: "gearbox", pattern: /\b(?:getriebeschaden|mechatronikschaden|getriebeproblem|getriebeprobleme|getriebestorung)\b/g },
  { kind: "gearbox", pattern: /\b(?:getriebe|automatikgetriebe|dsg) (?:problem|probleme|storung)\b/g },
  {
    kind: "gearbox",
    pattern: new RegExp(String.raw`\b(?:getriebe|automatikgetriebe|schaltgetriebe|dsg|mechatronik|wandler)(?:${BROKEN}| schaltet nicht| springt raus)\b`, "g"),
  },
  { kind: "clutch", pattern: new RegExp(String.raw`\b(?:kupplung|zms|zweimassenschwungrad)(?:${BROKEN}| rutscht| schleift)\b`, "g") },
  { kind: "clutch", pattern: /\bkupplungsschaden\b/g },
  { kind: "electrics", pattern: /\b(?:elektrik|elektronik)(?:fehler|problem|probleme|schaden)\b/g },
  {
    kind: "electrics",
    pattern: new RegExp(String.raw`\b(?:elektrik|elektronik|steuergerat|motorsteuergerat|kabelbaum)(?:${BROKEN})\b`, "g"),
  },
  { kind: "electrics", pattern: /\bkabelbrand\b/g },
  {
    kind: "accident",
    pattern: /\b(?:unfall|unfallwagen|unfallfahrzeug|unfallauto|unfallschaden|frontschaden|heckschaden|seitenschaden|totalschaden|karosserieschaden|blechschaden)\b/g,
  },
  { kind: "accident", pattern: /\bnicht unfallfrei\b/g, negatable: false },
  { kind: "rust", pattern: /\b(?:rost|rostschaden|rostloch|rostlocher|rostprobleme|durchgerostet)\b/g },
  { kind: "hail", pattern: /\b(?:hagel|hagelschaden)\b/g },
  { kind: "water", pattern: /\b(?:wasserschaden|flutschaden|hochwasser|hochwasserschaden|hochwasserfahrzeug)\b/g },
  {
    kind: "not_running",
    pattern:
      /\b(?:springt nicht (?:mehr )?an|nicht (?:mehr )?fahrbereit|nicht (?:mehr )?fahrtuchtig|nicht (?:mehr )?fahrbar|fahruntuchtig|fahrt nicht(?: mehr)?|lauft nicht(?: mehr)?|nicht (?:mehr )?lauffahig)\b/g,
    negatable: false,
  },
  {
    kind: "project",
    // "Export T1" is a customs transit document a dealer exports new cars with, not a parts car.
    pattern: /\b(?:bastler|bastlerfahrzeug|bastlerauto|bastlerwagen|teiletrager|teilespender|ersatzteilspender|teileverkauf|teileauto|schlachtfahrzeug|ausschlachten|schlachten|export(?! t[12]\b))\b/g,
  },
];

/**
 * Generic words, used only when no specific kind matched. "def" is "def." with its dot gone
 * ("Injektor def."); "beschädigt" mostly means the body, but says too little to count as an accident.
 */
const GENERIC: RegExp =
  /\b(?:defekt|defekte|defekter|defektes|def|kaputt|schaden|mangel|mangeln|beschadigt|beschadigte|beschadigter|beschadigtes|beschadigten|problem|probleme|storung)\b/g;

/** Words right before a match that turn it around: "kein Unfall", "ohne Rost", "nichts defekt", "oh. Schäden". */
const NEGATIONS = new Set(["kein", "keine", "keinen", "keinerlei", "ohne", "o", "oh", "nicht", "nichts"]);
/** A word right after a match that turns it around: "rost frei", "unfall frei" (spelt apart). */
const FREE = /^ frei\b/;
/** Words that may stand between a negation and the match: "ohne jeden Rost", "kein sichtbarer Rost". */
const FILLERS = new Set([
  "jeden", "jeglichen", "jegliche", "jeglicher", "irgendwelche", "irgendwelchen", "mehr", "echten",
  "sichtbare", "sichtbaren", "sichtbarer", "nennenswerte", "nennenswerten", "nennenswerter",
  "bekannte", "bekannten", "bekannter",
]);
/**
 * Punctuation that ends a phrase, so "ohne Rost, Motorschaden" does not negate the engine damage.
 * The dot of "o." or "oh." (ohne, short for a title's few characters) does not.
 */
const PHRASE_BREAK = /[,;:!?|/()[\]+]|(?<!\b[Oo][Hh]?)\.(?=\s|$)|\s[-–—]+\s/;
/** Words right after a match that say it is fixed: "Unfallschaden repariert", "Motorschaden behoben". */
const FIXED = /^(?: (?:wurde|wurden|ist|sind|fachgerecht|professionell|komplett|alles))* (?:repariert|behoben|instandgesetzt|beseitigt|erneuert|getauscht|gewechselt|gemacht)\b/;

interface Title {
  /** The normalized title. */
  text: string;
  /** Where each phrase starts in `text`. */
  phraseStarts: number[];
}

/** Negated: the word right before is a negation, or the one before that with a filler between. */
function negated(title: Title, index: number): boolean {
  const start = title.phraseStarts.findLast((phraseStart) => phraseStart <= index) ?? 0;
  const words = title.text.slice(start, index).split(" ").filter(Boolean);
  const last = words.at(-1);
  const beforeLast = words.at(-2);
  if (last === undefined) return false;
  return NEGATIONS.has(last) || (beforeLast !== undefined && FILLERS.has(last) && NEGATIONS.has(beforeLast));
}

/** The rest of the phrase after a match: "frei" in "Rost, frei ab sofort" belongs to another phrase. */
function restOfPhrase(title: Title, end: number): string {
  const next = title.phraseStarts.find((phraseStart) => phraseStart > end);
  return title.text.slice(end, next === undefined ? undefined : next - 1);
}

function mentioned(title: Title, pattern: RegExp, negatable: boolean): boolean {
  pattern.lastIndex = 0;
  for (const match of title.text.matchAll(pattern)) {
    const end = match.index + match[0].length;
    if (negatable && (negated(title, match.index) || FREE.test(restOfPhrase(title, end)))) continue;
    if (FIXED.test(title.text.slice(end))) continue;
    return true;
  }
  return false;
}

/** The damage kinds a title mentions, in DAMAGE_KINDS order; empty when it mentions none. */
export function detectDamage(raw: string): DamageKind[] {
  // Same text as normalizeText(raw), but it remembers where each phrase starts.
  const phrases = raw.split(PHRASE_BREAK).map(normalizeText).filter(Boolean);
  const phraseStarts: number[] = [];
  let offset = 0;
  for (const phrase of phrases) {
    phraseStarts.push(offset);
    offset += phrase.length + 1;
  }
  const title: Title = { text: phrases.join(" "), phraseStarts };
  const found = new Set<DamageKind>();
  for (const rule of RULES) {
    if (!found.has(rule.kind) && mentioned(title, rule.pattern, rule.negatable ?? true)) found.add(rule.kind);
  }
  if (found.size === 0 && mentioned(title, GENERIC, true)) found.add("defect");
  return DAMAGE_KINDS.filter((kind) => found.has(kind));
}
