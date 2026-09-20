// ============================================================================
//  #407 labsmoke — de orkestratie, met geïnjecteerde afhankelijkheden.
// ----------------------------------------------------------------------------
//  Deze module bevat de VOLGORDE: aanmelden, drift, root-item, scans, poort,
//  akkoord, meten, rapporteren. Ze staat los van `run.ts` om precies één reden:
//  zolang die volgorde in een `main()` zit die bij import meteen afgaat, is er
//  geen manier om hem te testen — en dan is "de dry-run doet geen call" een
//  belofte in een comment in plaats van een gemeten feit.
//
//  Alles wat het netwerk of de terminal raakt komt hier als parameter binnen:
//  de aanmelding, de Graph-client, de akkoordvraag en de `fetch` voor de
//  Retrieval-call. De test kan daardoor een OPEN POORT opbouwen — de stand die
//  in de praktijk het lastigst te bereiken is — en dan vaststellen dat er
//  ondanks die open poort nul Retrieval-pogingen vertrekken.
// ============================================================================
import type { Aanmelding } from "./auth";
import { bestandsnaamscan, inhoudscan, leesActor, leesRootItem, leesBron, type LeesClient } from "./graph";
import type { Labprofiel } from "./registry";
import type { Scanregel, Smokerapport } from "./rapport";
import {
  BESTANDSNAAM_PREFIX,
  INHOUDSCAN_TERM,
  SCENARIO,
  VERWACHTE_FIXTURE,
  beoordeelPoort,
  meet,
  toetsDrift,
} from "./smoke";
import { hitUrlBinnenRoot } from "../../spike/sharepoint-retrieval/copilot-retrieval";

/** Exitcodes; ook het contract van de CLI. */
export const EXIT = {
  klaar: 0,
  drift: 2,
  poort: 3,
  geenAkkoord: 4,
} as const;

export interface SmokeAfhankelijkheden {
  profiel: Labprofiel;
  /** Levert een delegated aanmelding; in tests een vaste stand. */
  aanmelden: () => Promise<Aanmelding>;
  /** Bouwt de read-only Graph-client op het verkregen token. */
  maakClient: (accessToken: string) => LeesClient;
  /** Wordt ALLEEN aangeroepen als de poort openstaat en het geen dry-run is. */
  vraagAkkoord: () => Promise<boolean>;
  /** De `fetch` die de ene Retrieval-call mag doen. */
  retrievalFetch: typeof fetch;
  signal: AbortSignal;
  dryRun: boolean;
  meld: (regel: string) => void;
  nu?: () => Date;
}

export interface SmokeUitkomst {
  rapport: Smokerapport;
  exitcode: number;
}

