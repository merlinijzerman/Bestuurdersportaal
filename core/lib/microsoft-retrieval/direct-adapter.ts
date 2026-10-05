// ============================================================================
// #462 PR-3 — gericht SharePoint-document als AI-context, zonder Copilot.
// ----------------------------------------------------------------------------
// Een lokale UUID-ref is alleen een locator. Deze adapter bevestigt per beurt:
// bron + tenant + drive + root, het actuele item, delegated toegang, versie
// vóór en ná download, de root en bronregistratie ná extractie. Pas daarna
// ontstaan maximaal acht passages voor de providerneutrale toelatingspoort.
// Bytes en extracten blijven request-lokaal en worden nooit opgeslagen.
// ============================================================================
import { maakChunksUitSegmenten, type ChunkMetLocatie } from "../chunking";
import { extractTekst, type ExtractieResultaat } from "../document-extractie";
import type {
  ActueleVersiestand,
  AdapterCapabilities,
  AdapterUitkomst,
  Bronregistratiestand,
  Bronresultaat,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "../retrieval/contract";
import {
  maakDocumentIdentiteit,
  maakPassageIdentiteit,
  maakVolledigeVersieHash,
} from "../retrieval/identiteit";
import type { GraphDriveItem } from "../microsoft-sharepoint-graph-core";
import { veiligeSharePointUrl } from "../microsoft-sharepoint-graph-core";
import {
  downloadItem,
  MAX_DOWNLOAD_BYTES,
  type DownloadOpdracht,
  type DownloadResultaat,
} from "./download";
import {
  bevestigKandidaatItem,
  bevestigVersieOngewijzigd,
  leesRoot,
  type BronSnapshot,
  type ItemLezer,
  type Versiebewijs,
} from "./driveitem";
import { extractieType } from "./keten";
import { canoniekeWebUrl, type GeregistreerdDocument } from "./mapping";

export const MAX_DIRECTE_PASSAGES_PER_DOCUMENT = 8;
export const MAX_DIRECTE_EXTRACTIE_TEKENS = 2_000_000;
export const MAX_DIRECTE_TOTAAL_BYTES = 60 * 1024 * 1024;
export const MAX_DIRECTE_TOTAAL_TEKENS = 4_000_000;

export const DIRECTE_SHAREPOINT_CAPABILITIES: AdapterCapabilities = {
  bronsoorten: ["sharepoint"],
  strategieen: ["gericht"],
  ondersteundeFilters: [],
  versiebewijs: true,
  versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] },
  permissionProof: true,
  preview: false,
  cancellation: true,
  timeout: true,
};

export interface DirectSharePointDocument {
  document: GeregistreerdDocument;
}

export interface DirectSharePointAdapterDeps {
  bron: BronSnapshot;
  tokenTenantId: string;
  accessToken: string;
  documenten: DirectSharePointDocument[];
  leesItem: ItemLezer;
  herleesBron: () => Promise<BronSnapshot | undefined>;
  /** Beurtbrede grenzen; PR-4 gebruikt ze voor maximaal zes mapdocumenten. */
  maxTotaalBytes?: number;
  maxTotaalTekens?: number;
  /** Alleen voor een expliciete mapselectie: een na hercontrole tekstloze PDF
   * overslaan en de gedeeltelijke dekking request-lokaal tellen. */
  onPdfZonderTekstlaag?: () => void;
  downloadImpl?: (opdracht: DownloadOpdracht) => Promise<DownloadResultaat>;
  extractImpl?: (
    bytes: Buffer,
    type: NonNullable<ReturnType<typeof extractieType>>,
    signal?: AbortSignal
  ) => Promise<ExtractieResultaat>;
}

interface PassageStand {
  document: GeregistreerdDocument;
  canoniekeUrl: string;
  documentIdentiteit: string;
  passageIdentiteit: string;
  versie: { soort: "etag" | "ctag"; waarde: string };
}

function normaliseer(waarde: string): string {
  return waarde
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLocaleLowerCase("nl-NL");
}

function woorden(waarde: string): string[] {
  return [...new Set(normaliseer(waarde).match(/[a-z0-9]{2,}/g) ?? [])];
}

