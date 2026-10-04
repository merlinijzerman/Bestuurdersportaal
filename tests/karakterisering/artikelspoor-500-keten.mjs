// ============================================================================
//  #500 hotfix productietime-out — de VOLLEDIGE vraagketen, lokaal eind-tot-eind.
// ----------------------------------------------------------------------------
//  Preview heeft geen juridische documenten, dus de keten wordt lokaal bewezen:
//  de gebouwde app (`next start`, HYBRID_SEARCH=on) tegen een productie-achtige
//  fixture, met de lokale WP4-AI-providerstub en de embeddingstub (geen echte
//  modelcall, geen netwerk buiten 127.0.0.1). Als ingelogde fondsgebruiker
//  (W1-bestuurder) gaan de drie 150d-pilotvragen en de reglementvraag via
//  `POST /api/chat`. Per vraag:
//    - afgerond (`done`) zonder error-event, 57014 of time-out, met duur;
//    - de geselecteerde bronnen in volgorde (governance_log.retrieval_meta.chunks);
//    - `retrieval_meta.selectie.juridisch.artikel`.
//  Acceptatie (issue #500):
//    bedoeling  — MvT p.395 ("Artikelsgewijze toelichting — Artikel 150d") is de
//                 eerste wetsgeschiedenis, en de Pensioenwet (artikel 150d) is
//                 geselecteerd als normatieve basis;
//    norm       — de Pensioenwet (artikel 150d) is de eerste juridische bron; de
//                 MvT staat nooit vóór de wet;
//    gecombineerd — wet en MvT beide geselecteerd, wet vóór MvT;
//    alle drie  — artikel.exact ≥ 1, geboost_geselecteerd ≥ 1, via_artikelspoor ≥ 1;
//    reglement  — géén `selectie.juridisch.artikel`.
//
//  DE FIXTURE. `supabase/checks/2026_09_29_500_artikelspoor_performance.sql`
//  (18.418 chunks; Pensioenwet 968, MvT 2.738 met p.395 op chunk 2396, twee
//  "Besluit uitvoering"-documenten, 83 fondsdocumenten), met de 60
//  fondsdocumenten van fonds A aan het W1-fonds en COMMIT. Dit script voegt
//  daar ~30 concurrerende MvT-passages aan toe die ALLE vraagwoorden bevatten
//  (en een pseudo-embedding van de stub), zodat de exacte p.395-passage — net
//  als in de productiepilot — niet in de kandidatenset van de hybride zoek-RPC
//  komt en alleen via het artikelspoor binnenkan.
//
//  DRAAIRECEPT (lokaal; shims voor supabase/psql zoals in tests/karakterisering/README.md):
//    bash scripts/start-ephemeral-supabase.sh
//    TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres \
//      bash scripts/testdb-apply-migrations.sh
//    node --env-file=.env.local tests/karakterisering/seed.mjs            # W1-fonds + gebruikers
//    psql postgresql://postgres:postgres@host.docker.internal:54322/postgres -v ON_ERROR_STOP=1 \
//      -v art500_fonds_a=00000000-0000-4000-8000-000000000001 -v art500_behoud=1 \
//      -f supabase/checks/2026_09_29_500_artikelspoor_performance.sql
//    npm run build
//    node tests/e2e/fixtures/ai-provider-stub.mjs &                      # :8790
//    node tests/e2e/fixtures/embed-stub.mjs &                            # :8791
//    HYBRID_SEARCH=on PORT=3000 npm run start &
//    node --env-file=.env.local tests/karakterisering/artikelspoor-500-keten.mjs
//  `.env.local` (gitignored) zoals de karakteriseringsjob (.github/workflows/
//  karakterisering.yml): lokale stack-keys, SEED_DOELOMGEVING=local,
//  WP4_E2E_AI_PROVIDER=local (+_URL :8790), WP4_E2E_EMBED_PROVIDER=local
//  (+_URL :8791), MISTRAL_API_KEY=<stub>, AI_GATEWAY_DATABASE_URL (lokaal),
//  HYBRID_SEARCH=on. Exit 0 = alle acceptatiepunten groen; anders exit 1.
// ============================================================================
import { pathToFileURL } from "node:url";
import { createHash, randomUUID } from "node:crypto";
import { ENV, FONDS_ID, WACHTWOORD, emailVoor } from "./config.mjs";
import { adminClient, seed } from "./seed.mjs";
import { sessieCookies } from "./sessie.mjs";
import { bevestigVeiligeSeedDoelomgeving } from "./seed-doelomgeving.mjs";
import { controleerTekstzoekpad } from "./zoektekst-fondsvlag.mjs";
import { pseudoEmbedding, vectorLiteral } from "../e2e/fixtures/embed-vector.mjs";
import { EMBED_STUB_MODEL } from "../e2e/fixtures/config.mjs";

