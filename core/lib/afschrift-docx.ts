// ============================================================================
// T6 — Afschrift-leeswijzer (00_LEESWIJZER.docx + .html).
// ----------------------------------------------------------------------------
// Het stuk dat een accountant/toezichthouder als EERSTE opent. Het moet er als
// een stuk van het fonds uitzien én in één oogopslag tonen dat het toelichtend
// is. Bouwt op de gedeelde OOXML-primitieven (docx-primitieven, besluit 0079).
//
// LAAGSCHEIDING: §1/§5/§6 zijn deterministisch (code). §2–4 zijn "proza": in
// fase 1 een deterministisch sjabloon (bouwSjabloonProza), in fase 2 vastgestelde
// AI-tekst — maar afschrift-docx rendert alleen wat het krijgt en kent het
// verschil niet. Dat beperkt het generatieve oppervlak tot ~de helft en houdt
// §5 automatisch consistent met de werkelijke bundelinhoud.
//
// HARDE CONTROLES (0098-patroon, als antwoord-docx):
//   • Het statuskader ("Toelichtend document — niet-authoritatief") MOET op
//     pagina 1 staan; de bouwfunctie weigert een document zonder (AC 8a).
//   • In fase 2 MOET het herkomstblok in §6 staan; de bouwfunctie weigert zonder
//     wanneer input.herkomst is meegegeven met aiLeeswijzer=true (AC 8).
//
// Neutrale huisstijl met één config-inhaakplek (T5-A6 nog open): geen logo,
// één accentkleur. De HTML-tweeling is de niet-bewerkbare referentiekopie.
// ============================================================================

import JSZip from "jszip";
import {
  esc,
  run,
  paragraaf,
  paragraafMetPpr,
  tabel,
  CONTENT_TYPES as BASIS_CONTENT_TYPES,
  RELS,
} from "./docx-primitieven";
import type { Feitenkaart } from "./afschrift-types";
import { VERTROUWELIJKHEID_LABEL } from "./afschrift-types";

// Anker waarop de bouwfunctie controleert (AC 8a). Wijzig deze tekst niet los
// van de statuskader-render.
export const STATUSKADER_ANKER = "Toelichtend document — niet-authoritatief";

export interface LeeswijzerHerkomst {
  model: string;
  promptversie: string;
  gegenereerdOp: string; // ISO
  tekstHash: string;
  vastgesteldDoor: string;
  vastgesteldOp: string; // ISO
}

export interface LeeswijzerProza {
  hoeVerlopen: string; // §2
  watVastgelegd: string; // §3
  bijzonderheden: string; // §4
}

export interface LeeswijzerInput {
  feitenkaart: Feitenkaart;
  /** §1 — per besluit de besluitvraag + scope (code). */
  besluitvragen: { besluitCode: string; titel: string; besluitvraag: string; scope: string | null }[];
  /** §5 — inventaris uit het manifest: pad → omschrijving. */
  inventaris: { pad: string; omschrijving: string }[];
  /** §6 — leesbare uitsluitingen en waarschuwingen. */
  uitsluitingen: string[];
  waarschuwingen: string[];
  hashketenOpmerking: string;
  /** Kenmerken-tabel + kop/voet. */
  opstellerNaam: string | null;
  opstellerRol: string | null;
  datumISO: string;
  snapshotHash: string | null;
  sha256Bundel: string | null;
  aantalBijlagen: number;
  /** §2–4 proza (sjabloon in fase 1, AI in fase 2). */
  proza: LeeswijzerProza;
  /** Fase 2: gevuld ⇒ AI-leeswijzer met herkomstblok in §6. */
  herkomst: LeeswijzerHerkomst | null;
  aiLeeswijzer: boolean;
}

// ── Deterministische hulpjes ─────────────────────────────────────────────────

const MAANDEN = [
  "januari", "februari", "maart", "april", "mei", "juni",
  "juli", "augustus", "september", "oktober", "november", "december",
];

