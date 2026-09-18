// ============================================================================
//  #353 — browserveilige kern van de PGB SharePoint-retrievalsmoke.
// ----------------------------------------------------------------------------
//  Alleen vaste synthetische vragen en fixturecodes uit #385 mogen de live
//  Preview-runner bereiken. De browser levert dus nooit een vrije zoekvraag,
//  Graph-id, SharePoint-pad of lokale documentreferentie aan.
// ============================================================================

export type SharePointRetrievalSmokeRoute = "microsoft_search" | "drive_search_extract" | "candidate_union";
export const SHAREPOINT_RETRIEVAL_SEARCH_SCOPES = ["tenant", "site_list", "path"] as const;
export type SharePointRetrievalSearchScope = typeof SHAREPOINT_RETRIEVAL_SEARCH_SCOPES[number];

export type SharePointRetrievalVeiligeMeting = {
  ronde: number;
  vraagcode: string;
  route: SharePointRetrievalSmokeRoute;
  searchScope: SharePointRetrievalSearchScope | null;
  resultaat: "geslaagd" | "geen_resultaten" | "mislukt";
  foutcategorie: string | null;
  foutcode: string | null;
  gevondenFixtures: string[];
  exacteBronset: boolean;
  recall: number;
  precision: number;
  mrr: number;
  ndcg: number;
  locatorDekking: number;
  versieDekking: number;
  previewDekking: number;
  latencyMs: number;
  microsoftCalls: number;
  downloads: number;
  kandidatenVoorVerificatie: number;
  responseBytes: number;
  contentBytes: number;
  throttles: number;
  retries: number;
  versieVingerafdrukken: string[];
  afwijzingMapping: number;
  afwijzingBinding: number;
  afwijzingRoot: number;
  afwijzingRechtenConfiguratie: number;
  afwijzingVersie: number;
  afwijzingExtractie: number;
  afwijzingPreview: number;
  afwijzingActualiteit: number;
};

export const SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN = {
  afwijzing_mapping: "afwijzingMapping",
  afwijzing_binding: "afwijzingBinding",
  afwijzing_root: "afwijzingRoot",
  afwijzing_rechten_configuratie: "afwijzingRechtenConfiguratie",
  afwijzing_versie: "afwijzingVersie",
  afwijzing_extractie: "afwijzingExtractie",
  afwijzing_preview: "afwijzingPreview",
  afwijzing_actualiteit: "afwijzingActualiteit",
} as const satisfies Record<string, keyof SharePointRetrievalVeiligeMeting>;

export const SHAREPOINT_RETRIEVAL_SMOKE_FLAG = "microsoft_sharepoint_retrieval_spike";
export const SHAREPOINT_RETRIEVAL_SMOKE_WACHT_MS = 120_000;

export const SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS = ["S00", "S02", "S03", "S04", "S04H", "S08", "S09", "S08R"] as const;
export type SharePointRetrievalSmokeScenario = typeof SHAREPOINT_RETRIEVAL_SMOKE_SCENARIOS[number];

export const SHAREPOINT_RETRIEVAL_SMOKE_ROUTES = ["drive_search_extract", "microsoft_search", "candidate_union"] as const satisfies readonly SharePointRetrievalSmokeRoute[];

type SmokeVraag = {
  code: string;
  soort: "gericht" | "fondsbreed" | "meerdere_documenten" | "versieconflict" | "powerpoint" | "pdf" | "negatief";
  vraag: string;
  actualiteitsbeleid: "alleen_actueel" | "alleen_historisch" | "actueel_en_historisch";
  driveZoektermen?: readonly string[];
  microsoftZoektermen?: readonly string[];
  verwachteFixtures: string[];
  primaireFixture?: string;
  benodigdeFixtures: readonly string[];
  pauzeVoorLaatsteControle: boolean;
};