export const PW_DOC = "05002000-0000-0000-0000-00000000a001";
export const MVT_DOC = "05002000-0000-0000-0000-00000000a002";
const LIMIET_CHAT_ENDPOINT = "chat";

export const VRAGEN = [
  { naam: "bedoeling", vraag: "Wat was de bedoeling van de wetgever bij artikel 150d Pensioenwet?" },
  { naam: "norm", vraag: "Wat bepaalt artikel 150d Pensioenwet?" },
  {
    naam: "gecombineerd",
    vraag:
      "Wat bepaalt artikel 150d Pensioenwet over het transitieplan en wat was volgens de memorie van toelichting de bedoeling daarvan?",
  },
  { naam: "reglement", vraag: "Wat staat in artikel 5 van ons reglement?" },
];

/** Concurrerende MvT-passages: alle vraagwoorden, maar geen exacte artikelpassage. */
export function concurrenten() {
  const uit = [];
  for (let i = 0; i < 30; i++) {
    const tekst =
      `Algemeen deel, paragraaf ${i + 1}. De bedoeling van de wetgever met de wijziging van de Pensioenwet is ` +
      `een evenwichtige overgang naar het nieuwe stelsel. Wat bepaalt de wet hierover? In het transitieplan ` +
      `(zie artikel 150d Pensioenwet) leggen sociale partners hun keuzes vast; de memorie van toelichting ` +
      `beschrijft de bedoeling daarvan in algemene zin (variant ${i}).`;
    uit.push({
      id: `05003000-0000-4000-8000-${String(i + 1).padStart(12, "0")}`,
      document_id: MVT_DOC,
      chunk_index: 3000 + i,
      pagina: 20 + i,
      tekst,
      structuur_type: "paragraaf",
      structuur_label: `§${i + 1} Algemeen deel`,
      context_prefix: `§${i + 1} Algemeen deel — Memorie van toelichting Wet toekomst pensioenen`,
      embedding: vectorLiteral(pseudoEmbedding(tekst)),
      embedding_model: EMBED_STUB_MODEL,
      indexering_versie: "art500-keten-v1",
    });
  }
  // De passage uit de pilot die wél werd geselecteerd (p.365, artikel 16).
  const p365 =
    "Artikel 16 Pensioenwet (Informatieverplichting)\nDe bedoeling van de wetgever is dat de deelnemer tijdig " +
    "wordt geïnformeerd over de overgang en het transitieplan (artikel 150d Pensioenwet).";
  uit.push({
    id: "05003000-0000-4000-8000-000000000365",
    document_id: MVT_DOC,
    chunk_index: 3100,
    pagina: 365,
    tekst: p365,
    structuur_type: "artikel",
    structuur_label: "Artikelsgewijze toelichting — Artikel 16",
    context_prefix: "Artikelsgewijze toelichting — Artikel 16 — Memorie van toelichting",
    embedding: vectorLiteral(pseudoEmbedding(p365)),
    embedding_model: EMBED_STUB_MODEL,
    indexering_versie: "art500-keten-v1",
  });
  return uit;
}

function leesSse(tekst) {
  const events = [];
  for (const regel of tekst.split("\n")) {
    if (!regel.startsWith("data:")) continue;
    try {
      events.push(JSON.parse(regel.slice(5).trim()));
    } catch {
      events.push({ type: "_niet_json", ruw: regel.slice(5, 200) });
    }
  }
  return events;
}