/** ISO → "9 augustus 2026" (deterministisch, geen locale). */
export function formatNlDatum(iso: string): string {
  const d = iso.slice(0, 10).split("-");
  if (d.length !== 3) return iso;
  const jaar = Number(d[0]);
  const maand = Number(d[1]);
  const dag = Number(d[2]);
  if (!maand || maand < 1 || maand > 12) return iso;
  return `${dag} ${MAANDEN[maand - 1]} ${jaar}`;
}

function enkelvoudMeervoud(n: number, enkel: string, meervoud: string): string {
  return n === 1 ? `${n} ${enkel}` : `${n} ${meervoud}`;
}

/**
 * Deterministisch sjabloon voor §2–4 (fase 1, en de terugval in fase 2). Strikt
 * beschrijvend, geen oordelen. De getallen komen 1-op-1 uit de feitenkaart, zodat
 * §3 exact overeenkomt met het auditdossier (AC 10 / 3b).
 */
export function bouwSjabloonProza(fk: Feitenkaart): LeeswijzerProza {
  // §2 — Hoe het proces is verlopen.
  const faseDelen: string[] = [];
  if (fk.onderbouwingsfase.start && fk.onderbouwingsfase.eind) {
    faseDelen.push(
      `De vastlegging liep van ${formatNlDatum(fk.onderbouwingsfase.start)} tot ${formatNlDatum(fk.onderbouwingsfase.eind)}.`
    );
  }
  if (fk.doorlooptijdDagen !== null) {
    faseDelen.push(`De doorlooptijd van het proces bedroeg ${enkelvoudMeervoud(fk.doorlooptijdDagen, "dag", "dagen")}.`);
  }
  faseDelen.push(
    `Het proces omvat ${enkelvoudMeervoud(fk.aantalBesluiten, "besluit", "besluiten")}` +
      (fk.besluiten.length
        ? `: ${fk.besluiten.map((b) => `${b.besluitCode} (${b.statusLabel.toLowerCase()})`).join(", ")}.`
        : ".")
  );
  const hoeVerlopen = faseDelen.join(" ");

  // §3 — Wat is vastgelegd (tellingen uit de feitenkaart).
  const t = fk.totalen;
  const watVastgelegd =
    `In dit dossier zijn ${enkelvoudMeervoud(t.aannames, "aanname", "aannames")} vastgelegd` +
    (t.aannames ? `, waarvan ${t.aannamesGevalideerd} gevalideerd` : "") +
    `; ${enkelvoudMeervoud(t.risicos, "risico", "risico's")}` +
    (t.risicos ? `, waarvan ${t.risicosGeaccepteerd} geaccepteerd` : "") +
    `; ${enkelvoudMeervoud(t.voorwaarden, "voorwaarde", "voorwaarden")}` +
    (t.voorwaarden ? `, waarvan ${t.voorwaardenOpen} nog open` : "") +
    `; ${enkelvoudMeervoud(t.acties, "actie", "acties")}` +
    `; en ${enkelvoudMeervoud(t.dissent, "dissentnotitie", "dissentnotities")}` +
    (t.dissent ? `, waarvan ${t.dissentFormeel} formeel vastgesteld` : "") +
    `. Er zijn ${enkelvoudMeervoud(fk.bewijs.totaal, "bewijsstuk", "bewijsstukken")} gevoegd` +
    (fk.bewijs.totaal ? `, waarvan ${fk.bewijs.metDocument} met een bijgevoegd bestand` : "") +
    `.`;

  // §4 — Bijzonderheden en afwijkingen.
  const bijzonderheden =
    fk.afwijkingen.length === 0
      ? "Er zijn geen bijzonderheden of afwijkingen ten opzichte van het verwachte procesverloop vastgelegd."
      : fk.afwijkingen.join(" ");

  return { hoeVerlopen, watVastgelegd, bijzonderheden };
}

// ── OOXML: stijlen + sectie met kop/voet ─────────────────────────────────────