/** Pure, deterministische rangschikking; stabiele documentvolgorde bij gelijke score. */
export function rangschikDirectePassages(
  chunks: ChunkMetLocatie[],
  vraag: string,
  maximum = MAX_DIRECTE_PASSAGES_PER_DOCUMENT
): Array<ChunkMetLocatie & { oorspronkelijkeIndex: number; score: number }> {
  const termen = woorden(vraag);
  return chunks
    .map((chunk, oorspronkelijkeIndex) => {
      const tekst = normaliseer(chunk.tekst);
      const score = termen.reduce(
        (som, term) => som + (tekst.includes(term) ? 1 : 0),
        0
      );
      return { ...chunk, oorspronkelijkeIndex, score };
    })
    .sort((a, b) => b.score - a.score || a.oorspronkelijkeIndex - b.oorspronkelijkeIndex)
    .slice(0, Math.max(0, Math.min(MAX_DIRECTE_PASSAGES_PER_DOCUMENT, maximum)));
}

function bronOngewijzigd(a: BronSnapshot, b: BronSnapshot): boolean {
  return (
    b.status === "actief" &&
    a.id === b.id &&
    a.tenantId === b.tenantId &&
    a.siteHostnaam === b.siteHostnaam &&
    a.driveId === b.driveId &&
    a.rootItemId === b.rootItemId &&
    a.configuratieversie === b.configuratieversie
  );
}

function opaqueVersie(document: GeregistreerdDocument, versie: Versiebewijs) {
  return {
    soort: versie.soort,
    waarde: maakVolledigeVersieHash(
      document.ref,
      versie.soort,
      versie.waarde
    ),
  } as const;
}

function foutUitkomst(
  t0: number,
  fout: NonNullable<AdapterUitkomst["fout"]>
): AdapterUitkomst {
  return {
    kandidaten: [],
    methode: "geen",
    provider: "microsoft",
    latencyMs: Date.now() - t0,
    opgehaald: 0,
    fout,
  };
}

