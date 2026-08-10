// ============================================================================
//  Runtime-validatie en begrenzing van de chat-invoer — PUUR, geen I/O.
// ----------------------------------------------------------------------------
//  Reviewbevinding H-12 (2026-07-30). De chatroute nam `messages` over via een
//  TypeScript-cast en deed één runtime-check, en die gold alleen voor het
//  LAATSTE bericht. Gevolgen:
//
//   1. DENIAL-OF-WALLET. Er was geen cap op de lengte van de vraag, geen cap op
//      de historie en geen tokenschatting vóór de call. Output was wél begrensd
//      (max_tokens 5000/8000), input niet. Met 20 requests per 5 minuten × 12
//      beurten × onbeperkte lengte loopt de rekening bij Opus hard op — plus per
//      request een Sonnet-rewrite en een Mistral-embedding.
//
//   2. GUARDRAIL-BYPASS. Eerdere beurten gingen ongecontroleerd door naar de
//      Anthropic-API, inclusief `role` en `content` van willekeurig type. Een
//      gefabriceerde "assistant"-beurt kan de instructieset relativeren, en met
//      `transformatie: true` wordt die tekst zelfs expliciet als "uw vorige
//      antwoord" behandeld.
//
//   3. AUDIT-INTEGRITEIT. `governance_log` legt alleen de laatste vraag en het
//      antwoord vast. Een antwoord dat onder een vervalste historie tot stand
//      kwam is achteraf niet als zodanig herkenbaar. Daarom levert deze module
//      ook een hash van de daadwerkelijk verstuurde historie, die de route in
//      `retrieval_meta` meeschrijft.
//
//  ONTWERP: fail-closed en expliciet. Ongeldige invoer levert een foutcode op
//  die de route naar een 400/413 vertaalt — geen stille truncatie, want dan zou
//  een gebruiker een antwoord krijgen op een vraag die hij niet stelde.
//
//  ----------------------------------------------------------------------------
//  CORRECTIE (2026-08-10) — de per-beurt cap gold óók voor assistent-beurten.
//  De user-cap (8.000 tekens) is een teken-cap; de eigen output van het portaal
//  is begrensd in TOKENS (MAX_TOKENS_BESTUURLIJK = 8.000 ≈ ~32.000 tekens). Een
//  normaal, lang memo-antwoord overschreed daardoor de 8.000-teken cap zodra het
//  als historie terugkwam, met een melding die de gebruiker ("upload een
//  document") ten onrechte de schuld gaf en de vervolgvraag blokkeerde (lange
//  bureau-memo → doodlopende vervolgvraag). Onder staan de user-cap en de
//  assistent-cap daarom los; het aanvalsoppervlak (user-invoer) houdt de krappe
//  H-12-cap. Zie notitie "verbeterprogramma opsteltaken en bureau-assistent".
//
//  Puur en los testbaar (chat-invoer.sanity.ts): geen `server-only`, geen DB.
// ============================================================================

import { createHash } from "node:crypto";

/** Maximale lengte van één USER-beurt. ~8.000 tekens is ruim 1.500 woorden —
 *  meer dan elke realistische bestuurdersvraag, en klein genoeg om een geplakt
 *  document als invoer te weren (daarvoor is de documentupload). Dit is het
 *  werkelijke aanvalsoppervlak (denial-of-wallet, prompt-injectie via geplakte
 *  tekst) en blijft daarom krap (H-12). */
export const MAX_BEURT_TEKENS = 8_000;

/** Maximale lengte van één ASSISTENT-beurt in de historie. Anders dan een
 *  user-beurt is dit de eigen, reeds begrensde output van het portaal
 *  (MAX_TOKENS_BESTUURLIJK = 8.000 tokens ≈ ~32.000 tekens). De cap staat ruimer
 *  dan de user-cap zodat een normaal, lang memo-antwoord niet ten onrechte wordt
 *  geweigerd zodra het als historie terugkomt (en de vervolgvraag erop
 *  blokkeert). Werkhypothese 40.000 = output-plafond + marge; kalibreren op
 *  echte antwoordlengtes. Een overschrijding hiervan is abnormaal (ruim boven
 *  wat het model kan produceren) en duidt op een vervormde/gefabriceerde
 *  historie — daarom nog steeds fail-closed. */
export const MAX_ASSISTANT_BEURT_TEKENS = 40_000;

/** Maximale som over alle meegestuurde beurten. Bij HISTORY_LIMIT = 12 gaf dit
 *  historisch gemiddeld 5.000 tekens per beurt — gekalibreerd toen beurten korte
 *  vragen waren. Met lange memo-antwoorden als beurt is dit de eerstvolgende
 *  kalibratiepost (én kostenrem): openstaand besluit in de notitie
 *  "verbeterprogramma opsteltaken en bureau-assistent". Bewust nog niet verhoogd
 *  in de beurt-cap-correctie van 2026-08-10 — één lange memo + vervolgvraag past
 *  ruim binnen 60.000; pas bij meerdere lange memo's in één gesprek raakt dit. */
export const MAX_HISTORIE_TEKENS = 60_000;

/** Harde bovengrens op het aantal beurten. De route knipt zelf al op
 *  HISTORY_LIMIT; dit weert een payload met duizenden beurten vóórdat er
 *  überhaupt geknipt wordt. */
export const MAX_BEURTEN = 60;

export type ChatBericht = { role: "user" | "assistant"; content: string };

export type InvoerFoutcode =
  | "geen_invoer"
  | "ongeldige_beurt"
  | "laatste_geen_vraag"
  | "beurt_te_lang"
  | "antwoord_te_lang"
  | "historie_te_lang"
  | "te_veel_beurten";

