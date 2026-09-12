// #368 — enige ingang voor overige, niet-citeerbare modelcontext.
// Deze laag leest geen provider en bevat geen vrije callback: de route levert een
// reeds onder RLS opgebouwd blok plus SERVER-context. Daarmee kan clientscope
// nooit als contractscope fungeren en wordt het werkelijke promptblok begrensd.
import type { RetrievalContext } from "./contract";
import type { ModelcontextAudit, ModelcontextBlok } from "./evidence-contract";
import { neutraliseerBrontekst } from "../bron-afbakening";
import { bevatPersoonsgegevens } from "../pii-gate";

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
];

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
  const limiet = Math.max(0, Math.floor(opdracht.maxGerenderdeTekens));
  const neutraal = neutraliseerModelcontextTekst(opdracht.tekst);
  const afgekapt = neutraal.tekst.length > limiet;
  const tekst = afgekapt ? neutraal.tekst.slice(0, limiet) : neutraal.tekst;
  const piiAnalyse = bevatPersoonsgegevens(tekst);
  const pii = piiAnalyse.bevatPii
    ? (piiAnalyse.soorten.some((soort) => /bsn|medisch|gezondheid/i.test(soort)) ? "bijzonder" : "persoonsgebonden")
    : opdracht.pii;
  return {
    tekst,
    audit: {
      correlation_id: opdracht.context.correlationId,
      soort: opdracht.soort,
      pii,
      gerenderde_tekens: tekst.length,
      limiet,
      afgekapt,
      ...(neutraal.geneutraliseerd > 0 ? { geneutraliseerd: neutraal.geneutraliseerd } : {}),
      ...(piiAnalyse.soorten.length > 0 ? { pii_soorten: piiAnalyse.soorten } : {}),
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
  for (const blok of blokken) {
    if (!blok.tekst) continue;
    const scheiding = opgenomen.length === 0 ? 0 : 2;
    if (blok.audit.correlation_id !== context.correlationId || gebruikt + scheiding + blok.tekst.length > limiet) {
      afgekapt = true;
      continue;
    }
    opgenomen.push(blok.tekst);
    for (const soort of blok.audit.pii_soorten ?? []) piiSoorten.add(soort);
    gebruikt += scheiding + blok.tekst.length;
  }
  return {
    tekst: opgenomen.join("\n\n"),
    audit: {
      correlation_id: context.correlationId,
      soort: "samengestelde_modelcontext",
      pii: blokken.some((b) => b.audit.pii === "bijzonder")
        ? "bijzonder"
        : blokken.some((b) => b.audit.pii === "persoonsgebonden")
          ? "persoonsgebonden"
          : "geen",
      gerenderde_tekens: gebruikt,
      limiet,
      afgekapt,
      ...(piiSoorten.size > 0 ? { pii_soorten: [...piiSoorten] } : {}),
      ...(afgekapt ? { fout: "afgekapt" as const } : {}),
    },
  };
}
