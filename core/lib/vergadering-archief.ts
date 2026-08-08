// ============================================================================
//  core/lib/vergadering-archief.ts — besluit 0141
// ----------------------------------------------------------------------------
//  Handmatig archiveren van een vergadering. Puur (geen I/O), gedeeld door de
//  route en de UI, getest in vergadering-archief.sanity.ts.
//
//  WAAROM ARCHIVEREN EN NIET EEN VIERDE STATUS
//  -------------------------------------------
//  `vergaderingen.status` modelleert de VOORTGANG van de voorbereiding
//  (gepland → in_voorbereiding → afgerond). Archivering is daar orthogonaal aan:
//  ze zegt niets over de voorbereiding maar over de zichtbaarheid in de lijst.
//  Zou archivering een vierde statuswaarde worden, dan verliest een afgeronde
//  vergadering bij archivering de informatie dát ze was afgerond — en dat is
//  precies de informatie die je later wilt terugzien. Daarom twee eigen kolommen
//  (`gearchiveerd_op`, `gearchiveerd_door`), die tegelijk vastleggen wie het
//  wanneer deed. De CHECK-constraint op `status` blijft daarmee ongemoeid, wat
//  ook betekent dat bestaande rijen niet geraakt worden.
//
//  DE VOORWAARDE
//  -------------
//  Archiveren mag pas als de DATUM verstreken is. Bewust niet "pas als de status
//  afgerond is": een vergadering die nooit netjes is afgerond zou dan eeuwig in
//  de lijst blijven staan — precies de klacht die dit besluit oplost. En bewust
//  niet "altijd": anders verdwijnt een vergadering van volgende week uit het
//  zicht met één misklik.
//
//  RECHTEN
//  -------
//  Iedereen binnen het fonds mag archiveren (RLS dekt de tenantgrens). Bewust
//  géén rolgate: archiveren is omkeerbaar, verwijdert niets en laat een
//  auditregel achter. Dat maakt het een lichte handeling. De ZWAARDERE handeling
//  — de vergaderkop wijzigen — houdt wél zijn bestaande rolmodel (aanmaker +
//  voorzitter/beheerder); die twee zijn hier bewust niet gelijkgetrokken.
// ============================================================================

export interface VergaderingArchiefToestand {
  /** ISO-tijdstip van de vergadering. */
  datum: string;
  /** ISO-tijdstip van archivering, of `null` als ze in de lijst staat. */
  gearchiveerd_op: string | null;
}

export type ArchiveerOordeel =
  | { mag: true }
  | { mag: false; foutcode: "reeds_gearchiveerd" | "datum_niet_verstreken"; melding: string };

/** Is deze vergadering gearchiveerd? Eén plek, zodat "gearchiveerd" nooit op
 *  twee manieren wordt bepaald. */
export function isGearchiveerd(v: VergaderingArchiefToestand): boolean {
  return v.gearchiveerd_op !== null;
}

/**
 * Mag deze vergadering gearchiveerd worden?
 *
 * `nu` is een parameter zodat de grens deterministisch testbaar is. De
 * vergelijking is strikt: een vergadering die NU begint is nog niet verstreken.
 */
export function magArchiveren(
  v: VergaderingArchiefToestand,
  nu: Date = new Date()
): ArchiveerOordeel {
  if (isGearchiveerd(v)) {
    return {
      mag: false,
      foutcode: "reeds_gearchiveerd",
      melding: "Deze vergadering staat al in het archief.",
    };
  }
  if (new Date(v.datum).getTime() > nu.getTime()) {
    return {
      mag: false,
      foutcode: "datum_niet_verstreken",
      melding:
        "Een vergadering kan pas worden gearchiveerd als de datum verstreken is. " +
        "Zo verdwijnt een geplande vergadering niet per ongeluk uit het zicht.",
    };
  }
  return { mag: true };
}

/** Mag deze vergadering terug uit het archief? Altijd, mits ze er in zit —
 *  archiveren moet omkeerbaar zijn, anders wordt het een verkapte verwijdering. */
export function magDearchiveren(v: VergaderingArchiefToestand): ArchiveerOordeel {
  if (!isGearchiveerd(v)) {
    return {
      mag: false,
      foutcode: "reeds_gearchiveerd",
      melding: "Deze vergadering staat niet in het archief.",
    };
  }
  return { mag: true };
}

/**
 * Splitst een lijst in de drie secties van de vergaderingenpagina.
 *
 * Gearchiveerd wint altijd van komend/afgelopen: een gearchiveerde vergadering
 * hoort nooit óók nog in een van de andere twee te verschijnen. Zonder deze
 * regel op één plek is dat precies het soort dubbeling dat er stil in sluipt.
 */
export function splitsVergaderingen<T extends VergaderingArchiefToestand>(
  lijst: T[],
  nu: Date = new Date()
): { komend: T[]; afgelopen: T[]; gearchiveerd: T[] } {
  const komend: T[] = [];
  const afgelopen: T[] = [];
  const gearchiveerd: T[] = [];
  for (const v of lijst) {
    if (isGearchiveerd(v)) gearchiveerd.push(v);
    else if (new Date(v.datum).getTime() >= nu.getTime()) komend.push(v);
    else afgelopen.push(v);
  }
  const opDatum = (a: T, b: T) => new Date(a.datum).getTime() - new Date(b.datum).getTime();
  komend.sort(opDatum);
  afgelopen.sort((a, b) => opDatum(b, a));
  gearchiveerd.sort((a, b) => opDatum(b, a));
  return { komend, afgelopen, gearchiveerd };
}
