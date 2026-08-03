// ============================================================================
//  core/lib/gesprek-verwijderen.ts — plateau A: één verwijderpad, één tekst.
// ----------------------------------------------------------------------------
//  Zowel /ai (AssistentClient) als de agendapuntchat bieden verwijderen aan. Ze
//  moeten hetzelfde doen en hetzelfde beloven — een verwijderdialoog die op de
//  ene plek méér toezegt dan op de andere is een governanceprobleem, geen
//  copyvraagstuk. Vandaar deze gedeelde module (zelfde redenering als besluit
//  0079 voor de antwoordrenderer).
//
//  UX-PRINCIPE "maak vereisten en blokkers expliciet": de dialoog vertelt vóór
//  de actie wat er wél en niet verdwijnt, niet achteraf.
// ============================================================================

/**
 * Bewaartermijn van platform-back-ups, in dagen.
 *
 * ⚠ BEWUST `null`. De feitelijke termijn volgt uit het back-upbeleid van het
 * platform en is in deze repo nergens vastgelegd. Een getal invullen dat we niet
 * kunnen onderbouwen zou de gebruiker schijnzekerheid geven over iets wat hij
 * niet kan controleren — precies wat de verwijderdialoog moet vermijden.
 *
 * Zodra de termijn is vastgesteld: hier het aantal dagen invullen. De tekst
 * hieronder past zich automatisch aan. Staat als openstaand punt genoteerd.
 */
export const BACKUP_TERMIJN_DAGEN: number | null = null;

function backupZin(): string {
  return BACKUP_TERMIJN_DAGEN === null
    ? "• Back-ups van het platform kunnen nog een kopie bevatten totdat ze " +
        "volgens het back-upbeleid vervallen."
    : `• Back-ups van het platform kunnen nog tot ${BACKUP_TERMIJN_DAGEN} dagen ` +
        "een kopie bevatten.";
}

/**
 * Tekst van de bevestigdialoog (AC-11). Benoemt vier dingen expliciet:
 * de actieve omgeving, het auditspoor, de back-uptermijn en al gepubliceerde
 * inbreng — dat laatste omdat wat je met de vergadering hebt gedeeld níét
 * meeverdwijnt, en dat is de meest voorkomende misvatting.
 */
export function verwijderDialoogTekst(titel?: string | null): string {
  const wat = titel ? `„${titel}"` : "dit gesprek";
  return [
    `${wat} definitief verwijderen?`,
    "",
    "Wat verdwijnt:",
    "• Het gesprek in uw actieve omgeving, met alle vragen en antwoorden.",
    "• De vraag- en antwoordtekst bij de bijbehorende regels in het auditspoor.",
    "",
    "Wat blijft:",
    "• Het auditspoor zelf: dát u een vraag stelde, wanneer, in welke modus en " +
      "met welk model. Zonder de inhoud.",
    "• Inbreng die u al bij een agendapunt of besluit heeft gedeeld — die is " +
      "onderdeel van de besluitvorming en verdwijnt hier niet mee.",
    backupZin(),
    "",
    "Dit kan niet ongedaan worden gemaakt.",
  ].join("\n");
}

export interface VerwijderResultaat {
  ok: boolean;
  /** Melding voor de gebruiker wanneer `ok` false is. */
  melding?: string;
}

/**
 * Roept DELETE /api/gesprekken/[id] aan. Die route doet zelf niets: zij roept
 * uitsluitend `verwijder_gesprek()` aan, die eigenaarschap, volgorde en
 * idempotentie in één transactie regelt.
 *
 * `request_id` maakt een netwerkretry of dubbelklik onschadelijk: dezelfde
 * aanroep levert één redactieregel en hetzelfde antwoord.
 */
export async function verwijderGesprekViaApi(id: string): Promise<VerwijderResultaat> {
  try {
    const res = await fetch(`/api/gesprekken/${id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ request_id: crypto.randomUUID() }),
    });
    if (res.ok) return { ok: true };

    console.error("Gesprek verwijderen mislukt:", res.status);
    return {
      ok: false,
      melding:
        res.status === 403
          ? "U kunt alleen uw eigen gesprekken verwijderen."
          : res.status === 404
            ? "Dit gesprek bestaat niet meer."
            : "Verwijderen is niet gelukt. Het gesprek is nog niet verwijderd.",
    };
  } catch (e) {
    console.error("Gesprek verwijderen mislukt:", e);
    return {
      ok: false,
      melding:
        "Verwijderen is niet gelukt — mogelijk is de verbinding weggevallen. " +
        "Het gesprek is nog niet verwijderd.",
    };
  }
}