const ACCENT = "1F3A5F"; // neutrale accentkleur (config-inhaakplek T5-A6)

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:pPr><w:spacing w:after="120" w:line="264" w:lineRule="auto"/></w:pPr><w:rPr><w:sz w:val="21"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Title"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/></w:pPr><w:rPr><w:b/><w:sz w:val="36"/><w:color w:val="${ACCENT}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Ondertitel"><w:name w:val="Ondertitel"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="240"/></w:pPr><w:rPr><w:color w:val="555555"/><w:sz w:val="22"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="260" w:after="60"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:b/><w:sz w:val="26"/><w:color w:val="${ACCENT}"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Heading2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:pPr><w:spacing w:before="180" w:after="40"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:b/><w:sz w:val="23"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Lijst"><w:name w:val="Lijst"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="360"/><w:spacing w:after="40"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="KopVoet"><w:name w:val="KopVoet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="0"/></w:pPr><w:rPr><w:sz w:val="16"/><w:color w:val="777777"/></w:rPr></w:style>
</w:styles>`;

// A4 met marges 2,5 cm (≈1417 twips) + kop-/voetreferenties.
const SECT_PR =
  "<w:sectPr>" +
  '<w:headerReference w:type="default" r:id="rIdHdr"/>' +
  '<w:footerReference w:type="default" r:id="rIdFtr"/>' +
  '<w:pgSz w:w="11906" w:h="16838"/>' +
  '<w:pgMar w:top="1417" w:right="1417" w:bottom="1417" w:left="1417" w:header="708" w:footer="708" w:gutter="0"/>' +
  "</w:sectPr>";

const CONTENT_TYPES = BASIS_CONTENT_TYPES.replace(
  "</Types>",
  '<Override PartName="/word/header1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.header+xml"/>' +
    '<Override PartName="/word/footer1.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footer+xml"/>' +
    "</Types>"
);

const DOC_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
<Relationship Id="rIdHdr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/header" Target="header1.xml"/>
<Relationship Id="rIdFtr" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footer" Target="footer1.xml"/>
</Relationships>`;

function headerXml(vertrouwelijkheidLabel: string): string {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:hdr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
${paragraaf(run(vertrouwelijkheidLabel.toUpperCase(), { grootte: 16, kleur: "777777" }), { stijl: "KopVoet", rechts: true })}
</w:hdr>`;
}

function footerXml(links: string): string {
  // Rechts: "Pagina X van Y" via PAGE/NUMPAGES-velden. Links: procescode · afschrift · sha256(8).
  const paginaVeld =
    run("Pagina ") +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> PAGE </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>' +
    run(" van ") +
    '<w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> NUMPAGES </w:instrText></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r>';
  // Tabel met twee kolommen (links/rechts) zonder randen zou netter zijn; hier
  // volstaan twee paragrafen: links de herleidbaarheidsregel, rechts de paginering.
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:ftr xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
${paragraaf(run(links, { grootte: 16, kleur: "777777" }), { stijl: "KopVoet" })}
${paragraafMetPpr('<w:pStyle w:val="KopVoet"/><w:jc w:val="right"/>', paginaVeld)}
</w:ftr>`;
}

// ── Statuskader ──────────────────────────────────────────────────────────────

function statuskaderTekst(input: LeeswijzerInput): string {
  const kern =
    input.aiLeeswijzer && input.herkomst
      ? `Voorbereid met AI op basis van vastgelegde procesgegevens, vastgesteld door ${input.herkomst.vastgesteldDoor} op ${formatNlDatum(input.herkomst.vastgesteldOp)}.`
      : "Samengesteld uit vastgelegde procesgegevens.";
  return `${STATUSKADER_ANKER}. ${kern} Leidend zijn de bijgevoegde brondocumenten en het auditdossier.`;
}

function statuskaderParagraaf(input: LeeswijzerInput): string {
  // Gearceerd kader met rand, direct onder de titel.
  const ppr =
    '<w:pBdr><w:top w:val="single" w:sz="6" w:space="4" w:color="C8CCD8"/>' +
    '<w:left w:val="single" w:sz="6" w:space="4" w:color="C8CCD8"/>' +
    '<w:bottom w:val="single" w:sz="6" w:space="4" w:color="C8CCD8"/>' +
    '<w:right w:val="single" w:sz="6" w:space="4" w:color="C8CCD8"/></w:pBdr>' +
    '<w:shd w:val="clear" w:color="auto" w:fill="F4F6F9"/>' +
    '<w:spacing w:before="120" w:after="200"/>';
  return paragraafMetPpr(ppr, run(statuskaderTekst(input), { grootte: 20 }));
}

