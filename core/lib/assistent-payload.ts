// ============================================================================
//  Assistent — de payload naar /api/chat (P1a C2, besluit 0201).
// ----------------------------------------------------------------------------
//  Dit is de ENIGE plek waar het verzoek aan `/api/chat` wordt samengesteld.
//
//  WAAROM een eigen module. De agendapuntchat is ooit als kopie van een oudere
//  aanroep ontstaan en niet meegegroeid: zij stuurt 9 van de 24 velden. Dat is
//  geen bug in de zin van "het werkt niet" — het is een verschil dat niemand
//  bewust heeft ontworpen, en dat je aan de interface niet ziet (ontwerpdoc
//  "Eén generieke assistent" §2). Zolang elke surface zijn eigen object-literal
//  bouwt, ontstaat die divergentie opnieuw zodra iemand één veld toevoegt.
//  Eén bouwer + één contracttest (`assistent-payload.sanity.ts`) maakt dat
//  structureel onmogelijk: een nieuw veld komt hier binnen en geldt overal.
//
//  GEDRAGSNEUTRAAL. De inhoud hieronder is een letterlijke transcriptie van het
//  object-literal dat in `AssistentClient.tsx` stond. De contracttest bevat een
//  BEVROREN KOPIE van dat origineel en toetst gelijkheid, zodat een
//  transcriptiefout niet stilzwijgend in de golden fixtures kan belanden.
//
//  Geen React, geen IO: puur invoer → object.
// ============================================================================

import type { Antwoordmodus } from "@/core/lib/vraagtype";
import type {
  AgendapuntContext,
  DocumentScope,
  ModuleScope,
  StuurOpties,
} from "@/core/lib/assistent-types";

/** Eén beurt in de geschiedenis zoals /api/chat hem verwacht. */
export interface ChatBericht {
  role: "user" | "assistant";
  content: string;
}

/**
 * De module-ingang (`/ai?intent=fonds&herkomst=<module>`): een bevestigde
 * bron-intentie die voor het hele gesprek geldt.
 */
export interface Herkomst {
  intent: "fonds" | "algemeen";
  module: string;
}

/**
 * Alles wat de payload nodig heeft. Bewust EXPLICIET en niet "de hele hookstaat":
 * zo is aan de signatuur af te lezen wat er naar de server gaat, en dwingt de
 * typechecker een nieuwe aanroeper om elk veld te leveren in plaats van het stil
 * weg te laten — precies wat bij de agendapuntchat is misgegaan.
 */
export interface ChatPayloadInvoer {
  messages: ChatBericht[];
  fondsId: string;
  alleenFondsdocumenten: boolean;
  algemeenPerspectief: boolean;
  /** Werkstand "stukken in voorbereiding": geldt voor het hele gesprek. */
  voorbereidingsstand: boolean;
  herkomst: Herkomst | null;
  /** De EFFECTIEVE scope voor deze beurt (na een eventuele per-turn override). */
  documentScope: DocumentScope | null;
  /** De EFFECTIEVE antwoordmodus voor deze beurt; null = auto-detectie. */
  antwoordmodus: Antwoordmodus | null;
  agendapuntContext: AgendapuntContext | null;
  moduleScope: ModuleScope | null;
  /** Koppelt de auditregel van deze beurt aan dit gesprek (plateau A). */
  gesprekId: string;
  opties?: StuurOpties;
}

/**
 * Bouwt het verzoeklichaam voor `/api/chat`.
 *
 * De sleutelvolgorde en de `undefined`-waarden zijn bewust gelijk aan het
 * origineel: `JSON.stringify` laat `undefined` weg, dus "veld afwezig" en
 * "veld undefined" leveren dezelfde bytes — maar de contracttest vergelijkt de
 * OBJECTEN, en daar is het verschil wél zichtbaar. Zo vangt de test ook een
 * veld dat per ongeluk helemaal is weggelaten.
 */
