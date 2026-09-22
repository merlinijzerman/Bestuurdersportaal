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
import {
  verifieerToelatingPerGroep,
  nietOndersteundeFilters,
  vatToelatingSamen,
  type Weigering,
} from "./toelatingspoort";
import { maakAfbreekgrendel, isAfbreking, redenVan, GrendelGesloten, TIMEOUT_DEFAULT_MS } from "./afbreken";
import type { Afbreekgrendel } from "./afbreken";
import { maakDocumentIdentiteit } from "./identiteit";
import type {
  AdapterCapabilities,
  AdapterUitkomst,
  Bronresultaat,
  Bronsoort,
  Bronstatus,
  Bronstatusreden,
  RetrievalFoutcategorie,
  WeergaveKandidaat,
  WeergaveVerrijking,
  CitaatOpdracht,
  Queries,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
  RetrievalTussenresultaat,
  RetrievalUitkomst,
} from "./contract";

const BRONSOORTEN = new Set<string>(["fonds", "generiek", "sharepoint", "notulen", "web"]);
const BIBLIOTHEKEN = new Set<string>(["fonds", "generiek", "sharepoint", "notulen", "web"]);

function isBekendeBronsoort(waarde: unknown): waarde is Bronsoort {
  return typeof waarde === "string" && BRONSOORTEN.has(waarde);
}

function geldigeBronsoorten(waarde: unknown): waarde is Bronsoort[] {
  return Array.isArray(waarde) && waarde.every(isBekendeBronsoort);
}

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
  /**
   * #426 — de adapter VOOR DIT SPOOR. Ontbreekt hij, dan geldt
   * `opdracht.adapter`. Dat is geen gemak maar de byte-identiteitsgarantie:
   * zolang geen enkel spoor dit veld zet, is er precies één adaptergroep en kan
   * de orkestratie niet anders lopen dan vóór T4-E.
   */
  adapter?: RetrievalAdapter;
  /**
   * Wat er gebeurt als DEZE bron niet kon worden geraadpleegd. Gesloten
   * opsomming, geen providerboodschap.
   *
   * Het veld staat op het spoor maar geldt de ADAPTERGROEP: een adapter faalt
   * één keer, niet één keer per spoor. Gemengde standen binnen één groep zijn
   * daarom ongeldig en werpen vóór elke aanroep; wordt die controle omzeild,
   * dan wint `"stop"`. Default `"stop"` — fail-closed is de enige veilige kant,
   * want `"meld"` laat een beurt doorgaan met minder bronnen.
   */
  bijBronfout?: "stop" | "meld";
}

/** #426 — waar één resultaatINSTANTIE vandaan komt. Request-lokaal. */
export interface Herkomst {
  groep: number;
  ordinal: number;
  primair: boolean;
}

/**
 * De request-lokale herkomststaat.
 *
 * EIGENAAR is `voerVolledigeRetrievalUit()` — dezelfde eigenaar als de
 * `Afbreekgrendel` — die hem via een private parameter uitleent aan beide fasen.
 * Bewust géén moduleglobale `WeakMap`: die overleeft het verzoek en wordt gedeeld
 * door élke gelijktijdige beurt in hetzelfde proces. De objectsleutels botsen
 * niet, dus het zou waarschijnlijk wérken — en juist daarom zou een
 * tenantoverschrijdende structuur niet opvallen. Bewust ook géén veld op
 * `RetrievalTussenresultaat`: dat type zit via `Omit<…>` in `RetrievalUitkomst`
 * en verlaat dus de orkestratie.
 */
export interface HerkomstStaat {
  readonly kaart: WeakMap<Bronresultaat, Herkomst>;
  /** Index = adaptergroep. Gevuld door fase 1, gelezen door fase 2. */
  adapters: readonly RetrievalAdapter[];
}

export function maakHerkomstStaat(): HerkomstStaat {
  return { kaart: new WeakMap(), adapters: [] };
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
    documentId: b.documentIdentiteit.id,
    bron: b.documentIdentiteit.bron ?? "",
    bibliotheek: b.documentIdentiteit.bibliotheek ?? "fonds",
    fondsId: b.documentIdentiteit.fondsId ?? null,
    documentstatus: b.status.documentstatus ?? null,
    bronstatus: b.status.bronstatus ?? null,
    documentdatum: b.weergave?.documentdatum ?? null,
    score: b.rang.score ?? null,
    fts: b.rang.fts ?? null,
    vec: b.rang.vec ?? null,
    documentIdentiteit: b.documentIdentiteit.id,
    passageIdentiteit: b.passageIdentiteit.id,
    versie: b.versie,
  };
}