export type InvoerResultaat =
  | {
      ok: true;
      messages: ChatBericht[];
      /** De genormaliseerde laatste gebruikersvraag. */
      vraag: string;
      /** Totaal aantal tekens over alle beurten (voor telemetrie). */
      tekens: number;
      /** sha256 over de verstuurde historie — legt in het auditspoor vast
       *  wélke context tot dit antwoord leidde, zonder de inhoud te dupliceren. */
      historieHash: string;
    }
  | { ok: false; foutcode: InvoerFoutcode; melding: string; status: 400 | 413 };

function isGeldigeBeurt(x: unknown): x is ChatBericht {
  if (typeof x !== "object" || x === null) return false;
  const b = x as Record<string, unknown>;
  if (b.role !== "user" && b.role !== "assistant") return false;
  if (typeof b.content !== "string") return false;
  return true;
}

/** Stabiele hash over de verstuurde historie (rol + inhoud, in volgorde). */
export function historieHash(messages: ChatBericht[]): string {
  const kanoniek = messages.map((m) => `${m.role}:${m.content}`).join("\u0000");
  return createHash("sha256").update(kanoniek).digest("hex").slice(0, 32);
}

/**
 * Valideert en begrenst de chat-invoer.
 *
 * @param ruweMessages  `body.messages` — van het type `unknown`, want de client
 *                      bepaalt de payload volledig.
 * @param ruweVraag     `body.vraag` — backwards-compat pad voor één losse vraag.
 */
export function valideerChatInvoer(
  ruweMessages: unknown,
  ruweVraag: unknown
): InvoerResultaat {
  // 1. Bepaal de bron: volledige historie, of het one-shot-pad.
  let kandidaten: unknown[];
  if (Array.isArray(ruweMessages) && ruweMessages.length > 0) {
    kandidaten = ruweMessages;
  } else if (typeof ruweVraag === "string" && ruweVraag.trim().length > 0) {
    kandidaten = [{ role: "user", content: ruweVraag }];
  } else {
    return {
      ok: false,
      foutcode: "geen_invoer",
      melding: "messages of vraag is verplicht",
      status: 400,
    };
  }

  // 2. Aantal beurten.
  if (kandidaten.length > MAX_BEURTEN) {
    return {
      ok: false,
      foutcode: "te_veel_beurten",
      melding: `Een gesprek kan maximaal ${MAX_BEURTEN} beurten bevatten.`,
      status: 413,
    };
  }

  // 3. Vorm van elke beurt — ELKE beurt, niet alleen de laatste.
  const messages: ChatBericht[] = [];
  for (const k of kandidaten) {
    if (!isGeldigeBeurt(k)) {
      return {
        ok: false,
        foutcode: "ongeldige_beurt",
        melding:
          "Een of meer berichten hebben een ongeldige vorm (rol moet 'user' of 'assistant' zijn en inhoud tekst).",
        status: 400,
      };
    }
    messages.push({ role: k.role, content: k.content });
  }

  // 4. Lengte per beurt (rol-afhankelijk) en over het geheel.
  //    - User-beurten: krappe H-12-cap; dit is het aanvalsoppervlak.
  //    - Assistent-beurten: de eigen, al begrensde output van het portaal, die
  //      in tokens telt (~4× zoveel tekens). Dezelfde 8.000-teken cap zou een
  //      normaal lang memo-antwoord ten onrechte weigeren zodra het als historie
  //      terugkomt — en de vervolgvraag erop blokkeren. Daarom een ruimere cap,
  //      met een eigen (niet-verwijtende) melding bij overschrijding.
  let tekens = 0;
  for (const m of messages) {
    const limiet = m.role === "user" ? MAX_BEURT_TEKENS : MAX_ASSISTANT_BEURT_TEKENS;
    if (m.content.length > limiet) {
      if (m.role === "user") {
        return {
          ok: false,
          foutcode: "beurt_te_lang",
          melding: `Een bericht mag maximaal ${MAX_BEURT_TEKENS.toLocaleString("nl-NL")} tekens bevatten. Upload een lang stuk als document in plaats van het in de vraag te plakken.`,
          status: 413,
        };
      }
      // Assistent-beurt boven de ruime cap: abnormaal lang (ruim boven wat het
      // model produceert). Geen "upload een document"-melding — de gebruiker
      // plakte niets; dit is een eerder antwoord in de historie.
      return {
        ok: false,
        foutcode: "antwoord_te_lang",
        melding: `Dit gesprek bevat een eerder antwoord dat te lang is om op voort te bouwen. Start een nieuw gesprek.`,
        status: 413,
      };
    }
    tekens += m.content.length;
  }
  if (tekens > MAX_HISTORIE_TEKENS) {
    return {
      ok: false,
      foutcode: "historie_te_lang",
      melding: `Dit gesprek is te lang geworden (maximaal ${MAX_HISTORIE_TEKENS.toLocaleString("nl-NL")} tekens). Start een nieuw gesprek.`,
      status: 413,
    };
  }

  // 5. De laatste beurt moet een niet-lege vraag van de gebruiker zijn.
  const laatste = messages[messages.length - 1];
  if (laatste.role !== "user" || laatste.content.trim().length === 0) {
    return {
      ok: false,
      foutcode: "laatste_geen_vraag",
      melding: "Het laatste bericht moet een vraag van de gebruiker zijn",
      status: 400,
    };
  }

  return {
    ok: true,
    messages,
    vraag: laatste.content.trim(),
    tekens,
    historieHash: historieHash(messages),
  };
}
