// #368 — enige ingang voor overige, niet-citeerbare modelcontext.
// Deze laag leest geen provider en bevat geen vrije callback: de route levert een
// reeds onder RLS opgebouwd blok plus SERVER-context. Daarmee kan clientscope
// nooit als contractscope fungeren en wordt het werkelijke promptblok begrensd.
import type { RetrievalContext } from "./contract";
import type { ModelcontextAudit, ModelcontextBlok } from "./evidence-contract";
import { neutraliseerBrontekst } from "../bron-afbakening";
import { bevatPersoonsgegevens } from "../pii-gate";
import { createHash } from "node:crypto";

export interface ModelcontextOpdracht {
  context: RetrievalContext;
  soort: string;
  tekst: string;
  maxGerenderdeTekens: number;
  pii: ModelcontextAudit["pii"];
}

const INSTRUCTIE_PATRONEN: RegExp[] = [
  /\b(?:ignore|disregard|forget)\s+(?:all\s+)?(?:previous|prior|above)\s+instructions?\b/gi,
  /\b(?:negeer|vergeet)\s+(?:alle\s+)?(?:vorige|eerdere|bovenstaande)\s+instructies?\b/gi,
  /\b(?:reveal|toon|openbaar)\s+(?:the\s+)?(?:secrets?|geheimen?)\b/gi,
  /\bvanaf\s+nu\s+(?:is\s+)?(?:uw|jouw|je)\s+taak\b[^\n]*/gi,
  /\b(?:systeemregels?|system\s+(?:rules?|instructions?))\s+(?:negeren|omzeilen|ignore|bypass)\b[^\n]*/gi,
  /\bbeantwoord\s+de\s+vraag\s+niet\b[^\n]*/gi,
  /\b(?:administrator|admin|system)\s*:\s*[^\n]*/gi,
  /^\s*(?:(?:voer|doe|volg|negeer|vergeet|antwoord|beantwoord|toon|onthul|geef|schrijf|zeg|stop|gebruik|reageer)\b|(?:you\s+must|you\s+should|always\b|never\b|do\s+not\b|don['’]t\b|ignore\b|disregard\b|forget\b|answer\b|respond\b|reveal\b|show\b|output\b|print\b|execute\b|follow\b)).*$/gim,
  /^\s*(?:vanaf\s+nu\s+(?:is\s+)?(?:uw|jouw|je)\s+taak\b|(?:systeemregels?|system\s+(?:rules?|instructions?))\s+(?:negeren|omzeilen|ignore|bypass)\b|(?:administrator|admin|system)\s*:\s*.*|(?:disclose|publish|leak|openbaar|onthul)\b.*\b(?:confidential|private|personal|vertrouwelijk|geheim|persoonsgegevens)\b|beantwoord\s+de\s+vraag\s+niet\b).*/gim,
  /<\/?\s*onbetrouwbare[_-]data\b[^>]*>/gi,
];

const AUDIT_SOORTEN = new Set<string>([
  "profielsturing", "organisatieprofiel", "regimekader", "agendapunt", "fondsmodules",
  "portaalstand", "module_scope", "module_scope_risico", "module_scope_risicomatrix",
  "module_scope_proces", "samengestelde_modelcontext",
]);
const PII_NIVEAUS = new Set<string>(["geen", "persoonsgebonden", "bijzonder"]);

/** Eén cryptografisch requestgebonden label voor alle onbetrouwbare
 * modelcontextblokken. Het soort hoort bewust niet in de afleiding: meerdere
 * blokken in één prompt moeten dezelfde systeemgedefinieerde grens dragen. */
export function maakModelcontextSentinel(context: RetrievalContext): string {
  return createHash("sha256")
    .update(`modelcontext-v1:${context.correlationId}`)
    .digest("hex")
    .slice(0, 24);
}

export function neutraliseerModelcontextTekst(tekst: string): {
  tekst: string;
  geneutraliseerd: number;
} {
  const bron = neutraliseerBrontekst(tekst);
  let uit = bron.tekst;
  let geneutraliseerd = bron.geneutraliseerd;
  for (const patroon of INSTRUCTIE_PATRONEN) {
    uit = uit.replace(patroon, () => {
      geneutraliseerd++;
      return "[geneutraliseerde instructiepoging]";
    });
  }
  return { tekst: uit, geneutraliseerd };
}

export function bouwModelcontextBlok(opdracht: ModelcontextOpdracht): ModelcontextBlok {
  if (!AUDIT_SOORTEN.has(opdracht.soort) || !PII_NIVEAUS.has(opdracht.pii)) {
    throw new Error("ongeldige_modelcontext_classificatie");
  }
  const limiet = Math.max(0, Math.floor(opdracht.maxGerenderdeTekens));
  const neutraal = neutraliseerModelcontextTekst(opdracht.tekst);
  const sentinel = maakModelcontextSentinel(opdracht.context);
  const begin = `<onbetrouwbare_data sentinel="${sentinel}">\n`;
  const einde = `\n</onbetrouwbare_data sentinel="${sentinel}">`;
  const ruimte = Math.max(0, limiet - begin.length - einde.length);
  const afgekapt = neutraal.tekst.length > ruimte;
  const inhoud = neutraal.tekst.slice(0, ruimte);
  const tekst = inhoud.length > 0 && limiet >= begin.length + einde.length
    ? `${begin}${inhoud}${einde}`
    : "";
  const piiAnalyse = bevatPersoonsgegevens(tekst);
  const gedetecteerdPii = piiAnalyse.bevatPii
    ? (piiAnalyse.soorten.some((soort) => /bsn|medisch|gezondheid/i.test(soort)) ? "bijzonder" : "persoonsgebonden")
    : "geen";
  // Alleen werkelijk gerenderde data mag auditclassificatie bijdragen. Een
  // lege waarde of nulcap persisteert dus ook geen caller-declaratie of
  // neutralisatietelling van tekst die de prompt nooit heeft bereikt.
  const pii = tekst.length === 0
    ? "geen"
    : opdracht.pii === "bijzonder" || gedetecteerdPii === "bijzonder"
      ? "bijzonder"
      : opdracht.pii === "persoonsgebonden" || gedetecteerdPii === "persoonsgebonden"
        ? "persoonsgebonden"
        : "geen";
  return {
    tekst,
    audit: {
      correlation_id: opdracht.context.correlationId,
      soort: opdracht.soort,
      pii,
      gerenderde_tekens: tekst.length,
      limiet,
      afgekapt,
      ...(tekst.length === 0
        ? { geneutraliseerd: 0, pii_soorten: [] }
        : neutraal.geneutraliseerd > 0
          ? { geneutraliseerd: neutraal.geneutraliseerd }
          : {}),
      ...(tekst.length > 0 && piiAnalyse.soorten.length > 0 ? { pii_soorten: piiAnalyse.soorten } : {}),
      ...(afgekapt ? { fout: "afgekapt" as const } : {}),
    },
  };
}

/** Combineert blokken met één eindgrens; gedeeltelijke blokken gaan niet mee. */
export function combineerModelcontext(
  context: RetrievalContext,
  blokken: readonly ModelcontextBlok[],
  maxGerenderdeTekens: number
): ModelcontextBlok {
  const limiet = Math.max(0, Math.floor(maxGerenderdeTekens));
  const opgenomen: string[] = [];
  let gebruikt = 0;
  let afgekapt = false;
  const piiSoorten = new Set<NonNullable<ModelcontextAudit["pii_soorten"]>[number]>();
  let pii: ModelcontextAudit["pii"] = "geen";
  const sentinel = maakModelcontextSentinel(context);
  const begin = `<onbetrouwbare_data sentinel="${sentinel}">\n`;
  const einde = `\n</onbetrouwbare_data sentinel="${sentinel}">`;
  for (const blok of blokken) {
    if (!blok.tekst) continue;
    if (!blok.tekst.startsWith(begin) || !blok.tekst.endsWith(einde)) {
      throw new Error("ongeldige_modelcontext_afbakening");
    }
    const scheiding = opgenomen.length === 0 ? 0 : 2;
    if (blok.audit.correlation_id !== context.correlationId || gebruikt + scheiding + blok.tekst.length > limiet) {
      afgekapt = true;
      continue;
    }
    opgenomen.push(blok.tekst);
    for (const soort of blok.audit.pii_soorten ?? []) piiSoorten.add(soort);
    if (blok.audit.pii === "bijzonder") pii = "bijzonder";
    else if (blok.audit.pii === "persoonsgebonden" && pii === "geen") pii = "persoonsgebonden";
    gebruikt += scheiding + blok.tekst.length;
  }
  return {
    tekst: opgenomen.join("\n\n"),
    audit: {
      correlation_id: context.correlationId,
      soort: "samengestelde_modelcontext",
      pii,
      gerenderde_tekens: gebruikt,
      limiet,
      afgekapt,
      ...(gebruikt === 0 ? { geneutraliseerd: 0, pii_soorten: [] } : {}),
      ...(piiSoorten.size > 0 ? { pii_soorten: [...piiSoorten] } : {}),
      ...(afgekapt ? { fout: "afgekapt" as const } : {}),
    },
  };
}
