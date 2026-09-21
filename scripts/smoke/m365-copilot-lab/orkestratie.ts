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
import { isAfbreking, redenVan } from "../../../core/lib/retrieval/afbreken";
import { CopilotFout } from "../../../core/lib/microsoft-retrieval/fouten";
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

/** Exitcodes; ook het contract van de CLI. */
export const EXIT = {
  klaar: 0,
  drift: 2,
  poort: 3,
  geenAkkoord: 4,
  /** De call is gedaan en fail-closed afgewezen; er ís een meetuitkomst. */
  retrievalAfgewezen: 5,
  /** Afgebroken NÁ het vertrek van het verzoek; het quotum kan verbruikt zijn. */
  retrievalAfgebroken: 6,
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

  meld(`Inhoudscan op "${INHOUDSCAN_TERM}" …`);
  const inhoud = await inhoudscan(client, bron.driveId, root.rootItemId, root.rootGraphPad, INHOUDSCAN_TERM);
  meld(
    `  ${inhoud.treffers} treffer(s): ${inhoud.binnenRoot} geverifieerd binnen de bronroot, `
    + `${inhoud.buitenRoot} buiten, ${inhoud.nietVerifieerbaar} niet verifieerbaar `
    + `(${inhoud.verseHerlezingen} verse herlezing(en))`,
  );

  meld(`Bestandsnaamscan op "${BESTANDSNAAM_PREFIX}*" …`);
  const naam = await bestandsnaamscan(client, bron.driveId, root.rootItemId, root.rootGraphPad, BESTANDSNAAM_PREFIX);
  meld(`  ${naam.treffers} treffer(s) binnen de bronroot, ${naam.bekeken} item(s) bekeken`);

  const scans: Scanregel[] = [
    {
      naam: "inhoudscan",
      sleutel: INHOUDSCAN_TERM,
      treffers: inhoud.treffers,
      binnenRoot: inhoud.binnenRoot,
      buitenRoot: inhoud.buitenRoot,
      nietVerifieerbaar: inhoud.nietVerifieerbaar,
      verseHerlezingen: inhoud.verseHerlezingen,
      redenen: inhoud.redenen as Record<string, number>,
    },
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

  // De pogingen worden BUITEN `meet()` geteld, op de grens waar het verkeer het
  // proces verlaat. Bij een geslaagde call rapporteert de client zelf hoeveel
  // pogingen hij deed; bij een afgewezen call komt die uitkomst er nooit uit, en
  // dan is dit de enige plek die nog weet of het ene toegestane verzoek
  // daadwerkelijk is verbruikt. Dat is precies wat het rapport moet vertellen.
  // De teller loopt VÓÓR de aanroep op, niet erna. Dat is bewust conservatief:
  // of het verzoek de host heeft bereikt, kunnen wij niet zien, en bij twijfel
  // gaan wij ervan uit dat het quotum is verbruikt. Een te hoge telling kost
  // een ronde wachten; een te lage laat iemand een tweede call doen die er niet
  // meer was.
  let pogingen = 0;
  const tellendeFetch = ((invoer: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    pogingen++;
    return deps.retrievalFetch(invoer, init);
  }) as typeof fetch;

  const afgerond = {
    ...basis,
    akkoordGevraagd: true,
    akkoordGegeven: true,
    scans,
    poort,
  } as const;

  let retrieval;
  try {
    retrieval = await meet(profiel, {
      accessToken: aanmelding.accessToken,
      signal: deps.signal,
      fetchImpl: tellendeFetch,
    });
  } catch (fout) {
    // EEN AFBREKING IS GEEN AFWIJZING. Maar het moment waarop zij valt, maakt
    // wél verschil — en dat onderscheid is de hele reden dat deze tak bestaat.
    //
    //   pogingen === 0  → het verzoek is nooit vertrokken. Er is geen quotum
    //                     verbruikt en niets te rapporteren; de run stopt, zoals
    //                     altijd bij een annulering of een verlopen deadline.
    //   pogingen >= 1   → het verzoek IS de deur uit. Of Microsoft het nog heeft
    //                     verwerkt weten wij niet, en dat is precies het punt:
    //                     het ene toegestane verzoek kan op zijn. Dan moet de
    //                     uitkomst vast, ook al is er niets gemeten.
    //
    // Dit krijgt bewust een EIGEN eindstand en niet `retrieval_afgewezen`: de
    // provider heeft niets geweigerd. Wie die twee samenvoegt, leest later een
    // afgebroken run als een toegangsprobleem en gaat entitlements uitzoeken die
    // niets mankeren.
    if (isAfbreking(fout)) {
      if (pogingen === 0) throw fout;
      // De reden is een vaste enum uit onze eigen afbrekingslaag — geen
      // providertekst, geen boodschap, geen stack.
      const reden = redenVan(fout) ?? "annulering";
      meld(`Retrieval afgebroken (${reden}) ná het vertrek van het verzoek — de uitkomst wordt vastgelegd.`);
      return {
        exitcode: EXIT.retrievalAfgebroken,
        rapport: {
          ...afgerond,
          graphCalls: client.pogingen(),
          retrieval: null,
          retrievalAfbreking: reden,
          retrievalPogingen: pogingen,
          eindstand: "retrieval_afgebroken",
        },
      };
    }
    if (!(fout instanceof CopilotFout)) throw fout;

    // Hier zat het gat. Zonder deze tak gooide een fail-closed afwijzing de hele
    // run omver en schreef de runner GEEN rapport — terwijl juist die uitkomst
    // het duurste bewijs van de hele keten is: het ene toegestane verzoek is
    // dan verbruikt en er is niets vastgelegd. `CopilotFout` draagt per
    // constructie alleen een vaste code en een HTTP-status, dus dit kan zonder
    // provider- of documentinhoud in het rapport.
    meld(`Retrieval afgewezen (${fout.code}) — de uitkomst wordt vastgelegd.`);
    return {
      exitcode: EXIT.retrievalAfgewezen,
      rapport: {
        ...afgerond,
        graphCalls: client.pogingen(),
        retrieval: null,
        retrievalFout: { code: fout.code, categorie: fout.categorie, httpStatus: fout.httpStatus },
        retrievalPogingen: pogingen,
        eindstand: "retrieval_afgewezen",
      },
    };
  }

  return {
    exitcode: EXIT.klaar,
    rapport: {
      ...afgerond,
      graphCalls: client.pogingen(),
      retrieval,
      retrievalPogingen: pogingen,
      eindstand: "gemeten",
    },
  };
}
