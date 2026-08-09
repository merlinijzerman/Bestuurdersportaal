// ============================================================================
// T6 — Afschrift-bundel (C1): bouwt de complete zip (laag B, deterministisch).
// ----------------------------------------------------------------------------
// Assembleert de gezipte procesbundel uit reeds-opgehaalde bouwstenen. De I/O
// (dossierviews laden, bijlagen uit storage halen) doet de worker; deze functie
// is puur en zonder DB, zodat zij zelfstandig sanity-testbaar is.
//
// Structuur (ontwerpbeslissing 1):
//   00_LEESWIJZER.docx / .html   ← laag B (sjabloon) of C (AI, fase 2)
//   01_Auditdossier[/<code>.html]← bestaande renderAuditdossierHtml()
//   02_Tijdlijn.html / .csv      ← beide auditsporen
//   03_Auditlog.csv / .json      ← beide sporen, bron-kolom + hash
//   04_Bijlagen/B01_…            ← documenten via procedure_bewijs
//   MANIFEST.json                ← volledigheid + integriteit
//   INHOUDSOPGAVE.md
//
// CAPS (ontwerpbeslissing 7): ≤40 bijlagen, ≤25MB/bijlage, ≤150MB ongecomprimeerd
// totaal. Overschrijding levert de bundel WÉL, met de overschrijding in
// uitgesloten_items — nooit een fout (AC 8).
// ============================================================================

import JSZip from "jszip";
import { bouwFeitenkaart } from "./afschrift-feitenkaart";
import {
  bouwAuditRegels,
  tijdlijnHTML,
  tijdlijnCSV,
  auditlogCSV,
  auditlogJSON,
} from "./afschrift-tijdlijn";
import {
  bouwManifest,
  sha256Hex,
  type ManifestBestand,
  type UitgeslotenItem,
  type ManifestWaarschuwing,
  type SnapshotHash,
} from "./afschrift-manifest";
import {
  bouwSjabloonProza,
  bouwLeeswijzerDocx,
  bouwLeeswijzerHtml,
  type LeeswijzerHerkomst,
  type LeeswijzerProza,
} from "./afschrift-docx";
import { veiligeBestandsnaamKern } from "./docx-primitieven";
import type { AfschriftBron } from "./afschrift-types";

// Caps (ontwerpbeslissing 7).
export const MAX_BIJLAGEN = 40;
export const MAX_BIJLAGE_BYTES = 25 * 1024 * 1024;
export const MAX_TOTAAL_BYTES = 150 * 1024 * 1024;

/** Eén bijlage zoals de worker haar aanlevert (bytes al uit storage gehaald). */
export interface BijlageInvoer {
  bewijsId: string;
  titel: string;
  documenttype: string | null;
  /** Bestandsextensie zonder punt (bv. "pdf"). */
  extensie: string;
  /** Bytes, of null wanneer de worker het bestand niet kon/mocht ophalen. */
  bytes: Uint8Array | null;
  /** Gezet ⇒ vooraf uitgesloten (geen_bestand/geen_toegang/ingetrokken). */
  uitsluiting?: { reden: UitgeslotenItem["reden"]; detail?: string };
  /** Gevuld ⇒ het meegenomen bestand kan een andere versie zijn (R2). */
  vervangenDoorDocumentId?: string | null;
}

export interface BundelInvoer {
  bron: AfschriftBron;
  /** Per Decision Object de renderAuditdossierHtml()-output. */
  auditdossiers: { besluitCode: string; html: string }[];
  /** Snapshot-hashes uit decision_audit_snapshots (besluitmoment). */
  snapshotHashes: SnapshotHash[];
  bijlagen: BijlageInvoer[];
  /** §1 van de leeswijzer (code). */
  besluitvragen: { besluitCode: string; titel: string; besluitvraag: string; scope: string | null }[];
  /** Fase 2: vastgestelde AI-proza (§2–4) + herkomst. Leeg ⇒ sjabloon (fase 1). */
  proza?: LeeswijzerProza | null;
  herkomst?: LeeswijzerHerkomst | null;
  /** Extra waarschuwingen die de worker vaststelt (bv. snapshot-terugval, M3). */
  extraWaarschuwingen?: ManifestWaarschuwing[];
}

export interface BundelResultaat {
  zipBytes: Uint8Array;
  /** sha256 van de zip-bytes (opslag-integriteit; DB-kolom sha256). */
  sha256: string;
  /** sha256 over de per-bestand-hashes (embedbaar in leeswijzer/manifest). */
  inhoudHash: string;
  bestandsaantal: number;
  bytes: number;
  uitgeslotenItems: UitgeslotenItem[];
  waarschuwingen: ManifestWaarschuwing[];
  bevatStemgedrag: boolean;
}

