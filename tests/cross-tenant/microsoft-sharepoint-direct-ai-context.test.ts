import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { extractTekstUitPdf } from "../../core/lib/document-extractie";
import {
  maakDirecteSharePointAdapter,
  rangschikDirectePassages,
} from "../../core/lib/microsoft-retrieval/direct-adapter";
import { voerVolledigeRetrievalUit } from "../../core/lib/retrieval/orkestratie";
import {
  maakDocumentIdentiteit,
} from "../../core/lib/retrieval/identiteit";
import type { BronSnapshot } from "../../core/lib/microsoft-retrieval/driveitem";
import type { GeregistreerdDocument } from "../../core/lib/microsoft-retrieval/mapping";
import type { GraphDriveItem } from "../../core/lib/microsoft-sharepoint-graph-core";

const FONDS = "11111111-1111-4111-8111-111111111111";
const GEBRUIKER = "22222222-2222-4222-8222-222222222222";
const HOST = "voorbeeld.sharepoint.com";
const DRIVE = "drive-1";
const ROOT_PAD = `/drives/${DRIVE}/root:/PGB`;
const WEB_URL = `https://${HOST}/sites/lab/Gedeelde%20documenten/PGB/beleid.docx`;

test("de synthetische PGB354-PDF-003-scan levert daadwerkelijk nul tekstsegmenten", async () => {
  const pad = resolve(
    import.meta.dirname,
    "../e2e/fixtures/pgb-sharepoint/bibliotheek/99 Mutatie- en intrekkingstests/PGB354-PDF-003-Scan-zonder-tekstlaag.pdf"
  );
  const extractie = await extractTekstUitPdf(readFileSync(pad));
  assert.equal(extractie.aantalPaginas, 1);
  assert.deepEqual(extractie.segmenten, []);
});

const BRON: BronSnapshot = {
  id: "33333333-3333-4333-8333-333333333333",
  tenantId: "tenant-1",
  siteHostnaam: HOST,
  driveId: DRIVE,
  rootItemId: "root-1",
  configuratieversie: 7,
  status: "actief",
};

const DOCUMENT: GeregistreerdDocument = {
  ref: "44444444-4444-4444-8444-444444444444",
  bronId: BRON.id,
  driveId: DRIVE,
  itemId: "item-1",
  rootItemId: BRON.rootItemId,
  naam: "beleid.docx",
  bestandstype: "docx",
  mappad: "02 Beleid",
  status: "gezien",
  bronStatus: "actief",
  siteHostnaam: HOST,
  configuratieversie: BRON.configuratieversie,
};

function root(): GraphDriveItem {
  return {
    id: BRON.rootItemId,
    name: "PGB",
    webUrl: `https://${HOST}/sites/lab/Gedeelde%20documenten/PGB`,
    folder: { childCount: 1 },
    parentReference: {
      driveId: DRIVE,
      id: "drive-root",
      path: `/drives/${DRIVE}/root:`,
    },
  };
}

function item(etag = 'W/"versie-1"'): GraphDriveItem {
  return {
    id: DOCUMENT.itemId,
    name: DOCUMENT.naam,
    webUrl: WEB_URL,
    eTag: etag,
    file: {
      mimeType:
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    },
    parentReference: {
      driveId: DRIVE,
      id: BRON.rootItemId,
      path: ROOT_PAD,
    },
  };
}

test("rangschikking is accentloos, deterministisch en begrensd op acht", () => {
  const chunks = Array.from({ length: 12 }, (_, index) => ({
    tekst:
      index === 9
        ? "De financiële zandloper staat in dit beleidskader."
        : `Algemene passage nummer ${index} met voldoende testinhoud voor selectie.`,
    pagina: index + 1,
    paragraaf: null,
  }));
  const uit = rangschikDirectePassages(chunks, "FINANCIELE zandloper", 20);
  assert.equal(uit.length, 8);
  assert.equal(uit[0].oorspronkelijkeIndex, 9);
  assert.deepEqual(
    uit.slice(1).map((x) => x.oorspronkelijkeIndex),
    [0, 1, 2, 3, 4, 5, 6]
  );
});

