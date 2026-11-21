import { normalizeText } from "./normalize";
import type { DefectComponent } from "./defects";

// Kept apart from defects.ts, which the flip calculator also uses in the browser: normalizeText
// pulls in the whole make and model list.

/**
 * Keyword rules for the Dutch names in RDW's defect list (dataset "Gebreken"), on normalizeText
 * output. The first rule that matches wins, so the more specific ones come first: a "remlicht"
 * (brake light) is lighting, a leaking shock absorber is suspension, not a leak. Names no rule
 * matches (seat belts, number plates, the odometer) count only towards "any defect".
 */
const RULES: [RegExp, DefectComponent | null][] = [
  [/airbag|gordel|stoel|deur|slot|kentekenplaat(?!verlicht)|snelheidsmeter|kilometerteller|tellerstand|identificatie|chassisnummer|controlelamp|waarschuwingslamp|tachograaf/, null],
  [/emissie|uitstoot|co gehalte|koolmonoxide|koolwaterstof|lambda|roet|rook|deeltjes|katalysator|obd|storingsindicat|motormanagement|\bmil\b/, "emissions"],
  // Before lighting: a "lichtmetalen velg" is an alloy wheel.
  [/\bband|velg|lichtmetal/, "tyres"],
  [/verlicht|lamp|licht|reflector|richtingaanwijz|knipper|wisser|sproeier|claxon|geluidssignaal|spiegel/, "lights"],
  [/\brem ?(?:leiding|slang)/, "brake_lines"],
  // Also inside compounds: "parkeerrem", "bedrijfsremwerking", "hoofdremcilinder".
  [/\brem|rem\b|rem(?:werking|kracht|systeem|vloeistof|cilinder|klauw|schijf|trommel|bekrachtig|blok|voering)|\babs\b/, "brakes"],
  [/uitlaat|geluiddemper|\bdemper/, "exhaust"],
  [/schokdemper|veer|vering/, "suspension"],
  [/wiellager/, "wheel_bearing"],
  [/aandrijfas|homokinet|manchet|cardan/, "driveshaft"],
  // "\bstuur": a "bestuurder" is the driver.
  [/\bstuur|kogel|spoorstang|fusee|draagarm|wieldraag|wielophang|stabilisator|reactiestang|ophanging|speling/, "steering"],
  [/profiel|wielmoer|wielbout|\bwiel\b/, "tyres"],
  // Not a bare "lek": "elektrisch" contains it.
  [/\blek|lekkage|olie|vloeistof|brandstof/, "leaks"],
  [/corros|roest|gecorrodeerd/, "rust"],
  // Wipers ("ruitenwisser") are lighting and small parts, matched above.
  [/ruit|glas/, "glass"],
];

/** The component group of an RDW defect name, or null for one that fits none. */
export function classifyDefect(description: string): DefectComponent | null {
  const text = normalizeText(description);
  for (const [pattern, component] of RULES) if (pattern.test(text)) return component;
  return null;
}