const encoder = new TextEncoder();
function tekstBytes(s: string): Uint8Array {
  return encoder.encode(s);
}

/** Bijlage-bestandsnaam: B01_<documenttype>_<titel>.<ext>, veilig genormaliseerd. */
function bijlageNaam(index: number, b: BijlageInvoer): string {
  const nr = String(index).padStart(2, "0");
  const typeDeel = b.documenttype ? `${veiligeBestandsnaamKern(b.documenttype, 30)}_` : "";
  const titelKern = veiligeBestandsnaamKern(b.titel, 60);
  const ext = b.extensie.replace(/[^a-zA-Z0-9]/g, "").toLowerCase() || "bin";
  return `04_Bijlagen/B${nr}_${typeDeel}${titelKern}.${ext}`;
}

function inhoudsopgaveMd(
  bestanden: { pad: string }[],
  aantalBesluiten: number,
  uitgesloten: number,
  waarschuwingen: number
): string {
  const regels = bestanden.map((b) => `- \`${b.pad}\``).join("\n");
  return `# Inhoudsopgave — auditdossier-afschrift

Deze bundel is een vastgelegd, reproduceerbaar archiefstuk over het gehele proces
(${aantalBesluiten} besluit${aantalBesluiten === 1 ? "" : "en"}).

## Bestanden
${regels}

## Integriteit
- \`MANIFEST.json\` bevat per bestand een sha256 en bytes, plus \`inhoud_hash\`
  (een hash over die per-bestand-hashes).
- Het **besluit-spoor** (\`03_Auditlog\`, bron = besluit) draagt per gebeurtenis
  een ongesleutelde sha256. Het **proces-spoor** (bron = proces, uit
  \`procedure_log\`) heeft **geen** hashkolom — de integriteitsgarantie is voor
  dat spoor dus minder sterk.
- ${uitgesloten} item(s) zijn niet opgenomen; zie \`uitgesloten_items\` in het manifest.
- ${waarschuwingen} waarschuwing(en); zie \`waarschuwingen\` in het manifest.

## Toelichting
- \`00_LEESWIJZER\` is een **toelichtend, niet-authoritatief** stuk. Leidend zijn
  de brondocumenten en \`01_Auditdossier\`.
`;
}

/**
 * Bouwt de volledige bundel. Deterministisch: identieke invoer ⇒ identieke
 * zip-bytes (entry-datums gepind op de generatietijd uit de context).
 */