test("direct document doorloopt download, versieherlezing en centrale V1-V5-poort", async () => {
  let huidigeBron = { ...BRON };
  const adapter = maakDirecteSharePointAdapter({
    bron: BRON,
    tokenTenantId: "tenant-1",
    accessToken: "test-token",
    documenten: [{ document: DOCUMENT }],
    leesItem: async (id) => (id === BRON.rootItemId ? root() : item()),
    herleesBron: async () => huidigeBron,
    downloadImpl: async () => ({ ok: true, bytes: Buffer.from("fixture") }),
    extractImpl: async () => ({
      tekst: "",
      aantalPaginas: 10,
      segmenten: Array.from({ length: 10 }, (_, index) => ({
        pagina: index + 1,
        paragraaf: null,
        tekst:
          index === 7
            ? "Zandloperbaken twaalf is de unieke beleidsmarker in dit document."
            : `Bestuurlijke context op pagina ${index + 1} met voldoende woorden voor een bruikbare passage.`,
      })),
    }),
  });
  const documentIdentiteit = maakDocumentIdentiteit(
    `fonds:${FONDS}:sharepoint`,
    DOCUMENT.ref
  );
  const uit = await voerVolledigeRetrievalUit(
    {
      fondsId: FONDS,
      actor: { soort: "gebruiker", id: GEBRUIKER },
      taaktype: "chat_generatie",
      bronbeleid: { bronsoorten: ["sharepoint"] },
      correlationId: "corr-direct",
      verzoekStartOp: new Date(Date.now() - 1_000).toISOString(),
    },
    {
      adapter,
      timeoutMs: 5_000,
      sporen: [
        {
          adapter,
          bijBronfout: "stop",
          query: {
            naam: "primair",
            documentScope: [documentIdentiteit],
            origineleVraag: "Wat is Zandloperbaken twaalf?",
            zoekvraag: "Zandloperbaken twaalf",
            strategie: "gericht",
            maxResultaten: 8,
            maxKandidaten: 24,
            maxContextTekens: 40_000,
          },
          grenzen: {
            maxPerDoc: 8,
            representatieConstraints: false,
            regimeWeging: false,
            relevantieDrempel: false,
          },
        },
      ],
    },
    {
      primaireDocumentIds: new Set([documentIdentiteit]),
      peildatum: "2026-09-28",
      hoofddocumentLabel: " [hoofddocument]",
      sentinel: "TEST",
    }
  );

  assert.ok(uit.geselecteerd.length > 0);
  assert.ok(uit.geselecteerd.length <= 8);
  assert.equal(uit.geselecteerd[0].bronsoort, "sharepoint");
  assert.match(uit.contextTekst, /Zandloperbaken twaalf/);
  assert.equal(uit.bronverwijzingen[0].bibliotheek, "sharepoint");
  assert.match(uit.geselecteerd[0].versie.waarde ?? "", /^version_v1_[a-f0-9]{64}$/);

  // V5-herlezing is request-lokaal. Een gewijzigde registratie levert bij een
  // volgende beurt geen kandidaat op; er wordt nooit op de oude stand vertrouwd.
  huidigeBron = { ...BRON, configuratieversie: 8 };
  const tweede = await adapter.verifieerBronregistratie?.(
    {
      fondsId: FONDS,
      actor: { soort: "gebruiker", id: GEBRUIKER },
      taaktype: "chat_generatie",
      bronbeleid: { bronsoorten: ["sharepoint"] },
      correlationId: "corr-direct",
      verzoekStartOp: new Date().toISOString(),
    },
    [BRON.id]
  );
  assert.deepEqual(tweede?.get(BRON.id), { verbonden: false, versie: -1 });
});