export async function stelVraag(admin, cookieHeader, gebruikerId, vraag) {
  await admin.from("rate_limit_events").delete().eq("endpoint", LIMIET_CHAT_ENDPOINT);
  const voor = new Date().toISOString();
  const t0 = performance.now();
  const res = await fetch(`${ENV.appBaseUrl}/api/chat`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: cookieHeader,
      origin: ENV.appBaseUrl,
      "idempotency-key": randomUUID(),
    },
    body: JSON.stringify({ vraag }),
  });
  const tekst = await res.text();
  const duurMs = Math.round(performance.now() - t0);
  const events = leesSse(tekst);
  // governance_log wordt ná de stream geschreven; even wachten mag.
  let log = null;
  for (let i = 0; i < 20 && !log; i++) {
    const { data } = await admin
      .from("governance_log")
      .select("id, aangemaakt, retrieval_meta")
      .eq("gebruiker_id", gebruikerId)
      .gte("aangemaakt", voor)
      .order("aangemaakt", { ascending: false })
      .limit(1);
    log = data?.[0] ?? null;
    if (!log) await new Promise((r) => setTimeout(r, 250));
  }
  return { status: res.status, duurMs, events, log, ruwBegin: tekst.slice(0, 300) };
}

// retrieval_meta.chunks draagt providerneutrale identiteiten (passage_v1_…,
// doc_v1_…), geen database-UUID's. Dezelfde afleiding als
// core/lib/retrieval/identiteit.ts + `chunkAlsBronresultaat` (namespace
// "generiek", passagesleutel "chunk-index:N"), zodat het script de passages kan
// terugvinden zonder de identiteiten te versoepelen.
function sleutel(prefix, delen) {
  const canoniek = [`bestuurdersportaal:${prefix}:v1`, ...delen]
    .map((deel) => `${Buffer.byteLength(deel, "utf8")}:${deel}`)
    .join("|");
  return `${prefix}_v1_${createHash("sha256").update(canoniek).digest("hex")}`;
}
export async function juridischePassages(admin) {
  const perPassage = new Map();
  for (const [documentId, titel, documenttype] of [
    [PW_DOC, "Pensioenwet", "wetgeving"],
    [MVT_DOC, "MvT 36 067 nr. 3", "wetsgeschiedenis"],
  ]) {
    const docIdentiteit = sleutel("doc", ["generiek", documentId]);
    for (let van = 0; ; van += 1000) {
      const { data, error } = await admin
        .from("document_chunks")
        .select("chunk_index, pagina, structuur_label")
        .eq("document_id", documentId)
        .order("chunk_index")
        .range(van, van + 999);
      if (error) throw new Error(`passages: ${error.message}`);
      for (const c of data) {
        perPassage.set(sleutel("passage", [docIdentiteit, `chunk-index:${c.chunk_index}`]), {
          documentId, titel, documenttype, pagina: c.pagina, label: c.structuur_label,
        });
      }
      if (data.length < 1000) break;
    }
  }
  return perPassage;
}

export function beschrijfChunks(passages, meta) {
  return (meta?.chunks ?? []).map((c, i) => {
    const p = passages.get(c.id);
    return {
      positie: i + 1,
      document: p?.titel ?? "overig",
      documenttype: p?.documenttype ?? null,
      pagina: p?.pagina ?? null,
      label: p?.label ?? null,
      pw150d: p?.documentId === PW_DOC && p?.label === "Artikel 150d",
      mvtP395: p?.documentId === MVT_DOC && p?.pagina === 395,
      artikelspoor: c.rang === null,
    };
  });
}

