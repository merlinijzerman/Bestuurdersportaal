// ============================================================
//  antwoord-klembord — kopiëren van AI-antwoorden naar het klembord
// ============================================================
// Bestuurders kopiëren vandaag met de muis. Daarbij sneuvelen precies de twee
// dingen die het antwoord verifieerbaar maken: de [Bron N]-verwijzingen en de
// tabelstructuur. Deze module bouwt uit dezelfde AST als de weergave
// (core/lib/antwoord-parser) twee klembordformaten:
//
//   text/html   — met een echte <table> en inline opmaak; plakt in Word als tabel
//   text/plain  — met TABS tussen de cellen; Excel leest dat als kolommen
//
// ── Waarom bronnenlijst en herkomstregel VERPLICHT zijn ─────────────────────
// Een kopieeractie wordt bewust NIET gelogd (besluit 0098): het is geen besluit
// en geen export naar het dossier. Gevolg, aanvaard: dit is het enige uitgaande
// pad zonder registratie. Daarmee is de herkomstregel ín de gekopieerde tekst
// het ENIGE dat later nog vertelt waar een passage vandaan komt. Er is dus geen
// schakelaar, instelling of parameter om ze weg te laten: bouwKopie() stelt ze
// zelf samen en is het enige pad naar het klembord. Wie hier een optie aan
// toevoegt, haalt de laatste herleidbaarheid weg.
//
// Deze module logt niets, doet geen enkele netwerkaanroep en raakt geen enkele
// auditstructuur aan. Dat is de bedoeling; houd het zo.

import { DOCUMENT_STATUS_LABEL } from "./document-status-transities";
import {
  celTekst,
  numeriekeKolommen,
  parseerBlokken,
  type Blok,
  type InlineDeel,
} from "./antwoord-parser";

/** De bronvelden die onder een kopie worden meegeschreven. */
export interface KopieBron {
  /** Het nummer zoals het in de tekst staat: [Bron 3] → 3. */
  nummer: number;
  titel: string;
  /** Herkomst/organisatie, bijv. "Intern", "DNB". */
  bron: string;
  /** Vindplaats: paragraaf en/of pagina. */
  paragraaf?: string | null;
  pagina?: number | null;
  documentdatum?: string | null;
  documentstatus?: string | null;
}

export interface KopieContext {
  /** Fondsnaam voor de herkomstregel; null laat de vermelding weg. */
  fondsnaam?: string | null;
  /** Datum van kopiëren, al geformatteerd (bijv. "31-07-2026"). */
  datum: string;
  /** Waar de kopie vandaan komt — bepaalt de formulering van de herkomstregel. */
  surface: "assistent" | "agendapunt";
}

// Merkteken zodat een KopiePayload alleen door bouwKopie() gemaakt kan worden.
// Zonder dit is `schrijfNaarKlembord({html, tekst})` met een zelfgebouwd object
// gewoon toegestaan en is de garantie uit besluit 0098 conventie in plaats van
// constructie. Het merk bestaat alleen tijdens het typechecken; de runtime-kant
// wordt bewaakt door heeftVerplichteHerkomst().
declare const kopieMerk: unique symbol;

export interface KopiePayload {
  html: string;
  tekst: string;
  readonly [kopieMerk]: true;
}

// ── Tekstopbouw ──────────────────────────────────────────────────────────────

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Inline-AST naar HTML. De citatiemarkers worden als LETTERLIJKE TEKST
 * meegeschreven ("[Bron 3]"), niet als pill: in Word moet zichtbaar blijven
 * waar een bewering vandaan komt.
 */
function inlineNaarHtml(delen: InlineDeel[]): string {
  return delen
    .map((d) => {
      switch (d.soort) {
        case "tekst":
          return d.stukken
            .map((s) => {
              const t = escapeHtml(s.tekst);
              if (s.soort === "vet") return `<strong>${t}</strong>`;
              if (s.soort === "cursief") return `<em>${t}</em>`;
              if (s.soort === "code") return `<code>${t}</code>`;
              return t;
            })
            .join("");
        case "bron":
          return escapeHtml(`[Bron ${d.nummer}]`);
        case "kennis":
          return escapeHtml(`[${d.label}]`);
        case "toelichting":
          return escapeHtml("[Toelichting agendapunt]");
        case "organisatieprofiel":
          return escapeHtml("[Organisatieprofiel]");
      }
    })
    .join("");
}

