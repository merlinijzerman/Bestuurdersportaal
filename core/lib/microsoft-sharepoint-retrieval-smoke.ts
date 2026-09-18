import "server-only";

import { sharepointAccessToken, sharepointSearchAccessToken } from "@/core/lib/microsoft-connector";
import { sharepointDocumenten } from "@/core/lib/microsoft-sharepoint";
import {
  SHAREPOINT_RETRIEVAL_FIXTURE_CODES,
  SHAREPOINT_RETRIEVAL_SMOKE_WACHT_MS,
  borgIntrekkingsUitkomst,
  fixtureCodeUitBestandsnaam,
  projecteerAuditAfwijzingen,
  sharePointRetrievalFixtureStatus,
  sharePointRetrievalSmokeVraag,
  type SharePointRetrievalSmokeEvent,
  type SharePointRetrievalSmokeRoute,
  type SharePointRetrievalSmokeScenario,
  type SharePointRetrievalSearchScope,
  type SharePointRetrievalVeiligeMeting,
} from "@/core/lib/microsoft-sharepoint-retrieval-smoke-core";
import * as vault from "@/core/lib/microsoft-vault";
import {
  maakVeiligeMeetrij,
  voerSharePointPermissionProbeUit,
  voerSharePointRetrievalSpikeUit,
  standaardWacht,
} from "../../scripts/spike/sharepoint-retrieval/prototype";
import type {
  SpikeBronSnapshot,
  SpikeDocumentMapping,
  SpikeFase,
} from "../../scripts/spike/sharepoint-retrieval/types";

type SmokeContext = {
  fondsId: string;
  gebruikerId: string;
  correlationId: string;
  signal: AbortSignal;
};

type SmokeOpdracht = {
  scenario: SharePointRetrievalSmokeScenario;
  route: SharePointRetrievalSmokeRoute;
  ronde: number;
  searchScope?: SharePointRetrievalSearchScope;
};

type StuurEvent = (event: SharePointRetrievalSmokeEvent) => void;

function bestandstype(waarde: string | null): SpikeDocumentMapping["bestandstype"] {
  if (waarde === "docx" || waarde === "pdf" || waarde === "pptx") return waarde;
  return "anders";
}

async function wachtMetHartslag(signal: AbortSignal, stuur: StuurEvent): Promise<void> {
  const stap = 15_000;
  let resterend = SHAREPOINT_RETRIEVAL_SMOKE_WACHT_MS;
  stuur({ type: "wacht_op_intrekking", wachtSeconden: Math.ceil(resterend / 1_000) });
  while (resterend > 0) {
    const nu = Math.min(stap, resterend);
    await standaardWacht(nu, signal);
    resterend -= nu;
    if (resterend > 0) stuur({ type: "wachtend", resterendSeconden: Math.ceil(resterend / 1_000) });
  }
}

async function bouwBronlezer(args: {
  ctx: SmokeContext;
  scenario: SharePointRetrievalSmokeScenario;
}): Promise<() => Promise<SpikeBronSnapshot>> {
  // De bestaande listing doet een actuele Graph-enumeratie en schrijft uitsluitend
  // lokale refs naar de private vault. Alleen vaste fixturecodes worden gemapt.
  const lijst = await sharepointDocumenten({
    fondsId: args.ctx.fondsId,
    gebruikerId: args.ctx.gebruikerId,
    correlationId: args.ctx.correlationId,
  });
  const refs = new Map<string, string>();
  for (const document of lijst.documenten) {
    const code = fixtureCodeUitBestandsnaam(document.naam);
    if (!code) continue;
    if (refs.has(code)) throw new Error("dubbele_fixture");
    refs.set(code, document.ref);
  }

  const vraag = sharePointRetrievalSmokeVraag(args.scenario);
  for (const code of vraag.benodigdeFixtures) {
    if (!refs.has(code)) throw new Error("fixture_niet_bereikbaar");
  }

  return async () => {
    const [bron, verbinding] = await Promise.all([
      vault.leesSharePointBron(args.ctx.fondsId),
      vault.leesVerbinding(args.ctx.fondsId, args.ctx.gebruikerId),
    ]);
    // De bron is fondsbreed. `bron.gebruiker_id` legt vast wie de configuratie
    // heeft gekozen, maar is geen autorisatievoorwaarde voor latere lezers. De
    // smoke draait als beheerder met diens eigen gedelegeerde token en bindt die
    // identiteit hieronder wel aan dezelfde tenant als de actuele fondsbron.
    if (!bron || bron.status !== "actief") throw new Error("bron_niet_actief");
    if (!verbinding
      || verbinding.status !== "gekoppeld"
      || !verbinding.scopes.includes("Sites.Selected")
      || verbinding.tenant_id !== bron.tenant_id
      || !verbinding.microsoft_object_id) {
      throw new Error("verbinding_niet_actief");
    }

    const documenten: SpikeDocumentMapping[] = [];
    for (const code of SHAREPOINT_RETRIEVAL_FIXTURE_CODES) {
      const ref = refs.get(code);
      if (!ref) continue;
      const document = await vault.leesSharePointDocument(args.ctx.fondsId, ref);
      const fixtureStatus = sharePointRetrievalFixtureStatus(code);
      if (!document
        || !fixtureStatus
        || document.bron_id !== bron.id
        || document.drive_id !== bron.drive_id
        || document.root_item_id !== bron.root_item_id
        || document.site_hostnaam !== bron.site_hostnaam
        || document.configuratieversie !== bron.configuratieversie
        || document.status !== "gezien"
        || document.bron_status !== "actief") throw new Error("documentbinding_gewijzigd");
      documenten.push({
        fixtureCode: code,
        ref: document.id,
        itemId: document.item_id,
        titel: document.naam,
        bestandstype: bestandstype(document.bestandstype),
        fixtureStatus,
        geregistreerdMappad: document.mappad,
      });
    }

    return {
      fondsId: args.ctx.fondsId,
      actorId: args.ctx.gebruikerId,
      microsoftActorObjectId: verbinding.microsoft_object_id,
      tenantId: bron.tenant_id,
      bronId: bron.id,
      status: bron.status,
      configuratieversie: bron.configuratieversie,
      siteId: bron.site_id,
      siteHostnaam: bron.site_hostnaam,
      driveId: bron.drive_id,
      driveNaam: bron.drive_weergavenaam,
      rootItemId: bron.root_item_id,
      documenten,
    };
  };
}