// ── Document-XML ─────────────────────────────────────────────────────────────

function kenmerkenTabel(input: LeeswijzerInput): string {
  const fk = input.feitenkaart;
  // 2-koloms kenmerkentabel: links het label (vet), rechts de waarde.
  const r = (label: string, waarde: string): string[] => [run(label, { vet: true }), run(waarde)];
  const data: string[][] = [
    r("Proces", fk.procedureTitel),
    r("Procescode", fk.procescode),
    r("Versie", fk.versie),
    r("Aanleiding", fk.aanleiding ?? "—"),
    r("Opgesteld door", `${input.opstellerNaam ?? "—"}${input.opstellerRol ? ` (${input.opstellerRol})` : ""}`),
    r("Datum", formatNlDatum(input.datumISO)),
    r("Hoogste vertrouwelijkheid", VERTROUWELIJKHEID_LABEL[fk.hoogsteVertrouwelijkheid]),
    r("Snapshot-hash", input.snapshotHash ? input.snapshotHash.slice(0, 16) + "…" : "—"),
    r("Aantal bijlagen", String(input.aantalBijlagen)),
    r("sha256 bundel", input.sha256Bundel ? input.sha256Bundel.slice(0, 16) + "…" : "—"),
  ];
  // 2 kolommen: label 30%, waarde 70%.
  return tabel(data, { breedtes: [2722, 6350] });
}

function sectieKop(nr: number, titel: string): string {
  return paragraaf(run(`${nr}. ${titel}`), { stijl: "Heading1" });
}

function alineas(tekst: string): string {
  return tekst
    .split(/\n{2,}/)
    .map((p) => paragraaf(run(p.trim())))
    .join("");
}

/**
 * Bouwt de document-XML van de leeswijzer. Puur en testbaar. Weigert (gooit) een
 * document zonder statuskader-anker (AC 8a), en — als input.aiLeeswijzer — zonder
 * herkomstblok in §6 (AC 8).
 */
