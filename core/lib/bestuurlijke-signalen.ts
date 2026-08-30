// Bestuurlijke signalen op de homepage (§12).
//
// Dit is een projectie van bestaand dossiermateriaal, geen tweede takenlijst.
// Per soort maken we maximaal één samengevat signaal; daarna bewaakt de vaste
// prioriteitsvolgorde dat de homepage nooit meer dan drie signalen toont.

import type { ActionStatus, DecisionStatus, DissentZichtbaarheid } from "./decision-view";
import { zwaarteVanVereiste } from "./requirement-zwaarte";

export type BestuurlijkSignaalSoort =
  | "kritieke_vereisten"
  | "actie_te_laat"
  | "afwijking_opvolgen"
  | "dissent_open"
  | "go_no_go"
  | "geen_houder";

export interface BestuurlijkSignaal {
  soort: BestuurlijkSignaalSoort;
  prioriteit: number;
  titel: string;
  toelichting: string;
  href: string;
}

export interface SignaalBewijs {
  vervuld: boolean;
  verplicht: boolean;
  blokkerend: boolean;
}

export interface SignaalActie {
  actie: string;
  deadline: string | null;
  status: ActionStatus;
  /** P5a-profielkoppeling. Optioneel zolang een oudere dossier-view nog zonder
      deze kolom wordt gelezen; dan geldt hij functioneel als null. */
  eigenaar_id?: string | null;
  /** Een externe houder heeft bewust alleen deze historische naam en is dus
      wél toegewezen. */
  eigenaar_naam: string | null;
}

export interface SignaalDissent {
  zichtbaarheid: DissentZichtbaarheid;
  formeel_vastgesteld: boolean;
}

export interface BestuurlijkSignaalBron {
  procedureId: string;
  procedureTitel: string;
  actief: boolean;
  afwijkingenOpen: number;
  bewijs: readonly SignaalBewijs[];
  besluit: {
    status: DecisionStatus;
    gewensteBesluitdatum: string | null;
    acties: readonly SignaalActie[];
    dissent: readonly SignaalDissent[];
  } | null;
}

const OPEN_ACTIE_STATUSSEN = new Set<ActionStatus>([
  "open",
  "in_behandeling",
  "escalatie",
]);

const AFGERONDE_BESLUITSTATUSSEN = new Set<DecisionStatus>([
  "afgesloten",
  "geannuleerd",
  "beeindigd",
  "afgewezen",
]);

function enkelvoudOfMeervoud(aantal: number, enkelvoud: string, meervoud: string) {
  return aantal === 1 ? enkelvoud : meervoud;
}

function datumAlsDag(datum: string): number {
  // Datums uit decision_actions en gewenste_besluitdatum zijn SQL `date`s.
  // Door ze op UTC-middernacht te vergelijken blijft de telling onafhankelijk
  // van het tijdstip waarop de homepage wordt geopend.
  return Date.parse(`${datum.slice(0, 10)}T00:00:00.000Z`);
}

function dagenTeLaat(deadline: string, vandaag: string): number {
  return Math.max(0, Math.floor((datumAlsDag(vandaag) - datumAlsDag(deadline)) / 86400000));
}

function isActieOpen(status: ActionStatus) {
  return OPEN_ACTIE_STATUSSEN.has(status);
}

function isBesluitActief(status: DecisionStatus) {
  return !AFGERONDE_BESLUITSTATUSSEN.has(status);
}

/**
 * Bouwt de maximaal drie bestuurlijke signalen in de voorgeschreven volgorde.
 * Aggregatie per soort voorkomt dat meerdere dossiers met hetzelfde probleem
 * alle ruimte innemen en een lager-prioriteitssignaal willekeurig verdringen.
 */
