// ============================================================================
//  #322 F4-T2-1 — De orkestratie.
// ----------------------------------------------------------------------------
//  Alles wat GEEN adapterwerk is: selectie, deduplicatie, samenvoeging over
//  sporen, begrenzing, citaatvorming en het auditspoor (besluit 0213 punt 5).
//  De adapter levert kandidaten en hun rangschikking, en weet als enige hoe
//  zijn eigen bron eruitziet — vandaar de hooks `verrijkSelectie` en `citeer`.
//
//  DEZE LAAG KENT GEEN `DocumentChunk`. Zou zij die kennen, dan zou een
//  Microsoftresultaat er niet doorheen komen en was het contract feitelijk
//  Supabase-only.
//
//  EEN DETAIL DAT BYTE-IDENTITEIT BEPAALT. C1 draait twee sporen — het primaire
//  (gescopet op het hoofddocument of de gekoppelde stukken) en het aanvullende
//  (de bibliotheek). Vóór T2-1 selecteerde ELK spoor apart, met zijn eigen
//  budget, en werden pas daarna de twee GESELECTEERDE sets samengevoegd. De
//  orkestratie doet dat hier bewust net zo: selectie per query, dan samenvoegen.
// ============================================================================
import type { RetrievalMeta } from "../rag";
import { bouwMeta, type AuditBron } from "./meta";
import { selecteerEnVerrijk, type SelectieBron } from "./selectie";
import type {
  AdapterUitkomst,
  Bronresultaat,
  CitaatOpdracht,
  Queries,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
  RetrievalTussenresultaat,
  RetrievalUitkomst,
} from "./contract";

/** Grenzen en vlaggen die de selectie stuurt; per query geresolveerd. */
export interface SelectiegrenzenPerQuery {
  maxResults: number;
  maxPerDoc: number;
  representatieConstraints: boolean;
  regimeWeging: boolean;
  relevantieDrempel: boolean;
}

export interface Spoor {
  query: RetrievalQuery;
  grenzen: SelectiegrenzenPerQuery;
}

export interface Orkestratieopdracht {
  adapter: RetrievalAdapter;
  /** Het primaire spoor staat vooraan: het krijgt de laagste bronnummers. */
  sporen: Queries<Spoor>;
}

/** Providerneutrale kijk voor de selectie — geen chunk, geen opslagvorm. */
function alsAuditBron(b: Bronresultaat): AuditBron {
  return {
    ref: b.ref,
    documentId: b.documentIdentiteit.documentId,
    bron: b.documentIdentiteit.bron ?? "",
    bibliotheek: b.documentIdentiteit.bibliotheek ?? "fonds",
    fondsId: b.documentIdentiteit.fondsId ?? null,
    documentstatus: b.status.documentstatus ?? null,
    bronstatus: b.status.bronstatus ?? null,
    documentdatum: b.versie.waarde ?? null,
    score: b.rang.score ?? null,
    fts: b.rang.fts ?? null,
    vec: b.rang.vec ?? null,
  };
}

function alsSelectieBron(b: Bronresultaat): SelectieBron {
  return {
    id: b.ref,
    document_id: b.documentIdentiteit.documentId,
    tekst: b.passage,
    rang: b.rang.score ?? null,
    titel: b.titel,
    bibliotheek: b.documentIdentiteit.bibliotheek ?? "fonds",
    normgewicht: b.curatie?.normgewicht ?? null,
    wettelijkRegime: b.curatie?.wettelijkRegime ?? null,
  };
}

/**
 * Fase 1: kandidaten ophalen, selecteren, samenvoegen en begrenzen. Levert een
 * ONVOLTOOID resultaat — er zijn nog geen citaties. Zie `citeer()`.
 */
