// ============================================================================
//  Assistent L1 — de URL-ingang (P1a C4, besluit 0201).
// ----------------------------------------------------------------------------
//  `?doc=`, `?agendapunt=`, `?proces=`, `?risicomatrix=1` en `?intent=`
//  (+ `?herkomst=`) zetten de context waarin de assistent opent. Dat gebeurde op
//  VIER plaatsen in `AssistentClient.tsx`, elk met een eigen
//  `new URLSearchParams(window.location.search)`, een eigen query en een eigen
//  try/catch. Hier is het één ingang.
//
//  BEWUST GESPLITST IN PARSE EN RESOLVE:
//    - `leesAssistentContextUitUrl` is PUUR — hij leest de querystring en zegt
//      welke ingang bedoeld is. Daarmee is de precedentie, de slugvalidatie en
//      het negeren van onzin testbaar zonder database én zonder browser.
//    - `resolveerAssistentContext` doet de RLS-reads en levert de context.
//
//  Waarom dat onderscheid ertoe doet: de URL-afhandeling draait client-side, dus
//  een HTTP-rooktest komt er niet langs. Zonder deze splitsing is de enige
//  verificatie "iemand klikt een deeplink aan". Dat is precies hoe de fout kon
//  ontstaan die deze module vergezelt: bij het verhuizen van de gesprekslaag
//  hernoemde een zoek-en-vervang de closure-variabele `herkomst` óók binnen de
//  stringliteral `params.get("herkomst")`. Geen test zag dat, want geen enkele
//  knop in het portaal zet die parameter (zie het ingangenregister). De pure
//  parse hieronder maakt dat wél zichtbaar.
//
//  GEEN PRECEDENTIE — dat was een fout in de eerste versie hiervan, gevonden bij
//  de code-review. Het origineel had DRIE ONAFHANKELIJKE try-blokken die
//  allemaal draaiden: `?doc=X&agendapunt=A` zette eerst de documentscope en
//  overschreef die daarna met de stukken van het agendapunt, plus de framing.
//  Een `else if`-keten koos er één en draaide de uitkomst zelfs om. Onbereikbaar
//  via de UI (elke knop zet één parameter), maar wel een gedragswijziging in een
//  refactor die neutraliteit belooft — en de test legde de afwijking vast alsof
//  het het oude gedrag was.
//
//  Daarom levert de parse een LIJST in bronvolgorde (doc, agendapunt,
//  proces|risicomatrix) en worden de patches in die volgorde samengevoegd; een
//  latere ingang overschrijft een eerdere, precies zoals de blokken deden.
//  `proces` en `risicomatrix` sluiten elkaar wél uit: die stonden in het
//  origineel in één blok als `if/else if`.
//
//  `intent`/`herkomst` staat los en náást de rest: de scope-takken zetten een
//  scope, en bij een actieve scope negeert de route de bron-intentie toch
//  (scopeActief ⇒ bronIntentResultaat = null).
//
//  De parse is puur; de resolver krijgt zijn databaseclient geïnjecteerd.
// ============================================================================

import type {
  AgendapuntContext,
  DocumentScope,
  ModuleScope,
} from "@/core/lib/assistent-types";
import type { Herkomst } from "@/core/lib/assistent-payload";

/** Welke deeplink-ingang de URL aanwijst (nog niet opgezocht in de database). */
export type AssistentUrlIngang =
  | { soort: "document"; documentId: string }
  | { soort: "agendapunt"; agendapuntId: string }
  | { soort: "proces"; procedureId: string }
  | { soort: "risicomatrix" };

export interface AssistentUrlVerzoek {
  /**
   * De scope-ingangen in bronvolgorde. Meerdere tegelijk is mogelijk — het
   * origineel liet de blokken allemaal draaien. Leeg als de URL er geen aanwijst.
   */
  ingangen: AssistentUrlIngang[];
  /** De bevestigde bron-intentie uit `?intent=` (+ `?herkomst=`), of null. */
  herkomst: Herkomst | null;
}

/**
 * Welke contextvelden deze ingang ZET. Bewust een patch en geen volledige
 * context: elke tak zette in het origineel alleen zijn eigen velden. `?doc=`
 * laat een agendapunt-framing die uit een hersteld gesprek komt dus staan.
 * Zou dit een volledige context zijn, dan wist de ene ingang stilzwijgend wat
 * de andere had gezet — een gedragswijziging die niemand zou opmerken.
 *
 * Een ontbrekende sleutel betekent "niet aanraken"; `null` betekent "wissen".
 */
export interface AssistentContextPatch {
  documentScope?: DocumentScope | null;
  agendapuntContext?: AgendapuntContext | null;
  moduleScope?: ModuleScope | null;
  risicoLijst?: { id: string; titel: string }[];
}

