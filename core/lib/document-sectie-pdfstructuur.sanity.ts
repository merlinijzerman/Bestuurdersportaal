// ============================================================
//  Sanity-tests #548-vervolg: PDF-structuur en aantoonbare sectiegrenzen.
//
//  Aanleiding (Productiepilot 5 oktober 2026): in het Besluit uitvoering
//  Pensioenwet en Wvb stond "Paragraaf 6.2. Individuele waardeoverdracht"
//  midden in een chunk (structuur_type=tabel, label NULL); de vraag om de hele
//  paragraaf 6.2 gaf een weigering. Oorzaken:
//    • de kop onderscheidt zich in de wetten.nl-afdruk alleen typografisch
//      (vet, zelfde grootte): kop, uitvoeringsregel, artikelkop en lid 1 werden
//      één alinea;
//    • hangende lidnummers ("5 | De ontvangende …", "b. | de uitvoerder …")
//      werden tabelcellen, en tekst ná die "tabel" bleef tabel zonder label;
//    • lidnummers in de boven-/onderste paginaband vielen weg als
//      "paginanummer" (letterlijk tekstverlies).
//
//  Fixtures:
//    • tests/fixtures/pdf-tekstitems/besluit-uitvoering-pw-vpl-p22-27.json —
//      de echte pdfjs-tekstitems (positie, grootte, font) van p. 22-27 van de
//      openbare wetten.overheid.nl-afdruk (BWBR0020892); geen PDF in Git.
//      Opnieuw te maken met scripts/meting/548-pdf-tekstitems-fixture.mts.
//    • een synthetische fonds-PDF (Word-export-layout) en een fonds-DOCX.
//  Uitvoeren: npx tsx core/lib/document-sectie-pdfstructuur.sanity.ts
// ============================================================

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import JSZip from "jszip";
import { extractTekst, type TekstSegment } from "./document-extractie";
import { bouwBronblokken, type PdfPaginaInvoer, type PdfTekstItem } from "./pdf-bronblokken";
import {
  BRONBLOKKEN_INDEXERING_VERSIE,
  bouwChunkRecordsZonderVerrijking,
  type ChunkRecord,
} from "./chunk-bouw";
import { splitsInStructuurUnits } from "./chunking";
import {
  bakenDocumentsectieAf,
  bepaalSectieverzoek,
  geefDocumentsectieWeer,
  stelSectieSamen,
  type SectieChunk,
} from "./retrieval/document-sectie";

let n = 0;
async function check(naam: string, fn: () => void | Promise<void>) {
  await fn();
  n++;
  console.log(`  ✓ ${naam}`);
}

const alsChunks = (records: ChunkRecord[]): SectieChunk[] =>
  records.map((r) => ({ ...r, id: `c${r.chunk_index}` }));

function sectie(vraag: string, chunks: SectieChunk[]) {
  const v = bepaalSectieverzoek(vraag)!;
  const b = bakenDocumentsectieAf(v, chunks);
  const rijen = b.van === null ? [] : chunks.filter((c) => c.chunk_index >= b.van! && c.chunk_index <= b.tot!);
  return { v, b, s: stelSectieSamen(b, rijen) };
}

function chunksUit(segmenten: TekstSegment[]): SectieChunk[] {
  return alsChunks(bouwChunkRecordsZonderVerrijking({ documentId: "d", segmenten }));
}

const alsAlineaSegmenten = (paginas: PdfPaginaInvoer[]): TekstSegment[] =>
  bouwBronblokken(paginas).segmenten.map((s) => ({ ...s, opmaak: "alinea_per_regel" as const }));

/** Letters en cijfers als multiset: volgorde-onafhankelijke volledigheidstoets. */
function tekens(s: string): Map<string, number> {
  const m = new Map<string, number>();
  for (const c of s.replace(/[^\p{L}\p{N}]/gu, "")) m.set(c, (m.get(c) ?? 0) + 1);
  return m;
}
function verschil(a: Map<string, number>, b: Map<string, number>): number {
  let d = 0;
  for (const [c, k] of a) d += Math.abs(k - (b.get(c) ?? 0));
  for (const [c, k] of b) if (!a.has(c)) d += k;
  return d;
}

