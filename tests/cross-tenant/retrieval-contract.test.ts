// ============================================================================
//  #322 F4-T2-1 — Is het contract werkelijk providerneutraal en consistent?
// ----------------------------------------------------------------------------
//  De 394 identieke goldens bewijzen gedragspariteit op het Supabase-pad. Ze
//  bewijzen NIET dat een andere provider erdoorheen komt, dat de aangekondigde
//  grenzen echt hard zijn, of dat de samenvoeging deterministisch is. Deze suite
//  toetst precies dat — hermetisch, zonder database en zonder netwerk.
//
//  De hoofdtest is de eerste: een kandidaat ZONDER `DocumentChunk`. In de eerste
//  opzet van PR-A droeg `Bronresultaat` een chunk en filterde de orkestratie
//  alles zonder chunk weg vóór de selectie. Een Microsoftresultaat zou dus stil
//  zijn verdwenen, en het contract was feitelijk Supabase-only.
// ============================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { voerRetrievalUit, citeer } from "../../core/lib/retrieval/orkestratie";
import type {
  AdapterUitkomst,
  Bronresultaat,
  CitaatOpdracht,
  CitaatResultaat,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "../../core/lib/retrieval/contract";

const CTX: RetrievalContext = {
  fondsId: "11111111-1111-4111-8111-111111111111",
  actor: { soort: "gebruiker", id: "22222222-2222-4222-8222-222222222222" },
  taaktype: "chat_generatie",
  bronbeleid: { bronsoorten: ["fonds", "sharepoint"] },
  correlationId: "corr-1",
};

/** Een SharePoint-resultaat: geen chunk, geen chunk-id, wel volledig bewijs. */
function sharepointBron(n: number, doc: string, passage: string): Bronresultaat {
  return {
    ref: `sp-${n}`,
    bronsoort: "sharepoint",
    titel: `SharePointstuk ${n}`,
    documentIdentiteit: { documentId: doc, bibliotheek: "fonds", bron: "SharePoint", fondsId: CTX.fondsId },
    versie: { soort: "etag", waarde: `etag-${n}`, gecontroleerdOp: "2026-09-10T10:00:00.000Z" },
    toegangscontrole: {
      toegestaan: true,
      gebruikerId: CTX.actor.soort === "gebruiker" ? CTX.actor.id : "",
      correlationId: CTX.correlationId,
      gecontroleerdOp: "2026-09-10T10:00:00.000Z",
      basis: "delegated_user",
      bronconfiguratieVersie: 3,
    },
    locator: { mappad: "/Gedeelde documenten" },
    passage,
    status: { documentstatus: "van_kracht", actueel: true },
    rang: { positie: n, score: 1 / n },
    curatie: { normgewicht: null, wettelijkRegime: null },
  };
}

const QUERY = (naam: string, over: Partial<RetrievalQuery> = {}): RetrievalQuery => ({
  naam,
  origineleVraag: "Wat staat er in het beleid?",
  zoekvraag: "beleid",
  strategie: "gericht",
  maxKandidaten: 10,
  maxContextTekens: 100_000,
  ...over,
});

const GRENZEN = {
  maxResults: 10,
  maxPerDoc: 5,
  representatieConstraints: false,
  regimeWeging: false,
  relevantieDrempel: false,
};

/** Nep-Microsoftadapter: levert uitsluitend chunkloze resultaten. */
function nepAdapter(opties: {
  perQuery: Record<string, Bronresultaat[]>;
  vertragingMs?: Record<string, number>;
  volgorde?: string[];
}): RetrievalAdapter {
  return {
    naam: "microsoft-sharepoint",
    capabilities: () => ({
      bronsoorten: ["sharepoint"],
      strategieen: ["gericht"],
      ondersteundeFilters: [],
      versiebewijs: true,
      permissionProof: true,
      preview: true,
      cancellation: true,
      timeout: true,
    }),
    async zoek(_ctx, query): Promise<AdapterUitkomst> {
      const ms = opties.vertragingMs?.[query.naam] ?? 0;
      if (ms > 0) await new Promise((r) => setTimeout(r, ms));
      opties.volgorde?.push(query.naam);
      const kandidaten = opties.perQuery[query.naam] ?? [];
      return {
        kandidaten,
        methode: "sharepoint_live",
        provider: "microsoft",
        latencyMs: ms,
        opgehaald: kandidaten.length,
      };
    },
    async citeer(_ctx, geselecteerd, opdracht: CitaatOpdracht): Promise<CitaatResultaat> {
      return {
        resultaten: geselecteerd,
        contextTekst: geselecteerd.map((b, i) => `[Bron ${i + 1}] ${b.passage}`).join("\n"),
        bronverwijzingen: geselecteerd.map((b, i) => ({
          nummer: i + 1,
          document_id: b.documentIdentiteit.documentId,
          titel: b.titel + (opdracht.primaireDocumentIds.has(b.documentIdentiteit.documentId) ? opdracht.hoofddocumentLabel : ""),
          bron: b.documentIdentiteit.bron ?? "",
        })) as unknown as CitaatResultaat["bronverwijzingen"],
        sentinel: "SENTINEL",
        geneutraliseerd: 0,
      };
    },
  };
}

const LEGE_OPDRACHT: CitaatOpdracht = {
  primaireDocumentIds: new Set<string>(),
  peildatum: "2026-09-10",
  hoofddocumentLabel: " [hoofddocument]",
};

// ── (1) De kern: een provider zonder DocumentChunk komt erdoorheen ───────────

test("T2-1 — een kandidaat ZONDER DocumentChunk wordt geselecteerd én geciteerd", async () => {
  const adapter = nepAdapter({
    perQuery: { primair: [sharepointBron(1, "doc-a", "De eerste passage."), sharepointBron(2, "doc-b", "De tweede passage.")] },
  });
  const tussen = await voerRetrievalUit(CTX, { adapter, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN }] });

  assert.equal(tussen.geselecteerd.length, 2, "chunkloze kandidaten mogen niet stil verdwijnen");
  assert.deepEqual(tussen.geselecteerd.map((b) => b.ref), ["sp-1", "sp-2"]);
  // Het auditspoor draagt ze óók — anders is de beurt niet reproduceerbaar.
  assert.deepEqual(tussen.meta.chunks.map((c) => c.id), ["sp-1", "sp-2"]);
  assert.deepEqual(tussen.meta.bronversie_audit?.map((b) => b.bron), ["SharePoint", "SharePoint"]);

  const voltooid = await citeer(CTX, adapter, tussen, LEGE_OPDRACHT);
  assert.equal(voltooid.bronverwijzingen.length, 2);
  assert.match(voltooid.contextTekst, /\[Bron 1\] De eerste passage\./);
});

