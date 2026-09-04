// ============================================================
//  T2 (#304) — de voorbereiding als BEWAARD PRODUCT.
// ------------------------------------------------------------
//  Tot dit ticket leidde de agendapuntkaart "is dit punt voorbereid?" af uit een
//  query op `gesprekken`, gefilterd op `document_scope->agendapunt_context->>id`.
//  Het product was daarmee een bijproduct van een chatlog: start iemand een
//  tweede gesprek over hetzelfde punt, dan wordt "de voorbereiding" troebel, en
//  de kaart kan niet zeggen wanneer ze is opgesteld of waarop ze steunt.
//
//  Nu schrijft de chat-route de uitkomst weg in `public.voorbereidingen`
//  (kolommen `ai_output` + `bronnen_meta`, beide sinds 29-04-2026 aanwezig en
//  sinds de herziening van 6 juli ongebruikt). De unique-constraint
//  (agendapunt_id, gebruiker_id) doet het werk: opnieuw opstellen OVERSCHRIJFT,
//  er ontstaan geen versies. De vorige uitvoer blijft in de gesprekshistorie.
//
//  Deze module is PUUR (geen IO), zodat de vorm van het bewaarde product
//  programmatisch te toetsen is — inclusief de regel dat er GEEN BRONFRAGMENTEN
//  in belanden. `bronnen_meta` draagt precies zoveel als de bronpill in de kaart
//  nodig heeft om eerlijk te zijn (nummer, titel, vindplaats, status), en niet
//  meer. Het `fragment` — de geciteerde brontekst — blijft bewust weg: dat zou
//  een tweede opslag van documentinhoud zijn naast `governance_log_inhoud`, en
//  daarmee buiten de retentiebaan van GOVERNANCE-LOG-RETENTIE-ONTWERP.md om
//  lopen. De weergave kan daar tegen: zonder fragment toont de pill "geen
//  fragment beschikbaar" en staat het citaat in het paneel, bij het antwoord.
//
//  Waarom de pill die velden überhaupt krijgt: zonder bronnenlijst rendert
//  `renderAntwoord` élke [Bron N] als OngeldigeBronPill — een zichtbare
//  hallucinatiemarkering op bronnen die wél bestonden. Dat is een ergere
//  onwaarheid dan een ontbrekend citaat.
//
//  BEWUST NIET (besluit 0205): de stukversie waarop de voorbereiding steunt, en
//  de melding "het stuk is gewijzigd ná uw voorbereiding". Dat veld alvast
//  vullen terwijl niemand het leest is precies het dode pad dat dit traject
//  opruimt. Openstaand punt voor T4.
// ============================================================

/** Zoveel brontitels bewaart de kaart; genoeg voor de weergave, geen archief. */
export const MAX_BRONTITELS = 10;

export interface VoorbereidingBron {
  nummer: number;
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  documentstatus?: string | null;
  documentdatum?: string | null;
  documenttype?: string | null;
  heeft_origineel: boolean;
}

export interface VoorbereidingProduct {
  ai_output: {
    tekst: string;
    opgesteld_op: string;
    governance_log_id: string | null;
    gesprek_id: string | null;
  };
  bronnen_meta: {
    aantal: number;
    titels: string[];
    bronnen: VoorbereidingBron[];
  };
}

/** De velden die uit een `BronVerwijzing` worden overgenomen. Bewust géén
 *  `fragment`; zie de kop van deze module. */
export interface BronInvoer {
  document_id?: string | null;
  titel?: string | null;
  bron?: string | null;
  pagina?: number | null;
  paragraaf?: string | null;
  documentstatus?: string | null;
  documentdatum?: string | null;
  documenttype?: string | null;
  heeft_origineel?: boolean | null;
}

export interface VoorbereidingProductInvoer {
  /** Het zichtbare antwoord (vervolgvragen-tail al afgeknipt). */
  tekst: string;
  /** De genummerde bronnen van deze beurt, in promptvolgorde. */
  bronnen: BronInvoer[];
  /** De governance_log-regel van deze beurt; null als die niet terugkwam. */
  governanceLogId: string | null;
  /** Het gesprek waarin de voorbereiding is opgesteld. */
  gesprekId: string | null;
  /** Tijdstip; expliciet meegegeven zodat de functie puur en toetsbaar blijft. */
  nu: string;
}