test("een token uit een andere tenant wordt vóór download fail-closed geweigerd", async () => {
  let downloads = 0;
  const adapter = maakDirecteSharePointAdapter({
    bron: BRON,
    tokenTenantId: "andere-tenant",
    accessToken: "test-token",
    documenten: [{ document: DOCUMENT }],
    leesItem: async (id) => (id === BRON.rootItemId ? root() : item()),
    herleesBron: async () => BRON,
    downloadImpl: async () => {
      downloads += 1;
      return { ok: true, bytes: Buffer.from("mag niet worden gelezen") };
    },
    extractImpl: async () => ({ tekst: "", aantalPaginas: 0, segmenten: [] }),
  });
  const uit = await adapter.zoek(
    {
      fondsId: FONDS,
      actor: { soort: "gebruiker", id: GEBRUIKER },
      taaktype: "chat_generatie",
      bronbeleid: { bronsoorten: ["sharepoint"] },
      correlationId: "corr-tenant",
      verzoekStartOp: new Date().toISOString(),
      resterendMs: () => 5_000,
    },
    {
      naam: "primair",
      documentScope: [
        maakDocumentIdentiteit(`fonds:${FONDS}:sharepoint`, DOCUMENT.ref),
      ],
      origineleVraag: "vraag",
      zoekvraag: "vraag",
      strategie: "gericht",
      maxResultaten: 8,
      maxKandidaten: 8,
      maxContextTekens: 10_000,
    }
  );
  assert.equal(uit.fout, "toestemming_geweigerd");
  assert.equal(uit.kandidaten.length, 0);
  assert.equal(downloads, 0);
});

test("mapdocumenten delen één downloadbudget en worden zichtbaar afgekapt", async () => {
  const tweede: GeregistreerdDocument = {
    ...DOCUMENT,
    ref: "55555555-5555-4555-8555-555555555555",
    itemId: "item-2",
    naam: "uitvoering.docx",
  };
  let downloads = 0;
  const adapter = maakDirecteSharePointAdapter({
    bron: BRON,
    tokenTenantId: BRON.tenantId,
    accessToken: "test-token",
    documenten: [{ document: DOCUMENT }, { document: tweede }],
    maxTotaalBytes: 10,
    leesItem: async (id) => {
      if (id === BRON.rootItemId) return root();
      const document = id === tweede.itemId ? tweede : DOCUMENT;
      return {
        ...item(),
        id: document.itemId,
        name: document.naam,
        webUrl: `https://${HOST}/sites/lab/Gedeelde%20documenten/PGB/${document.naam}`,
      };
    },
    herleesBron: async () => BRON,
    downloadImpl: async ({ maxBytes }) => {
      downloads += 1;
      assert.equal(maxBytes, 10);
      return { ok: true, bytes: Buffer.alloc(10, 1) };
    },
    extractImpl: async () => ({
      tekst: "",
      aantalPaginas: 1,
      segmenten: [{
        pagina: 1,
        paragraaf: null,
        tekst: "Voldoende inhoud over het beleid en de uitvoering voor de test.",
      }],
    }),
  });
  const uit = await adapter.zoek(
    {
      fondsId: FONDS,
      actor: { soort: "gebruiker", id: GEBRUIKER },
      taaktype: "chat_generatie",
      bronbeleid: { bronsoorten: ["sharepoint"] },
      correlationId: "corr-budget",
      verzoekStartOp: new Date().toISOString(),
      resterendMs: () => 5_000,
    },
    {
      naam: "primair",
      documentScope: [
        maakDocumentIdentiteit(`fonds:${FONDS}:sharepoint`, DOCUMENT.ref),
        maakDocumentIdentiteit(`fonds:${FONDS}:sharepoint`, tweede.ref),
      ],
      origineleVraag: "Wat is het beleid?",
      zoekvraag: "beleid",
      strategie: "gericht",
      maxResultaten: 8,
      maxKandidaten: 24,
      maxContextTekens: 40_000,
    }
  );
  assert.equal(downloads, 1);
  assert.equal(uit.opgehaald, 1);
  assert.deepEqual(uit.truncatie, { reden: "kandidaten" });
  assert.ok(uit.kandidaten.length > 0);
});