test("T2-1 — het contract GEBRUIKT nergens DocumentChunk als type", async () => {
  const { readFileSync } = await import("node:fs");
  const bron = readFileSync(new URL("../../core/lib/retrieval/contract.ts", import.meta.url), "utf8");
  // Een toelichting mág de naam noemen (die legt juist uit waaróm hij hier niet
  // hoort); wat verboden is, is elk TYPEGEBRUIK — een import of een annotatie.
  const zonderCommentaar = bron.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
  assert.ok(
    !/DocumentChunk/.test(zonderCommentaar),
    "een databasevorm in het publieke contract maakt het contract providergebonden"
  );
  // En de import mag er sowieso niet zijn, ook niet type-only.
  assert.ok(!/import[^;]*DocumentChunk[^;]*from/.test(bron));
});

// ── (2) Harde grenzen ───────────────────────────────────────────────────────

test("T2-1 — maxKandidaten is een HARDE grens op wat het contract verlaat", async () => {
  const veel = Array.from({ length: 25 }, (_, i) => sharepointBron(i + 1, `doc-${i}`, `Passage ${i}.`));
  const adapter = nepAdapter({ perQuery: { primair: veel } });
  const tussen = await voerRetrievalUit(CTX, {
    adapter,
    sporen: [{ query: QUERY("primair", { maxKandidaten: 4 }), grenzen: GRENZEN }],
  });
  assert.equal(tussen.kandidaten.length, 4, "een adapter die te veel teruggeeft wordt afgekapt");
  assert.deepEqual(tussen.truncatie, { reden: "kandidaten" });
});

test("T2-1 — maxContextTekens kapt de modelcontext af en meldt dat", async () => {
  const adapter = nepAdapter({
    perQuery: {
      primair: [
        sharepointBron(1, "doc-a", "x".repeat(40)),
        sharepointBron(2, "doc-b", "y".repeat(40)),
        sharepointBron(3, "doc-c", "z".repeat(40)),
      ],
    },
  });
  const tussen = await voerRetrievalUit(CTX, {
    adapter,
    sporen: [{ query: QUERY("primair", { maxContextTekens: 90 }), grenzen: GRENZEN }],
  });
  assert.equal(tussen.geselecteerd.length, 2, "de derde passage past niet meer binnen 90 tekens");
  assert.deepEqual(tussen.truncatie, { reden: "tekens" });
  assert.ok(tussen.geselecteerd.reduce((s, b) => s + b.passage.length, 0) <= 90);
});

// ── (3) Determinisme ────────────────────────────────────────────────────────