async function main() {
  console.log("document-sectie-pdfstructuur sanity-tests:");

  // ── A. Echte layout: Besluit uitvoering Pensioenwet en Wvb, p. 22-27 ──────
  const hier = fileURLToPath(new URL(".", import.meta.url));
  const fixture = JSON.parse(
    readFileSync(resolve(hier, "../../tests/fixtures/pdf-tekstitems/besluit-uitvoering-pw-vpl-p22-27.json"), "utf8")
  ) as { paginas: PdfPaginaInvoer[] };
  const BESLUIT = fixture.paginas;
  const besluitChunks = chunksUit(alsAlineaSegmenten(BESLUIT));
  const VRAAG_62 = 'Geef graag de hele Paragraaf 6.2 "Individuele waardeoverdracht" van het Besluit uitvoering Pensioenwet';

  await check("Besluit: geen letterlijk tekstverlies per pagina (ook lidnummers in de paginaband)", () => {
    const { segmenten } = bouwBronblokken(BESLUIT);
    for (const p of BESLUIT) {
      // Kop- en voetregel van de wetten.nl-afdruk zijn 8 pt; de hoofdtekst 10,5 pt.
      const bron = p.items.filter((i) => i.fontSize > 9).map((i) => i.str).join("");
      const uit = segmenten.find((s) => s.pagina === p.pagina)?.tekst ?? "";
      assert.equal(verschil(tekens(bron), tekens(uit)), 0, `pagina ${p.pagina}`);
    }
    // Lid 2 van artikel 18 staat in de onderste paginaband van p. 23.
    assert.ok(segmenten.find((s) => s.pagina === 23)!.tekst.includes("\n\n2 Indien de overdragende uitvoerder een premieovereenkomst"));
  });

  await check("Besluit: vette koppen worden eigen structuurgrenzen (Hoofdstuk 6, §6.1, §6.2, 17g, Hoofdstuk 6a)", () => {
    const labels = besluitChunks.map((c) => c.structuur_label);
    for (const l of ["Hoofdstuk 6", "Paragraaf 6.1", "Artikel 17e", "Artikel 17f", "Paragraaf 6.2", "Artikel 17g", "Artikel 28", "Hoofdstuk 6a", "Artikel 28a"]) {
      assert.ok(labels.includes(l), l);
    }
    const p62 = besluitChunks.filter((c) => c.structuur_label === "Paragraaf 6.2");
    assert.equal(p62.length, 1);
    assert.equal(p62[0].structuur_type, "paragraaf");
    assert.equal(p62[0].pagina, 23);
    assert.ok(p62[0].tekst!.startsWith("Paragraaf 6.2. Individuele waardeoverdracht\n\nBepalingen ter uitvoering"));
    // Geen tabel zonder sectielabel en geen lidnummer als genummerde kop.
    assert.equal(besluitChunks.filter((c) => c.structuur_type === "tabel" && !c.structuur_label).length, 0);
    assert.equal(besluitChunks.filter((c) => /^\d+$/.test(c.structuur_label ?? "")).length, 0);
  });

  await check("Besluit: de exacte vraag geeft de volledige §6.2 — eigen kop t/m artikel 28, vóór Hoofdstuk 6a", () => {
    const { b, s, v } = sectie(VRAAG_62, besluitChunks);
    assert.equal(b.reden, "ok");
    assert.equal(s.volledig, true);
    assert.deepEqual([s.beginPagina, s.eindPagina], [23, 27]);
    assert.ok(s.tekst.startsWith("Paragraaf 6.2. Individuele waardeoverdracht"));
    const koppen = [...s.tekst.matchAll(/^Artikel (\S+)\. /gm)].map((m) => m[1]);
    assert.deepEqual(koppen, ["17g", "18", "19", "19a", "19b", "20", "21", "22", "23", "23a", "24", "25", "26", "27", "28"]);
    assert.ok(!/Artikel 17[ef]\.|Paragraaf 6\.1|Hoofdstuk 6a|Artikel 28a/.test(s.tekst), "geen §6.1 of Hoofdstuk 6a");
    assert.ok(s.tekst.trimEnd().endsWith("het meerdere wordt behandeld als een bij ontslag verkregen pensioenaanspraak in die regeling."));
    // Letterlijk volledig: de tekens tussen de kop van §6.2 (p. 23) en de kop
    // van Hoofdstuk 6a (p. 27) in de bron zijn exact die van de sectie.
    const y = (pagina: number, begin: string) =>
      BESLUIT.find((p) => p.pagina === pagina)!.items.find((i) => i.str.startsWith(begin))!.y;
    const y62 = y(23, "Paragraaf 6.2.");
    const y6a = y(27, "Hoofdstuk 6a.");
    const inBereik = (pagina: number, iy: number) =>
      (pagina === 23 && iy <= y62) || (pagina > 23 && pagina < 27) || (pagina === 27 && iy > y6a);
    const bron = BESLUIT.flatMap((p) => p.items.filter((i) => i.fontSize > 9 && inBereik(p.pagina, i.y)))
      .map((i) => i.str)
      .join("");
    assert.equal(verschil(tekens(bron), tekens(s.tekst.replace(/\*\[pagina \d+\]\*/g, ""))), 0);
    const uit = geefDocumentsectieWeer(v, { id: "D", titel: "Besluit uitvoering Pensioenwet en Wvb" }, s);
    assert.match(uit, /^\*\*Paragraaf 6\.2\*\* — “Besluit uitvoering Pensioenwet en Wvb” \(pagina 23–27\)/);
    assert.ok(uit.endsWith("[Open het origineel](/api/documents/D/bestand#page=23)"));
  });

  await check("Besluit: §6.1 en losse artikelen eindigen exact op de volgende kop", () => {
    const p61 = sectie("Geef de hele paragraaf 6.1 van het Besluit uitvoering Pensioenwet", besluitChunks);
    assert.equal(p61.b.reden, "ok");
    assert.ok(p61.s.tekst.includes("Artikel 17f. Waardeoverdracht bestaand klein pensioen"));
    assert.ok(!p61.s.tekst.includes("Paragraaf 6.2"));
    const a17c = sectie("Geef het hele artikel 17c van het Besluit uitvoering Pensioenwet", besluitChunks);
    assert.equal(a17c.b.reden, "ok");
    assert.equal(a17c.s.tekst, "Artikel 17c. Collectief toedelingsmechanisme\n\n[Vervallen per 01-07-2023]");
    const a28 = sectie("Geef het hele artikel 28 van het Besluit uitvoering Pensioenwet", besluitChunks);
    assert.equal(a28.b.reden, "ok");
    assert.ok(a28.s.tekst.includes("\n\n4 In een pensioenregeling die voor de pensioenopbouw rekent"));
  });

  await check("Besluit: dezelfde items zonder fontinformatie → geen onterechte volledige §6.2", () => {
    // Negatieve controle: zonder het typografische signaal vallen de koppen weer
    // samen; de route mag dan nooit een (verkeerd begrensde) sectie tonen.
    const zonderFont = BESLUIT.map((p) => ({ ...p, items: p.items.map(({ font: _f, ...i }) => i) }));
    const r = sectie(VRAAG_62, chunksUit(alsAlineaSegmenten(zonderFont)));
    assert.ok(!(r.b.reden === "ok" && r.s.volledig));
  });

  await check("Besluit: een oudere bronblokkenindex (r2) toont nooit letterlijke tekst", () => {
    const r2 = besluitChunks.map((c) => ({ ...c, indexering_versie: "r2-bronblokken" }));
    const r = sectie(VRAAG_62, r2);
    assert.equal(r.b.reden, "oude_index");
    assert.equal(r.s.tekst, "");
    assert.equal(BRONBLOKKEN_INDEXERING_VERSIE, "r3-bronblokken");
  });

  // ── B. Bronblokken: synthetische regels ────────────────────────────────────
  const FS = 10.5;
  const it = (y: number, x: number, str: string, font?: string, fs = FS): PdfTekstItem =>
    ({ str, x, y, fontSize: fs, width: str.length * fs * 0.5, font });
  const pag = (nr: number, items: PdfTekstItem[]): PdfPaginaInvoer => ({ pagina: nr, breedte: 595, hoogte: 842, items });
  const VOL = "lopende tekst die de regel tot aan de rechterkantlijn vult en zo verder gaat met nog meer";

  await check("bronblokken: fontwissel na korte regel opent een blok; zonder font het oude gedrag", () => {
    const items = (f: (s: "kop" | "romp") => string | undefined) => [
      it(700, 75, "verwerft. De bepaling is van toepassing.", f("romp")),
      it(676, 38, "Paragraaf 2.1. Waardeoverdracht", f("kop")),
      it(664, 38, "Bepalingen ter uitvoering van de wet", f("romp")),
      it(652, 38, "Artikel 4. Termijn", f("kop")),
    ];
    const met = bouwBronblokken([pag(1, items((s) => (s === "kop" ? "F2" : "F1")))]).blokken.map((b) => b.tekst);
    assert.deepEqual(met, [
      "verwerft. De bepaling is van toepassing.",
      "Paragraaf 2.1. Waardeoverdracht",
      "Bepalingen ter uitvoering van de wet",
      "Artikel 4. Termijn",
    ]);
    const zonder = bouwBronblokken([pag(1, items(() => undefined))]).blokken.map((b) => b.tekst);
    assert.ok(zonder.length < met.length, "zonder font: kop en uitvoeringsregel blijven samen (bestaand gedrag)");
  });

  await check("bronblokken: een cursieve volle regel midden in een alinea splitst niet", () => {
    const b = bouwBronblokken([pag(1, [
      it(700, 75, `Dit is ${VOL}`, "F1"),
      it(688, 75, `${VOL} cursief`, "F3"),
      it(676, 75, "en de alinea eindigt hier.", "F1"),
    ])]).blokken;
    assert.equal(b.length, 1);
  });

  await check("bronblokken: hangend lid-/lijstnummer hoort bij zijn lid (geen tabel, geen kantlijn)", () => {
    const b = bouwBronblokken([pag(1, [
      it(700, 38, "1", "F2"), it(700, 75, "De voorwaarden zijn als volgt:", "F1"),
      it(688, 38, "a.", "F2"), it(688, 75, `de uitvoerder vraagt ${VOL}`, "F1"),
      it(676, 75, "1 januari 2020 een opgave;", "F1"),
      it(664, 38, "b.", "F2"), it(664, 75, "de uitvoerder handelt conform het plan; en", "F1"),
      it(652, 38, "c.", "F2"), it(652, 75, "de uitvoerder informeert de", "F1"),
      it(640, 75, "aanspraakgerechtigden.", "F1"),
    ])]).blokken;
    assert.ok(b.every((x) => x.soort === "alinea"), JSON.stringify(b));
    assert.deepEqual(b.map((x) => x.tekst.split(" ").slice(0, 3).join(" ")), [
      "1 De voorwaarden", "a. de uitvoerder", "b. de uitvoerder", "c. de uitvoerder",
    ]);
    assert.ok(b[1].tekst.endsWith(`${VOL} 1 januari 2020 een opgave;`));
    assert.equal(b[3].tekst, "c. de uitvoerder informeert de aanspraakgerechtigden.");
  });

  await check("bronblokken: paginaband — lidnummer en getallenrij blijven, kaal paginanummer verdwijnt", () => {
    const b = bouwBronblokken([
      pag(1, [it(700, 75, "Tekst op pagina een.", "F1"), it(60, 38, "2", "F2"), it(60, 75, "Indien de uitvoerder een opgave doet.", "F1"), it(20, 290, "1", "F1")]),
      pag(2, [it(805, 43, "104", "F2"), it(805, 545, "1", "F2"), it(700, 75, "Tekst op pagina twee.", "F1"), it(20, 290, "2", "F1")]),
    ]).blokken.map((x) => x.tekst);
    assert.ok(b.includes("2 Indien de uitvoerder een opgave doet."), JSON.stringify(b));
    assert.ok(b.some((t) => t.includes("104") && /\b1\b/.test(t)), "getallenrij 104 | 1 blijft");
    assert.ok(!b.includes("1") && !b.includes("2"), "kale paginanummers weg");
  });

  await check("bronblokken: twee koppen direct onder elkaar in hetzelfde font worden twee blokken", () => {
    const b = bouwBronblokken([pag(1, [
      it(700, 38, "2. Overige antecedenten", "F2"),
      it(688, 38, "2.1. Veroordelingen", "F2"),
      it(676, 38, "Bij vonnis is betrokkene veroordeeld.", "F1"),
    ])]).blokken.map((x) => x.tekst);
    assert.deepEqual(b, ["2. Overige antecedenten", "2.1. Veroordelingen", "Bij vonnis is betrokkene veroordeeld."]);
  });

  // ── C. Structuur: tabellen, nummervormen ───────────────────────────────────
  await check("structuur: tabel erft het sectielabel en tekst ná de tabel is weer sectietekst", () => {
    const units = splitsInStructuurUnits(
      ["Artikel 7. Premie", "", "De premie bedraagt:", "", "| Leeftijd | Premie |", "| 25 | 3% |", "", "De werkgever betaalt de premie."].join("\n"),
      { alineaPerRegel: true }
    );
    assert.deepEqual(units.map((u) => [u.type, u.label]), [["artikel", "Artikel 7"], ["tabel", "Artikel 7"], ["artikel", "Artikel 7"]]);
    // Zonder alinea-per-regel (oude index/PPTX) blijft het bestaande gedrag.
    const oud = splitsInStructuurUnits(["Artikel 7. Premie", "| a | b |", "Tekst."].join("\n"));
    assert.deepEqual(oud.map((u) => [u.type, u.label]), [["artikel", "Artikel 7"], ["tabel", null]]);
  });

  await check("structuur: artikel 1ca/14ba en paragraaf 9b.5 zijn koppen", () => {
    const units = splitsInStructuurUnits(
      ["Artikel 1c. Een", "tekst", "Artikel 1ca. Twee", "tekst", "Paragraaf 9b.5. Interne waardeoverdracht", "Artikel 14ba. Keuze"].join("\n"),
      { alineaPerRegel: true }
    );
    assert.deepEqual(units.map((u) => u.label), ["Artikel 1c", "Artikel 1ca", "Paragraaf 9b.5", "Artikel 14ba"]);
  });

  // ── D. Route: begin, einde en tussenliggende structuur aantoonbaar ────────
  const V = BRONBLOKKEN_INDEXERING_VERSIE;
  const rij = (i: number, type: string, label: string | null, tekst: string, pagina = 1): SectieChunk =>
    ({ id: `r${i}`, chunk_index: i, pagina, structuur_type: type, structuur_label: label, indexering_versie: V, tekst });

  await check("route: een terugspringende of andersoortige 'kop' bewijst het einde niet", () => {
    const lid = [
      rij(0, "artikel", "Artikel 3", "Artikel 3. Termijn\n\n1 De uitvoerder"),
      rij(1, "paragraaf", "5", "5 De ontvangende uitvoerder wendt aan"),
      rij(2, "artikel", "Artikel 4", "Artikel 4. Slot"),
    ];
    assert.equal(sectie("Geef het hele artikel 3 van het reglement", lid).b.reden, "einde_onzeker");
    const terug = [
      rij(0, "paragraaf", "Paragraaf 6.2", "Paragraaf 6.2. Individueel"),
      rij(1, "artikel", "Artikel 18", "Artikel 18. Verzoek"),
      rij(2, "paragraaf", "5", "5 Losse regel"),
    ];
    assert.equal(sectie("Geef de hele paragraaf 6.2 van het reglement", terug).b.reden, "einde_onzeker");
    const ouder = [rij(0, "paragraaf", "Paragraaf 6.2", "Paragraaf 6.2. A"), rij(1, "kop", "Hoofdstuk 6", "Hoofdstuk 6. B")];
    assert.equal(sectie("Geef de hele paragraaf 6.2 van het reglement", ouder).b.reden, "einde_onzeker");
    const goed = [rij(0, "paragraaf", "Paragraaf 6.2", "Paragraaf 6.2. A"), rij(1, "kop", "Hoofdstuk 6a", "Hoofdstuk 6a. B")];
    assert.equal(sectie("Geef de hele paragraaf 6.2 van het reglement", goed).b.reden, "ok");
    const laatste = [rij(0, "kop", "Hoofdstuk 1", "Hoofdstuk 1. A"), rij(1, "paragraaf", "Paragraaf 6.2", "Paragraaf 6.2. B")];
    assert.equal(sectie("Geef de hele paragraaf 6.2 van het reglement", laatste).b.reden, "ok", "einde document");
  });

  await check("route: een niet-herkende kop binnen de sectie → structuur_onzeker (geen tekst)", () => {
    const inline = [
      rij(0, "artikel", "Artikel 17c", "Artikel 17c. Collectief [Vervallen] Artikel 17d. Parameter [Vervallen] Hoofdstuk 6. Waardeoverdracht"),
      rij(1, "artikel", "Artikel 18", "Artikel 18. Verzoek"),
    ];
    const r = sectie("Geef het hele artikel 17c van het besluit", inline);
    assert.equal(r.s.reden, "structuur_onzeker");
    assert.equal(r.s.tekst, "");
    const deel = [rij(0, "artikel", "Artikel 150r", "Artikel 150r. Opschorting\n\n1. Lid.\n\nII\n\nIn artikel VII wordt"), rij(1, "artikel", "Artikel 145q", "Artikel 145q. X")];
    assert.equal(sectie("Geef het hele artikel 150r van het amendement", deel).s.reden, "structuur_onzeker");
    const toc = [rij(0, "artikel", "Artikel 51a", "Artikel 51a. Boete\n\nInhoudsopgave: 59a (blz. 2)"), rij(1, "artikel", "Artikel 52", "Artikel 52. X")];
    assert.equal(sectie("Geef het hele artikel 51a van het besluit", toc).s.reden, "structuur_onzeker");
    const sub = [rij(0, "paragraaf", "2.3", "2.3. Transacties\n\nTekst.\n\n2.4. (Voorwaardelijk) sepot\n\nTekst."), rij(1, "paragraaf", "2.5", "2.5. Andere")];
    assert.equal(sectie("Geef de hele paragraaf 2.3 van de bijlage", sub).s.reden, "structuur_onzeker");
    // Een verwijzing is geen kop.
    const verwijzing = [rij(0, "artikel", "Artikel 17f", "Artikel 17f. Klein\n\n3 Artikel 17e, derde tot en met zevende lid, is van toepassing."), rij(1, "artikel", "Artikel 18", "Artikel 18. X")];
    assert.equal(sectie("Geef het hele artikel 17f van het besluit", verwijzing).s.reden, "ok");
  });

  await check("route: de eerste chunk moet met de kop zelf beginnen, niet met een verwijzing", () => {
    const r = sectie("Geef het hele artikel 150r van het amendement", [
      rij(0, "artikel", "Artikel 150r", "bedoeld in artikel 150r, heeft aangegeven"),
      rij(1, "artikel", "Artikel 151", "Artikel 151. X"),
    ]);
    assert.equal(r.s.reden, "geen_kop");
    const p = sectie("Geef de hele paragraaf 6.2 van het besluit", [
      rij(0, "paragraaf", "Paragraaf 6.2", "Paragraaf 6.21. Verkeerd"),
      rij(1, "paragraaf", "Paragraaf 6.3", "Paragraaf 6.3. X"),
    ]);
    assert.equal(p.s.reden, "geen_kop");
  });

  // ── E. Fondsdocumenten: dezelfde keten ─────────────────────────────────────
  await check("fonds-PDF (Word-export: vette koppen, hangende leden, tabel, 2 pagina's): hele paragraaf en artikel", () => {
    const kop = "F2";
    const romp = "F1";
    const p1 = pag(1, [
      it(780, 57, "Paragraaf 3.1. Premie", kop),
      it(766, 57, "Artikel 7. Premievaststelling", kop),
      it(752, 57, "1.", kop), it(752, 85, `De premie wordt jaarlijks vastgesteld en ${VOL}`, romp),
      it(740, 85, "door het bestuur op voorstel van de actuaris.", romp),
      it(726, 57, "2.", kop), it(726, 85, "De premie bedraagt:", romp),
      it(712, 85, "Leeftijd", romp), it(712, 300, "Premie", romp),
      it(700, 85, "25-35", romp), it(700, 300, "3%", romp),
      it(688, 85, "35-67", romp), it(688, 300, "5%", romp),
      it(674, 85, "De werkgever draagt de premie af.", romp),
      it(60, 57, "3.", kop), it(60, 85, "De uitvoerder informeert de deelnemer.", romp),
      it(20, 290, "1", romp),
    ]);
    const p2 = pag(2, [
      it(780, 57, "Artikel 8. Premievrijstelling", kop),
      it(766, 85, "Bij arbeidsongeschiktheid wordt premievrij voortgezet.", romp),
      it(740, 57, "Paragraaf 3.2. Uitkering", kop),
      it(726, 57, "Artikel 9. Ingang", kop),
      it(712, 85, "Het pensioen gaat in op de pensioendatum.", romp),
      it(20, 290, "2", romp),
    ]);
    const chunks = chunksUit(alsAlineaSegmenten([p1, p2]));
    assert.ok(chunks.every((c) => c.indexering_versie === V));
    assert.ok(chunks.filter((c) => c.structuur_type === "tabel").every((c) => c.structuur_label === "Artikel 7"));
    const par = sectie("Geef de hele paragraaf 3.1 van het pensioenreglement", chunks);
    assert.equal(par.b.reden, "ok", JSON.stringify(chunks.map((c) => [c.structuur_type, c.structuur_label, c.tekst])));
    assert.equal(par.s.reden, "ok");
    assert.ok(par.s.tekst.startsWith("Paragraaf 3.1. Premie"));
    assert.ok(par.s.tekst.includes("| Leeftijd | Premie |"));
    assert.ok(par.s.tekst.includes("3. De uitvoerder informeert de deelnemer."), "lid 3 in de onderste band blijft");
    assert.ok(par.s.tekst.includes("Artikel 8. Premievrijstelling"));
    assert.ok(!par.s.tekst.includes("Paragraaf 3.2"));
    assert.deepEqual([par.s.beginPagina, par.s.eindPagina], [1, 2]);
    const art = sectie("Geef het hele artikel 7 van het pensioenreglement", chunks);
    assert.equal(art.s.reden, "ok");
    assert.ok(art.s.tekst.trimEnd().endsWith("3. De uitvoerder informeert de deelnemer."));
  });

  await check("fonds-DOCX: hele paragraaf over artikelen; een kop midden in een alinea weigert", async () => {
    const maakDocx = async (alineas: string[]) => {
      const zip = new JSZip();
      zip.file("[Content_Types].xml", '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>');
      zip.file("_rels/.rels", '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
      const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
      zip.file("word/document.xml", '<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
        alineas.map((a) => `<w:p><w:r><w:t xml:space="preserve">${esc(a)}</w:t></w:r></w:p>`).join("") + "</w:body></w:document>");
      return zip.generateAsync({ type: "nodebuffer" });
    };
    const basis = [
      "Hoofdstuk 2 Waardeoverdracht",
      "Paragraaf 2.1. Individuele waardeoverdracht",
      "Artikel 5. Recht op waardeoverdracht",
      "1 De deelnemer heeft recht op waardeoverdracht.",
      "Artikel 6. Termijnen",
      "De uitvoerder verstrekt binnen twee maanden een opgave.",
      "Paragraaf 2.2. Collectieve waardeoverdracht",
      "Artikel 7. Collectief",
      "Tekst.",
    ];
    const goed = chunksUit((await extractTekst(await maakDocx(basis), "docx")).segmenten);
    const r = sectie("Geef de hele paragraaf 2.1 van het pensioenreglement", goed);
    assert.equal(r.s.reden, "ok");
    assert.ok(r.s.tekst.startsWith("Paragraaf 2.1. Individuele waardeoverdracht"));
    assert.ok(r.s.tekst.endsWith("De uitvoerder verstrekt binnen twee maanden een opgave."));
    const samengevoegd = [...basis.slice(0, 5), "De uitvoerder verstrekt een opgave. Paragraaf 2.2. Collectieve waardeoverdracht", ...basis.slice(7)];
    const fout = chunksUit((await extractTekst(await maakDocx(samengevoegd), "docx")).segmenten);
    assert.equal(sectie("Geef de hele paragraaf 2.1 van het pensioenreglement", fout).s.reden, "structuur_onzeker");
  });

  console.log(`\n${n} sanity-tests geslaagd.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
