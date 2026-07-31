// ============================================================================
//  Bron-afbakening en -neutralisatie — PUUR, geen I/O.
// ----------------------------------------------------------------------------
//  Wordt gebruikt door maakContext (core/lib/rag.ts) en door de agendapunt-
//  voorbereiding. Los van rag.ts gehouden omdat die module de Supabase-client
//  aantrekt en daardoor niet standalone testbaar is; dit deel verdient wél een
//  eigen regressietest (chat-invoer.sanity.ts).
// ============================================================================

import { randomUUID } from "node:crypto";

// ── H-10: brontekst is ONBETROUWBARE DATA ─────────────────────────────────
// De contextregels werden opgebouwd als `[Bron N] titel: "tekst"`, samengevoegd
// met "\n\n---\n\n", zónder enige normalisatie van de chunktekst. Een geüpload
// document kon daardoor:
//   • een extra, verzonnen bronblok simuleren (`"` + newline + `---` +
//     `[Bron 2] DNB — Toezichtbrief: "…"`), dat het model overneemt met een
//     bestaand bronnummer;
//   • de citatievalidatie in de chatroute passeren, want die telt alleen of het
//     nummer binnen het bereik valt — niet of de claim uit die passage komt.
// Resultaat in de UI: een gouden bron-pill die naar een echte bronkaart linkt,
// bij een claim die uit een geïnjecteerde passage komt.
//
// Twee maatregelen, beide hier:
//   1. NEUTRALISEREN — patronen die een bronlabel of scheidingslijn nabootsen
//      worden onschadelijk gemaakt vóórdat de tekst de prompt in gaat. Het aantal
//      wordt geteld en gaat mee in retrieval_meta (context_geneutraliseerd).
//   2. AFBAKENEN — elke bron krijgt een <bron>-omhulsel met een per-request
//      willekeurige sentinel. Een document kan die sentinel niet raden, dus het
//      kan geen geldig blok openen of sluiten. Het instructieblok
//      (SP_BRON_VERTROUWEN in generatie-kern.ts) verwijst naar deze markering.
const BRONLABEL_PATRONEN: RegExp[] = [
  /\[\s*Bron\s*\d+\s*\]/gi,
  /\[\s*Algemene kennis\s*\]/gi,
  /\[\s*Volgens wetgeving\s*\]/gi,
  /\[\s*Toelichting agendapunt\s*\]/gi,
  /<\/?\s*bron\b[^>]*>/gi,
];

/** Maakt bronlabel-achtige patronen en scheidingslijnen in documenttekst
 *  onschadelijk. Retourneert de geschoonde tekst plus het aantal treffers,
 *  zodat een injectiepoging meetbaar is in het auditspoor. */
export function neutraliseerBrontekst(tekst: string): {
  tekst: string;
  geneutraliseerd: number;
} {
  let geneutraliseerd = 0;
  let uit = tekst;

  for (const patroon of BRONLABEL_PATRONEN) {
    uit = uit.replace(patroon, (m) => {
      geneutraliseerd++;
      // Haakjes vervangen door ronde haken: de tekst blijft leesbaar voor het
      // model (en dus bruikbaar als inhoud), maar is geen bronmarkering meer.
      return m.replace(/[[\]<>]/g, (t) => (t === "[" || t === "<" ? "(" : ")"));
    });
  }

  // Regels die uitsluitend uit streepjes bestaan bootsen de scheiding tussen
  // bronblokken na.
  uit = uit.replace(/^[ \t]*-{3,}[ \t]*$/gm, () => {
    geneutraliseerd++;
    return "—";
  });

  return { tekst: uit, geneutraliseerd };
}

/** Per-request sentinel voor de bron-afbakening. Onvoorspelbaar, dus een
 *  document kan geen geldig <bron>-blok openen of sluiten. */
export function maakBronSentinel(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}