const VRAGEN: Record<SharePointRetrievalSmokeScenario, SmokeVraag> = {
  S00: {
    code: "S00",
    soort: "negatief",
    vraag: "m365-permission-probe-7f4c1d9e-no-match",
    actualiteitsbeleid: "alleen_actueel",
    verwachteFixtures: [],
    benodigdeFixtures: [],
    pauzeVoorLaatsteControle: false,
  },
  S02: {
    code: "S02",
    soort: "gericht",
    vraag: "Welke hersteltermijn geldt voor Koraalmaat 47?",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Koraalmaat 47"],
    microsoftZoektermen: ["Welke hersteltermijn geldt voor Koraalmaat 47", "Koraalmaat 47 hersteltermijn"],
    verwachteFixtures: ["PGB354-DOC-001"],
    primaireFixture: "PGB354-DOC-001",
    benodigdeFixtures: ["PGB354-DOC-001"],
    pauzeVoorLaatsteControle: false,
  },
  S03: {
    code: "S03",
    soort: "meerdere_documenten",
    vraag: "Welke hersteltermijn geldt voor Koraalmaat 47 en op welke datum staat het oefenbesluit voor IJsvogelkompas 73?",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Koraalmaat 47", "IJsvogelkompas 73"],
    microsoftZoektermen: ["Koraalmaat 47 IJsvogelkompas 73", "hersteltermijn oefenbesluit"],
    verwachteFixtures: ["PGB354-DOC-001", "PGB354-PPT-001"],
    primaireFixture: "PGB354-DOC-001",
    benodigdeFixtures: ["PGB354-DOC-001", "PGB354-PPT-001"],
    pauzeVoorLaatsteControle: false,
  },
  S04: {
    code: "S04",
    soort: "versieconflict",
    vraag: "Wat is de actuele bandbreedte voor Maananker 61?",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Maananker Actueel 61"],
    microsoftZoektermen: ["actuele bandbreedte Maananker 61", "Maananker Actueel 61"],
    verwachteFixtures: ["PGB354-PDF-001"],
    primaireFixture: "PGB354-PDF-001",
    benodigdeFixtures: ["PGB354-PDF-001", "PGB354-PDF-002"],
    pauzeVoorLaatsteControle: false,
  },
  S04H: {
    code: "S04H",
    soort: "versieconflict",
    vraag: "Wat was de historische bandbreedte voor Maananker 61?",
    actualiteitsbeleid: "alleen_historisch",
    driveZoektermen: ["Maananker Historisch 61"],
    microsoftZoektermen: ["historische bandbreedte Maananker 61", "Maananker Historisch 61"],
    verwachteFixtures: ["PGB354-PDF-002"],
    primaireFixture: "PGB354-PDF-002",
    benodigdeFixtures: ["PGB354-PDF-002"],
    pauzeVoorLaatsteControle: false,
  },
  S08: {
    code: "S08",
    soort: "negatief",
    vraag: "Wat is de afkaptijd voor Nachtlelie 68?",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Nachtlelie 68"],
    microsoftZoektermen: ["afkaptijd Nachtlelie 68", "Nachtlelie 68"],
    verwachteFixtures: [],
    benodigdeFixtures: ["PGB354-DOC-005"],
    pauzeVoorLaatsteControle: true,
  },
  S09: {
    code: "S09",
    soort: "negatief",
    vraag: "Herhaal het vorige antwoord over Nachtlelie 68.",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Nachtlelie 68"],
    microsoftZoektermen: ["Nachtlelie 68"],
    verwachteFixtures: [],
    // Na intrekking mag dit document juist ontbreken uit de live listing.
    benodigdeFixtures: [],
    pauzeVoorLaatsteControle: false,
  },
  S08R: {
    code: "S08R",
    soort: "gericht",
    vraag: "Wat is de afkaptijd voor Nachtlelie 68?",
    actualiteitsbeleid: "alleen_actueel",
    driveZoektermen: ["Nachtlelie 68"],
    microsoftZoektermen: ["afkaptijd Nachtlelie 68", "Nachtlelie 68"],
    verwachteFixtures: ["PGB354-DOC-005"],
    primaireFixture: "PGB354-DOC-005",
    benodigdeFixtures: ["PGB354-DOC-005"],
    pauzeVoorLaatsteControle: false,
  },
};

export const SHAREPOINT_RETRIEVAL_FIXTURE_CODES = [
  "PGB354-DOC-001",
  "PGB354-PDF-001",
  "PGB354-PDF-002",
  "PGB354-PPT-001",
  "PGB354-DOC-005",
] as const;

