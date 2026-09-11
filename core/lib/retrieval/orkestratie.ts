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
import { effectievePeildatum } from "../rag";
import type { RetrievalMeta } from "../rag";
import { bouwMeta, type AuditBron } from "./meta";
import { selecteerEnVerrijk, type SelectieBron } from "./selectie";
import { bouwCitaties } from "./citatie";
import { verifieerToelating, nietOndersteundeFilters, vatToelatingSamen } from "./toelatingspoort";
import { maakAfbreekgrendel, isAfbreking, redenVan, GrendelGesloten, TIMEOUT_DEFAULT_MS } from "./afbreken";
import type { Afbreekgrendel } from "./afbreken";import type {
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
  /** Deadline over de HELE retrievalketen (D5). Default 20 s. */
  timeoutMs?: number;
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
 * Bouwt het auditspoor over EXACT de meegegeven bronnen. Eén functie, gebruikt
 * door fase 1 én opnieuw door `citeer()` zodra de contextgrens blokken heeft
 * afgekapt — anders noemt `meta.geselecteerd`, `meta.chunks`,
 * `bronversie_audit` of `aanvullend` bronnen die nooit naar het model gingen.
 */
function bouwRetrievalMeta(
  opgenomen: Bronresultaat[],
  basis: RetrievalTussenresultaat["metaBasis"]
): RetrievalMeta {
  const primair = opgenomen.filter((b) => basis.primaireRefs.has(b.ref));
  const aanvullend = opgenomen.filter((b) => !basis.primaireRefs.has(b.ref));
  const basisMeta = bouwMeta(basis.methode, basis.opgehaald, primair.map(alsAuditBron));
  return {
    ...basisMeta,
    ...basis.diagnostiek,
    ...basis.extra,
    chunks: [
      ...basisMeta.chunks,
      ...aanvullend.map((b) => ({
        id: b.ref,
        document_id: b.documentIdentiteit.documentId,
        rang: b.rang.score ?? null,
      })),
    ],
    opgehaald: basis.opgehaald,
    geselecteerd: opgenomen.length,
    ...(basis.meerdereSporen
      ? {
          aanvullend: {
            chunks: aanvullend.length,
            documenten: new Set(aanvullend.map((b) => b.documentIdentiteit.documentId)).size,
          },
        }
      : {}),
  };
}

/**
 * Fase 1: kandidaten ophalen, selecteren, samenvoegen en begrenzen. Levert een
 * ONVOLTOOID resultaat — er zijn nog geen citaties.
 *
 * INTERN. Gebruik `voerVolledigeRetrievalUit()`. Deze functie levert een
 * tussenresultaat dat een LEVENDE grendel draagt; wie haar los aanroept erft
 * daarmee een resource waarvan hij de levensduur moet kennen. Een productiepad
 * dat dat vergeet, laat timer en clientluisteraar staan tot de deadline vuurt.
 * De contractgate verbiedt zo'n import buiten deze module en de tests.
 *
 * `geleendeGrendel` — de eigenaar geeft zijn grendel mee en sluit hem zelf.
 */
export async function voerRetrievalUit(
  ctx: RetrievalContext,
  opdracht: Orkestratieopdracht,
  geleendeGrendel?: Afbreekgrendel
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
  //    Elk spoor krijgt een AFGELEIDE context met zijn EIGEN documentscope. Eén
  //    gedeelde scope zou het aanvullende spoor mee-scopen op de primaire
  //    documenten, en dan zoekt de verbreding naar de bibliotheek niet meer
  //    breder — precies wat zij moet doen.
  // PR-B — één samengesteld signaal voor de hele keten: de clientverbinding én
  // de deadline. Het onthoudt waaróm het afging, zodat een verbroken
  // verbinding `annulering` oplevert en een verlopen deadline `timeout` — twee
  // verschillende dingen die een kaal AbortSignal niet uit elkaar houdt.
  // Is er een grendel geleend, dan is de UITLENER de eigenaar en sluit hij hem;
  // deze functie mag dat dan niet doen, ook niet op het foutpad.
  const eigenGrendel = geleendeGrendel === undefined;
  const grendel = geleendeGrendel ?? maakAfbreekgrendel(ctx.signal, opdracht.timeoutMs ?? TIMEOUT_DEFAULT_MS);
  const ctxMetGrendel = { ...ctx, signal: grendel.signal };

  //    `ctx.scope.documentIds` is voor een adapter de ENIGE bron van waarheid;
  //    de orkestratie zet de spoorscope hier één keer en gebruikt diezelfde
  //    afgeleide context ook voor `verrijkSelectie`.
  // "Vandaag" wordt ÉÉN keer per beurt vastgesteld en door alle sporen gedeeld.
  // Zou elk spoor het zelf afleiden, dan kan een beurt die middernacht kruist
  // twee verschillende peildata gebruiken — en dan verschilt de
  // review-vervalcontrole per spoor binnen dezelfde vraag.
  const vandaagVoorDezeBeurt = effectievePeildatum(undefined);
  const peildatumVanSpoor = (q: RetrievalQuery) => q.filters?.peildatum ?? vandaagVoorDezeBeurt;

  const spoorContext = sporen.map(({ query }) => ({
    ...ctxMetGrendel,
    scope: { ...ctx.scope, documentIds: query.documentScope },
  }));
  try {
    // 1a. TOELATINGSPOORT, VÓÓR `zoek()` — de filterbelofte. Een filter dat de
    //     adapter niet ondersteunt is een FOUT, nooit een stille no-op: anders
    //     zoekt hij breder dan gevraagd en ziet niemand het. Dat spoor wordt
    //     dan niet bevraagd; `zoek()` wordt aantoonbaar niet aangeroepen.
    const caps = opdracht.adapter.capabilities();
    const nietOndersteund = sporen.map(({ query }) => nietOndersteundeFilters(caps, query));
    const filterweigeringen = nietOndersteund.filter((f) => f.length > 0).length;

    const uitkomsten: AdapterUitkomst[] = await Promise.all(
      sporen.map(({ query }, i) =>
        nietOndersteund[i].length > 0
          ? Promise.resolve<AdapterUitkomst>({
              kandidaten: [],
              methode: "geen",
              // Niet bevraagd — dus ook geen provider die iets heeft gedaan.
              provider: "geen",
              latencyMs: 0,
              opgehaald: 0,
              fout: "configuratiefout",
            })
          : opdracht.adapter.zoek(spoorContext[i], query)
      )
    );
    // Tussen twee stappen door: is er afgebroken, dan stopt de keten hier — ook
    // als de I/O zelf toevallig al klaar was.
    grendel.bewaak();

    // 2. TOELATINGSPOORT, NÁ `zoek()` en VÓÓR de kandidatenbegrenzing. Niet pas
    //    vóór de selectie: kapt de pool eerst af op `maxKandidaten`, dan kan een
    //    geweigerde bron een toelaatbare kandidaat uit de pool hebben verdrongen.
    //
    //    ÉÉN BATCH over alle sporen: één `poortNu` en één V5-herlezing per unieke
    //    bron. Per spoor apart zou dezelfde bron twee keer worden gelezen en bij
    //    een intrekking tussen die lezingen verschillend worden beoordeeld.
    const poort = await verifieerToelating(
      ctxMetGrendel,
      opdracht.adapter,
      uitkomsten.map((u) => u.kandidaten)
    );
    grendel.bewaak();
    const toegelatenPerSpoor = poort.toegelatenPerSpoor;
    const geweigerdPerSpoor = sporen.map((_, i) => poort.geweigerd.filter((w) => w.spoor === i).length);
    // Inhoudsvrij, alleen tellingen; `null` als er niets is geweigerd.
    const toelating = vatToelatingSamen(poort.geweigerd, filterweigeringen);

    // 3. `perAdapter` in SPOORVOLGORDE opbouwen, niet in volgorde van binnenkomst.
    //    Zou dit vanuit de parallelle promises gebeuren, dan bepaalde de
    //    responstijd de volgorde en was de samenvoeging niet meer deterministisch.
    //    `kandidaten` telt wat de poort HEEFT TOEGELATEN: een geweigerde bron mag
    //    ook in het auditspoor niet meetellen.
    const perAdapter: RetrievalTussenresultaat["perAdapter"] = uitkomsten.map((u, i) => ({
      naam: opdracht.adapter.naam,
      query: sporen[i].query.naam,
      methode: u.methode,
      latencyMs: u.latencyMs,
      kandidaten: toegelatenPerSpoor[i].length,
      fout: u.fout,
      // Alleen aanwezig als er werkelijk iets is geweigerd: een veld dat altijd
      // op 0 staat zou elke bestaande snapshot veranderen zonder iets te melden.
      ...(geweigerdPerSpoor[i] > 0 ? { geweigerd: geweigerdPerSpoor[i] } : {}),
    }));

    // 4. Harde grens op de KANDIDATENPOOL — niet op de eindselectie. De pool is
    //    bewust ruimer (`max(3 × maxResultaten, 20)`), want de centrale weging mag
    //    een kandidaat van plek 15 alsnog in de top halen. Terugkappen naar
    //    `maxResultaten` zou die promotie stil wegnemen.
    let truncatie: RetrievalTussenresultaat["truncatie"];
    const begrensd = toegelatenPerSpoor.map((toegelaten, i) => {
      const max = sporen[i].query.maxKandidaten;
      if (toegelaten.length <= max) return toegelaten;
      truncatie = { reden: "kandidaten" };
      return toegelaten.slice(0, max);
    });

    // 5. Selectie PER SPOOR — zie de kopnoot — gevolgd door de providerhook.
    const geselecteerdPerSpoor: Bronresultaat[][] = [];
    const extraPerSpoor: Partial<RetrievalMeta>[] = [];
    for (let i = 0; i < uitkomsten.length; i++) {
      const u = uitkomsten[i];
      const g = sporen[i].grenzen;
      const perRef = new Map(begrensd[i].map((b) => [b.ref, b]));
      const sel = await selecteerEnVerrijk(begrensd[i].map(alsSelectieBron), u.methode as RetrievalMeta["methode"], {
        filters: sporen[i].query.filters,
        maxResults: sporen[i].query.maxResultaten,
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
        const v = await opdracht.adapter.verrijkSelectie(spoorContext[i], gekozen, {
          // De EFFECTIEVE peildatum van dit spoor: dezelfde waarde waarmee de
          // retrieval draaide. Een lege string zou de review-vervalcontrole op
          // generieke siblings uitschakelen.
          peildatum: peildatumVanSpoor(sporen[i].query),
        });
        gekozen = v.resultaten;
        Object.assign(extra, v.meta ?? {});
      }
      geselecteerdPerSpoor.push(gekozen);
      extraPerSpoor.push(extra);
      grendel.bewaak();
    }

    // 5. Samenvoegen. Het primaire spoor vooraan; een document dat daar al in zit
    //    komt niet nóg eens uit een volgend spoor (één passage, één bronnummer).
    const primair = geselecteerdPerSpoor[0] ?? [];
    const primaireDocIds = new Set(primair.map((b) => b.documentIdentiteit.documentId));
    const aanvullend = geselecteerdPerSpoor
      .slice(1)
      .flat()
      .filter((b) => !primaireDocIds.has(b.documentIdentiteit.documentId));
    const geselecteerd = [...primair, ...aanvullend];

    // 6. De contextgrens wordt NIET hier afgedwongen. Meten op de kale passage zou
    //    de parent-uitbreiding, de bronkoppen en de scheidingstekens niet
    //    meetellen, en dan is de grens geen grens. Zij geldt in `citeer()`, op de
    //    werkelijk gerenderde blokken.

    // 7. Auditspoor over de HUIDIGE selectie. Kapt `citeer()` later blokken af,
    //    dan wordt deze meta daar opnieuw gebouwd over exact de opgenomen bronnen.
    const metaBasis = {
      methode: uitkomsten[0].methode as RetrievalMeta["methode"],
      opgehaald: uitkomsten.reduce((s, u) => s + u.opgehaald, 0),
      diagnostiek: uitkomsten[0].diagnostiek ?? {},
      // De inhoudsvrije poortsamenvatting reist mee in de META, want die gaat
      // via de route naar het duurzame auditspoor. Alleen aanwezig als er iets
      // is geweigerd: een altijd-aanwezig veld zou elke snapshot veranderen.
      extra: { ...(extraPerSpoor[0] ?? {}), ...(toelating ? { toelating } : {}) },
      primaireRefs: new Set(primair.map((b) => b.ref)),
      meerdereSporen: uitkomsten.length > 1,
    };
    const meta = bouwRetrievalMeta(geselecteerd, metaBasis);

    return {
      kandidaten: begrensd.flat(),
      geselecteerd,
      perAdapter,
      latencyMs: Date.now() - t0,
      truncatie,
      fout: uitkomsten.find((u) => u.fout)?.fout,
      meta,
      // De gezaghebbende grens komt van de primaire query en reist mee, zodat
      // `citeer()` hem niet nóg eens hoeft te krijgen (twee plekken lopen uiteen).
      maxContextTekens: sporen[0].query.maxContextTekens,
      metaBasis,
      // De grendel reist mee naar fase 2: de weergaveverrijking (parent,
      // notulen, documentmetadata) en de contextopbouw horen binnen dezelfde
      // deadline. Sloot hij hier, dan viel dat werk erbuiten en claimde de
      // adapter ten onrechte `timeout: true`. Sluiten doet de EIGENAAR —
      // `voerVolledigeRetrievalUit()` — niet deze fase en niet de volgende.
      grendel,
    };
  } catch (e) {
    // Een afbreking is een EIGEN foutcategorie, geen providerfout — en er volgt
    // geen terugval: de keten stopt volledig. Een EIGEN grendel wordt hier
    // gesloten; een geleende laat je met rust — die is van de uitlener, en die
    // sluit hem in zijn eigen `finally`.
    if (eigenGrendel) grendel.stop();
    throw e;
  }
}

/**
 * DE PUBLIEKE INGANG. Voert beide fasen uit en BEZIT de afbreekgrendel.
 *
 * De tweefasen-API bestaat omdat de citaatvorming een eigen stap is, maar zij
 * gaf de aanroeper een levend handvat in handen: slaagde fase 1 en bleef fase 2
 * uit, dan bleven timer en clientluisteraar staan tot de deadline vuurde. Dat
 * was geen theoretisch lek — het was een verplichting die nergens stond.
 *
 * Hier is de eigenaar expliciet: deze functie maakt de grendel, leent hem uit
 * aan beide fasen, en sluit hem in `finally` — langs élke uitgang, ook als
 * `verrijkWeergave` halverwege faalt. Productiepaden roepen uitsluitend deze
 * functie aan; de contractgate bewaakt dat.
 */
export async function voerVolledigeRetrievalUit(
  ctx: RetrievalContext,
  opdracht: Orkestratieopdracht,
  citaatOpdracht: CitaatOpdracht
): Promise<RetrievalUitkomst> {
  const grendel = maakAfbreekgrendel(ctx.signal, opdracht.timeoutMs ?? TIMEOUT_DEFAULT_MS);
  try {
    const tussen = await voerRetrievalUit(ctx, opdracht, grendel);
    return await citeer(ctx, opdracht.adapter, tussen, citaatOpdracht);
  } finally {
    grendel.stop();
  }
}

/** Vertaalt een afbreking naar de contract-foutcategorie (§4.4). */
export function foutcategorieVoor(e: unknown): "timeout" | "annulering" | null {
  return isAfbreking(e) ? redenVan(e) : null;
}

/**
 * Fase 2: citaatvorming. Maakt van een ONVOLTOOID tussenresultaat het
 * definitieve resultaat dat de generatielaag mag gebruiken.
 *
 * INTERN — zie `voerVolledigeRetrievalUit()`. De route sequencet deze fasen NIET
 * meer: beide draaien binnen die ene aanroep, en het voortgangsevent en het
 * scope-auditspoor komen erná. Daardoor is de volgorde-eis uit PR-A structureel
 * geborgd in plaats van afhankelijk van een aanroeper die haar aanhoudt.
 *
 * Waarom de fasen dan nog gescheiden zijn: citaatvorming is eigen werk met een
 * eigen adapterhook (`verrijkWeergave`), en het tussenresultaat maakt zichtbaar
 * dat een selectie zónder citaties bestaat. De ADAPTER rendert — hij weet hoe
 * zijn bron eruitziet — maar de orkestratie bepaalt wát en in welke volgorde.
 *
 * De grendel in `tussen` is GELEEND van `voerVolledigeRetrievalUit()`; die sluit
 * hem. Deze functie sluit hem ook aan het eind van haar eigen werk, zodat de
 * deadline niet doorloopt als de aanroeper nog iets doet — dubbel sluiten is
 * veilig, want `stop()` is idempotent.
 */
export async function citeer(
  ctx: RetrievalContext,
  adapter: RetrievalAdapter,
  tussen: RetrievalTussenresultaat,
  opdracht: CitaatOpdracht
): Promise<RetrievalUitkomst> {
  // De adapter vult providerspecifieke WEERGAVEMETADATA aan (notulenlabel,
  // documenttype, de uitgebreide parent-passage). Hij bouwt geen citaties.
  // De grendel is GELEEND van `voerVolledigeRetrievalUit()`; die sluit hem in
  // zijn `finally`. Hier wordt hij alleen uit het tussenresultaat gelicht,
  // zodat het eindresultaat pure data blijft.
  const grendel = tussen.grendel;
  const { grendel: _grendel, ...tussenData } = tussen;
  const ctxMetGrendel = grendel ? { ...ctx, signal: grendel.signal } : ctx;
  // Tweemaal citeren op hetzelfde tussenresultaat zou de tweede keer ZONDER
  // deadline draaien; de grendel is enkelvoudig en zegt dat nu zelf.
  if (grendel?.gesloten()) throw new GrendelGesloten();
  try {
    // De weergaveverrijking valt BINNEN de deadline: parent-context, notulen- en
    // documentmetadata doen alle drie nog database-werk.
    const verrijkt = adapter.verrijkWeergave
      ? await adapter.verrijkWeergave(ctxMetGrendel, tussen.geselecteerd)
      : tussen.geselecteerd;
    grendel?.bewaak();

    // Nummering, sentinel, neutralisatie, BronVerwijzing en de contextgrens:
    // centraal, identiek voor elke provider.
    // Eerst de DEFINITIEVE context bouwen — inclusief de harde grens — en pas
    // daarna alle metadata afleiden van exact de bronnen die erin staan.
    // De grens komt UITSLUITEND van de query, via het tussenresultaat.
    const c = bouwCitaties(verrijkt, { ...opdracht, maxContextTekens: tussen.maxContextTekens });
    return {
      ...tussenData,
      geselecteerd: c.opgenomen,
      meta: bouwRetrievalMeta(c.opgenomen, tussen.metaBasis),
      bronverwijzingen: c.bronnen,
      contextTekst: c.contextTekst,
      sentinel: c.sentinel,
      geneutraliseerd: c.geneutraliseerd,
      truncatie: c.afgekapt ? { reden: "tekens" } : tussen.truncatie,
    };
  } finally {
    grendel?.stop();
  }
}