export function bouwLeeswijzerDocumentXml(input: LeeswijzerInput): string {
  const fk = input.feitenkaart;
  const delen: string[] = [];

  // Titelblok
  delen.push(paragraaf(run("LEESWIJZER BIJ HET AUDITDOSSIER"), { stijl: "Title" }));
  delen.push(
    paragraaf(run(`${fk.procedureTitel} · ${fk.procescode}`), { stijl: "Ondertitel" })
  );
  delen.push(
    paragraaf(run(`Versie: ${fk.versie} · ${formatNlDatum(input.datumISO)}`), { stijl: "Ondertitel" })
  );

  // Statuskader (verplicht, pagina 1)
  delen.push(statuskaderParagraaf(input));

  // Kenmerken
  delen.push(paragraaf(run("Kenmerken"), { stijl: "Heading2" }));
  delen.push(kenmerkenTabel(input));

  // §1 — Waar dit dossier over gaat (code)
  delen.push(sectieKop(1, "Waar dit dossier over gaat"));
  if (input.besluitvragen.length === 0) {
    delen.push(paragraaf(run("Er zijn geen besluiten aan dit proces gekoppeld.")));
  } else {
    for (const bv of input.besluitvragen) {
      delen.push(paragraaf(run(`${bv.besluitCode} — ${bv.titel}`, { vet: true })));
      delen.push(paragraaf(run(`Besluitvraag: ${bv.besluitvraag}`)));
      if (bv.scope) delen.push(paragraaf(run(`Scope: ${bv.scope}`)));
    }
  }

  // §2 — Hoe het proces is verlopen (proza)
  delen.push(sectieKop(2, "Hoe het proces is verlopen"));
  delen.push(alineas(input.proza.hoeVerlopen));

  // §3 — Wat is vastgelegd (proza op tellingen)
  delen.push(sectieKop(3, "Wat is vastgelegd"));
  delen.push(alineas(input.proza.watVastgelegd));

  // §4 — Bijzonderheden en afwijkingen (proza)
  delen.push(sectieKop(4, "Bijzonderheden en afwijkingen"));
  delen.push(alineas(input.proza.bijzonderheden));

  // §5 — Wat u in deze bundel aantreft (code, uit manifest)
  delen.push(sectieKop(5, "Wat u in deze bundel aantreft"));
  for (const it of input.inventaris) {
    delen.push(paragraaf(run("• ") + run(`${it.pad} — `, { vet: true }) + run(it.omschrijving), { stijl: "Lijst" }));
  }

  // §6 — Verantwoording en beperkingen (code)
  delen.push(sectieKop(6, "Verantwoording en beperkingen"));
  const rol = input.opstellerRol ?? "de aanvrager";
  delen.push(
    paragraaf(
      run(
        `Deze bundel bevat het dossier zoals ${rol} het op ${formatNlDatum(input.datumISO)} kon inzien (gebouwd onder de RLS-rechten van de aanvrager).`
      )
    )
  );
  if (input.uitsluitingen.length) {
    delen.push(paragraaf(run("Niet in deze bundel opgenomen:", { vet: true })));
    for (const u of input.uitsluitingen) delen.push(paragraaf(run("• ") + run(u), { stijl: "Lijst" }));
  }
  if (input.waarschuwingen.length) {
    delen.push(paragraaf(run("Aandachtspunten:", { vet: true })));
    for (const w of input.waarschuwingen) delen.push(paragraaf(run("• ") + run(w), { stijl: "Lijst" }));
  }
  delen.push(paragraaf(run(input.hashketenOpmerking)));

  // Fase 2: herkomstblok
  if (input.aiLeeswijzer && input.herkomst) {
    const h = input.herkomst;
    delen.push(paragraaf(run("Herkomst van de AI-voorbereiding", { vet: true })));
    delen.push(
      paragraaf(
        run(
          `Model: ${h.model} · promptversie ${h.promptversie} · gegenereerd ${formatNlDatum(h.gegenereerdOp)} · ` +
            `sha256 van de tekst ${h.tekstHash.slice(0, 16)}… · Vastgesteld door ${h.vastgesteldDoor} op ${formatNlDatum(h.vastgesteldOp)}.`
        )
      )
    );
  }

  const body = `${delen.join("")}${SECT_PR}`;
  const documentXml =
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" ` +
    `xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">` +
    `<w:body>${body}</w:body></w:document>`;

  // Sluis 1: statuskader verplicht (AC 8a).
  if (!documentXml.includes(esc(STATUSKADER_ANKER))) {
    throw new Error("afschrift-docx: statuskader ontbreekt — export geweigerd");
  }
  // Sluis 2: fase-2-herkomstblok verplicht bij een AI-leeswijzer (AC 8).
  if (input.aiLeeswijzer && input.herkomst && !documentXml.includes("Herkomst van de AI-voorbereiding")) {
    throw new Error("afschrift-docx: herkomstblok ontbreekt bij AI-leeswijzer — export geweigerd");
  }

  return documentXml;
}

// ── Zip (.docx met kop/voet) ─────────────────────────────────────────────────