export async function bouwBundel(invoer: BundelInvoer): Promise<BundelResultaat> {
  const { bron } = invoer;
  const feitenkaart = bouwFeitenkaart(bron);
  const ctx = bron.context;

  const uitgeslotenItems: UitgeslotenItem[] = [];
  const waarschuwingen: ManifestWaarschuwing[] = [];

  // ── Contentbestanden (alles behalve leeswijzer + manifest) ────────────────
  const content: { pad: string; bytes: Uint8Array }[] = [];

  // 01_Auditdossier
  if (invoer.auditdossiers.length === 1) {
    content.push({ pad: "01_Auditdossier.html", bytes: tekstBytes(invoer.auditdossiers[0].html) });
  } else {
    for (const d of invoer.auditdossiers) {
      const naam = veiligeBestandsnaamKern(d.besluitCode, 40) || "besluit";
      content.push({ pad: `01_Auditdossier/${naam}.html`, bytes: tekstBytes(d.html) });
    }
  }

  // 02_Tijdlijn + 03_Auditlog (beide sporen)
  const regels = bouwAuditRegels(bron);
  const tijdlijnMeta = {
    procescode: feitenkaart.procescode,
    procedureTitel: feitenkaart.procedureTitel,
    versie: feitenkaart.versie,
    gegenereerdOp: ctx.aangemaaktOp,
  };
  content.push({ pad: "02_Tijdlijn.html", bytes: tekstBytes(tijdlijnHTML(regels, tijdlijnMeta)) });
  content.push({ pad: "02_Tijdlijn.csv", bytes: tekstBytes(tijdlijnCSV(regels)) });
  content.push({ pad: "03_Auditlog.csv", bytes: tekstBytes(auditlogCSV(regels)) });
  content.push({ pad: "03_Auditlog.json", bytes: tekstBytes(auditlogJSON(regels)) });

  // 04_Bijlagen (met caps)
  let bijlageIndex = 0;
  let totaalBijlageBytes = 0;
  for (const b of invoer.bijlagen) {
    // Vooraf uitgesloten (geen_bestand/geen_toegang/ingetrokken).
    if (b.uitsluiting || b.bytes === null) {
      uitgeslotenItems.push({
        pad: null,
        type: "bijlage",
        titel: b.titel,
        reden: b.uitsluiting?.reden ?? "geen_bestand",
        detail: b.uitsluiting?.detail,
      });
      continue;
    }
    if (b.bytes.length > MAX_BIJLAGE_BYTES) {
      uitgeslotenItems.push({ pad: null, type: "bijlage", titel: b.titel, reden: "te_groot",
        detail: `${b.bytes.length} bytes > ${MAX_BIJLAGE_BYTES}` });
      continue;
    }
    if (bijlageIndex >= MAX_BIJLAGEN) {
      uitgeslotenItems.push({ pad: null, type: "bijlage", titel: b.titel, reden: "cap_overschreden",
        detail: `meer dan ${MAX_BIJLAGEN} bijlagen` });
      continue;
    }
    if (totaalBijlageBytes + b.bytes.length > MAX_TOTAAL_BYTES) {
      uitgeslotenItems.push({ pad: null, type: "bijlage", titel: b.titel, reden: "cap_overschreden",
        detail: `overschrijdt totaalcap ${MAX_TOTAAL_BYTES} bytes` });
      continue;
    }
    bijlageIndex += 1;
    totaalBijlageBytes += b.bytes.length;
    const pad = bijlageNaam(bijlageIndex, b);
    content.push({ pad, bytes: b.bytes });
    if (b.vervangenDoorDocumentId) {
      waarschuwingen.push({
        pad,
        melding:
          "Deze bijlage kan een andere versie zijn dan die ten tijde van het besluit voorlag " +
          "(vervangen_door_document_id is gevuld).",
      });
    }
  }

  // Worker-vastgestelde waarschuwingen (M3: snapshot-terugval e.d.).
  if (invoer.extraWaarschuwingen?.length) {
    waarschuwingen.push(...invoer.extraWaarschuwingen);
  }

  // INHOUDSOPGAVE (over de contentbestanden + straks leeswijzer + manifest)
  // Voorlopige lijst voor de inhoudsopgave: we voegen leeswijzer/manifest-namen toe.
  const alleNamenVoorlopig = [
    "00_LEESWIJZER.docx",
    "00_LEESWIJZER.html",
    ...content.map((c) => c.pad),
    "MANIFEST.json",
    "INHOUDSOPGAVE.md",
  ].sort();
  const inhoudsopgave = inhoudsopgaveMd(
    alleNamenVoorlopig.map((pad) => ({ pad })),
    feitenkaart.aantalBesluiten,
    uitgeslotenItems.length,
    waarschuwingen.length
  );
  content.push({ pad: "INHOUDSOPGAVE.md", bytes: tekstBytes(inhoudsopgave) });

  // ── Per-bestand-hashes + inhoudHash (excl. leeswijzer + manifest) ─────────
  const contentBestanden: ManifestBestand[] = content
    .map((c) => ({ pad: c.pad, bytes: c.bytes.length, sha256: sha256Hex(c.bytes) }))
    .sort((a, b) => (a.pad < b.pad ? -1 : 1));
  const inhoudHash = sha256Hex(contentBestanden.map((b) => `${b.pad}\t${b.sha256}`).join("\n"));

  // ── Leeswijzer (docx + html), met inhoudHash als embedbare bundelhash ─────
  const proza = invoer.proza ?? bouwSjabloonProza(feitenkaart);
  const uitsluitingenLeesbaar = uitgeslotenItems.map(
    (u) => `${u.titel} — ${uitsluitReor(u.reden)}${u.detail ? ` (${u.detail})` : ""}`
  );
  const waarschuwingenLeesbaar = waarschuwingen.map((w) => `${w.pad}: ${w.melding}`);
  const leeswijzerInput = {
    feitenkaart,
    besluitvragen: invoer.besluitvragen,
    inventaris: contentBestanden.map((b) => ({ pad: b.pad, omschrijving: omschrijfBestand(b.pad) })),
    uitsluitingen: uitsluitingenLeesbaar,
    waarschuwingen: waarschuwingenLeesbaar,
    hashketenOpmerking:
      "Het besluit-spoor draagt per gebeurtenis een ongesleutelde sha256; het proces-spoor (procedure_log) heeft geen hashkolom." +
      (ctx.versie === "besluitmoment"
        ? " Bij versie 'besluitmoment' weerspiegelen het auditdossier en het besluit-spoor de bevroren snapshot; het proces-spoor (procedure_log) en de bijlagen weerspiegelen het generatiemoment."
        : ""),
    opstellerNaam: ctx.aangemaaktDoorNaam,
    opstellerRol: ctx.gebouwdOnderRol,
    datumISO: ctx.aangemaaktOp,
    snapshotHash: invoer.snapshotHashes[0]?.hash ?? null,
    sha256Bundel: inhoudHash,
    aantalBijlagen: bijlageIndex,
    proza,
    herkomst: invoer.herkomst ?? null,
    aiLeeswijzer: Boolean(invoer.herkomst),
  };
  const leeswijzerDocx = await bouwLeeswijzerDocx(leeswijzerInput);
  const leeswijzerHtml = tekstBytes(bouwLeeswijzerHtml(leeswijzerInput));

  const leeswijzerBestanden: ManifestBestand[] = [
    { pad: "00_LEESWIJZER.docx", bytes: leeswijzerDocx.length, sha256: sha256Hex(leeswijzerDocx) },
    { pad: "00_LEESWIJZER.html", bytes: leeswijzerHtml.length, sha256: sha256Hex(leeswijzerHtml) },
  ];

  // ── Manifest (lijst ALLE bestanden behalve zichzelf) ──────────────────────
  const bevatStemgedrag = bron.decisions.some((d) => d.stemverslagen.length > 0);
  const alleBestanden = [...leeswijzerBestanden, ...contentBestanden].sort((a, b) =>
    a.pad < b.pad ? -1 : 1
  );
  const { json: manifestJson } = bouwManifest({
    context: ctx,
    bestanden: alleBestanden,
    snapshotHashes: invoer.snapshotHashes,
    uitgeslotenItems,
    waarschuwingen,
    hoogsteVertrouwelijkheid: feitenkaart.hoogsteVertrouwelijkheid,
    aantalBesluiten: feitenkaart.aantalBesluiten,
    bevatStemgedrag,
    inhoudHash,
  });
  const manifestBytes = tekstBytes(manifestJson);

  // ── Zip (gepinde datums = deterministisch) ────────────────────────────────
  const zip = new JSZip();
  const datum = new Date(ctx.aangemaaktOp);
  zip.file("00_LEESWIJZER.docx", leeswijzerDocx, { date: datum });
  zip.file("00_LEESWIJZER.html", leeswijzerHtml, { date: datum });
  for (const c of content) zip.file(c.pad, c.bytes, { date: datum });
  zip.file("MANIFEST.json", manifestBytes, { date: datum });

  const zipBytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });

  const bestandsaantal = alleBestanden.length + 1; // + MANIFEST.json
  const totaalBytes =
    alleBestanden.reduce((s, b) => s + b.bytes, 0) + manifestBytes.length;

  return {
    zipBytes,
    sha256: sha256Hex(zipBytes),
    inhoudHash,
    bestandsaantal,
    bytes: totaalBytes,
    uitgeslotenItems,
    waarschuwingen,
    bevatStemgedrag,
  };
}

