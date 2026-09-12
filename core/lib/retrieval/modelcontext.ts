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

export function bouwModelcontextBlok(opdracht: ModelcontextOpdracht): ModelcontextBlok {
  const limiet = Math.max(0, Math.floor(opdracht.maxGerenderdeTekens));
  const neutraal = neutraliseerBrontekst(opdracht.tekst);
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
  for (const blok of blokken) {
    if (!blok.tekst) continue;
    const scheiding = opgenomen.length === 0 ? 0 : 2;
    if (blok.audit.correlation_id !== context.correlationId || gebruikt + scheiding + blok.tekst.length > limiet) {
      afgekapt = true;
      continue;
    }
    opgenomen.push(blok.tekst);
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
      ...(afgekapt ? { fout: "afgekapt" as const } : {}),
    },
  };
}
