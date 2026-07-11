// lib/aqlab/release-core.ts
// -----------------------------------------------------------------------------
// AQLab — PURE kern van de release-service (AQL-4, technisch §5.6b, functioneel
// §6). Geen I/O, geen "server-only": los testbaar (lib/aqlab-release.sanity.ts).
// De DB-orchestratie leeft in lib/aqlab/release.ts (server-only).
//
// Verantwoordelijkheid van deze kern:
//   (a) de 7-status-statusmachine (functioneel §6) — toegestane overgangen;
//   (b) de harde vrijgave-guard: welke besluit/status/advies-combinaties zijn
//       toegestaan gegeven run_type, kritieke-bevindingen en (advies)afwijking.
//
// GUARDRAILS (CLAUDE.md / technisch §2.13 / functioneel §6.3/§6.3a):
//   • kritieke_bevindingen_count > 0  ⇒  besluit ≠ 'vrijgegeven' EN
//     release_advies ≠ 'accepteren' (spiegelt de DB-CHECK aqlab_release_kritiek_blokkeert).
//   • run_type = 'ad_hoc'  ⇒  nooit release_status 'vrijgegeven' (geen formeel besluit).
//   • run_type = 'subset'  ⇒  'vrijgegeven' alleen mét expliciete governance-motivatie.
//   • release_status 'vrijgegeven' vereist besluit='vrijgegeven' + besluit_door + besluit_op.
//   • Afwijken van het run-advies ⇒ motivatie verplicht (human-in-the-loop, herleidbaar).
//   • Consistentie-blokkade uit AQL-3 (aggregatie.regressie.release_advies) weegt mee.
//   • Vrijgave is een MENSBESLUIT (Governance Owner), nooit automatisch uit een score.
// -----------------------------------------------------------------------------

/** De 7 releasestatussen (DB-enum aqlab_release_decisions.release_status). */
export type Releasestatus =
  | "concept"
  | "getest"
  | "review_vereist"
  | "aangepast"
  | "vrijgegeven"
  | "geblokkeerd"
  | "gearchiveerd";

/** DB-toegestane release_advies-waarden (aqlab_release_decisions.release_advies).
 *  NB: de pure regressiekern kent daarnaast 'review_required' — dat is GEEN
 *  DB-advies maar een status-signaal; mapAdviesNaarDb() vertaalt het. */
export type DbReleaseAdvies = "accepteren" | "aanpassen" | "blokkeren";

/** DB-toegestane besluitwaarden (aqlab_release_decisions.besluit). */
export type Besluit = "vrijgegeven" | "geblokkeerd";

export type RunType = "full_regression" | "subset" | "ad_hoc";

export const RELEASE_STATUSSEN: readonly Releasestatus[] = [
  "concept", "getest", "review_vereist", "aangepast",
  "vrijgegeven", "geblokkeerd", "gearchiveerd",
] as const;

/**
 * Toegestane statusovergangen (functioneel §6, state machine). Een lege set
 * betekent een eindstatus. `concept` is de startstatus (geen inkomende overgang
 * nodig). Elke overgang = een NIEUWE append-only regel (nooit UPDATE).
 */
export const STATUS_OVERGANGEN: Record<Releasestatus, readonly Releasestatus[]> = {
  concept:        ["getest"],
  getest:         ["review_vereist", "vrijgegeven"],
  review_vereist: ["aangepast", "geblokkeerd"],
  aangepast:      ["getest"],
  vrijgegeven:    ["gearchiveerd"],
  geblokkeerd:    ["aangepast", "gearchiveerd"],
  gearchiveerd:   [],
};

/** Is de overgang van `van` naar `naar` toegestaan door de statusmachine? */
export function isToegestaneOvergang(van: Releasestatus, naar: Releasestatus): boolean {
  return STATUS_OVERGANGEN[van]?.includes(naar) ?? false;
}

/**
 * Vertaalt het (mogelijk 'review_required') regressie-advies naar een geldig
 * DB-advies + een geadviseerde status. 'review_required' is geen DB-advies:
 * het duidt op onvolledige/onbetrouwbare meting → conservatief 'aanpassen' +
 * status 'review_vereist'. null (ad_hoc) → geen advies.
 */
export function mapAdviesNaarDb(
  coreAdvies: "accepteren" | "aanpassen" | "blokkeren" | "review_required" | null
): { advies: DbReleaseAdvies | null; geadviseerdeStatus: Releasestatus } {
  switch (coreAdvies) {
    case "accepteren": return { advies: "accepteren", geadviseerdeStatus: "getest" };
    case "aanpassen":  return { advies: "aanpassen",  geadviseerdeStatus: "review_vereist" };
    case "blokkeren":  return { advies: "blokkeren",  geadviseerdeStatus: "geblokkeerd" };
    case "review_required": return { advies: "aanpassen", geadviseerdeStatus: "review_vereist" };
    default: return { advies: null, geadviseerdeStatus: "getest" };
  }
}

export interface VrijgaveBesluitInput {
  run_type: RunType;
  /** Doel-releasestatus die de gebruiker wil vastleggen. */
  gewenste_status: Releasestatus;
  /** Formeel besluit (bij vrijgeven/blokkeren), of null bij een tussenstatus. */
  besluit: Besluit | null;
  /** Advies dat de run gaf (DB-vorm), of null (ad_hoc / niet berekend). */
  run_advies: DbReleaseAdvies | null;
  /** Aantal open kritieke bevindingen (ernst='kritiek', status='open'). */
  kritieke_bevindingen_count: number;
  /** Ingevoerde motivatie (leeg/null = geen). */
  motivatie: string | null;
  /** Is er een besluitnemer + tijdstip aanwezig (voor 'vrijgegeven')? */
  heeft_besluitnemer: boolean;
}

