// ============================================================================
//  bronsamenvatting — de regel die de INGEKLAPTE onderbouwingsbalk toont
// ----------------------------------------------------------------------------
//  Het paneel "Onderbouwing en bronnen" is standaard ingeklapt (Increment I-1,
//  FO §11c) en dat blijft zo. Maar de ingeklapte balk toonde alleen een aantal,
//  waardoor je moest openklappen om te zien wáár een antwoord op steunt. Deze
//  functie levert de regel die dat zichtbaar maakt.
//
//  Pure functie in core/ i.p.v. in het component, zodat hij getest kan worden
//  (bronsamenvatting.sanity.ts) — de rendering blijft in app/ (boundary T9).
// ============================================================================

/**
 * Documentnamen voor de ingeklapte balk: ontdubbeld, in de volgorde van
 * bronvermelding, en afgekapt zodat de balk één regel blijft.
 *
 * Ontdubbelen is wezenlijk en niet cosmetisch: één document levert vaak meerdere
 * chunks en dus meerdere bronnen. Zonder ontdubbeling zou de balk drie keer
 * dezelfde titel tonen en de indruk wekken dat het antwoord op drie stukken
 * steunt.
 *
 * @param titels     De titels van de geraadpleegde bronnen, in bronvolgorde.
 * @param maxAantal  Hoeveel unieke titels voluit worden getoond (default 3).
 */
export function samenvattingDocumentnamen(
  titels: readonly string[],
  maxAantal = 3
): string {
  // Trimmen vóór het ontdubbelen: "Notulen" en "Notulen " zijn hetzelfde stuk.
  const uniek = [
    ...new Set(
      titels
        .filter((t) => typeof t === "string")
        .map((t) => t.trim())
        .filter((t) => t.length > 0)
    ),
  ];
  if (uniek.length === 0) return "";
  if (maxAantal < 1) return `+${uniek.length} meer`;
  const getoond = uniek.slice(0, maxAantal).join(" · ");
  const rest = uniek.length - maxAantal;
  return rest > 0 ? `${getoond} · +${rest} meer` : getoond;
}

// ── Het label op de [Bron N]-pill ───────────────────────────────────────────
// De pill droeg alleen een nummer. "Zoals vastgesteld [3]" dwingt de lezer om
// het nummer te onthouden en elders op te zoeken; een pill die "Notulen 11-07"
// zegt, leest als een bronvermelding. Het nummer blijft staan — het koppelt de
// bewering aan de kaart en aan het auditspoor — maar krijgt tekst ernaast.
//
// Bewust in core/: het is een afleidingsregel, geen opmaak, en hij moet
// reproduceerbaar zijn (bronsamenvatting.sanity.ts).

/** Maximale lengte van het afgeleide label; daarboven kapt de CSS met een ellipsis. */
const PILL_LABEL_MAX = 32;

/** Dag-maand uit een ISO-datum (`2026-07-11` → `11-07`), of null. */
function korteDatum(iso?: string | null): string | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  return m ? `${m[3]}-${m[2]}` : null;
}

/**
 * Leesbaar label naast het bronnummer.
 *
 * Voorkeursvorm is `documenttype + datum` ("Notulen 11-07"): kort, en het zegt
 * wát voor stuk het is. Ontbreekt het documenttype — vandaag het geval zolang de
 * metadata-review-queue niet is doorgewerkt — dan valt het terug op de titel.
 * Ontbreekt ook die, dan blijft het label leeg en toont de pill alleen het
 * nummer, precies zoals vóór deze wijziging.
 */
export function pillLabelVoor(bron: {
  titel?: string | null;
  documenttype?: string | null;
  documentdatum?: string | null;
  documenttypeLabel?: string | null;
}): string {
  const typeLabel = bron.documenttypeLabel?.trim() || null;
  const datum = korteDatum(bron.documentdatum);
  const rauw = typeLabel
    ? datum
      ? `${typeLabel} ${datum}`
      : typeLabel
    : (bron.titel ?? "").trim();
  if (!rauw) return "";
  // De cap geldt voor BEIDE takken. `documenttype` is vrije tekst in de database
  // en `documenttypeLabel()` valt bij een onbekende waarde terug op de ruwe
  // waarde — die kan dus willekeurig lang zijn.
  return rauw.length > PILL_LABEL_MAX
    ? `${rauw.slice(0, PILL_LABEL_MAX).trimEnd()}…`
    : rauw;
}