// Losse hex is hier bewust literal: dit is geëxporteerde opmaak voor een extern
// programma (Word/Excel), niet de tokenlaag van de applicatie. Zelfde lijn als
// de print-CSS in core/lib/*-html.ts.
const TH_STIJL = "border:1px solid #c8ccd8;background:#f2f4f9;padding:6px 9px;font-weight:700;";
const TD_STIJL = "border:1px solid #c8ccd8;padding:6px 9px;vertical-align:top;";

function blokNaarHtml(blok: Blok): string {
  switch (blok.soort) {
    case "alinea":
      return `<p>${inlineNaarHtml(blok.inline)}</p>`;
    case "kop":
      return `<p><strong>${inlineNaarHtml(blok.inline)}</strong></p>`;
    case "lijst": {
      const items = blok.items.map((it) => `<li>${inlineNaarHtml(it)}</li>`).join("");
      return blok.geordend ? `<ol>${items}</ol>` : `<ul>${items}</ul>`;
    }
    case "tabel": {
      const numeriek = numeriekeKolommen(blok);
      // Precies één text-align per cel: Word verwerkt een dubbele declaratie
      // niet altijd zoals de CSS-cascade voorschrijft.
      const uitlijning = (ci: number) =>
        numeriek[ci] ? "text-align:right;" : "text-align:left;";
      const kop = blok.kop
        .map((c, ci) => `<th style="${TH_STIJL}${uitlijning(ci)}">${inlineNaarHtml(c)}</th>`)
        .join("");
      const rijen = blok.rijen
        .map(
          (rij) =>
            `<tr>${rij
              .map((c, ci) => `<td style="${TD_STIJL}${uitlijning(ci)}">${inlineNaarHtml(c)}</td>`)
              .join("")}</tr>`,
        )
        .join("");
      return `<table style="border-collapse:collapse;"><thead><tr>${kop}</tr></thead><tbody>${rijen}</tbody></table>`;
    }
  }
}

function blokNaarTekst(blok: Blok): string {
  switch (blok.soort) {
    case "alinea":
      return celTekst(blok.inline);
    case "kop":
      return celTekst(blok.inline);
    case "lijst":
      return blok.items
        .map((it, i) => (blok.geordend ? `${i + 1}. ${celTekst(it)}` : `- ${celTekst(it)}`))
        .join("\n");
    case "tabel": {
      // TABS tussen de cellen — Excel leest dat als kolommen.
      const regels = [blok.kop.map(celTekst).join("\t")];
      for (const rij of blok.rijen) regels.push(rij.map(celTekst).join("\t"));
      return regels.join("\n");
    }
  }
}

// ── Bronnenlijst en herkomstregel (niet uitschakelbaar) ─────────────────────

/** Welke [Bron N] komen in deze blokken voor? Volgorde van eerste voorkomen. */
export function geciteerdeBronnen(blokken: Blok[]): number[] {
  const gezien: number[] = [];
  const uitInline = (delen: InlineDeel[]) => {
    for (const d of delen) {
      if (d.soort === "bron" && !gezien.includes(d.nummer)) gezien.push(d.nummer);
    }
  };
  for (const b of blokken) {
    if (b.soort === "alinea" || b.soort === "kop") uitInline(b.inline);
    if (b.soort === "lijst") b.items.forEach(uitInline);
    if (b.soort === "tabel") {
      b.kop.forEach(uitInline);
      b.rijen.forEach((r) => r.forEach(uitInline));
    }
  }
  return gezien;
}