export interface VrijgaveBesluitOordeel {
  toegestaan: boolean;
  redenen: string[];
  /** Was motivatie verplicht (afwijken van advies of subset-vrijgave)? */
  motivatie_verplicht: boolean;
}

/** Wijkt het gekozen besluit/advies af van het door de run gegeven advies? */
export function wijktAfVanAdvies(input: VrijgaveBesluitInput): boolean {
  // Geen run-advies (ad_hoc/onbekend) → elke formele keuze is per definitie een
  // eigenstandige governancekeuze en vereist motivatie zodra er een besluit valt.
  if (input.besluit == null && input.gewenste_status !== "vrijgegeven" && input.gewenste_status !== "geblokkeerd") {
    return false;
  }
  if (input.run_advies == null) return input.besluit != null;
  // Advies 'accepteren' maar geblokkeerd besluit, of advies 'blokkeren' maar
  // toch vrijgegeven → afwijking. Advies 'aanpassen' met vrijgave → afwijking.
  if (input.besluit === "vrijgegeven") return input.run_advies !== "accepteren";
  if (input.besluit === "geblokkeerd") return input.run_advies === "accepteren";
  return false;
}

/**
 * Pure guard voor het vastleggen van een vrijgavebesluit. Bepaalt of de
 * gevraagde combinatie is toegestaan en met welke redenen ze eventueel wordt
 * geweigerd. Spiegelt de DB-CHECKs (aqlab_release_kritiek_blokkeert,
 * aqlab_release_vrijgegeven_volledig) én dwingt de service-laag-regels af die de
 * DB niet kan zien (run-type, advies-afwijking-motivatie).
 */
export function valideerVrijgaveBesluit(input: VrijgaveBesluitInput): VrijgaveBesluitOordeel {
  const redenen: string[] = [];
  const heeftMotivatie = !!(input.motivatie && input.motivatie.trim().length > 0);
  // Formele statussen dragen een go/no-go-mensbesluit (beide herleidbaar).
  const isFormeleStatus = input.gewenste_status === "vrijgegeven" || input.gewenste_status === "geblokkeerd";

  // 0. Besluit ↔ status-consistentie: een formeel besluit moet bij de status horen
  //    (voorkomt bv. besluit='vrijgegeven' op een 'getest'-rij dat de DB-CHECK
  //    aqlab_release_vrijgegeven_volledig niet in die richting bewaakt).
  if (input.besluit != null && input.besluit !== input.gewenste_status) {
    redenen.push(`Besluit '${input.besluit}' moet overeenkomen met de releasestatus '${input.gewenste_status}'.`);
  }

  // 1. Harde blokkade: open kritieke bevinding blokkeert vrijgave + accepteren.
  if (input.kritieke_bevindingen_count > 0) {
    if (input.besluit === "vrijgegeven" || input.gewenste_status === "vrijgegeven") {
      redenen.push(
        `${input.kritieke_bevindingen_count} open kritieke bevinding(en) → vrijgave onmogelijk (besluit ≠ 'vrijgegeven').`
      );
    }
    if (input.run_advies === "accepteren") {
      redenen.push("Open kritieke bevinding → advies kan niet 'accepteren' zijn.");
    }
  }

  // 2. Elk formeel besluit (go ÉN no-go) vereist een herleidbaar mensbesluit:
  //    besluit gelijk aan de status + besluitnemer/tijdstip. Zo is ook een
  //    blokkade (no-go) altijd toewijsbaar aan een persoon.
  if (isFormeleStatus) {
    if (input.besluit !== input.gewenste_status || !input.heeft_besluitnemer) {
      redenen.push(
        `Een formeel '${input.gewenste_status}'-besluit vereist besluit='${input.gewenste_status}' met besluitnemer en tijdstip (herleidbaar mensbesluit).`
      );
    }
  }

  // 3. Run-type-regels gelden alleen voor een formele VRIJGAVE (niet voor no-go).
  if (input.gewenste_status === "vrijgegeven" || input.besluit === "vrijgegeven") {
    if (input.run_type === "ad_hoc") {
      redenen.push("Ad-hoc run kan nooit 'vrijgegeven' opleveren — formele vrijgave vereist een regressierun.");
    }
    if (input.run_type === "subset" && !heeftMotivatie) {
      redenen.push("Subset-run: vrijgave vereist een expliciete governance-motivatie.");
    }
  }

  // 4. Motivatie verplicht bij afwijken van het advies of subset-vrijgave.
  const afwijking = wijktAfVanAdvies(input);
  const subsetVrijgave =
    input.run_type === "subset" &&
    (input.gewenste_status === "vrijgegeven" || input.besluit === "vrijgegeven");
  const motivatie_verplicht = afwijking || subsetVrijgave;
  if (motivatie_verplicht && !heeftMotivatie) {
    redenen.push(
      afwijking
        ? "Afwijken van het releaseadvies vereist een motivatie."
        : "Governance-motivatie verplicht bij vrijgave op een subset-run."
    );
  }

  return { toegestaan: redenen.length === 0, redenen, motivatie_verplicht };
}
