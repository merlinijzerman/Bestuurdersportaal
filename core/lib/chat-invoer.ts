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
//  Puur en los testbaar (chat-invoer.sanity.ts): geen `server-only`, geen DB.
// ============================================================================

import { createHash } from "node:crypto";

/** Maximale lengte van één beurt. ~8.000 tekens is ruim 1.500 woorden — meer
 *  dan elke realistische bestuurdersvraag, en klein genoeg om een geplakt
 *  document als invoer te weren (daarvoor is de documentupload). */
export const MAX_BEURT_TEKENS = 8_000;

/** Maximale som over alle meegestuurde beurten. Bij HISTORY_LIMIT = 12 geeft
 *  dit gemiddeld 5.000 tekens per beurt — ruim, maar begrensd. */
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

  // 4. Lengte per beurt en over het geheel.
  let tekens = 0;
  for (const m of messages) {
    if (m.content.length > MAX_BEURT_TEKENS) {
      return {
        ok: false,
        foutcode: "beurt_te_lang",
        melding: `Een bericht mag maximaal ${MAX_BEURT_TEKENS.toLocaleString("nl-NL")} tekens bevatten. Upload een lang stuk als document in plaats van het in de vraag te plakken.`,
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
