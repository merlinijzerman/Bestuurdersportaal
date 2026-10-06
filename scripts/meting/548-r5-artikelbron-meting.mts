// ============================================================================
//  #548-R5 — vóór/na-meting: waar vallen Besluit-art. 19b en 22 weg?
//  Hermetisch (fixture: echte Besluit-structuur + synthetische bronnen).
//  Volgt per vraag: intentie/poort → artikelfocus → opzoekscope → kandidaten
//  (artikel- en sectiespoor) → selectiediagnostiek → selectie (10 passages) →
//  bronkoppen in de modelcontext → antwoordgrens.
//  Uitvoeren: npx tsx scripts/meting/548-r5-artikelbron-meting.mts
// ============================================================================
import { bepaalJuridischeVraagintentie } from "../../core/lib/vraagtype";
import { bepaalJuridischBeleid } from "../../core/lib/retrieval/juridisch-beleid";
import { bepaalArtikelfocus } from "../../core/lib/retrieval/artikelverwijzing";
import {
  VRAAG_BREED,
  VRAAG_EXPLICIET,
  artikelenIn,
  draai,
} from "../../tests/cross-tenant/fixtures/artikelbron-548";

const uniek = (xs: string[]) => [...new Set(xs)];

for (const vraag of [VRAAG_EXPLICIET, VRAAG_BREED]) {
  const intentie = bepaalJuridischeVraagintentie(vraag);
  const { uit, naAdapter, log } = await draai(vraag);
  // De artikelopzoeking (1b) is de document_chunks-select zonder chunk_index/embed.
  const start = log.findIndex((l) => l.methode === "select" && l.args[0] === "id, document_id, tekst, structuur_label");
  const opzoeking = start < 0 ? undefined
    : log.slice(start).find((l) => l.methode === "in" && l.args[0] === "document_id");
  console.log(`\n▶ ${vraag}`);
  console.log("  1. intentie/poort  :", intentie.intentie, intentie.vertrouwen, JSON.stringify(bepaalJuridischBeleid(intentie)));
  console.log("  2. artikelfocus    :", JSON.stringify(bepaalArtikelfocus([vraag], intentie)));
  console.log("  3. artikelopzoeking:", opzoeking ? `artikelspoor in ${(opzoeking.args[1] as string[]).length} juridische documenten` : "geen artikelspoor");
  console.log("  4. kandidaten (art):", JSON.stringify(uniek(artikelenIn(naAdapter))));
  console.log("     via sectiespoor :", JSON.stringify(artikelenIn(naAdapter.filter((b) => b.rang.poging === "sectiespoor"))));
  console.log("     via artikelspoor:", JSON.stringify(artikelenIn(naAdapter.filter((b) => b.rang.poging === "artikelspoor"))));
  console.log("  5. selectie-diagn. :", JSON.stringify(uit.meta.selectie?.juridisch?.artikel ?? null));
  console.log("  6. geselecteerd    :", JSON.stringify(artikelenIn(uit.geselecteerd)));
  console.log("     bronnen         :", JSON.stringify(uniek(uit.geselecteerd.map((b) => b.titel))));
  const koppen = [...uit.contextTekst.matchAll(/\[Bron (\d+)\][^\n]*?(\([^()]*\)):/g)].map((m) => `${m[1]}${m[2]}`);
  console.log("  7. bronkoppen      :", koppen.join(" "));
  let grens: string | null = null;
  try {
    const { brondekkingsinstructie } = await import("../../core/lib/retrieval/brondekking");
    grens = brondekkingsinstructie(uit.geselecteerd.map((b) => ({
      documenttype: b.weergave?.documenttype, wetsgeschiedenisSubtype: b.weergave?.wetsgeschiedenisSubtype,
    })));
  } catch {
    grens = null; // vóór #548-R5 bestaat de module niet
  }
  console.log("  8. antwoordgrens   :", grens ? "BRONDEKKING-instructie in de gebruikersprompt" : "geen");
}