export async function main() {
  bevestigVeiligeSeedDoelomgeving({ url: ENV.url });
  if (process.env.SEED_DOELOMGEVING !== "local") throw new Error("Alleen lokaal (SEED_DOELOMGEVING=local).");
  const admin = adminClient();
  const { users } = await seed(admin);

  // Controle: de productie-achtige fixture staat er (anders eerst de psql-stap).
  const { count } = await admin
    .from("document_chunks")
    .select("id", { count: "exact", head: true })
    .eq("embedding_model", "art500-perf");
  if ((count ?? 0) < 18418) {
    throw new Error(`Fixture ontbreekt (${count ?? 0} art500-perf-chunks): draai eerst de psql-stap uit het draairecept.`);
  }
  const { error: cErr } = await admin.from("document_chunks").upsert(concurrenten(), { onConflict: "id" });
  if (cErr) throw new Error(`concurrenten: ${cErr.message}`);

  const passages = await juridischePassages(admin);
  const bestuurder = users.bestuurder;
  const { cookieHeader } = await sessieCookies({
    url: ENV.url,
    anonKey: ENV.anonKey,
    email: emailVoor("bestuurder"),
    password: WACHTWOORD,
  });

  const uitkomst = {};
  const fouten = [];
  const eis = (ok, tekst) => {
    if (!ok) fouten.push(tekst);
  };
  const metas = []; // R1 (0218) — markercontrole per ronde (ART_VERWACHT_TEKSTZOEKPAD)
  for (const { naam, vraag } of VRAGEN) {
    const r = await stelVraag(admin, cookieHeader, bestuurder.userId, vraag);
    const fout = r.events.find((e) => e.type === "error");
    const klaar = r.events.some((e) => e.type === "done");
    const meta = r.log?.retrieval_meta ?? null;
    metas.push(meta);
    const bronnen = beschrijfChunks(passages, meta);
    const artikel = meta?.selectie?.juridisch?.artikel;
    uitkomst[naam] = {
      http: r.status,
      duur_ms: r.duurMs,
      afgerond: klaar,
      fout: fout?.error ?? null,
      governance_log: r.log?.id ?? null,
      artikel: artikel ?? null,
      bronnen,
    };
    const tekstFout = JSON.stringify(r.events).toLowerCase();
    eis(r.status === 200 && klaar && !fout, `${naam}: niet afgerond (http ${r.status}, fout ${fout?.error ?? "-"}, begin ${r.ruwBegin})`);
    eis(!/57014|statement timeout|duurde te lang/.test(tekstFout), `${naam}: time-out in de stroom`);
    eis(Boolean(r.log), `${naam}: geen governance_log-regel`);
    if (naam === "reglement") {
      eis(artikel === undefined, `${naam}: selectie.juridisch.artikel hoort te ontbreken (${JSON.stringify(artikel)})`);
      continue;
    }
    eis((artikel?.exact ?? 0) >= 1, `${naam}: artikel.exact < 1`);
    eis((artikel?.geboost_geselecteerd ?? 0) >= 1, `${naam}: artikel.geboost_geselecteerd < 1`);
    eis((artikel?.via_artikelspoor ?? 0) >= 1, `${naam}: artikel.via_artikelspoor < 1`);
    const eersteMvt = bronnen.find((b) => b.documenttype === "wetsgeschiedenis");
    const eersteWet = bronnen.findIndex((b) => b.pw150d);
    const eersteMvtIdx = bronnen.findIndex((b) => b.documenttype === "wetsgeschiedenis");
    const eersteJuridisch = bronnen.find((b) => b.documenttype === "wetgeving" || b.documenttype === "wetsgeschiedenis");
    if (naam === "bedoeling") {
      eis(eersteMvt?.mvtP395 === true, `${naam}: eerste wetsgeschiedenis is niet MvT p.395 (${JSON.stringify(eersteMvt)})`);
      eis(eersteWet >= 0, `${naam}: Pensioenwet artikel 150d niet geselecteerd als normatieve basis`);
    }
    if (naam === "norm") {
      eis(eersteJuridisch?.pw150d === true, `${naam}: eerste juridische bron is niet Pensioenwet art. 150d (${JSON.stringify(eersteJuridisch)})`);
      eis(eersteMvtIdx === -1 || eersteMvtIdx > eersteWet, `${naam}: MvT staat vóór de wet`);
    }
    if (naam === "gecombineerd") {
      eis(eersteWet >= 0 && eersteMvtIdx >= 0, `${naam}: wet en MvT niet beide geselecteerd`);
      eis(eersteWet < eersteMvtIdx, `${naam}: wet niet vóór MvT`);
      eis(bronnen[eersteMvtIdx]?.mvtP395 === true, `${naam}: eerste MvT-passage is niet p.395`);
    }
  }
  for (const f of controleerTekstzoekpad(metas)) fouten.push(`tekstzoekpad: ${f}`);
  console.log(JSON.stringify({ fonds: FONDS_ID, uitkomst, fouten }, null, 2));
  if (fouten.length > 0) {
    console.error(`ROOD: ${fouten.length} acceptatiepunt(en) niet gehaald.`);
    process.exit(1);
  }
  console.log("GROEN: de volledige 150d-keten en de reglementcontrole voldoen.");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