function alsSelectieBron(b: Bronresultaat): SelectieBron {
  return {
    id: b.ref,
    document_id: b.documentIdentiteit.id,
    tekst: b.passage,
    rang: b.rang.score ?? null,
    titel: b.titel,
    bibliotheek: b.documentIdentiteit.bibliotheek ?? "fonds",
    normgewicht: b.curatie?.normgewicht ?? null,
    wettelijkRegime: b.curatie?.wettelijkRegime ?? null,
  };
}

/**
 * Een adapter krijgt server-afgeleide scope, maar mag niet de enige bewaker
 * daarvan zijn. Een foutieve of kwaadwillige adapteruitkomst wordt hier nog
 * eenmaal providerneutraal tegen fonds, document en proces getoetst.
 */
export function binnenServerScope(ctx: RetrievalContext, bron: Bronresultaat): boolean {
  if (!isBekendeBronsoort(bron.bronsoort)) return false;
  const identiteit = bron.documentIdentiteit;
  if (identiteit.bibliotheek !== undefined && identiteit.bibliotheek !== null
    && !BIBLIOTHEKEN.has(identiteit.bibliotheek)) return false;
  // Fondsgebonden bronnen zonder fonds-id zijn géén neutrale bron: zonder deze
  // expliciete tak werd `null` als "niet te controleren" behandeld en dus
  // doorgelaten. Alleen een bron die zowel contractueel als in de
  // documentidentiteit echt generiek is, mag fondsloos zijn.
  if (identiteit.fondsId == null) {
    if (bron.bronsoort !== "generiek" || identiteit.bibliotheek !== "generiek") return false;
  } else if (identiteit.fondsId !== ctx.fondsId) {
    return false;
  }
  if (ctx.scope?.documentIds?.length) {
    // Bestaande lokale aanroepers leveren server-side documentrefs (UUID's),
    // terwijl na #367 alleen de opaque identiteit de adaptergrens passeert.
    // Een externe adapter moet een al-opaque scopewaarde leveren; voor de
    // lokale fonds/generiek-adapter herleiden we dezelfde centrale identiteit.
    const namespace = bron.documentIdentiteit.bron === "Decision Object"
      ? `fonds:${ctx.fondsId}:decision`
      : bron.bronsoort === "generiek"
      ? "generiek"
      : bron.bronsoort === "fonds" || bron.bronsoort === "notulen"
        ? `fonds:${ctx.fondsId}`
        : null;
    const binnenDocumentScope = ctx.scope.documentIds.some((scopeRef) =>
      scopeRef === identiteit.id ||
      (namespace !== null && maakDocumentIdentiteit(namespace, scopeRef) === identiteit.id)
    );
    if (!binnenDocumentScope) return false;
  }
  if (ctx.scope?.procesId && identiteit.procesId !== ctx.scope.procesId) return false;
  return true;
}

/**
 * De volledige servergrens vóór V1–V5: fonds/bibliotheek/processcope én het
 * server-afgeleide bronbeleid moeten alle drie kloppen. Niet-zoekende
 * evidencereaders gebruiken exact deze functie; zo ontstaat naast de
 * orkestratie geen tweede, zwakkere scopepoort.
 */
export function binnenCentraleServergrens(
  ctx: RetrievalContext,
  capabilities: Pick<AdapterCapabilities, "bronsoorten">,
  bron: Bronresultaat
): boolean {
  if (!geldigeBronsoorten(ctx.bronbeleid.bronsoorten)
    || !geldigeBronsoorten(capabilities.bronsoorten)
    || !isBekendeBronsoort(bron.bronsoort)) return false;
  return ctx.bronbeleid.bronsoorten.includes(bron.bronsoort)
    && capabilities.bronsoorten.includes(bron.bronsoort)
    && binnenServerScope(ctx, bron);
}