/** Het resultaat van het opzoeken. */
export interface AssistentUrlContext {
  patch: AssistentContextPatch;
  /**
   * Moet er een schoon gesprek worden gestart? Alleen bij een gevónden
   * scope-ingang: anders zou de scope over een lopend gesprek heen vallen.
   * Een `?intent=` alléén start géén nieuw gesprek — die zet enkel de intentie.
   */
  startSchoonGesprek: boolean;
}

/**
 * De slug uit `?herkomst=` landt in het auditspoor (`bron_intent_herkomst`) én
 * als label in de UI. Daarom een sobere vorm en nooit vrije tekst uit de URL.
 */
const HERKOMST_SLUG = /^[a-z0-9-]{1,40}$/;

/**
 * Leest de querystring. PUUR: geen `window`, geen database — geef de zoekstring
 * mee (`window.location.search` aan de aanroepzijde).
 */
export function leesAssistentContextUitUrl(zoekstring: string): AssistentUrlVerzoek {
  const params = new URLSearchParams(zoekstring);

  const doc = params.get("doc");
  const agendapunt = params.get("agendapunt");
  const proces = params.get("proces");
  const risicomatrix = params.get("risicomatrix");

  const ingangen: AssistentUrlIngang[] = [];
  if (doc) ingangen.push({ soort: "document", documentId: doc });
  if (agendapunt) ingangen.push({ soort: "agendapunt", agendapuntId: agendapunt });
  // Deze twee stonden in het origineel in één blok als if/else if.
  if (proces) ingangen.push({ soort: "proces", procedureId: proces });
  else if (risicomatrix) ingangen.push({ soort: "risicomatrix" });

  // De parameter is een GEBRUIKERSACTIE (er is in die module op een knop
  // geklikt), geen heuristiek — daarom mag hij het vertrouwen op "zeker" zetten.
  const intent = params.get("intent");
  const herkomst: Herkomst | null =
    intent === "fonds" || intent === "algemeen"
      ? {
          intent,
          module: (() => {
            const ruw = (params.get("herkomst") || "").slice(0, 40);
            return HERKOMST_SLUG.test(ruw) ? ruw : "portaal";
          })(),
        }
      : null;

  return { ingangen, herkomst };
}

/**
 * De omgekeerde weg: van ingangen naar de deeplink. (T1, besluit 0204.)
 *
 * De module-ingangen openen het paneel zónder navigatie, maar ze blijven een
 * `<a href>` — zodat ze klikbaar blijven binnen een uitgeschakelde fieldset
 * (de leesmodus van `StapPaneel`), zodat midden-klik en bookmarken blijven
 * werken, en zodat er een echte val-terug is als het paneel er niet is.
 *
 * Die href hoort hier thuis en niet bij de knoppen: parser en bouwer moeten
 * dezelfde parameternamen kennen. Staan ze uit elkaar, dan is een deeplink die
 * niemand meer aanroept precies het soort dode pad dat dit ticket opruimt.
 */
export function bouwAssistentDeeplink(ingangen: AssistentUrlIngang[]): string {
  const params = new URLSearchParams();
  for (const ingang of ingangen) {
    if (ingang.soort === "document") params.set("doc", ingang.documentId);
    else if (ingang.soort === "agendapunt") params.set("agendapunt", ingang.agendapuntId);
    else if (ingang.soort === "proces") params.set("proces", ingang.procedureId);
    else params.set("risicomatrix", "1");
  }
  const query = params.toString();
  return query ? `/ai?${query}` : "/ai";
}

/**
 * De MINIMALE vorm van de databaseclient die deze resolver gebruikt — bewust
 * een eigen structureel type en niet de supabase-client zelf. Zo is de resolver
 * te testen met een klein stubje, en is aan de signatuur af te lezen dat hij
 * alleen leest (select/eq/order) en nooit schrijft.
 */
interface Zoekbouwer extends PromiseLike<{ data: unknown }> {
  eq(kolom: string, waarde: unknown): Zoekbouwer;
  order(kolom: string, opties: { ascending: boolean }): Zoekbouwer;
  maybeSingle(): PromiseLike<{ data: unknown }>;
}

export interface ContextLezer {
  from(tabel: string): { select(kolommen: string): Zoekbouwer };
}

/** Niets gevonden: raak geen enkel veld aan en start geen nieuw gesprek. */
const LEEG: AssistentUrlContext = { patch: {}, startSchoonGesprek: false };

/**
 * Zoekt de ingang op onder RLS en levert de context.
 *
 * Faalt veilig: elke tak vangt zijn eigen fout af en levert dan de lege context,
 * precies zoals de vier losse try/catch-blokken deden. Een kapotte deeplink mag
 * de assistent nooit onbruikbaar maken.
 */