/** Eén regel per bron: titel — vindplaats — datum — documentstatus. */
export function bronRegel(b: KopieBron): string {
  const vindplaats = [b.paragraaf, b.pagina ? `pag. ${b.pagina}` : null]
    .filter(Boolean)
    .join(", ");
  const status = b.documentstatus
    ? ((DOCUMENT_STATUS_LABEL as Record<string, string>)[b.documentstatus] ?? b.documentstatus)
    : null;
  const delen = [
    `[Bron ${b.nummer}]`,
    [b.bron, b.titel].filter(Boolean).join(" — "),
    vindplaats || null,
    b.documentdatum || null,
    status,
  ].filter(Boolean);
  return delen.join(" · ");
}

/** Welke NIET-genummerde herkomstmarkers komen in deze blokken voor? */
export function geciteerdeMarkers(blokken: Blok[]): string[] {
  const gezien = new Set<string>();
  const uitInline = (delen: InlineDeel[]) => {
    for (const d of delen) {
      if (d.soort === "kennis") gezien.add(d.label);
      if (d.soort === "toelichting") gezien.add("Toelichting agendapunt");
      if (d.soort === "organisatieprofiel") gezien.add("Organisatieprofiel");
    }
  };
  for (const b of blokken) {
    if (b.soort === "alinea" || b.soort === "kop") uitInline(b.inline);
    if (b.soort === "lijst") b.items.forEach(uitInline);
    if (b.soort === "tabel") {
      b.kop.forEach(uitInline);
      b.rijen.forEach((r) => r.forEach(uitInline));
    }
  }
  return [...gezien];
}

// Wat elke niet-genummerde marker betekent. Zonder legenda worden vier
// herkomstsoorten die in de weergave een eigen kleur én waarschuwing dragen in
// de kopie tot dezelfde vlakke bracket-tekst platgeslagen — en juist bij
// [Toelichting agendapunt] is het verschil met een vastgestelde bron
// bestuurlijk relevant (ADR 0028).
const MARKER_UITLEG: Record<string, string> = {
  "Algemene kennis": "niet uit een fondsdocument — algemene kennis van het model",
  "Volgens wetgeving": "wet- of regelgeving, niet uit een fondsdocument",
  "Toelichting agendapunt":
    "uit de toelichting bij het agendapunt — door het bestuur opgestelde vrije tekst, geen vastgestelde fondsbron",
  Organisatieprofiel:
    "uit het organisatieprofiel — organisatiecontext, geen vastgestelde fondsbron",
};

/**
 * Het bronnenblok onder een kopie. Drie gevallen, want de bronnenlijst mag NOOIT
 * iets ontkennen wat er wel is:
 *
 *  1. genummerde verwijzingen aanwezig → die bronnen;
 *  2. géén genummerde verwijzingen maar wél aangeleverde bronnen → alle bronnen,
 *     met de mededeling dat het antwoord geen genummerde verwijzingen bevat.
 *     Dit is het normale geval bij document-scope en "document doorgronden":
 *     de systeemprompt VERBIEDT daar de [Bron N]-notatie
 *     (`SP_DOCUMENT_SCOPE_BREED_REGELS` / `SP_DOCUMENT_SCOPE_ALG_REGELS`), dus
 *     een lijst die alleen op markers steunt zou daar altijd leeg zijn en het
 *     antwoord ten onrechte als bronloos presenteren;
 *  3. helemaal geen bronnen aangeleverd → dat zeggen, en niet meer dan dat.
 */