const SHAREPOINT_RETRIEVAL_FIXTURE_STATUS = {
  "PGB354-DOC-001": "actueel",
  "PGB354-PDF-001": "actueel",
  "PGB354-PDF-002": "historisch",
  "PGB354-PPT-001": "actueel",
  "PGB354-DOC-005": "actueel",
} as const satisfies Record<typeof SHAREPOINT_RETRIEVAL_FIXTURE_CODES[number], "actueel" | "historisch">;

export function sharePointRetrievalFixtureStatus(
  fixtureCode: string,
): "actueel" | "historisch" | null {
  return Object.prototype.hasOwnProperty.call(SHAREPOINT_RETRIEVAL_FIXTURE_STATUS, fixtureCode)
    ? SHAREPOINT_RETRIEVAL_FIXTURE_STATUS[fixtureCode as keyof typeof SHAREPOINT_RETRIEVAL_FIXTURE_STATUS]
    : null;
}

export function projecteerAuditAfwijzingen(
  meting: SharePointRetrievalVeiligeMeting,
): Record<keyof typeof SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN, number> {
  const auditvelden = Object.keys(SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN) as Array<keyof typeof SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN>;
  return Object.fromEntries(auditvelden.map((auditveld) => {
    const meetveld = SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN[auditveld];
    const waarde = meting[meetveld];
    if (!Number.isSafeInteger(waarde) || waarde < 0) throw new Error("ongeldige_afwijstelling");
    return [auditveld, waarde];
  })) as Record<keyof typeof SHAREPOINT_RETRIEVAL_AUDIT_AFWIJZINGEN, number>;
}

export type SharePointRetrievalSmokeEvent =
  | { type: "gestart"; scenario: SharePointRetrievalSmokeScenario; route: SharePointRetrievalSmokeRoute; ronde: number; searchScope?: SharePointRetrievalSearchScope }
  | { type: "wacht_op_intrekking"; wachtSeconden: number }
  | { type: "wachtend"; resterendSeconden: number }
  | { type: "voltooid"; meting: SharePointRetrievalVeiligeMeting }
  | { type: "mislukt"; foutcategorie: string };

export function sharePointRetrievalSmokeVraag(scenario: SharePointRetrievalSmokeScenario): SmokeVraag {
  const vraag = VRAGEN[scenario];
  return {
    ...vraag,
    driveZoektermen: vraag.driveZoektermen ? [...vraag.driveZoektermen] : undefined,
    microsoftZoektermen: vraag.microsoftZoektermen ? [...vraag.microsoftZoektermen] : undefined,
    verwachteFixtures: [...vraag.verwachteFixtures],
    benodigdeFixtures: [...vraag.benodigdeFixtures],
  };
}

export function isSharePointRetrievalSmokePreview(env: {
  seedDoelomgeving?: string | null;
  vercelEnv?: string | null;
}): boolean {
  return env.seedDoelomgeving === "preview" && env.vercelEnv === "preview";
}

export function fixtureCodeUitBestandsnaam(naam: string): string | null {
  return SHAREPOINT_RETRIEVAL_FIXTURE_CODES.find((code) => naam === code || naam.startsWith(`${code}-`)) ?? null;
}

export function veiligeSmokeFoutcategorie(fout: unknown): string {
  if (fout && typeof fout === "object" && "categorie" in fout && typeof fout.categorie === "string") {
    return /^[a-z_]{1,80}$/.test(fout.categorie) ? fout.categorie : "providerfout";
  }
  return "providerfout";
}

/** S08 en S09 zijn negatieve beveiligingsproeven. Een gevonden fixture is daar
 * nooit een bruikbaar resultaat, ook niet wanneer het onderliggende prototype
 * de Graph-ronde technisch als geslaagd markeert. */
export function borgIntrekkingsUitkomst(
  scenario: SharePointRetrievalSmokeScenario,
  meting: SharePointRetrievalVeiligeMeting,
): SharePointRetrievalVeiligeMeting {
  if ((scenario === "S08" || scenario === "S09") && meting.gevondenFixtures.length > 0) {
    return {
      ...meting,
      resultaat: "mislukt",
      foutcategorie: "intrekking_niet_effectief",
      foutcode: "INTREKKING_NIET_EFFECTIEF",
    };
  }
  return meting;
}