export async function resolveerAssistentContext(
  lezer: ContextLezer,
  ingangen: AssistentUrlIngang[]
): Promise<AssistentUrlContext> {
  const samen: AssistentUrlContext = { patch: {}, startSchoonGesprek: false };
  for (const ingang of ingangen) {
    const uit = await resolveerEen(lezer, ingang);
    // Een latere ingang overschrijft een eerdere, zoals de losse blokken deden.
    samen.patch = { ...samen.patch, ...uit.patch };
    samen.startSchoonGesprek = samen.startSchoonGesprek || uit.startSchoonGesprek;
  }
  return samen;
}

async function resolveerEen(
  lezer: ContextLezer,
  ingang: AssistentUrlIngang
): Promise<AssistentUrlContext> {
  try {
    if (ingang.soort === "document") {
      const { data } = await lezer
        .from("documenten")
        .select("id, titel, actief")
        .eq("id", ingang.documentId)
        .maybeSingle();
      const d = data as { id?: string; titel?: string; actief?: boolean } | null;
      // `actief !== false` en niet `=== true`: een oude rij zonder de kolom telt
      // als actief. Overgenomen uit het origineel.
      if (!d?.id || d.actief === false) return LEEG;
      return {
        patch: {
          documentScope: {
            document_ids: [d.id],
            titels: [d.titel || "dit document"],
          },
        },
        startSchoonGesprek: true,
      };
    }

    if (ingang.soort === "agendapunt") {
      const { data } = await lezer
        .from("agendapunten")
        .select("id, titel")
        .eq("id", ingang.agendapuntId)
        .maybeSingle();
      const ap = data as { id?: string; titel?: string } | null;
      if (!ap?.id) return LEEG;
      const { data: stukkenRuw } = await lezer
        .from("documenten")
        .select("id, titel")
        .eq("agendapunt_id", ap.id)
        .eq("actief", true);
      const geldig = Array.isArray(stukkenRuw)
        ? (stukkenRuw as { id?: unknown; titel?: unknown }[]).filter(
            (s): s is { id: string; titel: string } => typeof s?.id === "string"
          )
        : [];
      return {
        patch: {
          agendapuntContext: { id: ap.id, titel: ap.titel || "dit agendapunt" },
          // De toelichting zelf wordt server-side per beurt opgehaald; de
          // client-titel wordt niet vertrouwd voor de promptinhoud (ADR 0028).
          documentScope:
            geldig.length > 0
              ? {
                  document_ids: geldig.map((s) => s.id),
                  titels: geldig.map((s) => s.titel || "stuk"),
                }
              : null,
        },
        startSchoonGesprek: true,
      };
    }

    if (ingang.soort === "proces") {
      const { data } = await lezer
        .from("procedures")
        .select("id, titel")
        .eq("id", ingang.procedureId)
        .maybeSingle();
      const p = data as { id?: string; titel?: string } | null;
      if (!p?.id) return LEEG;
      return {
        patch: {
          // Alleen de sleutel + een label voor de chip; de server resolveert de
          // inhoud onder RLS en vertrouwt de client-titel niet (besluit 0151).
          moduleScope: {
            soort: "proces",
            procedure_id: p.id,
            label: p.titel || "dit proces",
          },
        },
        startSchoonGesprek: true,
      };
    }

    // risicomatrix — de enige risico-ingang; `risico` ontstaat pas door in de
    // chat in te zoomen met een verdiep-chip.
    //
    // De risicolijst heeft een EIGEN try. In het origineel stonden de scope en
    // het schone gesprek vóór de risicos-query, dus wierp die, dan bleef de
    // module-scope staan en zag de bestuurder nog steeds de juiste chip — alleen
    // de verdiep-chips ontbraken. Alles in één try zou van een deelfout een
    // volledige stille mislukking maken.
    let risicoLijst: { id: string; titel: string }[] = [];
    try {
      const { data: risicosRuw } = await lezer
        .from("risicos")
        .select("id, titel")
        .eq("status", "actief")
        .order("niveau", { ascending: false });
      risicoLijst = Array.isArray(risicosRuw)
        ? (risicosRuw as { id?: unknown; titel?: unknown }[])
            .filter((r): r is { id: string; titel: string } => typeof r?.id === "string")
            .map((r) => ({ id: r.id, titel: r.titel || "risico" }))
        : [];
    } catch (e) {
      console.error("Risicolijst voor de verdiep-chips ophalen mislukt:", e);
    }
    return {
      patch: {
        moduleScope: { soort: "risicomatrix", label: "de risicomatrix" },
        risicoLijst,
      },
      startSchoonGesprek: true,
    };
  } catch (e) {
    console.error("Context uit de URL zetten mislukt:", e);
    return LEEG;
  }
}