export async function voerRetrievalUit(
  ctx: RetrievalContext,
  opdracht: Orkestratieopdracht
): Promise<RetrievalTussenresultaat> {
  const t0 = Date.now();
  const sporen = opdracht.sporen;
  if (sporen.length === 0) {
    // Het type maakt dit onmogelijk; deze grendel vangt een aanroeper die het
    // type omzeilt (bv. een `as`-cast of JS). Stil doorgaan zou een beurt
    // zonder enige bron opleveren die er wél volwaardig uitziet.
    throw new Error("orkestratie: ten minste één spoor is vereist");
  }

  // 1. Adapters bevragen. De sporen draaien parallel, net als vóór T2-1.
  const uitkomsten: AdapterUitkomst[] = await Promise.all(
    sporen.map(({ query }) => opdracht.adapter.zoek(ctx, query))
  );

  // 2. `perAdapter` in SPOORVOLGORDE opbouwen, niet in volgorde van binnenkomst.
  //    Zou dit vanuit de parallelle promises gebeuren, dan bepaalde de
  //    responstijd de volgorde en was de samenvoeging niet meer deterministisch.
  const perAdapter: RetrievalTussenresultaat["perAdapter"] = uitkomsten.map((u, i) => ({
    naam: opdracht.adapter.naam,
    query: sporen[i].query.naam,
    methode: u.methode,
    latencyMs: u.latencyMs,
    kandidaten: u.kandidaten.length,
    fout: u.fout,
  }));

  // 3. Harde kandidatengrens per spoor. De adapter mag intern ruimer ophalen;
  //    wat het contract verlaat is begrensd.
  let truncatie: RetrievalTussenresultaat["truncatie"];
  const begrensd = uitkomsten.map((u, i) => {
    const max = sporen[i].query.maxKandidaten;
    if (u.kandidaten.length <= max) return u.kandidaten;
    truncatie = { reden: "kandidaten" };
    return u.kandidaten.slice(0, max);
  });

  // 4. Selectie PER SPOOR — zie de kopnoot — gevolgd door de providerhook.
  const geselecteerdPerSpoor: Bronresultaat[][] = [];
  const extraPerSpoor: Partial<RetrievalMeta>[] = [];
  for (let i = 0; i < uitkomsten.length; i++) {
    const u = uitkomsten[i];
    const g = sporen[i].grenzen;
    const perRef = new Map(begrensd[i].map((b) => [b.ref, b]));
    const sel = await selecteerEnVerrijk(begrensd[i].map(alsSelectieBron), u.methode as RetrievalMeta["methode"], {
      filters: sporen[i].query.filters,
      maxResults: g.maxResults,
      maxPerDoc: g.maxPerDoc,
      representatieConstraints: g.representatieConstraints,
      regimeWeging: g.regimeWeging,
      relevantieDrempel: g.relevantieDrempel,
    });
    let gekozen = sel.chunks.map((b) => perRef.get(b.id)).filter((b): b is Bronresultaat => Boolean(b));
    const extra = { ...sel.extra };
    // Providerspecifieke uitbreiding (Supabase: parent-context). Per spoor, op
    // exact dezelfde plek als vóór T2-1.
    if (opdracht.adapter.verrijkSelectie && gekozen.length > 0) {
      const v = await opdracht.adapter.verrijkSelectie(ctx, gekozen);
      gekozen = v.resultaten;
      Object.assign(extra, v.meta ?? {});
    }
    geselecteerdPerSpoor.push(gekozen);
    extraPerSpoor.push(extra);
  }

  // 5. Samenvoegen. Het primaire spoor vooraan; een document dat daar al in zit
  //    komt niet nóg eens uit een volgend spoor (één passage, één bronnummer).
  const primair = geselecteerdPerSpoor[0] ?? [];
  const primaireDocIds = new Set(primair.map((b) => b.documentIdentiteit.documentId));
  const aanvullend = geselecteerdPerSpoor
    .slice(1)
    .flat()
    .filter((b) => !primaireDocIds.has(b.documentIdentiteit.documentId));
  let geselecteerd = [...primair, ...aanvullend];

  // 6. Harde contextgrens: de som van de passages. De grens van het primaire
  //    spoor is leidend — dat is de query die de beurt draagt.
  const maxTekens = sporen[0].query.maxContextTekens;
  if (maxTekens > 0) {
    let som = 0;
    const passend: Bronresultaat[] = [];
    for (const b of geselecteerd) {
      som += b.passage.length;
      if (som > maxTekens) {
        truncatie = { reden: "tekens" };
        break;
      }
      passend.push(b);
    }
    geselecteerd = passend;
  }

  // 7. Auditspoor. De basis komt van het primaire spoor; de aanvullende bronnen
  //    dragen alleen ref/document/rang — dezelfde asymmetrie als vóór T2-1,
  //    want deze lijst voedt de bronset-hash van de bevroren reflectiebronset.
  const primairGekozen = geselecteerd.filter((b) => primair.includes(b));
  const aanvullendGekozen = geselecteerd.filter((b) => !primair.includes(b));
  const basis = uitkomsten[0];
  const basisMeta = bouwMeta(basis.methode as RetrievalMeta["methode"], basis.opgehaald, primairGekozen.map(alsAuditBron));
  const meta: RetrievalMeta = {
    ...basisMeta,
    ...(basis.diagnostiek ?? {}),
    ...extraPerSpoor[0],
    chunks: [
      ...basisMeta.chunks,
      ...aanvullendGekozen.map((b) => ({
        id: b.ref,
        document_id: b.documentIdentiteit.documentId,
        rang: b.rang.score ?? null,
      })),
    ],
    opgehaald: uitkomsten.reduce((s, u) => s + u.opgehaald, 0),
    geselecteerd: geselecteerd.length,
    ...(uitkomsten.length > 1
      ? {
          aanvullend: {
            chunks: aanvullendGekozen.length,
            documenten: new Set(aanvullendGekozen.map((b) => b.documentIdentiteit.documentId)).size,
          },
        }
      : {}),
  };

  return {
    kandidaten: begrensd.flat(),
    geselecteerd,
    perAdapter,
    latencyMs: Date.now() - t0,
    truncatie,
    fout: uitkomsten.find((u) => u.fout)?.fout,
    meta,
  };
}

/**
 * Fase 2: citaatvorming. Maakt van een ONVOLTOOID tussenresultaat het
 * definitieve resultaat dat de generatielaag mag gebruiken.
 *
 * BEWUST GESCHEIDEN van `voerRetrievalUit`. De chatroute stuurt tussen beide
 * stappen een voortgangsevent en schrijft het scope-auditspoor; die volgorde zit
 * byte-voor-byte in de SSE-snapshots. Beide stappen zijn orkestratiewerk; de
 * route sequencet alleen. De ADAPTER rendert — hij weet hoe zijn bron eruitziet
 * — maar de orkestratie bepaalt wát en in welke volgorde.
 */
export async function citeer(
  ctx: RetrievalContext,
  adapter: RetrievalAdapter,
  tussen: RetrievalTussenresultaat,
  opdracht: CitaatOpdracht
): Promise<RetrievalUitkomst> {
  const c = await adapter.citeer(ctx, tussen.geselecteerd, opdracht);
  return {
    ...tussen,
    geselecteerd: c.resultaten,
    bronverwijzingen: c.bronverwijzingen,
    contextTekst: c.contextTekst,
    sentinel: c.sentinel,
    geneutraliseerd: c.geneutraliseerd,
  };
}