export async function bouwLeeswijzerDocx(input: LeeswijzerInput): Promise<Uint8Array> {
  const documentXml = bouwLeeswijzerDocumentXml(input);
  const vertrouwelijkheid = VERTROUWELIJKHEID_LABEL[input.feitenkaart.hoogsteVertrouwelijkheid];
  const footerLinks =
    `${input.feitenkaart.procescode} · afschrift ${input.datumISO.slice(0, 10)}` +
    (input.sha256Bundel ? ` · sha256 ${input.sha256Bundel.slice(0, 8)}` : "");

  // Determinisme: pin de entry-datums op de generatietijd (anders vult JSZip
  // per part `new Date()` in → niet-reproduceerbare .docx-bytes → onbruikbare
  // bundel-sha256/dedup). Zie code-review H1.
  const datum = new Date(input.datumISO);
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES, { date: datum });
  zip.file("_rels/.rels", RELS, { date: datum });
  zip.file("word/document.xml", documentXml, { date: datum });
  zip.file("word/_rels/document.xml.rels", DOC_RELS, { date: datum });
  zip.file("word/styles.xml", STYLES, { date: datum });
  zip.file("word/header1.xml", headerXml(vertrouwelijkheid), { date: datum });
  zip.file("word/footer1.xml", footerXml(footerLinks), { date: datum });
  return zip.generateAsync({
    type: "uint8array",
    mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ── HTML-tweeling (niet-bewerkbare referentiekopie) ──────────────────────────

function htmlEsc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function bouwLeeswijzerHtml(input: LeeswijzerInput): string {
  const fk = input.feitenkaart;
  const p = (t: string) => `<p>${htmlEsc(t)}</p>`;
  const secties = [
    `<h2>1. Waar dit dossier over gaat</h2>`,
    input.besluitvragen.length
      ? input.besluitvragen
          .map(
            (bv) =>
              `<p><strong>${htmlEsc(bv.besluitCode)} — ${htmlEsc(bv.titel)}</strong><br>Besluitvraag: ${htmlEsc(bv.besluitvraag)}${bv.scope ? `<br>Scope: ${htmlEsc(bv.scope)}` : ""}</p>`
          )
          .join("")
      : p("Er zijn geen besluiten aan dit proces gekoppeld."),
    `<h2>2. Hoe het proces is verlopen</h2>`,
    input.proza.hoeVerlopen.split(/\n{2,}/).map(p).join(""),
    `<h2>3. Wat is vastgelegd</h2>`,
    input.proza.watVastgelegd.split(/\n{2,}/).map(p).join(""),
    `<h2>4. Bijzonderheden en afwijkingen</h2>`,
    input.proza.bijzonderheden.split(/\n{2,}/).map(p).join(""),
    `<h2>5. Wat u in deze bundel aantreft</h2>`,
    `<ul>${input.inventaris.map((it) => `<li><strong>${htmlEsc(it.pad)}</strong> — ${htmlEsc(it.omschrijving)}</li>`).join("")}</ul>`,
    `<h2>6. Verantwoording en beperkingen</h2>`,
    p(`Deze bundel bevat het dossier zoals ${input.opstellerRol ?? "de aanvrager"} het op ${formatNlDatum(input.datumISO)} kon inzien.`),
    input.uitsluitingen.length ? `<p><strong>Niet opgenomen:</strong></p><ul>${input.uitsluitingen.map((u) => `<li>${htmlEsc(u)}</li>`).join("")}</ul>` : "",
    input.waarschuwingen.length ? `<p><strong>Aandachtspunten:</strong></p><ul>${input.waarschuwingen.map((w) => `<li>${htmlEsc(w)}</li>`).join("")}</ul>` : "",
    p(input.hashketenOpmerking),
  ].join("\n");

  return `<!DOCTYPE html>
<html lang="nl"><head><meta charset="utf-8"><title>Leeswijzer — ${htmlEsc(fk.procescode)}</title>
<style>
  body { font-family: -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1a1a; max-width: 46rem; margin: 2rem auto; padding: 0 1rem; line-height: 1.5; }
  h1 { color: #1F3A5F; font-size: 1.5rem; margin-bottom: .1rem; }
  h2 { color: #1F3A5F; font-size: 1.1rem; margin-top: 1.6rem; }
  .sub { color: #555; }
  .status { background: #F4F6F9; border: 1px solid #C8CCD8; border-radius: 6px; padding: .7rem .9rem; margin: 1rem 0; font-size: .95rem; }
</style></head><body>
<h1>LEESWIJZER BIJ HET AUDITDOSSIER</h1>
<div class="sub">${htmlEsc(fk.procedureTitel)} · ${htmlEsc(fk.procescode)} · versie ${htmlEsc(fk.versie)} · ${formatNlDatum(input.datumISO)}</div>
<div class="status">${htmlEsc(statuskaderTekst(input))}</div>
${secties}
</body></html>`;
}
