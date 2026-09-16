// Which language the wall text is in. The browser lists what the visitor
// reads, best first (`navigator.languages`); `?lang=xx` in the link overrides
// it, so a host can hand someone a German link from an English machine. A
// language file is keyed by its primary subtag ("de"), and a regional
// preference ("de-AT") matches it: nobody writes Austrian plaques separately.
// English is the fallback, because it is the language every file is checked
// against for completeness.

export const FALLBACK_LOCALE = "en";

/** "de-AT" -> "de"; "" stays ""; case is dropped (BCP-47 tags are case-insensitive). */
export function primarySubtag(tag: string): string {
  const trimmed = tag.trim().toLowerCase();
  const dash = trimmed.indexOf("-");
  return dash === -1 ? trimmed : trimmed.slice(0, dash);
}

function match(available: readonly string[], tag: string): string | undefined {
  const wanted = tag.trim().toLowerCase();
  if (!wanted) return undefined;
  const exact = available.find((a) => a.toLowerCase() === wanted);
  if (exact) return exact;
  const primary = primarySubtag(wanted);
  return available.find((a) => primarySubtag(a) === primary);
}

/**
 * The best language on offer: the override when it names one we have, else
 * the first of the visitor's preferences we have (exact tag first, then by
 * primary subtag), else English. An override we do not have is ignored, not
 * an error: a stale link still opens the world.
 */
export function pickLocale(
  available: readonly string[],
  preferred: readonly string[],
  override?: string | null,
): string {
  if (override) {
    const hit = match(available, override);
    if (hit) return hit;
  }
  for (const tag of preferred) {
    const hit = match(available, tag);
    if (hit) return hit;
  }
  return available.find((a) => a.toLowerCase() === FALLBACK_LOCALE) ?? available[0] ?? FALLBACK_LOCALE;
}
