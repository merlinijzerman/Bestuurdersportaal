// ============================================================================
//  lib/generiek-status.ts — Increment T6 (gedeelde contentlaag, generic-MVP).
// ----------------------------------------------------------------------------
//  Eén canoniek geldigheidsstatusmodel voor GENERIEKE content —
//  draft/published/deprecated/withdrawn (beslisnotitie v0.4 §7 / besluit 0040) —
//  AFGELEID/documentair over de bestaande status/bronstatus-velden. Er is bewust
//  GEEN aparte statuskolom: dat zou een tweede, concurrerende bron van waarheid
//  worden náást het rijke as-built vocabulaire (decisions/0048).
//
//  Kernafspraak (acceptatiecriterium T6): `published` valt 1-op-1 samen met de
//  0045/T4-retrieval-gate. `isPublishedGeneriek` in lib/rag.ts is DE bron-van-
//  waarheid voor "is dit een actuele generieke bron?"; deze module hergebruikt
//  die definitie zodat contentlaag en retrieval nooit uiteenlopen. Alles wat niet
//  `published` is, faalt automatisch die gate → deprecated/withdrawn worden per
//  constructie nooit als actuele bron gebruikt.
//
//  Puur (geen DB/IO) → los testbaar (generiek-status.sanity.ts).
// ============================================================================

// De vier canonieke toestanden (v0.4 §7). Alleen `published` telt als actuele
// bron voor RAG en portaalweergave; de andere drie zijn niet-actueel.
export const GENERIEKE_GELDIGHEIDSSTATUS = [
  "draft",
  "published",
  "deprecated",
  "withdrawn",
] as const;
export type GeneriekeGeldigheidsstatus =
  (typeof GENERIEKE_GELDIGHEIDSSTATUS)[number];

export const GELDIGHEIDSSTATUS_LABEL: Record<GeneriekeGeldigheidsstatus, string> = {
  draft: "Concept (nog niet gepubliceerd)",
  published: "Gepubliceerd (actuele bron)",
  deprecated: "Verouderd (historisch, niet actueel)",
  withdrawn: "Ingetrokken (uitgesloten als bron)",
};

// De as-built velden waarover de mapping wordt afgeleid. NULL bronstatus ≡
// 'actief' tijdens de Increment-C-overgang — spiegelt de RPC en isPublishedGeneriek.
export interface GeneriekStatusVelden {
  status: string | null | undefined;
  bronstatus: string | null | undefined;
}

// Spiegelt lib/rag.ts::isPublishedGeneriek (voor generieke content) exact, zodat
// de canonieke `published` NIET kan divergeren van de 0045-gate. De consistentie
// wordt programmatisch bewezen in generiek-status.sanity.ts.
function isPublished(v: GeneriekStatusVelden): boolean {
  const status = v.status ?? null;
  const bronstatus = v.bronstatus ?? "actief"; // NULL ≡ actief
  return status === "van_kracht" && bronstatus === "actief";
}

// Mapping (documentair, geen kolom):
//   published  ≡ status='van_kracht' AND coalesce(bronstatus,'actief')='actief'  (0045)
//   withdrawn  ≡ actief teruggetrokken: status='gearchiveerd' OF bronstatus='uitgesloten'
//   deprecated ≡ verouderd maar leesbaar als historie: status IN
//                ('vervangen','alleen_historisch') OF bronstatus='historisch'
//   draft      ≡ al het overige (concept/ter_bespreking/ter_besluitvorming/
//                vastgesteld) — nog niet gepubliceerd.
// Volgorde is belangrijk: published eerst (de gate), dan withdrawn (hardste
// uitsluiting), dan deprecated, anders draft.
export function generiekGeldigheidsstatus(
  v: GeneriekStatusVelden
): GeneriekeGeldigheidsstatus {
  if (isPublished(v)) return "published";

  const status = v.status ?? null;
  const bronstatus = v.bronstatus ?? "actief";

  if (status === "gearchiveerd" || bronstatus === "uitgesloten") return "withdrawn";
  if (
    status === "vervangen" ||
    status === "alleen_historisch" ||
    bronstatus === "historisch"
  ) {
    return "deprecated";
  }
  return "draft";
}

// Handig voor UI/retrieval-checks: is deze generieke bron actueel (= published)?
export function isActueleGeneriekeBron(v: GeneriekStatusVelden): boolean {
  return generiekGeldigheidsstatus(v) === "published";
}