export function bouwBronnenBlok(
  blokken: Blok[],
  alleBronnen: KopieBron[],
): { kop: string | null; regels: string[]; mededeling: string | null; waarschuwing: string | null } {
  const nummers = geciteerdeBronnen(blokken);
  const gekoppeld = nummers
    .map((nr) => alleBronnen.find((b) => b.nummer === nr))
    .filter((b): b is KopieBron => Boolean(b));
  const ongekoppeld = nummers.filter((nr) => !alleBronnen.some((b) => b.nummer === nr));

  // Een [Bron N] die niet aan een aangeleverde bron te koppelen is, wordt in de
  // weergave zichtbaar gemarkeerd ("⚠ Bron N?"). Dat signaal mag in de kopie
  // niet verdwijnen: in Word is een gehallucineerde verwijzing anders niet van
  // een geldige te onderscheiden.
  const waarschuwing =
    ongekoppeld.length > 0
      ? `Let op: ${ongekoppeld
          .map((nr) => `[Bron ${nr}]`)
          .join(", ")} kon niet aan een aangeleverde bron worden gekoppeld. Controleer deze verwijzing${
          ongekoppeld.length > 1 ? "en" : ""
        } vóór gebruik.`
      : null;

  if (gekoppeld.length > 0) {
    return { kop: "Bronnen:", regels: gekoppeld.map(bronRegel), mededeling: null, waarschuwing };
  }
  if (alleBronnen.length > 0) {
    return {
      kop: "Gebruikte stukken bij dit antwoord (het antwoord bevat geen genummerde verwijzingen):",
      regels: alleBronnen.map(bronRegel),
      mededeling: null,
      waarschuwing,
    };
  }
  return {
    kop: null,
    regels: [],
    mededeling: "Bij dit antwoord zijn geen fondsdocumenten als bron aangeleverd.",
    waarschuwing,
  };
}

/** Vast beginstuk van de herkomstregel; dient als runtime-anker (zie onder). */
export const HERKOMST_ANKER = "Gekopieerd uit ";

/**
 * De herkomstregel. Geen instelling, geen per-fonds configuratie.
 * `heeftBronnen` stuurt alleen de FORMULERING: zonder bronnen mag er niet staan
 * dat het antwoord op "de hierboven vermelde bronnen" steunt, want daarboven
 * staat er dan geen.
 */
export function herkomstRegel(ctx: KopieContext, heeftBronnen: boolean): string {
  const waar =
    ctx.surface === "agendapunt"
      ? "de AI-assistent bij een agendapunt"
      : "de AI-assistent";
  const fonds = ctx.fondsnaam ? ` van ${ctx.fondsnaam}` : "";
  const basis = heeftBronnen
    ? "Door AI samengesteld op basis van de hierboven vermelde bronnen"
    : "Door AI samengesteld zonder fondsdocument als bron";
  return (
    `${HERKOMST_ANKER}${waar}${fonds} in het bestuurdersportaal op ${ctx.datum}. ` +
    `${basis}; niet inhoudelijk gecontroleerd en geen bestuurlijk besluit.`
  );
}

// ── De enige weg naar het klembord ──────────────────────────────────────────

/**
 * Bouwt beide klembordformaten voor een reeks blokken. De bronnenlijst en de
 * herkomstregel worden ALTIJD toegevoegd; er is bewust geen parameter om dat
 * te onderdrukken (besluit 0098).
 */
export function bouwKopie(
  blokken: Blok[],
  alleBronnen: KopieBron[],
  ctx: KopieContext,
): KopiePayload {
  const bron = bouwBronnenBlok(blokken, alleBronnen);
  const legenda = geciteerdeMarkers(blokken)
    .filter((m) => MARKER_UITLEG[m])
    .map((m) => `[${m}] = ${MARKER_UITLEG[m]}`);
  const herkomst = herkomstRegel(ctx, bron.regels.length > 0);

  // ── text/plain ──
  const tekstDelen = blokken.map(blokNaarTekst).filter((s) => s.length > 0);
  const tekstBronnen = bron.kop
    ? [bron.kop, ...bron.regels].join("\n")
    : (bron.mededeling ?? "");
  const tekst = [
    tekstDelen.join("\n\n"),
    tekstBronnen,
    bron.waarschuwing ?? "",
    legenda.join("\n"),
    herkomst,
  ]
    .filter((s) => s.length > 0)
    .join("\n\n");

  // ── text/html ──
  const htmlDelen = blokken.map(blokNaarHtml).join("");
  const htmlBronnen = bron.kop
    ? `<p><strong>${escapeHtml(bron.kop)}</strong></p><ol>${bron.regels
        .map((r) => `<li>${escapeHtml(r)}</li>`)
        .join("")}</ol>`
    : `<p>${escapeHtml(bron.mededeling ?? "")}</p>`;
  const htmlWaarschuwing = bron.waarschuwing
    ? `<p><strong>${escapeHtml(bron.waarschuwing)}</strong></p>`
    : "";
  const htmlLegenda =
    legenda.length > 0
      ? `<p>${legenda.map((r) => escapeHtml(r)).join("<br>")}</p>`
      : "";
  const html =
    `<div>${htmlDelen}${htmlBronnen}${htmlWaarschuwing}${htmlLegenda}` +
    `<p><em>${escapeHtml(herkomst)}</em></p></div>`;

  return { html, tekst } as KopiePayload;
}