test("een tekstloze PDF in een map laat andere documenten door en telt gedeeltelijke dekking", async () => {
  const scan: GeregistreerdDocument = {
    ...DOCUMENT,
    ref: "66666666-6666-4666-8666-666666666666",
    itemId: "scan-1",
    naam: "bijlage-scan.pdf",
    bestandstype: "pdf",
  };
  let herlezingen = 0;
  let overgeslagen = 0;
  const adapter = maakDirecteSharePointAdapter({
    bron: BRON,
    tokenTenantId: BRON.tenantId,
    accessToken: "test-token",
    documenten: [{ document: scan }, { document: DOCUMENT }],
    leesItem: async (id) => id === BRON.rootItemId ? root() : id === scan.itemId
      ? {
          ...item(),
          id: scan.itemId,
          name: scan.naam,
          webUrl: `https://${HOST}/sites/lab/Gedeelde%20documenten/PGB/${scan.naam}`,
          file: { mimeType: "application/pdf" },
        }
      : item(),
    herleesBron: async () => {
      herlezingen += 1;
      return BRON;
    },
    downloadImpl: async () => ({ ok: true, bytes: Buffer.from("fixture") }),
    extractImpl: async (_bytes, type) => type === "pdf"
      ? { tekst: "", aantalPaginas: 2, segmenten: [] }
      : {
          tekst: "Beleidsmarker Zandloperbaken twaalf staat in dit document.",
          aantalPaginas: 1,
          segmenten: [{ pagina: 1, paragraaf: null, tekst: "Beleidsmarker Zandloperbaken twaalf staat in dit document." }],
        },
    onPdfZonderTekstlaag: () => {
      assert.ok(herlezingen > 0, "de bron moet opnieuw zijn gecontroleerd vóór overslaan");
      overgeslagen += 1;
    },
  });
  const uit = await adapter.zoek(
    {
      fondsId: FONDS,
      actor: { soort: "gebruiker", id: GEBRUIKER },
      taaktype: "chat_generatie",
      bronbeleid: { bronsoorten: ["sharepoint"] },
      correlationId: "corr-tekstloze-scan",
      verzoekStartOp: new Date().toISOString(),
      resterendMs: () => 5_000,
    },
    {
      naam: "primair",
      documentScope: [scan, DOCUMENT].map((document) =>
        maakDocumentIdentiteit(`fonds:${FONDS}:sharepoint`, document.ref)
      ),
      origineleVraag: "Waar staat Zandloperbaken twaalf?",
      zoekvraag: "Zandloperbaken twaalf",
      strategie: "gericht",
      maxResultaten: 8,
      maxKandidaten: 24,
      maxContextTekens: 40_000,
    }
  );
  assert.equal(uit.fout, undefined);
  assert.equal(uit.opgehaald, 1);
  assert.equal(overgeslagen, 1);
  assert.ok(uit.kandidaten.length > 0);
  assert.ok(uit.kandidaten.every((k) => k.documentIdentiteit.id ===
    maakDocumentIdentiteit(`fonds:${FONDS}:sharepoint`, DOCUMENT.ref)));
});

test("een los tekstloos PDF-document blijft fail-closed", async () => {
  const scan: GeregistreerdDocument = {
    ...DOCUMENT,
    naam: "bijlage-scan.pdf",
    bestandstype: "pdf",
  };
  const adapter = maakDirecteSharePointAdapter({
    bron: BRON,
    tokenTenantId: BRON.tenantId,
    accessToken: "test-token",
    documenten: [{ document: scan }],
    leesItem: async (id) => id === BRON.rootItemId ? root() : {
      ...item(),
      name: scan.naam,
      webUrl: `https://${HOST}/sites/lab/Gedeelde%20documenten/PGB/${scan.naam}`,
      file: { mimeType: "application/pdf" },
    },
    herleesBron: async () => BRON,
    downloadImpl: async () => ({ ok: true, bytes: Buffer.from("fixture") }),
    extractImpl: async () => ({ tekst: "", aantalPaginas: 1, segmenten: [] }),
  });
  const uit = await adapter.zoek(
    {
      fondsId: FONDS,
      actor: { soort: "gebruiker", id: GEBRUIKER },
      taaktype: "chat_generatie",
      bronbeleid: { bronsoorten: ["sharepoint"] },
      correlationId: "corr-losse-scan",
      verzoekStartOp: new Date().toISOString(),
      resterendMs: () => 5_000,
    },
    {
      naam: "primair",
      documentScope: [maakDocumentIdentiteit(`fonds:${FONDS}:sharepoint`, scan.ref)],
      origineleVraag: "vraag",
      zoekvraag: "vraag",
      strategie: "gericht",
      maxResultaten: 8,
      maxKandidaten: 8,
      maxContextTekens: 10_000,
    }
  );
  assert.equal(uit.fout, "configuratiefout");
  assert.equal(uit.kandidaten.length, 0);
});