export async function voerSmokeUit(deps: SmokeAfhankelijkheden): Promise<SmokeUitkomst> {
  const { profiel, meld } = deps;
  const nu = deps.nu ?? (() => new Date());

  const aanmelding = await deps.aanmelden();
  const client = deps.maakClient(aanmelding.accessToken);

  const actor = await leesActor(client);
  const bron = await leesBron(client, profiel.siteHostnaam, profiel.siteRelatiefPad);
  const drift = toetsDrift(profiel, aanmelding, actor, bron);

  const basis = {
    uitgevoerdOp: nu().toISOString(),
    profielId: profiel.profielId,
    tenantDomein: profiel.tenantDomein,
    actorUpn: profiel.actorUpn,
    siteHostnaam: profiel.siteHostnaam,
    scenario: SCENARIO.code,
    verwachteFixture: VERWACHTE_FIXTURE,
    geregistreerdeIndexstand: profiel.indexStatus,
    drift,
    akkoordGevraagd: false,
    akkoordGegeven: false,
  } as const;

  // DRIFT EERST. Het root-item wordt pas opgezocht als tenant, actor, app en
  // root kloppen: bij drift hoort er geen enkele verdere lezing te volgen.
  if (drift.length > 0) {
    meld("DRIFT VASTGESTELD — de run stopt fail-closed vóór het opzoeken van de bronroot.");
    return {
      exitcode: EXIT.drift,
      rapport: {
        ...basis,
        scans: [],
        poort: { doorgelaten: false, code: "beide_nul" },
        graphCalls: client.pogingen(),
        retrieval: null,
        eindstand: "gestopt_op_drift",
      },
    };
  }

  // Het startpunt van beide scans: het GEREGISTREERDE root-item, niet de
  // drive-root. Zie `leesRootItem` voor waarom dat verschil uitmaakt.
  const root = await leesRootItem(client, bron.driveId, bron.driveWebUrl, profiel.rootUrl);
  const binnenRoot = (webUrl: string | undefined) => hitUrlBinnenRoot(webUrl, profiel.rootUrl, profiel.siteHostnaam);

  meld(`Inhoudscan op "${INHOUDSCAN_TERM}" …`);
  const inhoud = await inhoudscan(client, bron.driveId, root.rootItemId, INHOUDSCAN_TERM, binnenRoot);
  meld(`  ${inhoud.treffers} treffer(s), ${inhoud.binnenRoot} binnen de bronroot`);

  meld(`Bestandsnaamscan op "${BESTANDSNAAM_PREFIX}*" …`);
  const naam = await bestandsnaamscan(client, bron.driveId, root.rootItemId, BESTANDSNAAM_PREFIX, binnenRoot);
  meld(`  ${naam.treffers} treffer(s) binnen de bronroot, ${naam.bekeken} item(s) bekeken`);

  const scans: Scanregel[] = [
    { naam: "inhoudscan", sleutel: INHOUDSCAN_TERM, treffers: inhoud.treffers, binnenRoot: inhoud.binnenRoot },
    {
      naam: "bestandsnaamscan",
      sleutel: BESTANDSNAAM_PREFIX,
      treffers: naam.treffers,
      binnenRoot: naam.treffers,
      afgekapt: naam.afgekapt,
    },
  ];
  const poort = beoordeelPoort(inhoud, naam);

  if (!poort.doorgelaten) {
    meld(`POORT DICHT (${poort.code}) — er wordt geen Retrieval-call uitgevoerd.`);
    return {
      exitcode: EXIT.poort,
      rapport: { ...basis, scans, poort, graphCalls: client.pogingen(), retrieval: null, eindstand: "gestopt_op_poort" },
    };
  }

  // DE DRY-RUN-GRENDEL. Hij staat vóór de akkoordvraag, niet erna: bij een
  // dry-run is er niets om akkoord op te geven, dus wordt er ook niets gevraagd.
  if (deps.dryRun) {
    meld("--dry-run: de poort staat open, maar er wordt geen live call gedaan.");
    return {
      exitcode: EXIT.klaar,
      rapport: {
        ...basis,
        scans,
        poort,
        graphCalls: client.pogingen(),
        retrieval: null,
        eindstand: "gestopt_op_akkoord",
      },
    };
  }

  if (!(await deps.vraagAkkoord())) {
    meld("Geen akkoord — de run stopt zonder Retrieval-call.");
    return {
      exitcode: EXIT.geenAkkoord,
      rapport: {
        ...basis,
        akkoordGevraagd: true,
        scans,
        poort,
        graphCalls: client.pogingen(),
        retrieval: null,
        eindstand: "gestopt_op_akkoord",
      },
    };
  }

  meld("Eén Retrieval-poging …");
  const retrieval = await meet(profiel, {
    accessToken: aanmelding.accessToken,
    signal: deps.signal,
    fetchImpl: deps.retrievalFetch,
  });

  return {
    exitcode: EXIT.klaar,
    rapport: {
      ...basis,
      akkoordGevraagd: true,
      akkoordGegeven: true,
      scans,
      poort,
      graphCalls: client.pogingen(),
      retrieval,
      eindstand: "gemeten",
    },
  };
}