async function audit(ctx: SmokeContext, meting: SharePointRetrievalVeiligeMeting): Promise<void> {
  await vault.registreerSharePointGebeurtenis({
    fondsId: ctx.fondsId,
    gebruikerId: ctx.gebruikerId,
    gebeurtenis: meting.resultaat === "geslaagd"
      ? "microsoft.sharepoint.retrieval_spike.geslaagd"
      : "microsoft.sharepoint.retrieval_spike.mislukt",
    correlationId: ctx.correlationId,
    foutcategorie: meting.foutcategorie,
    details: {
      ronde: meting.ronde,
      vraagcode: meting.vraagcode,
      route: meting.route,
      search_scope: meting.searchScope ?? "niet_van_toepassing",
      resultaat: meting.resultaat,
      kandidaten: meting.gevondenFixtures.length,
      kandidaten_voor_verificatie: meting.kandidatenVoorVerificatie,
      latency_ms: meting.latencyMs,
      microsoft_calls: meting.microsoftCalls,
      downloads: meting.downloads,
      response_bytes: meting.responseBytes,
      content_bytes: meting.contentBytes,
      throttles: meting.throttles,
      retries: meting.retries,
      ...projecteerAuditAfwijzingen(meting),
    },
  });
}

/**
 * Voert precies één vaste Preview-meting uit. Alleen de veilige meetprojectie
 * verlaat deze module; tokens, Graph-id's, paden, passages en downloadinhoud niet.
 */
export async function voerSharePointRetrievalPreviewSmokeUit(
  ctx: SmokeContext,
  opdracht: SmokeOpdracht,
  stuur: StuurEvent,
): Promise<SharePointRetrievalVeiligeMeting> {
  const vraag = sharePointRetrievalSmokeVraag(opdracht.scenario);
  const leesBron = await bouwBronlezer({ ctx, scenario: opdracht.scenario });
  const delegatedToken = async () => {
    const token = await (opdracht.route === "drive_search_extract"
      ? sharepointAccessToken({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId })
      : sharepointSearchAccessToken({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId }));
    return { accessToken: token.accessToken, tenantId: token.tenantId, actorObjectId: token.objectId };
  };

  if (opdracht.scenario === "S00") {
    const uitkomst = await voerSharePointPermissionProbeUit({ leesBron, delegatedToken }, {
      signal: ctx.signal,
      timeoutMs: 15_000,
    });
    const meting: SharePointRetrievalVeiligeMeting = {
      ronde: opdracht.ronde,
      vraagcode: "S00",
      route: "drive_search_extract",
      searchScope: null,
      resultaat: uitkomst.status === "toegestaan" ? "geslaagd" : "mislukt",
      foutcategorie: uitkomst.status === "toegestaan" ? null : uitkomst.status,
      foutcode: uitkomst.foutcode,
      gevondenFixtures: [],
      exacteBronset: true,
      recall: 0,
      precision: 0,
      mrr: 0,
      ndcg: 0,
      locatorDekking: 0,
      versieDekking: 0,
      previewDekking: 0,
      latencyMs: uitkomst.latencyMs,
      microsoftCalls: uitkomst.microsoftCalls,
      downloads: 0,
      kandidatenVoorVerificatie: 0,
      responseBytes: 0,
      contentBytes: 0,
      throttles: 0,
      retries: 0,
      versieVingerafdrukken: [],
      afwijzingMapping: 0,
      afwijzingBinding: 0,
      afwijzingRoot: 0,
      afwijzingRechtenConfiguratie: 0,
      afwijzingVersie: 0,
      afwijzingExtractie: 0,
      afwijzingPreview: 0,
      afwijzingActualiteit: 0,
    };
    await audit(ctx, meting);
    return meting;
  }
  let gepauzeerd = false;
  const onFase = vraag.pauzeVoorLaatsteControle
    ? async (fase: SpikeFase, document?: SpikeDocumentMapping) => {
      if (gepauzeerd || fase !== "voor_laatste_rechtencheck" || document?.fixtureCode !== "PGB354-DOC-005") return;
      gepauzeerd = true;
      await wachtMetHartslag(ctx.signal, stuur);
    }
    : undefined;

  const uitkomst = await voerSharePointRetrievalSpikeUit({
    leesBron,
    delegatedToken,
    onFase,
  }, {
    route: opdracht.route,
    microsoftSearchScope: opdracht.searchScope,
    correlationId: ctx.correlationId,
    vraag,
    signal: ctx.signal,
    timeoutMs: vraag.pauzeVoorLaatsteControle ? 180_000 : 20_000,
    concurrency: 3,
  });
  const meting = borgIntrekkingsUitkomst(
    opdracht.scenario,
    maakVeiligeMeetrij(opdracht.ronde, vraag, uitkomst),
  );
  await audit(ctx, meting);
  return meting;
}
