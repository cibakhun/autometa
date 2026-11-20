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
  { kind: "engine", pattern: /\bmotor(?:schaden|problem|probleme|platzer)\b/g },
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
  { kind: "gearbox", pattern: /\b(?:getriebeschaden|mechatronikschaden)\b/g },
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
    pattern: /\b(?:bastler|bastlerfahrzeug|bastlerauto|bastlerwagen|teiletrager|teilespender|ersatzteilspender|schlachtfahrzeug|ausschlachten|schlachten|export)\b/g,
  },
];

/** Generic words, used only when no specific kind matched. */
const GENERIC: RegExp = /\b(?:defekt|defekte|defekter|defektes|kaputt|schaden|mangel|mangeln)\b/g;

/** Words right before a match that turn it around: "kein Unfall", "ohne Rost", "nichts defekt". */
const NEGATIONS = new Set(["kein", "keine", "keinen", "keinerlei", "ohne", "nicht", "nichts", "frei"]);
/** Words right after a match that say it is fixed: "Unfallschaden repariert", "Motorschaden behoben". */
const FIXED = /^(?: (?:wurde|wurden|ist|sind|fachgerecht|professionell|komplett|alles))* (?:repariert|behoben|instandgesetzt|beseitigt|erneuert|getauscht|gewechselt|gemacht)\b/;

function mentioned(text: string, pattern: RegExp, negatable: boolean): boolean {
  pattern.lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const before = text.slice(0, match.index).trim().split(" ").slice(-2);
    if (negatable && before.some((word) => NEGATIONS.has(word))) continue;
    if (FIXED.test(text.slice(match.index + match[0].length))) continue;
    return true;
  }
  return false;
}

/** The damage kinds a title mentions, in DAMAGE_KINDS order; empty when it mentions none. */
export function detectDamage(title: string): DamageKind[] {
  const text = normalizeText(title);
  const found = new Set<DamageKind>();
  for (const rule of RULES) {
    if (!found.has(rule.kind) && mentioned(text, rule.pattern, rule.negatable ?? true)) found.add(rule.kind);
  }
  if (found.size === 0 && mentioned(text, GENERIC, true)) found.add("defect");
  return DAMAGE_KINDS.filter((kind) => found.has(kind));
}
