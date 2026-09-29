// ============================================================================
//  Foutvertaling voor generieke curatiewijzigingen (#499).
// ----------------------------------------------------------------------------
//  Voorheen meldde elke mislukte documenten-UPDATE "mogelijk een ongeldige
//  statusovergang" — ook een statement-time-out (SQLSTATE 57014). Daardoor
//  zocht de beheerder de fout in de metadata terwijl de database simpelweg te
//  lang bezig was. Deze module onderscheidt de oorzaken op SQLSTATE (en voor de
//  statusovergang op de vaste triggermelding) en geeft een gebruikersmelding
//  ZONDER interne details (geen SQL, geen object- of kolomnamen). De SQLSTATE
//  gaat wél het auditspoor in (effect), niet naar de gebruiker.
//
//  Puur (geen DB/IO) → los testbaar (generiek-mutatie-fout.sanity.ts).
// ============================================================================

export type MutatieFoutSoort =
  | "time_out"
  | "statusovergang"
  | "ongeldige_metadata"
  | "niet_gevonden"
  | "niet_beschikbaar"
  | "onbekend";

export type MutatieFoutInvoer = {
  code?: string | null;
  message?: string | null;
} | null | undefined;

/** SQLSTATE-codes met een vaste betekenis voor dit pad. */
const SQLSTATE_TIME_OUT = "57014"; // query_canceled (statement_timeout)
const SQLSTATE_CHECK = "23514"; // check_violation
const SQLSTATE_NIET_GEVONDEN = "P0002"; // no_data_found (RPC: geen generiek document)
const SQLSTATE_RAISE = "P0001"; // raise_exception (o.a. de toestandsmachine-trigger)
// PostgREST: functie ontbreekt in de schemacache (migratie niet gedraaid).
const POSTGREST_FUNCTIE_ONBEKEND = "PGRST202";

export function classificeerMutatieFout(fout: MutatieFoutInvoer): MutatieFoutSoort {
  const code = typeof fout?.code === "string" ? fout.code : "";
  const bericht = typeof fout?.message === "string" ? fout.message : "";
  if (code === SQLSTATE_TIME_OUT) return "time_out";
  if (code === SQLSTATE_RAISE && /statusovergang/i.test(bericht)) return "statusovergang";
  if (code === SQLSTATE_CHECK) return "ongeldige_metadata";
  if (code === SQLSTATE_NIET_GEVONDEN) return "niet_gevonden";
  if (code === POSTGREST_FUNCTIE_ONBEKEND) return "niet_beschikbaar";
  return "onbekend";
}

/** Gebruikersmelding per oorzaak. `handeling` is een korte zelfstandige
 *  naamwoordgroep ("Bijwerken", "Intrekken" …). Elke melding zegt expliciet dat
 *  er niets is gewijzigd: de wijziging is atomisch (één transactie). */
export function mutatieFoutMelding(soort: MutatieFoutSoort, handeling: string): string {
  switch (soort) {
    case "time_out":
      return `${handeling} duurde te lang en is afgebroken; er is niets gewijzigd. Probeer het later opnieuw. Blijft dit gebeuren, meld het dan aan het platformbeheer.`;
    case "statusovergang":
      return `${handeling} geweigerd: deze statusovergang is niet toegestaan. Er is niets gewijzigd.`;
    case "ongeldige_metadata":
      return `${handeling} geweigerd: de combinatie van metadata voldoet niet aan de databaseregels. Er is niets gewijzigd.`;
    case "niet_gevonden":
      return "Generiek document niet gevonden.";
    case "niet_beschikbaar":
      return `${handeling} is tijdelijk niet beschikbaar; er is niets gewijzigd. Meld dit aan het platformbeheer.`;
    default:
      return `${handeling} is mislukt; er is niets gewijzigd. Probeer het opnieuw.`;
  }
}

/** Alleen een SQLSTATE-achtige code (5 tekens of PGRSTnnn) gaat het audit-
 *  effect in; al het andere wordt weggelaten, zodat er geen vrije foutentekst
 *  in het auditspoor belandt. */
export function auditFoutcode(fout: MutatieFoutInvoer): string | null {
  const code = typeof fout?.code === "string" ? fout.code : "";
  return /^([0-9A-Z]{5}|PGRST[0-9]{3})$/.test(code) ? code : null;
}