export function bouwBestuurlijkeSignalen(
  bronnen: readonly BestuurlijkSignaalBron[],
  vandaag: string
): BestuurlijkSignaal[] {
  const actieveBronnen = bronnen.filter((bron) => bron.actief);
  const signalen: BestuurlijkSignaal[] = [];

  const kritieke = actieveBronnen.flatMap((bron) =>
    bron.bewijs
      .filter(
        (bewijs) => !bewijs.vervuld && zwaarteVanVereiste(bewijs) === "kritiek"
      )
      .map(() => bron)
  );
  if (kritieke.length > 0) {
    const eerste = kritieke[0];
    signalen.push({
      soort: "kritieke_vereisten",
      prioriteit: 1,
      titel: `${kritieke.length} ${enkelvoudOfMeervoud(kritieke.length, "kritieke vereiste ontbreekt", "kritieke vereisten ontbreken")}`,
      toelichting: `In ${eerste.procedureTitel}.`,
      href: `/procedures/${eerste.procedureId}`,
    });
  }

  const achterstalligeActies = actieveBronnen.flatMap((bron) =>
    (bron.besluit?.acties ?? [])
      .filter(
        (actie) =>
          isActieOpen(actie.status) &&
          actie.deadline !== null &&
          datumAlsDag(actie.deadline) < datumAlsDag(vandaag)
      )
      .map((actie) => ({ bron, actie, dagen: dagenTeLaat(actie.deadline!, vandaag) }))
  );
  if (achterstalligeActies.length > 0) {
    const oudste = [...achterstalligeActies].sort((a, b) => b.dagen - a.dagen)[0];
    signalen.push({
      soort: "actie_te_laat",
      prioriteit: 2,
      titel: `${achterstalligeActies.length} ${enkelvoudOfMeervoud(achterstalligeActies.length, "actie is", "acties zijn")} ${oudste.dagen} ${enkelvoudOfMeervoud(oudste.dagen, "dag", "dagen")} te laat`,
      toelichting: `${oudste.actie.actie} · ${oudste.bron.procedureTitel}.`,
      href: `/procedures/${oudste.bron.procedureId}`,
    });
  }

  const afwijkingen = actieveBronnen.flatMap((bron) =>
    Array.from({ length: bron.afwijkingenOpen }, () => bron)
  );
  if (afwijkingen.length > 0) {
    const eerste = afwijkingen[0];
    signalen.push({
      soort: "afwijking_opvolgen",
      prioriteit: 3,
      titel:
        afwijkingen.length === 1
          ? "Stap afgerond met afwijking; opvolging open"
          : `${afwijkingen.length} stappen afgerond met afwijking; opvolging open`,
      toelichting: `In ${eerste.procedureTitel}.`,
      href: `/procedures/${eerste.procedureId}`,
    });
  }

  const openDissent = actieveBronnen.flatMap((bron) =>
    (bron.besluit?.dissent ?? [])
      .filter(
        (dissent) =>
          dissent.zichtbaarheid === "formele_dissent" && !dissent.formeel_vastgesteld
      )
      .map(() => bron)
  );
  if (openDissent.length > 0) {
    const eerste = openDissent[0];
    signalen.push({
      soort: "dissent_open",
      prioriteit: 4,
      titel:
        openDissent.length === 1
          ? "Formele dissent nog niet vastgesteld"
          : `${openDissent.length} formele dissents nog niet vastgesteld`,
      toelichting: `In ${eerste.procedureTitel}.`,
      href: `/procedures/${eerste.procedureId}`,
    });
  }

  const geplandeBesluiten = actieveBronnen
    .filter(
      (bron) =>
        bron.besluit?.gewensteBesluitdatum &&
        isBesluitActief(bron.besluit.status)
    )
    .sort((a, b) =>
      datumAlsDag(a.besluit!.gewensteBesluitdatum!) -
      datumAlsDag(b.besluit!.gewensteBesluitdatum!)
    );
  if (geplandeBesluiten.length > 0) {
    const eerste = geplandeBesluiten[0];
    signalen.push({
      soort: "go_no_go",
      prioriteit: 5,
      titel: `Go/no-gobesluit gepland op ${formatDatum(eerste.besluit!.gewensteBesluitdatum!)}`,
      toelichting: `Voor ${eerste.procedureTitel}.`,
      href: `/procedures/${eerste.procedureId}`,
    });
  }

  const zonderHouder = actieveBronnen.flatMap((bron) =>
    (bron.besluit?.acties ?? [])
      .filter(
        (actie) =>
          isActieOpen(actie.status) &&
          actie.eigenaar_id == null &&
          actie.eigenaar_naam == null
      )
      .map((actie) => ({ bron, actie }))
  );
  if (zonderHouder.length > 0) {
    const eerste = zonderHouder[0];
    signalen.push({
      soort: "geen_houder",
      prioriteit: 6,
      titel:
        zonderHouder.length === 1
          ? "Geen houder toegewezen"
          : `${zonderHouder.length} acties zonder houder`,
      toelichting: `${eerste.actie.actie} · ${eerste.bron.procedureTitel}.`,
      href: `/procedures/${eerste.bron.procedureId}`,
    });
  }

  return signalen.sort((a, b) => a.prioriteit - b.prioriteit).slice(0, 3);
}

function formatDatum(datum: string) {
  return new Intl.DateTimeFormat("nl-NL", {
    day: "numeric",
    month: "long",
  }).format(new Date(`${datum.slice(0, 10)}T12:00:00`));
}