/** Bouwt de kopie voor een volledig antwoord (parseert de tekst zelf). */
export function bouwKopieVanTekst(
  antwoord: string,
  alleBronnen: KopieBron[],
  ctx: KopieContext,
): KopiePayload {
  return bouwKopie(parseerBlokken(antwoord), alleBronnen, ctx);
}

/** Datum in de Nederlandse notatie die het portaal elders ook gebruikt. */
export function nlDatum(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `${p(d.getDate())}-${p(d.getMonth() + 1)}-${d.getFullYear()}`;
}

/**
 * Runtime-tegenhanger van het type-merk: draagt deze payload daadwerkelijk een
 * herkomstregel in BEIDE formaten? `schrijfNaarKlembord` weigert zonder. Zo is
 * de garantie uit besluit 0098 niet alleen een afspraak in het type maar ook
 * een controle op het moment van schrijven.
 */
export function heeftVerplichteHerkomst(payload: {
  html: string;
  tekst: string;
}): boolean {
  return (
    payload.tekst.includes(HERKOMST_ANKER) && payload.html.includes(HERKOMST_ANKER)
  );
}

export type KlembordResultaat = "opmaak" | "tekst" | "mislukt";

/**
 * Schrijft beide formaten naar het klembord, met twee terugvallen.
 *
 * De payload wordt SYNCHROON opgebouwd en direct weggeschreven: Safari verbreekt
 * de gebruikersgebaar-keten zodra er vóór de schrijfactie ge-await wordt, en
 * weigert de kopie dan. Firefox < 127 kent geen write() met text/html; die valt
 * terug op platte tekst — met tabs, dus Excel werkt daar wél, Word krijgt geen
 * tabelopmaak. Dat verschil wordt aan de gebruiker teruggekoppeld ("opmaak" vs
 * "tekst"), zodat niemand denkt dat er meer is gekopieerd dan er staat.
 */
export async function schrijfNaarKlembord(
  payload: KopiePayload,
): Promise<KlembordResultaat> {
  // Laatste sluis: een payload zonder herkomstregel gaat niet naar buiten.
  if (!heeftVerplichteHerkomst(payload)) return "mislukt";

  const klembord =
    typeof navigator !== "undefined" ? navigator.clipboard : undefined;

  if (klembord && typeof ClipboardItem !== "undefined" && klembord.write) {
    try {
      const item = new ClipboardItem({
        "text/html": new Blob([payload.html], { type: "text/html" }),
        "text/plain": new Blob([payload.tekst], { type: "text/plain" }),
      });
      await klembord.write([item]);
      return "opmaak";
    } catch {
      // door naar de terugval
    }
  }

  if (klembord?.writeText) {
    try {
      await klembord.writeText(payload.tekst);
      return "tekst";
    } catch {
      // door naar de terugval
    }
  }

  // Laatste terugval: een tijdelijk tekstveld buiten beeld.
  if (typeof document !== "undefined") {
    try {
      const veld = document.createElement("textarea");
      veld.value = payload.tekst;
      veld.setAttribute("readonly", "");
      veld.style.position = "fixed";
      veld.style.left = "-9999px";
      document.body.appendChild(veld);
      veld.select();
      const gelukt = document.execCommand("copy");
      document.body.removeChild(veld);
      if (gelukt) return "tekst";
    } catch {
      // door naar mislukt
    }
  }

  return "mislukt";
}
