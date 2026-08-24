// ============================================================================
//  Schema-enforce — pure bodyvalidatie + env-schakelaar voor de wrappers.
//  (W9, EPIC W, deploy 3 — het MECHANISME. Spiegelt core/lib/capability-enforce.ts.)
// ----------------------------------------------------------------------------
//  Beantwoordt één vraag, zonder I/O en zonder Next-runtime:
//
//      gegeven het schema dat een route DECLAREERT en de body die binnenkomt —
//      voldoet die body?
//
//  De wrappers (core/lib/route-wrapper.ts én platform/lib/machine-route-wrapper.ts)
//  gebruiken dat oordeel, afhankelijk van één env-vlag:
//
//    ENFORCE_SCHEMA uit  → valideren en LOGGEN (observe). Het request loopt
//                          ONGEWIJZIGD door; de handler leest zelf de body. Dit
//                          is de enige fase waarin een te STRENG schema betrapt
//                          wordt vóór een gebruiker het merkt.
//    ENFORCE_SCHEMA aan  → handhaven: een mismatch wordt 400.
//
//  ÉÉN MODULE, TWEE WRAPPERS. `platform/lib` importeert al uit `core/lib`
//  (ai-poort, app-fout, auditdossier-html, …); andersom nul. De richting
//  platform → core is gevestigd, dus deze controle bestaat één keer, hier, en
//  wordt aan de platformkant geïmporteerd. Geen duplicaat.
//
//  DE WRAPPER LEEST EEN `request.clone()`, NOOIT HET ORIGINEEL. Een request-body
//  is één keer leesbaar; de handler leest hem zelf. Door de kloon te lezen blijft
//  het origineel onaangeroerd en is vlag-uit gegarandeerd byte-identiek — de
//  handler ziet exact wat hij vandaag ziet. Zie route-wrapper.ts stap 3c.
//
//  DEFENSE-IN-DEPTH, GEEN VERVANGING. De route-eigen `typeof`-checks en de 232
//  handmatige 400's blijven ONVERKORT staan. Een schema kan RUIMER zijn dan de
//  inline controle; zolang beide draaien is dat onschadelijk. Zie TICKET-W9 §8.
// ============================================================================
import type { ZodType } from "zod";

/** Wat een route in zijn spec declareert: een zod-schema, of expliciet "geen-body".
 *  Verplicht en niet optioneel — een AFWEZIGE waarde is niet te onderscheiden van
 *  een VERGETEN waarde; dezelfde regel als bij `capability` en `hostGuard`. */
export type SchemaDeclaratie = ZodType | "geen-body";

/** Eén mismatch, in de vorm die de observe-log nodig heeft: route + handler komen
 *  van de wrapper; veld + verwachte vorm + gekregen vorm komen hiervandaan. */
export type SchemaFout = {
  veld: string;
  verwacht: string;
  gekregen: string;
  code: string;
};

export type SchemaOordeel =
  | { toegestaan: true; data: unknown }
  | { toegestaan: false; fouten: SchemaFout[] };

/**
 * Bepaalt of schema-afdwinging actief is voor deze deployment.
 *
 * BEWUST ANDERS DAN `tenantEnforceVoorOmgeving`, en identiek aan
 * `capabilityEnforceVoorOmgeving`: KALE opt-in, geen omgevings-default. Zou
 * preview/productie automatisch fail-closed staan, dan zou de eerste W9-deploy
 * geldig verkeer met 400's kunnen weigeren op paden die geen test raakt. De
 * default-flip naar fail-closed is een eigen `BESLUIT:` aan het EIND van deploy 3,
 * pas nadat de observe-fase de schema's heeft gevalideerd. Die flip hoort hier.
 */
export function schemaEnforceVoorOmgeving(args: {
  enforceSchema?: string | null;
}): boolean {
  return (args.enforceSchema?.trim().toLowerCase() ?? "") === "on";
}

/** Leest de env-vlag. Apart van de pure functie zodat die testbaar blijft. */
export function schemaEnforceAan(): boolean {
  return schemaEnforceVoorOmgeving({ enforceSchema: process.env.ENFORCE_SCHEMA });
}

/** Loopt een zod-pad af over de body om de FEITELIJK gekregen waarde te
 *  beschrijven — dat is informatiever voor de observe-log dan de generieke
 *  issue-tekst, en het lekt geen waarden (alleen het TYPE/de vorm). */
function beschrijfGekregen(body: unknown, pad: PropertyKey[]): string {
  let cur: unknown = body;
  for (const sleutel of pad) {
    if (cur !== null && typeof cur === "object" && sleutel in (cur as object)) {
      cur = (cur as Record<PropertyKey, unknown>)[sleutel];
    } else {
      cur = undefined;
      break;
    }
  }
  if (cur === null) return "null";
  if (Array.isArray(cur)) return "array";
  return typeof cur; // string | number | boolean | object | undefined | ...
}

/**
 * De beoordeling, puur.
 *
 * - `"geen-body"`  → altijd toegestaan; de route leest geen body.
 * - een zod-schema → `safeParse(body)`. Slaagt hij, dan `{toegestaan:true, data}`;
 *   faalt hij, dan een lijst mismatches met veld + verwachte + gekregen vorm.
 *
 * PUUR: geen vlag, geen I/O. De wrapper beslist op grond van `schemaEnforceAan()`
 * of een negatief oordeel een 400 wordt of alleen een logregel.
 */
export function beoordeelSchema(args: {
  schema: SchemaDeclaratie;
  body: unknown;
}): SchemaOordeel {
  if (args.schema === "geen-body") return { toegestaan: true, data: undefined };
  const res = args.schema.safeParse(args.body);
  if (res.success) return { toegestaan: true, data: res.data };
  const fouten: SchemaFout[] = res.error.issues.map((issue) => {
    const pad = issue.path;
    const verwacht =
      "expected" in issue && issue.expected != null
        ? String((issue as { expected: unknown }).expected)
        : issue.code;
    return {
      veld: pad.length ? pad.join(".") : "(root)",
      verwacht,
      gekregen: beschrijfGekregen(args.body, pad),
      code: issue.code,
    };
  });
  return { toegestaan: false, fouten };
}

/**
 * Leest de body van een request-KLOON (nooit het origineel; de handler leest dat
 * zelf). Onderscheidt drie gevallen, zodat de schema-poort een AFWEZIGE body niet
 * als fout behandelt — cruciaal om niet strenger te zijn dan de route:
 *
 *   - lege/afwezige body → `{}`. Veel routes lezen de body OPTIONEEL (een DELETE
 *     zonder body, een slikker met `.catch(() => ({}))`) en geven daar vandaag een
 *     2xx op. De losse schema's accepteren `{}`, dus de poort mag er niet op 400'en.
 *   - geldige JSON → het geparseerde object.
 *   - bytes aanwezig maar ONPARSEBAAR → `{ kapot: true }`. Dít is de gesanctioneerde
 *     slikker-wijziging: kapotte JSON wordt onder de vlag een 400. Een afwezige body
 *     valt hier NIET onder — die is geen kapotte JSON.
 */
export async function leesBodyVanKloon(
  request: { clone: () => { text: () => Promise<string> } }
): Promise<{ body: unknown; kapot: boolean }> {
  let rauw = "";
  try {
    rauw = await request.clone().text();
  } catch {
    return { body: {}, kapot: false };
  }
  if (rauw.trim() === "") return { body: {}, kapot: false };
  try {
    return { body: JSON.parse(rauw), kapot: false };
  } catch {
    return { body: undefined, kapot: true };
  }
}