export function bouwChatPayload(invoer: ChatPayloadInvoer): Record<string, unknown> {
  const {
    messages,
    fondsId,
    alleenFondsdocumenten,
    algemeenPerspectief,
    voorbereidingsstand,
    herkomst,
    documentScope: effScope,
    antwoordmodus: effAntwoordmodus,
    agendapuntContext,
    moduleScope,
    gesprekId,
    opties,
  } = invoer;

  return {
    messages,
    fonds_id: fondsId,
    // Increment I-2 (FO §11a) — geen zichtbare bron-modus meer; alleen de
    // expliciete restrictie + (na een chip) de bevestigde bron-intentie.
    alleen_fondsdocumenten: alleenFondsdocumenten,
    // Precedentie: een expliciete keuze in DEZE beurt (chip of startvraag)
    // gaat vóór de herkomst-ingang van het gesprek (ingreep 2).
    bron_intent_override: opties?.bronIntentOverride ?? herkomst?.intent,
    // Auditspoor (ingreep 1/2): van wie kwam de bevestigde intentie? Zonder
    // dit staat er alleen dát er een override was, niet wie hem zette.
    bron_intent_bron:
      opties?.bronIntentBron ?? (herkomst ? "herkomst" : undefined),
    bron_intent_herkomst: herkomst?.module,
    document_scope: effScope
      ? {
          document_ids: effScope.document_ids,
          algemene_kennis: effScope.algemene_kennis === true,
        }
      : undefined,
    // Increment G — vastgezette antwoordmodus (null = auto-detectie).
    actieve_antwoordmodus: effAntwoordmodus,
    // Increment F (FO §14) — "algemeen perspectief": profielsturing overslaan.
    algemeen_perspectief: algemeenPerspectief,
    // FO §13 — transformatie-vervolgactie (herschrijf-intent op vorige antwoord).
    transformatie: opties?.transformatie === true,
    // ADR 0028 — agendapunt-modus: alleen het id (+ titel voor de UI). De
    // route haalt de toelichting zelf op onder RLS; de client-titel wordt
    // niet vertrouwd voor de promptinhoud. Precedentie: stuurt een
    // vervolgactie tegelijk een per-turn scopeOverride mee, dan wint
    // agendapunt-modus server-side (route.ts) — die override-stukken worden
    // dan agendapunt-retrievalscope i.p.v. een strikte document-scope.
    agendapunt_context: agendapuntContext
      ? { id: agendapuntContext.id, titel: agendapuntContext.titel }
      : undefined,
    // Besluit 0151 — module-scope: alleen de sleutel; de route resolveert de
    // inhoud onder RLS en zet daarbij (net als document_scope) de intent-
    // heuristiek uit. De client-titel wordt niet vertrouwd voor de prompt.
    module_scope: moduleScope
      ? {
          soort: moduleScope.soort,
          ...(moduleScope.procedure_id
            ? { procedure_id: moduleScope.procedure_id }
            : {}),
          ...(moduleScope.risico_id ? { risico_id: moduleScope.risico_id } : {}),
        }
      : undefined,
    // P2 Deel B — de doorgrond-parameters; de route stelt hieruit de
    // instructie samen en logt ze in retrieval_meta (criterium 13).
    doorgrond: opties?.doorgrond
      ? {
          secties: opties.doorgrond.secties,
          vorige_document_id: opties.doorgrond.vorigeId ?? undefined,
        }
      : undefined,
    // T2 — bureau-stand "Een stuk voorbereiden". De route negeert dit veld
    // zonder de capability ai.stukvoorbereiding (server-side gate).
    stukvoorbereiding: opties?.stukvoorbereiding
      ? { stuksoort: opties.stukvoorbereiding.stuksoort }
      : undefined,
    // P2 Deel A — herkomst voorbeeldvraag, meegelogd (criterium 4).
    startvraag_bron: opties?.startvraagBron,
    // 30-07-2026 — expliciete verbreding na de melding "wel stukken, niet
    // vastgesteld". Alleen true als de gebruiker de chip aanklikte.
    // De chip (per beurt) OF de werkstand (heel het gesprek). Beide zetten
    // hetzelfde serverveld; de chip blijft werken zoals hij deed.
    neem_niet_vastgestelde_mee:
      opties?.neemNietVastgesteldeMee === true || voorbereidingsstand,
    // Besluit 0137 (antwoord-eerst) — koppelt de hergegenereerde beurt na een
    // bronkeuze-chipklik aan het eerste antwoord (auditspoor: bronkeuze_herzien).
    bronkeuze_vorige_log_id: opties?.bronkeuzeVorigeLogId,
    // Plateau A — koppelt de auditregel van deze beurt aan dit gesprek,
    // zodat de gebruiker hem later kan verwijderen. Het id wordt door de
    // aanroeper bepaald (zorgVoorGesprekId) en is straks hetzelfde id dat
    // `bewaarGesprek` als expliciete `id` bij de insert gebruikt. Zonder die
    // volgorde zou juist de eerste beurt van elk gesprek onkoppelbaar blijven.
    gesprek_id: gesprekId,
    // ── Plateau B — signalen over het gebruikte invoerkanaal ──────────
    // Dit zijn SIGNALEN, geen waarheden. De route vraagt op basis hiervan
    // een transitie aan bij reflectie_transitie(), die valideert tegen de
    // opnieuw uitgelezen serverstatus. Past de gevraagde overgang niet,
    // dan wordt deze beurt gewoon als normale chatbeurt afgehandeld —
    // een client kan zich dus geen reflectie toe-eigenen (FR-67).
    reflectie_antwoord: opties?.reflectieAntwoord === true,
    reflectie_herformuleren: opties?.reflectieHerformuleren === true,
    reflectie_verdiepen: opties?.reflectieVerdiepen === true,
    reflectie_tegenperspectief: opties?.reflectieTegenperspectief === true,
    reflectie_start: opties?.reflectieStart
      ? {
          ingang: opties.reflectieStart.ingang,
          bronset_log_id: opties.reflectieStart.bronsetLogId ?? undefined,
        }
      : undefined,
    volledige_analyse: opties?.volledigeAnalyse
      ? {
          origineel_log_id: opties.volledigeAnalyse.origineelLogId,
          document_id: opties.volledigeAnalyse.documentId,
        }
      : undefined,
  };
}

/**
 * Elke sleutel die het verzoeklichaam draagt. De contracttest gebruikt deze
 * lijst als volledigheidscheck: een bouwer die een veld laat vallen, valt op.
 * Bewust een aparte, met de hand bijgehouden lijst en geen `Object.keys` van
 * een voorbeeld — anders zou hij automatisch meebewegen met een fout.
 */
export const CHAT_PAYLOAD_VELDEN = [
  "messages",
  "fonds_id",
  "alleen_fondsdocumenten",
  "bron_intent_override",
  "bron_intent_bron",
  "bron_intent_herkomst",
  "document_scope",
  "actieve_antwoordmodus",
  "algemeen_perspectief",
  "transformatie",
  "agendapunt_context",
  "module_scope",
  "doorgrond",
  "stukvoorbereiding",
  "startvraag_bron",
  "neem_niet_vastgestelde_mee",
  "bronkeuze_vorige_log_id",
  "gesprek_id",
  "reflectie_antwoord",
  "reflectie_herformuleren",
  "reflectie_verdiepen",
  "reflectie_tegenperspectief",
  "reflectie_start",
  "volledige_analyse",
] as const;
