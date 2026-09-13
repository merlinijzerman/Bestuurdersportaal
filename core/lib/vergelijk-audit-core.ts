/** Pure selectie voor het duurzame vergelijkspoor: alleen werkelijk gebruikte refs. */
export function selecteerGebruikteEvidence<T extends { ref: string }>(
  items: readonly T[],
  gebruikteRefs: ReadonlySet<string>,
  limiet: number
): T[] {
  const geselecteerd = items
    .filter((item) => gebruikteRefs.has(item.ref))
    .sort((a, b) => a.ref.localeCompare(b.ref));
  if (geselecteerd.length > limiet) throw new Error("vergelijk_evidence_afgekapt");
  return geselecteerd;
}