/**
 * Bouwt de twee jsonb-kolommen van een voorbereiding.
 *
 * `aantal` telt ÁLLE bronnen van de beurt, ook als de titellijst is afgekapt —
 * anders zou de kaart "7 bronnen" tonen bij tien gebruikte bronnen en daarmee de
 * onderbouwing kleiner voorstellen dan ze was.
 */
export function bouwVoorbereidingProduct(
  invoer: VoorbereidingProductInvoer
): VoorbereidingProduct {
  const bronnen: VoorbereidingBron[] = invoer.bronnen
    .slice(0, MAX_BRONTITELS)
    .map((b, i) => ({
      nummer: i + 1,
      document_id: b.document_id ?? "",
      titel: (b.titel ?? "").trim() || "(zonder titel)",
      bron: b.bron ?? "",
      pagina: b.pagina ?? null,
      paragraaf: b.paragraaf ?? null,
      documentstatus: b.documentstatus ?? null,
      documentdatum: b.documentdatum ?? null,
      documenttype: b.documenttype ?? null,
      heeft_origineel: b.heeft_origineel === true,
    }));

  return {
    ai_output: {
      tekst: invoer.tekst,
      opgesteld_op: invoer.nu,
      governance_log_id: invoer.governanceLogId,
      gesprek_id: invoer.gesprekId,
    },
    bronnen_meta: {
      aantal: invoer.bronnen.length,
      titels: bronnen.map((b) => b.titel),
      bronnen,
    },
  };
}

/** Leest een bewaard product terug; tolerant voor de lege default `'{}'`. */
export function leesVoorbereidingProduct(rij: {
  ai_output?: unknown;
  bronnen_meta?: unknown;
  gegenereerd_op?: string | null;
  bijgewerkt_op?: string | null;
} | null): {
  tekst: string;
  aantalBronnen: number;
  bronnen: VoorbereidingBron[];
  opgesteldOp: string | null;
} | null {
  if (!rij) return null;
  const out = (rij.ai_output ?? {}) as Record<string, unknown>;
  const tekst = typeof out.tekst === "string" ? out.tekst : "";
  // Een rij zonder AI-tekst bestaat legitiem: de notities-route maakt hem aan
  // zodra een bestuurder alleen een aantekening opslaat. Dat is géén
  // voorbereiding en mag de kaart niet als "voorbereid" tonen.
  if (!tekst.trim()) return null;

  const meta = (rij.bronnen_meta ?? {}) as Record<string, unknown>;
  const bronnen: VoorbereidingBron[] = Array.isArray(meta.bronnen)
    ? (meta.bronnen as unknown[]).flatMap((b) => {
        const o = (b ?? {}) as Record<string, unknown>;
        if (typeof o.titel !== "string") return [];
        return [
          {
            nummer: Number(o.nummer) || 0,
            document_id: typeof o.document_id === "string" ? o.document_id : "",
            titel: o.titel,
            bron: typeof o.bron === "string" ? o.bron : "",
            pagina: typeof o.pagina === "number" ? o.pagina : null,
            paragraaf: typeof o.paragraaf === "string" ? o.paragraaf : null,
            documentstatus:
              typeof o.documentstatus === "string" ? o.documentstatus : null,
            documentdatum:
              typeof o.documentdatum === "string" ? o.documentdatum : null,
            documenttype:
              typeof o.documenttype === "string" ? o.documenttype : null,
            heeft_origineel: o.heeft_origineel === true,
          },
        ];
      })
    : [];

  return {
    tekst,
    aantalBronnen: typeof meta.aantal === "number" ? meta.aantal : bronnen.length,
    bronnen,
    opgesteldOp:
      (typeof out.opgesteld_op === "string" ? out.opgesteld_op : null) ??
      rij.gegenereerd_op ??
      rij.bijgewerkt_op ??
      null,
  };
}