/**
 * Bouwt het auditspoor over EXACT de meegegeven bronnen. Eén functie, gebruikt
 * door fase 1 én opnieuw door `citeer()` zodra de contextgrens blokken heeft
 * afgekapt — anders noemt `meta.geselecteerd`, `meta.chunks`,
 * `bronversie_audit` of `aanvullend` bronnen die nooit naar het model gingen.
 */
function bouwRetrievalMeta(
  opgenomen: Bronresultaat[],
  basis: RetrievalTussenresultaat["metaBasis"],
  /**
   * #426 — welke opgenomen bronnen primair zijn. Zonder staat valt hij terug op
   * `primaireRefs`; dat is het pad van vóór T4-E en blijft byte-identiek. MET
   * staat leest hij de herkomst van de INSTANTIE, want een `ref` uit groep B die
   * gelijk is aan een primaire `ref` uit groep A zou anders als primair tellen.
   */
  primairVan?: (bron: Bronresultaat) => boolean
): RetrievalMeta {
  const isPrimair = primairVan ?? ((b: Bronresultaat) => basis.primaireRefs.has(b.ref));
  const primair = opgenomen.filter(isPrimair);
  const aanvullend = opgenomen.filter((b) => !isPrimair(b));
  const basisMeta = bouwMeta(basis.methode, basis.opgehaald, primair.map(alsAuditBron), basis.correlationId);
  const volledigeBronmeta = bouwMeta(
    basis.methode,
    basis.opgehaald,
    opgenomen.map(alsAuditBron),
    basis.correlationId
  );
  return {
    ...basisMeta,
    ...basis.diagnostiek,
    ...basis.extra,
    chunks: [
      ...basisMeta.chunks,
      ...aanvullend.map((b) => ({
        id: b.ref,
        document_id: b.documentIdentiteit.id,
        rang: b.rang.score ?? null,
      })),
    ],
    // Een bevroren reflectiebronset moet ook bij meerdere sporen iedere
    // geselecteerde passage volledig aan versie en citation kunnen binden.
    bronversie_audit: volledigeBronmeta.bronversie_audit,
    opgehaald: basis.opgehaald,
    geselecteerd: opgenomen.length,
    ...(basis.meerdereSporen
      ? {
          aanvullend: {
            chunks: aanvullend.length,
            documenten: new Set(aanvullend.map((b) => b.documentIdentiteit.id)).size,
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
  geleendeGrendel?: Afbreekgrendel,
  /** #426 — GELEEND van `voerVolledigeRetrievalUit()`; zie `HerkomstStaat`. */
  herkomst?: HerkomstStaat
): Promise<RetrievalTussenresultaat> {
  const t0 = Date.now();
  const sporen = opdracht.sporen;
  if (sporen.length === 0) {
    throw new Error("orkestratie: ten minste één spoor is vereist");
  }

  // ── Adaptergroepen ────────────────────────────────────────────────────────
  // Groeperen op OBJECTIDENTITEIT, niet op naam: twee verschillend
  // geconfigureerde instanties van dezelfde adapter mogen elkaars standenmap
  // niet delen. Zolang geen spoor een eigen adapter zet, is er één groep en is
  // elke stap hieronder identiek aan die van vóór T4-E.
  const groepen: RetrievalAdapter[] = [];
  const groepVanAdapter = new Map<RetrievalAdapter, number>();
  const spoorNaarGroep = sporen.map(({ adapter }) => {
    const effectief = adapter ?? opdracht.adapter;
    let groep = groepVanAdapter.get(effectief);
    if (groep === undefined) {
      groep = groepen.length;
      groepen.push(effectief);
      groepVanAdapter.set(effectief, groep);
    }
    return groep;
  });
  if (herkomst) herkomst.adapters = groepen;

  // `bijBronfout` geldt de GROEP; gemengde standen drukken een tegenstrijdige
  // bedoeling uit en horen luid te falen in plaats van stil te worden uitgelegd.
  const beleidPerGroep = bepaalBronfoutbeleid(sporen, spoorNaarGroep);

  const capsPerGroep = groepen.map((a) => a.capabilities());
  const capsVanSpoor = (i: number) => capsPerGroep[spoorNaarGroep[i]];
  const adapterVanSpoor = (i: number) => groepen[spoorNaarGroep[i]];

  const eigenGrendel = geleendeGrendel === undefined;
  const grendel = geleendeGrendel ?? maakAfbreekgrendel(ctx.signal, opdracht.timeoutMs ?? TIMEOUT_DEFAULT_MS);
  const ctxMetGrendel = { ...ctx, signal: grendel.signal };

  const vandaagVoorDezeBeurt = effectievePeildatum(undefined);
  const peildatumVanSpoor = (q: RetrievalQuery) => q.filters?.peildatum ?? vandaagVoorDezeBeurt;

  const spoorContext = sporen.map(({ query }) => ({
    ...ctxMetGrendel,
    scope: { ...ctx.scope, documentIds: query.documentScope },
  }));
  try {
    // ── 1a. Filterbelofte, VÓÓR `zoek()` ─────────────────────────────────────
    const contextBronsoortenGeldig = geldigeBronsoorten(ctx.bronbeleid.bronsoorten);
    const toegestaneBronsoorten = new Set(contextBronsoortenGeldig ? ctx.bronbeleid.bronsoorten : []);
    const nietOndersteund = sporen.map(({ query }, i) => {
      const caps = capsVanSpoor(i);
      const fouten = nietOndersteundeFilters(caps, query);
      if (!contextBronsoortenGeldig) fouten.push("bronbeleid:ongeldige_bronsoort");
      if (!geldigeBronsoorten(caps.bronsoorten)) fouten.push("capability:ongeldige_bronsoort");
      if (!caps.strategieen.includes(query.strategie)) fouten.push(`strategie:${query.strategie}`);
      for (const bronsoort of query.filters?.bronsoort ?? []) {
        if (!isBekendeBronsoort(bronsoort) || !toegestaneBronsoorten.has(bronsoort)) {
          fouten.push(`bronbeleid:${bronsoort}`);
        }
      }
      return fouten;
    });
    const filterweigeringen = nietOndersteund.filter((f) => f.length > 0).length;

    // ── 1b. Adapters bevragen, parallel per spoor ────────────────────────────
    const uitkomsten: AdapterUitkomst[] = await Promise.all(
      sporen.map(({ query }, i) =>
        nietOndersteund[i].length > 0
          ? Promise.resolve<AdapterUitkomst>({
              kandidaten: [],
              methode: "geen",
              provider: "geen",
              latencyMs: 0,
              opgehaald: 0,
              fout: "configuratiefout",
            })
          : adapterVanSpoor(i).zoek(spoorContext[i], query)
      )
    );
    grendel.bewaak();

    const scopeweigeringen: Weigering[] = [];

    // ── 2. VOORGRENS, zonder I/O ─────────────────────────────────────────────
    //    Geen toelatingspoort en geen bewijs: alleen voorkomen dat een adapter
    //    verrijkings-I/O doet voor een kandidaat die op zijn RUWE, server-
    //    controleerbare velden al evident buiten scope valt.
    //    De weigering wordt HIER al vastgelegd. Filtert de voorgrens stil, dan
    //    verdwijnt een buiten-scope-kandidaat zonder spoor in de audit: hij
    //    bereikt de tweede grens niet meer en zou daar dus ook niet worden
    //    geteld. Dubbeltellen kan niet, juist omdat hij niet verder komt.
    const voorgeselecteerd = uitkomsten.map((u, spoor) =>
      u.kandidaten.filter((b) => {
        const toegestaan = binnenCentraleServergrens(spoorContext[spoor], capsVanSpoor(spoor), b);
        if (!toegestaan) scopeweigeringen.push({ spoor, ref: b.ref, grond: "buiten_server_scope" });
        return toegestaan;
      })
    );

    // ── 3. PRE-POORTVERRIJKING (#426 D-6) ────────────────────────────────────
    //    Alles wat een `Bronresultaat` buiten `weergave` kan wijzigen, gebeurt
    //    HIER — vóór de definitieve servergrens en vóór V1–V5. Anders kan een
    //    bron die als `fonds` is toegelaten ná de poort `notulen` worden, en dat
    //    is precies het veld waarop de grens beslist.
    const verrijkt: Bronresultaat[][] = [];
    const extraPerSpoor: Partial<RetrievalMeta>[] = [];
    for (let i = 0; i < voorgeselecteerd.length; i++) {
      const hook = adapterVanSpoor(i).verrijkKandidaten;
      if (!hook || voorgeselecteerd[i].length === 0) {
        verrijkt.push(voorgeselecteerd[i]);
        extraPerSpoor.push({});
        continue;
      }
      const v = await hook.call(adapterVanSpoor(i), spoorContext[i], voorgeselecteerd[i], {
        peildatum: peildatumVanSpoor(sporen[i].query),
      });
      verrijkt.push(v.resultaten);
      extraPerSpoor.push({ ...(v.meta ?? {}) });
      grendel.bewaak();
    }

    // ── 4. De DEFINITIEVE servergrens, op de verrijkte vorm ──────────────────
    const beleidsToegelaten = verrijkt.map((lijst, spoor) =>
      lijst.filter((b) => {
        const toegestaan = binnenCentraleServergrens(spoorContext[spoor], capsVanSpoor(spoor), b);
        if (!toegestaan) scopeweigeringen.push({ spoor, ref: b.ref, grond: "buiten_server_scope" });
        return toegestaan;
      })
    );

    // ── 5. TOELATINGSPOORT, per adaptergroep, met ÉÉN gedeelde `poortNu` ─────
    const poort = await verifieerToelatingPerGroep(
      ctxMetGrendel,
      groepen,
      beleidsToegelaten,
      spoorNaarGroep,
      Date.now()
    );
    grendel.bewaak();
    const toegelatenPerSpoor = poort.toegelatenPerSpoor;
    const alleWeigeringen = [...scopeweigeringen, ...poort.geweigerd];
    const geweigerdPerSpoor = sporen.map((_, i) => alleWeigeringen.filter((w) => w.spoor === i).length);
    const toelating = vatToelatingSamen(alleWeigeringen, filterweigeringen);

    const perAdapter: RetrievalTussenresultaat["perAdapter"] = uitkomsten.map((u, i) => ({
      naam: adapterVanSpoor(i).naam,
      query: sporen[i].query.naam,
      methode: u.methode,
      latencyMs: u.latencyMs,
      kandidaten: toegelatenPerSpoor[i].length,
      fout: u.fout ?? (scopeweigeringen.some((w) => w.spoor === i) ? "buiten_scope" : undefined),
      ...(geweigerdPerSpoor[i] > 0 ? { geweigerd: geweigerdPerSpoor[i] } : {}),
    }));

    // ── 6. Harde grens op de KANDIDATENPOOL ─────────────────────────────────
    let truncatie: RetrievalTussenresultaat["truncatie"];
    const begrensd = toegelatenPerSpoor.map((toegelaten, i) => {
      const max = sporen[i].query.maxKandidaten;
      if (toegelaten.length <= max) return toegelaten;
      truncatie = { reden: "kandidaten" };
      return toegelaten.slice(0, max);
    });

    // ── 7. Selectie PER SPOOR ───────────────────────────────────────────────
    const geselecteerdPerSpoor: Bronresultaat[][] = [];
    for (let i = 0; i < uitkomsten.length; i++) {
      const g = sporen[i].grenzen;
      const perRef = new Map(begrensd[i].map((b) => [b.ref, b]));
      const sel = await selecteerEnVerrijk(
        begrensd[i].map(alsSelectieBron),
        uitkomsten[i].methode as RetrievalMeta["methode"],
        {
          filters: sporen[i].query.filters,
          maxResults: sporen[i].query.maxResultaten,
          maxPerDoc: g.maxPerDoc,
          representatieConstraints: g.representatieConstraints,
          regimeWeging: g.regimeWeging,
          relevantieDrempel: g.relevantieDrempel,
        }
      );
      geselecteerdPerSpoor.push(
        sel.chunks.map((b) => perRef.get(b.id)).filter((b): b is Bronresultaat => Boolean(b))
      );
      Object.assign(extraPerSpoor[i], sel.extra);
      grendel.bewaak();
    }

    // ── 8. Samenvoegen ──────────────────────────────────────────────────────
    const primair = geselecteerdPerSpoor[0] ?? [];
    const primaireDocIds = new Set(primair.map((b) => b.documentIdentiteit.id));
    const aanvullend = geselecteerdPerSpoor
      .slice(1)
      .flat()
      .filter((b) => !primaireDocIds.has(b.documentIdentiteit.id));
    const geselecteerd = [...primair, ...aanvullend];

    // ── 9. HERKOMST per instantie, VÓÓR enige groepering ─────────────────────
    if (herkomst) {
      const groepVanBron = new Map<Bronresultaat, number>();
      geselecteerdPerSpoor.forEach((lijst, i) => {
        for (const b of lijst) if (!groepVanBron.has(b)) groepVanBron.set(b, spoorNaarGroep[i]);
      });
      geselecteerd.forEach((bron, ordinal) => {
        herkomst.kaart.set(bron, {
          groep: groepVanBron.get(bron) ?? 0,
          ordinal,
          primair: ordinal < primair.length,
        });
      });
    }

    const metaBasis = {
      methode: uitkomsten[0].methode as RetrievalMeta["methode"],
      opgehaald: uitkomsten.reduce((s, u) => s + u.opgehaald, 0),
      diagnostiek: uitkomsten[0].diagnostiek ?? {},
      extra: { ...(extraPerSpoor[0] ?? {}), ...(toelating ? { toelating } : {}) },
      primaireRefs: new Set(primair.map((b) => b.ref)),
      meerdereSporen: uitkomsten.length > 1,
      correlationId: ctx.correlationId,
    };
    const meta = bouwRetrievalMeta(geselecteerd, metaBasis, primairVanMet(herkomst, metaBasis));

    const bronstatus = bouwBronstatus(uitkomsten, perAdapter, spoorNaarGroep, groepen, beleidPerGroep);

    return {
      kandidaten: begrensd.flat(),
      geselecteerd,
      perAdapter,
      latencyMs: Date.now() - t0,
      truncatie,
      fout:
        uitkomsten.find((u) => u.fout)?.fout ??
        (scopeweigeringen.length > 0 ? "buiten_scope" : undefined),
      meta,
      maxContextTekens: sporen[0].query.maxContextTekens,
      ...(bronstatus.length > 0 ? { bronstatus } : {}),
      metaBasis,
      grendel,
    };
  } catch (e) {
    if (eigenGrendel) grendel.stop();
    throw e;
  }
}

/**
 * `bijBronfout` per adaptergroep. Gemengde standen binnen één groep zijn
 * ongeldig: een adapter faalt één keer, niet één keer per spoor, dus twee
 * tegenstrijdige standen laten niet vaststellen wat er moet gebeuren.
 *
 * Werpt daarom vóór elke aanroep — hetzelfde patroon als de bestaande
 * `sporen.length === 0`-grendel, die ook een geval afvangt dat het type al
 * verbiedt. En mocht deze functie ooit worden omzeild, dan wint `"stop"`.
 */
function bepaalBronfoutbeleid(
  sporen: Queries<Spoor>,
  spoorNaarGroep: readonly number[]
): ("stop" | "meld")[] {
  const beleid: ("stop" | "meld")[] = [];
  for (let i = 0; i < sporen.length; i++) {
    const groep = spoorNaarGroep[i];
    const stand = sporen[i].bijBronfout ?? "stop";
    if (beleid[groep] === undefined) beleid[groep] = stand;
    else if (beleid[groep] !== stand) {
      throw new Error(
        "orkestratie: gemengde bijBronfout binnen één adaptergroep — dat drukt een tegenstrijdige bedoeling uit"
      );
    }
  }
  return beleid.map((b) => (b === "meld" ? "meld" : "stop"));
}

/** Leest primair van de INSTANTIE zodra er een herkomststaat is; anders van de ref. */
function primairVanMet(
  herkomst: HerkomstStaat | undefined,
  basis: RetrievalTussenresultaat["metaBasis"]
): ((bron: Bronresultaat) => boolean) | undefined {
  if (!herkomst) return undefined;
  return (bron) => herkomst.kaart.get(bron)?.primair ?? basis.primaireRefs.has(bron.ref);
}

/**
 * #426 — waarom een GEVRAAGDE bron niet in het antwoord zit.
 *
 * Alleen aanwezig als er werkelijk iets te melden is. Inhoudsvrij: adapternaam,
 * bronsoort en een gesloten reden — nooit een providerboodschap.
 */
function bouwBronstatus(
  uitkomsten: readonly AdapterUitkomst[],
  perAdapter: RetrievalTussenresultaat["perAdapter"],
  spoorNaarGroep: readonly number[],
  groepen: readonly RetrievalAdapter[],
  beleidPerGroep: readonly ("stop" | "meld")[]
): Bronstatus[] {
  const status: Bronstatus[] = [];
  const gezien = new Set<number>();
  for (let i = 0; i < uitkomsten.length; i++) {
    const groep = spoorNaarGroep[i];
    if (gezien.has(groep)) continue;
    const fout = perAdapter[i].fout;
    if (!fout) continue;
    gezien.add(groep);
    status.push({
      adapter: groepen[groep].naam,
      bronsoort: groepen[groep].capabilities().bronsoorten[0] ?? "fonds",
      geraadpleegd: uitkomsten[i].provider !== "geen",
      reden: redenVanFout(fout),
    });
    // `"stop"` betekent dat de beurt hier fail-closed hoort te stoppen. Die
    // beslissing hoort bij de aanroeper (T4-E-orkestratielaag boven deze fase);
    // wat hier gebeurt is dat de status ZICHTBAAR wordt gemaakt, zodat een
    // kleinere bronset nooit stil als volledig kan worden gepresenteerd.
    void beleidPerGroep[groep];
  }
  return status;
}

function redenVanFout(fout: RetrievalFoutcategorie): Bronstatusreden {
  switch (fout) {
    case "timeout":
      return "timeout";
    case "annulering":
      return "geannuleerd";
    case "geen_resultaten":
      return "geen_resultaten";
    case "toestemming_geweigerd":
      return "token_ongeldig";
    case "configuratiefout":
      return "readiness_ontbreekt";
    default:
      return "providerfout";
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
  // #426 — deze functie is óók eigenaar van de request-lokale herkomststaat, en
  // leent hem net als de grendel uit aan beide fasen. Hij leeft precies zo lang
  // als dit verzoek: geen moduleglobale structuur die gelijktijdige beurten van
  // verschillende fondsen zouden delen, en geen veld op het tussenresultaat, dat
  // via `Omit<…>` in `RetrievalUitkomst` zit en de orkestratie dus verlaat.
  const herkomst = maakHerkomstStaat();
  try {
    const tussen = await voerRetrievalUit(ctx, opdracht, grendel, herkomst);
    return await citeer(ctx, opdracht.adapter, tussen, citaatOpdracht, herkomst);
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
  opdracht: CitaatOpdracht,
  /** #426 — GELEEND van `voerVolledigeRetrievalUit()`; zie `HerkomstStaat`. */
  herkomst?: HerkomstStaat
): Promise<RetrievalUitkomst> {
  const grendel = tussen.grendel;
  const { grendel: _grendel, ...tussenData } = tussen;
  const ctxMetGrendel = grendel ? { ...ctx, signal: grendel.signal } : ctx;
  if (grendel?.gesloten()) throw new GrendelGesloten();
  try {
    const verrijkt = await pasWeergaveToe(ctxMetGrendel, adapter, tussen.geselecteerd, herkomst);
    grendel?.bewaak();

    const primairVan = primairVanMet(herkomst, tussen.metaBasis);
    const primaireDocumentIds = opdracht.primaireDocumentIds?.size
      ? new Set(
          verrijkt
            .filter((bron) =>
              primairVan ? primairVan(bron) : tussen.metaBasis.primaireRefs.has(bron.ref)
            )
            .map((bron) => bron.documentIdentiteit.id)
        )
      : opdracht.primaireDocumentIds;
    const c = bouwCitaties(verrijkt, {
      ...opdracht,
      primaireDocumentIds,
      maxContextTekens: tussen.maxContextTekens,
    });
    return {
      ...tussenData,
      geselecteerd: c.opgenomen,
      meta: bouwRetrievalMeta(c.opgenomen, tussen.metaBasis, primairVan),
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

/**
 * Past de gesloten weergavepatch per adaptergroep toe.
 *
 * DE HOOK KRIJGT HET `Bronresultaat` NIET. Hij ziet `{ ref, weergave }` en
 * levert `WeergaveVerrijking[]`; deze functie houdt het toegelaten resultaat
 * vast, maakt per occurrence een VERSE instantie en zet alleen `weergave`. Dat
 * de instanties hier ontstaan is geen tegenmaatregel maar een eigenschap: ze
 * zijn per constructie uniek, ook als twee occurrences dezelfde `ref` hebben.
 *
 * De verdeling over groepen is uitsluitend voor de hook; de volgorde komt terug
 * uit de OORSPRONKELIJKE positie in `geselecteerd` — die is de ordinal. Bij één
 * groep is dat een identiteitsoperatie.
 */
async function pasWeergaveToe(
  ctx: RetrievalContext,
  standaard: RetrievalAdapter,
  geselecteerd: readonly Bronresultaat[],
  herkomst: HerkomstStaat | undefined
): Promise<Bronresultaat[]> {
  const groepen = herkomst && herkomst.adapters.length > 0 ? herkomst.adapters : [standaard];
  const positiesPerGroep: number[][] = groepen.map(() => []);
  geselecteerd.forEach((bron, i) => {
    const groep = herkomst?.kaart.get(bron)?.groep ?? 0;
    (positiesPerGroep[groep] ?? positiesPerGroep[0]).push(i);
  });

  const perPositie = new Map<number, Bronresultaat>();
  for (let groep = 0; groep < groepen.length; groep++) {
    const posities = positiesPerGroep[groep];
    if (posities.length === 0) continue;
    const bronnen = posities.map((i) => geselecteerd[i]);
    const hook = groepen[groep].verrijkWeergave;
    if (!hook) {
      posities.forEach((i, k) => perPositie.set(i, versInstantie(bronnen[k], undefined, herkomst)));
      continue;
    }
    const kandidaten: WeergaveKandidaat[] = bronnen.map((b) => ({ ref: b.ref, weergave: b.weergave }));
    const patches = await hook.call(groepen[groep], ctx, kandidaten);
    if (!Array.isArray(patches) || patches.length !== bronnen.length) {
      throw new Error("orkestratie: verrijkWeergave() gaf niet evenveel patches als kandidaten");
    }
    for (let k = 0; k < bronnen.length; k++) {
      const patch = lees(patches, k);
      if (patch.type === "weglaten") continue;
      perPositie.set(
        posities[k],
        versInstantie(bronnen[k], patch.type === "verrijkt" ? patch.weergave : undefined, herkomst)
      );
    }
  }

  // STABIEL op de oorspronkelijke positie — dat is de ordinal. Aaneenschakelen
  // per groep zou bij verweven groepen de bronvolgorde veranderen.
  return [...perPositie.keys()].sort((a, b) => a - b).map((i) => perPositie.get(i)!);
}

/**
 * Leest één patch en weigert alles wat geen expliciete uitkomst is.
 *
 * Gelijke arraylengte is niet genoeg: een gat in een sparse array of een
 * `undefined` heeft wél de goede `length`, maar betekent een vergeten tak en
 * geen besluit om een bron weg te laten.
 */
function lees(patches: WeergaveVerrijking[], index: number): WeergaveVerrijking {
  const patch = Object.prototype.hasOwnProperty.call(patches, index) ? patches[index] : undefined;
  if (
    patch === undefined ||
    patch === null ||
    typeof patch !== "object" ||
    (patch.type !== "behouden" && patch.type !== "weglaten" && patch.type !== "verrijkt")
  ) {
    throw new Error("orkestratie: verrijkWeergave() gaf een ongeldige patch op positie " + index);
  }
  return patch;
}

/** Verse instantie, met de herkomst van het origineel overgenomen. */
function versInstantie(
  origineel: Bronresultaat,
  weergave: Bronresultaat["weergave"] | undefined,
  herkomst: HerkomstStaat | undefined
): Bronresultaat {
  const vers: Bronresultaat = weergave === undefined ? { ...origineel } : { ...origineel, weergave };
  const eerder = herkomst?.kaart.get(origineel);
  if (herkomst && eerder) herkomst.kaart.set(vers, eerder);
  return vers;
}