test("T2-1 — perAdapter volgt de SPOORvolgorde, niet de responstijd", async () => {
  const volgorde: string[] = [];
  const adapter = nepAdapter({
    perQuery: {
      primair: [sharepointBron(1, "doc-a", "A")],
      aanvullend: [sharepointBron(2, "doc-b", "B")],
    },
    // Het primaire spoor is TRAGER: zonder expliciete ordening zou het
    // aanvullende spoor vooraan komen te staan.
    vertragingMs: { primair: 40, aanvullend: 1 },
    volgorde,
  });
  const tussen = await voerRetrievalUit(CTX, {
    adapter,
    sporen: [
      { query: QUERY("primair"), grenzen: GRENZEN },
      { query: QUERY("aanvullend"), grenzen: GRENZEN },
    ],
  });
  assert.deepEqual(volgorde, ["aanvullend", "primair"], "de responsvolgorde is bewust omgekeerd");
  assert.deepEqual(
    tussen.perAdapter.map((p) => p.query),
    ["primair", "aanvullend"],
    "de metadata moet de spoorvolgorde volgen, anders is de samenvoeging niet deterministisch"
  );
});

// ── (4) Overlap tussen de sporen ────────────────────────────────────────────

test("T2-1 — een document uit het primaire spoor komt niet nóg eens uit het aanvullende", async () => {
  const adapter = nepAdapter({
    perQuery: {
      primair: [sharepointBron(1, "doc-gedeeld", "Primaire passage.")],
      aanvullend: [
        sharepointBron(2, "doc-gedeeld", "Zelfde document, ander fragment."),
        sharepointBron(3, "doc-uniek", "Ander document."),
      ],
    },
  });
  const tussen = await voerRetrievalUit(CTX, {
    adapter,
    sporen: [
      { query: QUERY("primair"), grenzen: GRENZEN },
      { query: QUERY("aanvullend"), grenzen: GRENZEN },
    ],
  });
  assert.deepEqual(
    tussen.geselecteerd.map((b) => b.ref),
    ["sp-1", "sp-3"],
    "sp-2 hoort bij een document dat al primair is — één document, één bronnummer"
  );
  assert.deepEqual(tussen.meta.aanvullend, { chunks: 1, documenten: 1 });
});

// ── (5) Tussenresultaat is geen eindresultaat ───────────────────────────────

test("T2-1 — een tussenresultaat draagt geen citaties en is dus onbruikbaar voor de generatielaag", async () => {
  const adapter = nepAdapter({ perQuery: { primair: [sharepointBron(1, "doc-a", "A")] } });
  const tussen = await voerRetrievalUit(CTX, { adapter, sporen: [{ query: QUERY("primair"), grenzen: GRENZEN }] });
  // Runtime: de citatievelden bestaan simpelweg niet op het tussenresultaat.
  for (const veld of ["bronverwijzingen", "contextTekst", "sentinel", "geneutraliseerd"]) {
    assert.ok(!(veld in tussen), `${veld} hoort pas ná citeer() te bestaan`);
  }
  const voltooid = await citeer(CTX, adapter, tussen, LEGE_OPDRACHT);
  for (const veld of ["bronverwijzingen", "contextTekst", "sentinel", "geneutraliseerd"]) {
    assert.ok(veld in voltooid, `${veld} hoort ná citeer() wél te bestaan`);
  }
});

test("T2-1 — het type verbiedt een tussenresultaat waar een eindresultaat hoort", async () => {
  const { readFileSync } = await import("node:fs");
  const bron = readFileSync(new URL("../../core/lib/retrieval/contract.ts", import.meta.url), "utf8");
  // `RetrievalUitkomst` moet strikt méér eisen dan het tussenresultaat; anders
  // is een half resultaat er stil voor door te geven.
  assert.match(bron, /interface RetrievalUitkomst extends RetrievalTussenresultaat/);
  assert.match(bron, /interface RetrievalTussenresultaat \{[\s\S]*?\n\}/);
});

// ── (6) Lege querylijst ─────────────────────────────────────────────────────

test("T2-1 — een lege sporenlijst wordt gecontroleerd geweigerd", async () => {
  const adapter = nepAdapter({ perQuery: {} });
  await assert.rejects(
    // Het type maakt dit onmogelijk (`Queries<T>` eist ten minste één element);
    // de cast bootst een aanroeper na die het type omzeilt.
    () => voerRetrievalUit(CTX, { adapter, sporen: [] as unknown as Parameters<typeof voerRetrievalUit>[1]["sporen"] }),
    /ten minste één spoor/,
    "stil doorgaan zou een bronloze beurt opleveren die er volwaardig uitziet"
  );
});