export function maakDirecteSharePointAdapter(
  deps: DirectSharePointAdapterDeps
): RetrievalAdapter {
  const passageStand = new Map<string, PassageStand>();

  return {
    naam: "microsoft-sharepoint",
    capabilities: () => DIRECTE_SHAREPOINT_CAPABILITIES,

    async zoek(ctx: RetrievalContext, query: RetrievalQuery): Promise<AdapterUitkomst> {
      const t0 = Date.now();
      const gebruikerId = ctx.actor.soort === "gebruiker" ? ctx.actor.id : "";
      if (!gebruikerId || !ctx.resterendMs || ctx.resterendMs() <= 0) {
        return foutUitkomst(t0, ctx.resterendMs ? "timeout" : "configuratiefout");
      }
      if (query.filters || query.strategie !== "gericht") {
        return foutUitkomst(t0, "configuratiefout");
      }

      const root = await leesRoot(deps.bron, deps.leesItem, ctx.signal);
      if (!root.ok) return foutUitkomst(t0, "toestemming_geweigerd");

      const kandidaten: Bronresultaat[] = [];
      let gelezenDocumenten = 0;
      let totaalBytes = 0;
      let totaalExtractieTekens = 0;
      let budgetAfgekapt = false;
      let pdfZonderTekstlaag = 0;
      for (const { document } of deps.documenten) {
        if (ctx.resterendMs() <= 0) return foutUitkomst(t0, "timeout");
        const type = extractieType(document.bestandstype);
        if (!type) return foutUitkomst(t0, "configuratiefout");

        // Directe refs hebben geen externe hit-URL. Lees daarom de actuele URL
        // eerst zelf en bind de daaropvolgende bevestiging exact aan die waarde.
        const aanwijzer: GraphDriveItem = await deps.leesItem(document.itemId, ctx.signal);
        const canoniek = canoniekeWebUrl(aanwijzer.webUrl);
        if (!canoniek) return foutUitkomst(t0, "toestemming_geweigerd");

        const bevestigd = await bevestigKandidaatItem(
          {
            bron: deps.bron,
            tokenTenantId: deps.tokenTenantId,
            document,
            hitCanoniek: canoniek,
            rootGraphPad: root.rootGraphPad,
            signal: ctx.signal,
          },
          deps.leesItem
        );
        if (!bevestigd.ok) return foutUitkomst(t0, "toestemming_geweigerd");

        const doeDownload = deps.downloadImpl ?? downloadItem;
        const byteBudget = Math.max(
          0,
          Math.min(
            MAX_DOWNLOAD_BYTES,
            (deps.maxTotaalBytes ?? MAX_DIRECTE_TOTAAL_BYTES) - totaalBytes
          )
        );
        if (byteBudget <= 0) {
          budgetAfgekapt = true;
          break;
        }
        const download = await doeDownload({
          accessToken: deps.accessToken,
          driveId: deps.bron.driveId,
          itemId: document.itemId,
          siteHostnaam: deps.bron.siteHostnaam,
          signal: ctx.signal,
          maxBytes: byteBudget,
        });
        if (!download.ok) {
          if (byteBudget < MAX_DOWNLOAD_BYTES && gelezenDocumenten > 0) {
            budgetAfgekapt = true;
            break;
          }
          return foutUitkomst(t0, "toestemming_geweigerd");
        }
        totaalBytes += download.bytes.byteLength;

        const doeExtractie = deps.extractImpl ?? ((bytes, bestandstype) =>
          extractTekst(bytes, bestandstype));
        const extractie = await doeExtractie(download.bytes, type, ctx.signal);
        const documentTekens = extractie.segmenten.reduce(
          (som, segment) => som + segment.tekst.length,
          0
        );
        if (documentTekens > MAX_DIRECTE_EXTRACTIE_TEKENS) {
          return foutUitkomst(t0, "configuratiefout");
        }
        if (
          totaalExtractieTekens + documentTekens >
          (deps.maxTotaalTekens ?? MAX_DIRECTE_TOTAAL_TEKENS)
        ) {
          if (gelezenDocumenten > 0) {
            budgetAfgekapt = true;
            break;
          }
          return foutUitkomst(t0, "configuratiefout");
        }
        totaalExtractieTekens += documentTekens;

        const onveranderd = await bevestigVersieOngewijzigd(
          {
            bron: deps.bron,
            document,
            hitCanoniek: canoniek,
            rootGraphPad: root.rootGraphPad,
            versieVoor: bevestigd.versie,
            signal: ctx.signal,
          },
          deps.leesItem
        );
        if (!onveranderd.ok) return foutUitkomst(t0, "toestemming_geweigerd");

        // Laatste externe grondslagcontrole vóór uitsluitend lokaal projectiewerk.
        const [rootNu, bronNu] = await Promise.all([
          leesRoot(deps.bron, deps.leesItem, ctx.signal),
          deps.herleesBron(),
        ]);
        if (
          !rootNu.ok ||
          rootNu.rootWebUrl !== root.rootWebUrl ||
          rootNu.rootGraphPad !== root.rootGraphPad ||
          !bronNu ||
          !bronOngewijzigd(deps.bron, bronNu)
        ) {
          return foutUitkomst(t0, "toestemming_geweigerd");
        }
        // Een echte PDF-scan kan na een geslaagde download nul tekst opleveren.
        // Alleen een MAP mag na alle rechten-, root- en versiecontroles met de
        // overige documenten doorgaan. Bij een los gekozen document, een ander
        // bestandstype of een beveiligingsfout blijft de beurt fail-closed.
        if (documentTekens === 0) {
          if (type !== "pdf" || !deps.onPdfZonderTekstlaag) {
            return foutUitkomst(t0, "configuratiefout");
          }
          pdfZonderTekstlaag += 1;
          deps.onPdfZonderTekstlaag();
          continue;
        }
        const gecontroleerdOp = new Date().toISOString();
        const documentIdentiteit = maakDocumentIdentiteit(
          `fonds:${ctx.fondsId}:sharepoint`,
          document.ref
        );
        const versie = opaqueVersie(document, bevestigd.versie);
        const passages = rangschikDirectePassages(
          maakChunksUitSegmenten(extractie.segmenten),
          query.zoekvraag,
          Math.min(query.maxKandidaten, MAX_DIRECTE_PASSAGES_PER_DOCUMENT)
        );
        if (passages.length === 0) return foutUitkomst(t0, "configuratiefout");

        passages.forEach((passage, positie) => {
          const passageIdentiteit = maakPassageIdentiteit(
            documentIdentiteit,
            `chunk:${passage.oorspronkelijkeIndex}|pagina:${passage.pagina ?? "-"}|paragraaf:${passage.paragraaf ?? "-"}`
          );
          const resultaat: Bronresultaat = {
            ref: passageIdentiteit,
            bronsoort: "sharepoint",
            titel: bevestigd.naam,
            documentIdentiteit: {
              id: documentIdentiteit,
              bibliotheek: "sharepoint",
              bron: "SharePoint",
              fondsId: ctx.fondsId,
            },
            passageIdentiteit: { id: passageIdentiteit },
            versie: {
              ...versie,
              gecontroleerdOp,
            },
            bronregistratieRef: bronNu.id,
            toegangscontrole: {
              toegestaan: true,
              resultaatRef: passageIdentiteit,
              bronregistratieRef: bronNu.id,
              gebruikerId,
              correlationId: ctx.correlationId,
              gecontroleerdOp,
              basis: "delegated_user",
              bronconfiguratieVersie: bronNu.configuratieversie,
            },
            locator: {
              pagina: passage.pagina,
              paragraaf: passage.paragraaf,
              mappad: document.mappad,
            },
            passage: passage.tekst,
            status: { bronstatus: "actief", actueel: true },
            rang: { positie, score: passage.score },
            weergave: {
              bestandstype: type,
              opslagPad: document.mappad || "/",
              externUrl: veiligeSharePointUrl(aanwijzer.webUrl),
            },
          };
          passageStand.set(passageIdentiteit, {
            document,
            canoniekeUrl: canoniek,
            documentIdentiteit,
            passageIdentiteit,
            versie,
          });
          kandidaten.push(resultaat);
        });
        gelezenDocumenten += 1;
      }

      return {
        kandidaten,
        methode: "sharepoint_live",
        provider: "microsoft",
        latencyMs: Date.now() - t0,
        opgehaald: gelezenDocumenten,
        ...(pdfZonderTekstlaag > 0 && kandidaten.length === 0
          ? { fout: "geen_resultaten" as const }
          : {}),
        ...(budgetAfgekapt ? { truncatie: { reden: "kandidaten" as const } } : {}),
      };
    },

    async verifieerVersies(ctx, refs): Promise<Map<string, ActueleVersiestand>> {
      const uitkomst = new Map<string, ActueleVersiestand>();
      const root = await leesRoot(deps.bron, deps.leesItem, ctx.signal);
      if (!root.ok) return new Map(refs.map((ref) => [ref, { beschikbaar: false, versie: { soort: "onbekend", waarde: null } }]));

      for (const ref of refs) {
        const stand = passageStand.get(ref);
        if (!stand) {
          uitkomst.set(ref, { beschikbaar: false, versie: { soort: "onbekend", waarde: null } });
          continue;
        }
        const bevestigd = await bevestigKandidaatItem(
          {
            bron: deps.bron,
            tokenTenantId: deps.tokenTenantId,
            document: stand.document,
            hitCanoniek: stand.canoniekeUrl,
            rootGraphPad: root.rootGraphPad,
            signal: ctx.signal,
          },
          deps.leesItem
        );
        const actueel = bevestigd.ok
          ? opaqueVersie(stand.document, bevestigd.versie)
          : null;
        uitkomst.set(
          ref,
          actueel
            ? {
                beschikbaar: true,
                documentIdentiteit: stand.documentIdentiteit,
                passageIdentiteit: stand.passageIdentiteit,
                versie: actueel,
              }
            : { beschikbaar: false, versie: { soort: "onbekend", waarde: null } }
        );
      }
      return uitkomst;
    },

    async verifieerBronregistratie(_ctx, refs): Promise<Map<string, Bronregistratiestand>> {
      const nu = await deps.herleesBron();
      const stand: Bronregistratiestand =
        nu && bronOngewijzigd(deps.bron, nu)
          ? { verbonden: true, versie: nu.configuratieversie }
          : { verbonden: false, versie: -1 };
      return new Map(refs.map((ref) => [ref, stand]));
    },
  };
}