test("een map met uitsluitend een tekstloze PDF geeft geen verzonnen bronresultaten", async () => {
  const scan: GeregistreerdDocument = {
    ...DOCUMENT,
    naam: "bijlage-scan.pdf",
    bestandstype: "pdf",
  };
  let overgeslagen = 0;
  const adapter = maakDirecteSharePointAdapter({
    bron: BRON,
    tokenTenantId: BRON.tenantId,
    accessToken: "test-token",
    documenten: [{ document: scan }],
    leesItem: async (id) => id === BRON.rootItemId ? root() : {
      ...item(),
      name: scan.naam,
      webUrl: `https://${HOST}/sites/lab/Gedeelde%20documenten/PGB/${scan.naam}`,
      file: { mimeType: "application/pdf" },
    },
    herleesBron: async () => BRON,
    downloadImpl: async () => ({ ok: true, bytes: Buffer.from("fixture") }),
    extractImpl: async () => ({ tekst: "", aantalPaginas: 1, segmenten: [] }),
    onPdfZonderTekstlaag: () => { overgeslagen += 1; },
  });
  const uit = await adapter.zoek(
    {
      fondsId: FONDS,
      actor: { soort: "gebruiker", id: GEBRUIKER },
      taaktype: "chat_generatie",
      bronbeleid: { bronsoorten: ["sharepoint"] },
      correlationId: "corr-alleen-scan",
      verzoekStartOp: new Date().toISOString(),
      resterendMs: () => 5_000,
    },
    {
      naam: "primair",
      documentScope: [maakDocumentIdentiteit(`fonds:${FONDS}:sharepoint`, scan.ref)],
      origineleVraag: "vraag",
      zoekvraag: "vraag",
      strategie: "gericht",
      maxResultaten: 8,
      maxKandidaten: 8,
      maxContextTekens: 10_000,
    }
  );
  assert.equal(uit.fout, "geen_resultaten");
  assert.equal(uit.kandidaten.length, 0);
  assert.equal(overgeslagen, 1);
});

test("intrekking tijdens een tekstloze PDF blijft ook voor een map fail-closed", async () => {
  const scan: GeregistreerdDocument = {
    ...DOCUMENT,
    naam: "bijlage-scan.pdf",
    bestandstype: "pdf",
  };
  let overgeslagen = 0;
  const adapter = maakDirecteSharePointAdapter({
    bron: BRON,
    tokenTenantId: BRON.tenantId,
    accessToken: "test-token",
    documenten: [{ document: scan }],
    leesItem: async (id) => id === BRON.rootItemId ? root() : {
      ...item(),
      name: scan.naam,
      webUrl: `https://${HOST}/sites/lab/Gedeelde%20documenten/PGB/${scan.naam}`,
      file: { mimeType: "application/pdf" },
    },
    herleesBron: async () => ({ ...BRON, status: "gestopt" }),
    downloadImpl: async () => ({ ok: true, bytes: Buffer.from("fixture") }),
    extractImpl: async () => ({ tekst: "", aantalPaginas: 1, segmenten: [] }),
    onPdfZonderTekstlaag: () => { overgeslagen += 1; },
  });
  const uit = await adapter.zoek(
    {
      fondsId: FONDS,
      actor: { soort: "gebruiker", id: GEBRUIKER },
      taaktype: "chat_generatie",
      bronbeleid: { bronsoorten: ["sharepoint"] },
      correlationId: "corr-ingetrokken-scan",
      verzoekStartOp: new Date().toISOString(),
      resterendMs: () => 5_000,
    },
    {
      naam: "primair",
      documentScope: [maakDocumentIdentiteit(`fonds:${FONDS}:sharepoint`, scan.ref)],
      origineleVraag: "vraag",
      zoekvraag: "vraag",
      strategie: "gericht",
      maxResultaten: 8,
      maxKandidaten: 8,
      maxContextTekens: 10_000,
    }
  );
  assert.equal(uit.fout, "toestemming_geweigerd");
  assert.equal(overgeslagen, 0);
});