// ── Leesbare labels ──────────────────────────────────────────────────────────

function uitsluitReor(reden: UitgeslotenItem["reden"]): string {
  switch (reden) {
    case "geen_bestand": return "geen bijgevoegd bestand (alleen titel en beschrijving)";
    case "geen_toegang": return "niet leesbaar onder de rechten van de aanvrager";
    case "te_groot": return "boven de per-bestandslimiet";
    case "ingetrokken": return "ingetrokken document (niet opgenomen)";
    case "cap_overschreden": return "buiten de bundelcaps gevallen";
  }
}

function omschrijfBestand(pad: string): string {
  if (pad.startsWith("01_Auditdossier")) return "Het volledige auditdossier per besluit (aannames, risico's, dissent, audit-trail).";
  if (pad === "02_Tijdlijn.html") return "Chronologische tijdlijn uit beide auditsporen (leesbaar).";
  if (pad === "02_Tijdlijn.csv") return "Dezelfde tijdlijn als CSV.";
  if (pad === "03_Auditlog.csv") return "De volledige auditlog (beide sporen) als CSV.";
  if (pad === "03_Auditlog.json") return "De volledige auditlog als JSON, met oude/nieuwe waarde.";
  if (pad.startsWith("04_Bijlagen")) return "Bijgevoegd brondocument.";
  if (pad === "INHOUDSOPGAVE.md") return "Overzicht van de bundelinhoud en de integriteitsopmerkingen.";
  return "Bundelonderdeel.";
}
