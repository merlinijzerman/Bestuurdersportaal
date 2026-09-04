# AI-gateway — inventarisatie en uitvoeringsplan (M365 fase 2B, issue #311)

- **Status:** plan **gereviewd en akkoord** (opdrachtgever, 2026-09-04, zie §6) met twee verplichte beveiligingsaanpassingen (§3.3a, §3.3b); T1 gemerged (PR #312); **T2 (DB-laag) in uitvoering** op `feat/311-t2-ai-gateway-db` — migratie `2026_09_04_ai_gateway_configuratie.sql`, suite `2026_09_04_ai_gateway.sql`, runbook `security/AI-GATEWAY-RUNBOOK.md`
- **Datum:** 2026-09-04
- **Context:** besluit 0208 (twee productvarianten, AI-provider als aparte configuratiedimensie), issue #311
- **Leidend principe:** het bestaande gedrag blijft standaard Anthropic; deze fase levert het uitbreidingspunt, geen klant-eigen provider.

> Bron van waarheid blijft de code (`CLAUDE.md`). Dit document beschrijft wat er vandaag ís (gemeten, met bestand:regel) en wat het plan verandert. Waar een keuze open staat, staat dat als **reviewvraag**.

## 1. Wat er al staat — en wat het ticket daaraan toevoegt

De codebase heeft sinds de AI-begrenzing (werkopdracht 2026-08-15; in de code aangeduid als "besluit 0180" — let op: `decisions/0180-…` in de repo gaat over forkdeclaraties, de begrenzing heeft geen eigen besluitbestand) al twee lagen tussen route en provider:

| Laag | Bestand | Wat | Reikwijdte |
|---|---|---|---|
| Preflight (quotum + idempotentie) | `core/lib/ai-preflight.ts`, RPC `fn_ai_preflight(_systeem)` | één reservering per logische actie; actietypes in `core/lib/ai-quota-kern.ts:130-165` | gebruiker + fonds + globaal, **quota platformbreed** (één getal voor alle fondsen) |
| Poort (kill switch + modelallowlist) | `core/lib/ai-poort.ts`, RPC `fn_ai_poort_check(provider, model)` | live vóór iedere providercall; enige `new Anthropic(` (r.123) | platformbreed |
| Boundarytest | `tests/cross-tenant/ai-poort.test.ts` | pint 7 bestanden die een provider direct mogen raken; eist poort-import en preflight-import | — |

**Wat ontbreekt** (het gat dat #311 vult):

1. **Per-fonds provider-/modelconfiguratie.** Modellen zijn code-constanten: `AI_MODEL` (`core/lib/generatie-kern.ts:34`, env-overschrijfbaar), `HAIKU_MODEL` (`core/lib/llm-modellen.ts`), `REWRITE_MODEL = "claude-sonnet-4-6"` (`app/api/chat/route.ts:165`), `SAMENVATTING_MODEL`/`AFSCHRIFT_AI_MODEL`/`BESLUIT_MODEL = "claude-sonnet-4-5"`, `JUDGE_MODEL = "claude-opus-4-8"`. Er is geen tabel die fonds × taak aan provider/model koppelt.
2. **Eén typed contract voor streaming én non-streaming.** De chatroute roept de SDK rechtstreeks aan binnen de poort-callback (`client.messages.create`/`.stream`, r.907, 2356, 3306, 3478); `core/lib/llm-providers/*` (AQLab) kent alleen een non-streaming `ProviderResultaat {tekst, tokens, latency_ms}`. Streaming is vandaag een eigenschap van de route, niet van de adapterlaag.
3. **Genormaliseerde fouten/usage/stopredenen.** Alleen `AiPoortGeslotenError` is getypeerd; providerfouten zijn kale `Error`s; `stop_reason`, cache-tokens en timeouts worden per call-site anders afgehandeld.
4. **Audit per providercall.** `governance_log.retrieval_meta.tokens` is een gedocumenteerde **ondergrens** (route r.3896-3924): reranker, reformulatie, contextresolver, web_search en de routes `afschrift/concept` en `besluit-concept` tellen niet mee of loggen niets (`platform/lib/monitoring-signalen.ts:413`).
5. **SDK-import-grens.** De huidige test pint `new Anthropic(` en endpoints, niet `import … from "@anthropic-ai/sdk"`; de route importeert SDK-types en krijgt de client in callbacks.

## 2. Inventarisatie van alle AI-aanroepen (runtime)

Volledige tabel met bron-inspectie (niet grep-treffers): per aanroep taaktype, stream, provider/model, sampling, promptbron, persoonsgegevens/documentinhoud, retrievalcontext, begrenzingspad en auditpad.

### 2.1 Productiechat — `app/api/chat/route.ts`

| # | Regel | Taak | Stream | Model | temp / max_tokens | Poort | Preflight | Audit |
|---|---|---|---|---|---|---|---|---|
| C1 | 905-915 | contextresolutie (Plateau 1) | nee | `REWRITE_MODEL` sonnet-4-6 | 0 / 220; AbortController 3500 ms + SDK-timeout 5500 ms | `bewaakteAnthropic` | valt onder actie `chat` | `retrieval_meta.invoer.context` (tokens, duur, timeout) |
| C2 | 2356 | query-reformulatie (`core/lib/query-reformulatie.ts:174`) | nee | sonnet-4-6 | 0 / 150 | `bewaakteAnthropic` (de helper zelf poort-checkt niet — G5) | idem | niet geteld (`tokendekking.bevat_query_reformulatie=false`) |
| C3 | 1655 → `core/lib/vraagrouter-model.ts:58-109` | vraagrouter (tool-use) | nee | `HAIKU_MODEL` | 0 / 300; SDK-timeout 2500 ms | `bewaakteAnthropic` | idem | `retrieval_meta.vraagrouter.modelrouter` |
| C4 | `core/lib/rag.ts:463` → `core/lib/rerank.ts:204` | reranker | nee | Haiku | 0 / 1024; 4000 ms | `bewaakteAnthropic`, zonder poort → fallback | idem | `RerankMeta`; niet geteld |
| C5 | 3305-3321 | map-stap (volledige analyse) | nee | `MAP_MODEL` Haiku | 0 / 1200; per call 20 s, fase 60 s | `bewaakteAnthropic` | idem | `tokens` (map_calls) |
| C6 | 3478-3481 | **eindgeneratie** | **ja** (`messages.stream`, `on("text")`, `finalMessage()`) | `AI_MODEL` opus-4-8 | provider-default / 5000 of 8000 (`MAX_TOKENS_BESTUURLIJK`); 45 s bij volledige analyse | `bewaakteAnthropicStream` | `chat` (r.656) | `schrijf_ai_interactie` → `governance_log` (+`_inhoud`), `p_model: AI_MODEL`, `tokens` incl. cache |
| C6a | 3104, 3470 | web_search-**servertool** (`buildWebSearchTool`, `core/lib/web-retrieval.ts:42`) | in C6 | — | `allowed_domains`, `max_uses` | idem | idem | `retrieval_meta.web` |
| C7 | `core/lib/vergelijk-productie.ts:136-157, 209-230` (via `/api/vergelijk`, óók vanuit chat r.77) | vergelijkdimensies + waardevergelijking (tool-use) | nee | Haiku resp. `VERGELIJK_MODEL = AI_MODEL` | 0 / 512 en 700 | `bewaakteAnthropic` | `vergelijken` | `fn_schrijf_vergelijking` |

Mistral-embeddings in de retrieval (`core/lib/rag.ts:1303,1378` → `core/lib/embeddings.ts:69`) lopen via `bewaakteProviderCallOfNull` met zichtbare FTS-terugval.

### 2.2 Overige productie-AI-taken

| # | Bestand:regel | Taak | Model | Sampling | Begrenzing | Audit | Aanroeper |
|---|---|---|---|---|---|---|---|
| P1 | `core/lib/samenvatting.ts:99-111` | samenvatting vergaderstuk | sonnet-4-5 | default / 800 | poort ✓, binnen `document_ingest` | `documenten.samenvatting_ai` | ingest-worker |
| P2 | `core/lib/chunk-ingest.ts:205` | context-prefix | Haiku | 0 / 120 | poort ✓, `document_ingest` | `document_chunks.prefix_model` | ingest/reindex |
| P3 | `core/lib/chunk-ingest.ts:638-678` | prefix via Message Batches | Haiku | — | poort ✓; **slapend** (`BATCH_BAAN_AAN=false`) | `extern_batch_id` | — |
| P4 | `core/lib/semantische-extractie.ts:90-105` | semantische extractie (tool-use) | Haiku | 0 / 1024 | poort ✓, **geen preflight/quotum (G1)** | `extraction_run` | `semantische-extractie-job` |
| P5 | `app/api/procedures/[id]/afschrift/concept/route.ts:146-175` | afschriftconcept | sonnet-4-5 | default / 1500 | poort ✓, `afschrift_concept` | **geen governance_log (G4)**; sjabloon-terugval | UI |
| P6 | `app/api/procedures/[id]/stappen/[stapId]/besluit-concept/route.ts:167-185` | besluitconcept | sonnet-4-5 | default / 1000 | poort ✓, `besluit_concept` | **geen governance_log (G4)** | UI |
| P7 | `platform/lib/aqlab/judge.ts:212` | AQLab-judge | opus-4-8 | vast schema | poort ✓, `aqlab_run` | `aqlab_*` | AQLab-worker |
| P8 | `core/lib/llm-providers/{anthropic,openai,mistral}.ts` via `generatie-kern.ts:906` | AQLab-generatie (challenger) | caller-supplied uit `aqlab_model_configurations` | per config | poort ✓, `aqlab_run`/`aqlab_adhoc`, fonds = null | `aqlab_run_outputs` | AQLab |
| P9 | `core/lib/embeddings.ts:69`, `core/lib/ocr.ts:160` | embeddings / OCR (Mistral) | `mistral-embed`, `mistral-ocr-latest` | — | poort ✓ (OCR-parameters optioneel — G3), `ocr`/`ocr_generiek`/`embeddings_backfill`/`notulen_bevestig` | `documenten.ocr_engine`, jobtabellen | ingest, backfill-routes, notulen |
| P10 | `platform/lib/generiek-pipeline.ts:236` | prefix+embeddings generieke bibliotheek | Haiku/Mistral | — | poort ✓, **geen preflight buiten OCR (G2)** | jobtabellen | curatie |
| P11 | `platform/lib/monitoring-health.ts:197` | health-probe `GET /v1/models` | — | — | **bewust poortvrij**, niet gefactureerd | `monitoring_snapshot` | cron |

### 2.3 Niet-runtime / experimenteel (migreert niet in deze tranche)

| Pad | Waarom niet | Maatregel |
|---|---|---|
| `scripts/backfill-embeddings.mjs`, `scripts/test-embeddings.mjs` | handmatige werkplekscripts, geen servercontext | bestaande opt-out-grendel `AI_BEGRENZING_BEWUST_OMZEILD` (getest in `ai-poort.test.ts`) |
| `scripts/spike-s1/extract.ts` | wegwerp-spike met **eigen** `new Anthropic(` (r.122), geen grendel (G6) | in T4: grendel toevoegen óf verwijderen (voorstel: verwijderen) |
| `platform/lib/aqlab/*` challengers (OpenAI/Mistral) | synthetische golden set, provider is bewust caller-supplied (besluit 0064); fonds = null | blijven op de gedeelde adapterlaag; zie §3.6 |

### 2.4 Gevonden gaten (buiten de letter van #311, wél relevant voor "geen omzeiling")

- **G1** `semantische-extractie-job` reserveert geen quotum en heeft geen actietype.
- **G2** `generiek-pipeline` reserveert alleen OCR; `generiek_curatie` bestaat als actietype maar wordt nergens aangeroepen.
- **G3** `ocrPdfNaarResultaat(buffer, poort?, reserveer?)` — poort/reservering optioneel in de signature.
- **G4** `afschrift/concept` en `besluit-concept` schrijven geen auditregel; tokenverbruik onzichtbaar.
- **G5** `reformuleerVraag` accepteert een kale client; alleen de caller wikkelt hem in de poort.
- **G6** `scripts/spike-s1/extract.ts` bouwt een eigen client zonder grendel.
- **G7** Twee modelregisters lopen uit de pas: `core/lib/aqlab/modellen.ts` (baseline sonnet-4-6, 8× gpt-*, mistral-large) vs. DB-seed `ai_model_allowlist` (6 rijen, geen gpt-*/mistral-large). De DB beslist; de code-lijst is een keuzelijst.
- **G8** `supabase/migrations/2026_08_16_ai_begrenzing_rpc.sql` verwijst naar een rollbackbestand dat niet bestaat.
- **G9** Geen fondscreatie-route/-trigger: fondsen ontstaan per migratie (`2026_08_06_demo_fondsen_bootstrap.sql`).

## 3. Doelontwerp

### 3.1 Plaats in de keten

```
route/worker
  │  preflight(actietype)             ← bestaand: quotum + idempotentie, één keer per actie
  ▼
AI-gateway  core/lib/ai-gateway/
  │  1. resolveConfig(fonds, taakgroep)   ← NIEUW: ai_gateway_private.lees_config via de aparte rol ai_gateway (§3.3a)
  │  2. poortCheck(provider, model)       ← bestaand: kill switch + allowlist, live per call
  │  3. adapter.genereer / .stream        ← adapterlaag; enige plek met provider-SDK/endpoint
  │  4. normaliseer (tekst, usage, stopreden, foutcategorie)
  │  5. ai_gateway_private.schrijf_log    ← NIEUW: append-only auditregel per call, zelfde rol; best-effort met gestructureerde foutregistratie (R3)
  ▼
provider
```

Elke beveiligings- en quotacontrole zit vóór stap 3; stap 1 en 2 falen gesloten zonder fallback. Stap 1 en 5 lopen over een eigen, minimale databaseverbinding (rol `ai_gateway`, §3.3a) die alleen de server-side gateway heeft; de RLS-client van de route blijft voor alles wat tenantdata raakt. De browser levert nooit provider, model, endpoint of fonds: fonds komt uit `withFondsRoute`-context (sessie) of de job-rij (service), taaktype is een code-constante op de call-site.

### 3.2 Contract (`core/lib/ai-gateway/contract.ts`) — provider-neutraal, geen SDK-types

```ts
type Taaktype =
  | "chat_generatie" | "chat_contextresolutie" | "chat_reformulatie" | "chat_vraagrouter"
  | "chat_mapstap" | "rerank" | "vergelijk_dimensies" | "vergelijk_waarde"
  | "samenvatting" | "context_prefix" | "semantische_extractie"
  | "afschrift_concept" | "besluit_concept" | "aqlab_generatie" | "aqlab_judge";

type Taakgroep = "generatie" | "hulp_sterk" | "concept" | "hulp_snel";   // configuratiegroep, zie 3.3

type GatewayContext = {
  supabase: SupabaseClient;                       // RLS-client (tenant) of service-client (worker)
  fondsId: string | null;                         // server-side vastgesteld; null alleen bij globale taaktypes
  actor: { soort: "gebruiker"; id: string } | { soort: "systeem"; proces: string };
  actieId: string | null;                         // bewijs van preflight-reservering (verplicht bij bereik 'fonds')
  correlatieId: string;                           // requestId van de wrapper of job-id
  label: string;                                  // bv. "chat.POST"
};

type TekstBlok = { type: "text"; text: string; cache?: "ephemeral" };
type Bericht = { role: "user" | "assistant"; content: string };
type NeutraleTool =
  | { soort: "webzoek"; domeinen: string[]; maxGebruik: number }        // → Anthropic web_search-servertool
  | { soort: "functie"; naam: string; beschrijving: string; schema: object; verplicht?: boolean }; // tool-use extractie

type GenereerVerzoek = {
  taaktype: Taaktype;
  systeem: TekstBlok[];
  berichten: Bericht[];
  maxTokens: number;
  temperature?: number | null;  topP?: number | null;
  tools?: NeutraleTool[];
  timeoutMs?: number;           // harde SDK-timeout
  signal?: AbortSignal;         // annulering/timeout door de aanroeper (patroon map-stap)
};

type Usage = { in: number; out: number; cacheLezen: number; cacheCreatie: number; totaal: number };
type StopReden = "einde" | "max_tokens" | "stop_sequence" | "tool" | "onbekend";

type GenereerResultaat = {
  tekst: string;
  inhoud: unknown[];            // ruwe content-blokken, uitsluitend voor server-side tool-extractie (web, functie-argumenten)
  stopReden: StopReden;
  usage: Usage;
  latencyMs: number;
  provider: string; model: string; profielId: string; configVersie: number; poortConfigVersie: number;
};

type StreamHandle = {
  onTekst(cb: (delta: string) => void): void;    // vervangt claudeStream.on("text")
  afronden(): Promise<GenereerResultaat>;         // vervangt finalMessage()
};

class GatewayFout extends Error {
  categorie: "configuratie" | "poort_gesloten" | "provider" | "timeout" | "rate_limit" | "geannuleerd";
  reden: string;                // intern, gesaniteerd; nooit naar de browser
  herhaalbaar: boolean;
}
```

Wat bewust **niet** in het contract zit: retrieval, promptopbouw, `[Bron N]`-semantiek, vervolgvragen-marker, citaatvalidatie. De route houdt die exact waar ze zijn; alleen `bewaakteAnthropic*(…, client => client.messages.*)` wordt vervangen door `gateway.genereer(ctx, verzoek)` / `gateway.stream(ctx, verzoek)`.

### 3.3 Configuratiemodel (DB) — per fonds, per taakgroep

Vier **taakgroepen** in plaats van vijftien losse rijen per fonds; elke groep bundelt taaktypes die vandaag aantoonbaar hetzelfde model gebruiken. Zo is de backfill deterministisch en verandert er geen model, temperatuur, tokenlimiet of streaming (die drie laatste blijven code-constanten per taaktype).

| Taakgroep | Huidig model (backfill) | Taaktypes |
|---|---|---|
| `generatie` | `claude-opus-4-8` (= `AI_MODEL`-default) | chat_generatie, vergelijk_waarde |
| `hulp_sterk` | `claude-sonnet-4-6` | chat_contextresolutie, chat_reformulatie |
| `concept` | `claude-sonnet-4-5` | samenvatting, afschrift_concept, besluit_concept |
| `hulp_snel` | `claude-haiku-4-5-20251001` | chat_vraagrouter, chat_mapstap, rerank, vergelijk_dimensies, context_prefix, semantische_extractie |

AQLab (`aqlab_generatie`, `aqlab_judge`) is platformbreed (fonds = null) en blijft caller-supplied binnen de DB-allowlist; de judge houdt zijn gepinde model als code-constante met een eigen platformprofiel-rij (geen fonds).

Tabellen — in het private schema `ai_gateway_private` (§3.3a), RLS aan zonder policies, `revoke all … from public, anon, authenticated, service_role`; alleen de functies van het schema raken ze (eigenaar `postgres`):

```sql
-- Platformprofielen: welke provider, met welke server-side secret-REFERENTIE. Nooit een key of URL.
create table ai_gateway_private.provider_profiel (
  id            text primary key,                          -- 'platform-anthropic'
  eigenaar_fonds_id uuid references public.fondsen(id) on delete cascade,  -- null = platform; anders klant-eigen (§3.3b)
  provider      text not null check (provider in ('anthropic','openai','mistral')),
  secret_ref    text not null,                             -- sleutelnaam in de servergeheimen, bv. 'ANTHROPIC_API_KEY'
  endpoint_ref  text,                                      -- optionele sleutelnaam (bv. 'OPENAI_BASE_URL'); code mapt ref → env, nooit een vrije URL
  actief        boolean not null default true,
  versie        integer not null default 1,
  bijgewerkt    timestamptz not null default now(),
  bijgewerkt_door uuid, reden text
);

-- Productbeleid-default per taakgroep (bron voor nieuwe fondsen).
create table ai_gateway_private.taakgroep_default (   -- alleen platformprofielen (trigger)
  taakgroep     text primary key check (taakgroep in ('generatie','hulp_sterk','concept','hulp_snel')),
  profiel_id    text not null references ai_gateway_private.provider_profiel(id),
  provider      text not null, model text not null,
  foreign key (provider, model) references public.ai_model_allowlist(provider, model),
  versie integer not null default 1, bijgewerkt timestamptz not null default now(), bijgewerkt_door uuid
);

-- De fondsconfiguratie zelf.
create table ai_gateway_private.fonds_configuratie (
  fonds_id      uuid not null references public.fondsen(id) on delete cascade,
  taakgroep     text not null check (taakgroep in ('generatie','hulp_sterk','concept','hulp_snel')),
  profiel_id    text not null references ai_gateway_private.provider_profiel(id),  -- trigger: platform óf eigen fonds (§3.3b)
  provider      text not null, model text not null,
  foreign key (provider, model) references public.ai_model_allowlist(provider, model),
  actief        boolean not null default true,
  versie        integer not null default 1,
  geldig_vanaf  timestamptz not null default now(),
  bijgewerkt    timestamptz not null default now(),
  bijgewerkt_door uuid, reden text,
  primary key (fonds_id, taakgroep)
);
-- triggers: profiel.provider = provider, profiel-eigenaar = platform of dit fonds, versie++ bij update, append-only log
create table ai_gateway_private.fonds_configuratie_log ( … oud/nieuw jsonb, versie, gewijzigd_door, gewijzigd_op … );  -- append-only (fn_log_append_only)

-- Nieuwe fondsen: AFTER INSERT ON public.fondsen maakt de VIER rijen transactioneel aan uit
-- taakgroep_default (G9: er is geen creatieroute; patroon trg_fonds_integratieprofiel_standaard).
-- Ontbrekende of ongeldige default → de trigger raist en de fondscreatie FAALT (reviewbesluit R6);
-- resolutie zonder rij = 'config_ontbreekt' → fail-closed, géén fallback naar de default-tabel.
```

### 3.3a Toegangspad: aparte minimale DB-rol `ai_gateway` (reviewvoorwaarde)

De configuratie- en log-RPC's zijn **niet** bereikbaar voor `authenticated` (en niet voor `anon`/`service_role`). Ze leven in een privaat schema `ai_gateway_private` en zijn uitsluitend uitvoerbaar door een aparte, minimale loginrol `ai_gateway`, naar het patroon van `microsoft_vault` (`supabase/migrations/2026_09_04_microsoft_fase1_connectorfundament.sql`, `core/lib/microsoft-vault.ts`, `security/MICROSOFT-365-F1-RUNBOOK.md`):

- **Rol:** `ai_gateway` met `NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS`, lage connection limit, wachtwoord interactief geprovisioned (runbook); de migratie faalt gesloten als de rol ontbreekt. Rechten: `USAGE` op `ai_gateway_private` en `EXECUTE` op precies de benoemde functies — **geen** tabelrechten, geen `public`-rechten. De testketen maakt de rol zelf aan (`scripts/testdb-apply-migrations.sh`, zoals voor `microsoft_vault`).
- **Verbinding:** alleen de server-side gateway (`core/lib/ai-gateway/config-db.ts`, `import "server-only"`, `pg.Pool` via Supavisor transaction pooler, TLS met vastgepinde CA, `rejectUnauthorized: true`) gebruikt `AI_GATEWAY_DATABASE_URL` + `AI_GATEWAY_CA_CERT_BASE64`. Tenantroutes blijven op de RLS-client; er komt **geen** service-roleclient in tenantroutes.
- **Functies in `ai_gateway_private`** (`security definer`, `set search_path = ai_gateway_private, public, pg_temp`, `revoke all … from public, anon, authenticated, service_role`, daarna `grant execute … to ai_gateway`):
  - `lees_config(p_fonds_id uuid, p_taakgroep text)` → `{ok, profiel_id, provider, model, secret_ref, endpoint_ref, versie, eigenaar_fonds_id}` of `{ok:false, reden}`; het fonds-id komt van de server (sessiecontext via `withFondsRoute`, of de job-rij), nooit van de browser. De functie weigert een profiel dat niet platform is én niet van het fonds (§3.3b).
  - `schrijf_log(…)` → append-only insert in `ai_gateway_private.gateway_log`; `fonds_id` is een verplicht argument dat door de gateway uit dezelfde servercontext komt als bij `lees_config`.
  - `lees_log_platform(p_fonds_id, p_limiet)` → uitsluitend voor de platformlaag (beheerscherm #317), via dezelfde rol; geen `authenticated`-pad.
  - `lees_platform_profiel(p_provider)` → het actieve platformprofiel (secret-/endpointreferentie) voor platformbrede taaktypes zonder fonds (AQLab); een klantprofiel komt hier nooit uit.
- **Wat de browser dus nooit ziet:** `secret_ref`, `endpoint_ref`, profiel-id's, configuratieversies van andere fondsen, de logfunctie. Een ingelogde sessie heeft geen enkele executable in dit schema; `supabase/checks/<datum>_ai_gateway.sql` bewijst dat (`has_function_privilege('authenticated', …) = false` voor élke functie, `has_schema_privilege('authenticated','ai_gateway_private','USAGE') = false`, en `ai_gateway` heeft exact N executes en nul tabelrechten — patroon `2026_09_04_microsoft_fase1_connectorfundament.sql`).
- **Configuratietabellen** verhuizen mee naar `ai_gateway_private` (`provider_profiel`, `taakgroep_default`, `fonds_configuratie`, `fonds_configuratie_log`, `gateway_log`); alleen `ai_model_allowlist` blijft in `public` (bestaand, deny-by-default). De FK vanuit het private schema naar `public.ai_model_allowlist` blijft mogelijk.
- **Secret- en endpointreferenties** zijn sleutelnamen die de adapter via een **code-allowlist** vertaalt naar `process.env` (`ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `MISTRAL_API_KEY`, `OPENAI_BASE_URL`, `MISTRAL_CHAT_URL`); een onbekende referentie faalt gesloten (`configuratie`). Geen vrije URL uit de database (SSRF), geen key in de database.
- **Fail-closed zonder verbinding:** ontbreekt `AI_GATEWAY_DATABASE_URL` of faalt de pool, dan `GatewayFout("configuratie","gateway_db_onbereikbaar")` — geen fallback naar code-constanten. Lokale E2E/karakterisering krijgt de rol uit de testketen en de URL uit `.env.local`.

### 3.3b Eigenaarschap van providerprofielen (reviewvoorwaarde)

`provider_profiel` krijgt `eigenaar_fonds_id uuid null references public.fondsen(id) on delete cascade`: `null` = platformprofiel, anders fondsgebonden (toekomstige klant-eigen Azure OpenAI/Copilot-configuratie). Afdwinging op drie plekken, zodat de configuratie van klant A nooit aan klant B kan hangen:

1. **CHECK/trigger op `fonds_configuratie`:** `profiel.eigenaar_fonds_id is null or profiel.eigenaar_fonds_id = fonds_configuratie.fonds_id` — een insert/update die daarvan afwijkt faalt (trigger `bewaak_profiel_eigenaar`, ook bij een latere wijziging van het profiel zelf).
2. **`lees_config`** herhaalt de toets bij het lezen en geeft `{ok:false, reden:'profiel_niet_van_fonds'}` als de rij toch inconsistent is (defense-in-depth).
3. **`taakgroep_default`** mag alleen naar platformprofielen verwijzen (CHECK via trigger): een nieuw fonds kan nooit een klantprofiel erven.

De gedragssuite bewijst: fonds A met een eigen profiel → ok; fonds B dat A's profiel selecteert → insert geweigerd; platformprofiel voor beide → ok; default-tabel met klantprofiel → geweigerd.

Gates/registraties: `allowlist-grants.tsv` (nieuwe objecten in `ai_gateway_private`, rol `ai_gateway`), `2026_07_31_r1_structurele_gates.sql` A–H (privaat schema: geen `authenticated`-executes, gate H), V3-grants, rollbackbestand (zet `ai_gateway` op `nologin`, trekt executes in; de logtabel faalt gesloten bij bestaande regels), en een gedragssuite `supabase/checks/<datum>_ai_gateway.sql` (rolcontrole en exact-N-executes, backfill-volledigheid ×4 per fonds, fail-closed zonder rij, profiel-eigenaarschap §3.3b, `authenticated`/`anon`/`service_role` zonder enige toegang, append-only log, trigger nieuwe fondsen incl. falen bij ontbrekende default).

### 3.4 Adapters en convergentie met AQLab (`platform/lib/aqlab/generate-adapter.ts`)

Er komt **geen tweede adapterhiërarchie**. `core/lib/llm-providers/` wordt de adapterlaag van de gateway:

- `core/lib/ai-gateway/adapters/anthropic.ts` — de enige module die `@anthropic-ai/sdk` (niet-type) importeert; huisvest de client (verhuist uit `ai-poort.ts`), implementeert `genereer` én `stream`, mapt `NeutraleTool` → `web_search`/`tools`+`tool_choice`, mapt `usage` (incl. cache-velden) en `stop_reason`, en classificeert fouten: `AbortError`/`APIConnectionTimeoutError` → `timeout`/`geannuleerd`, 429 → `rate_limit`, 401/403 → `configuratie`, overige → `provider`. `maxRetries` blijft 1 (gekarakteriseerd: providerfout-snapshot toont twee verzoeken).
- `openai.ts`/`mistral.ts` (chat-completions) verhuizen ongewijzigd naar `adapters/` en krijgen dezelfde foutclassificatie; ze blijven non-streaming (`stream()` → `GatewayFout("configuratie","streaming_niet_ondersteund")`, fail-closed).
- `genereerViaProvider` (AQLab) wordt `gateway.genereer` met taaktype `aqlab_generatie` en een **expliciete modelkeuze** die alleen voor `fondsId = null`-taaktypes is toegestaan en nog steeds door `fn_ai_poort_check` gaat. `generatie-kern.sanity.ts` (sha256-pin op de toon-prompt) en `aqlab:smoke` blijven ongewijzigd groen: retrieval en `[Bron N]` raken de adapter niet.
- `ai-poort.ts` houdt `poortCheck`, `bewaakteProviderCall(OfNull)` (embeddings/OCR); `bewaakteAnthropic(Stream)` verdwijnen zodra alle call-sites over zijn (T4), samen met de client.
- `core/lib/ai-provider-endpoint.mjs` (lokale E2E-omleiding) blijft de enige base-URL-bron voor Anthropic.

**Boundarytest** (uitbreiding van `tests/cross-tenant/ai-poort.test.ts`): `from "@anthropic-ai/sdk"` (ook `import type`) alleen in `core/lib/ai-gateway/adapters/anthropic.ts`; `openai`/`mistral`-endpoints alleen in hun adapter; elke gateway-aanroeper importeert de preflight; en een bron-inspectie dat `gateway.genereer|stream` nooit met een letterlijke modelstring wordt aangeroepen (model komt uit config).

### 3.5 Audit, observability, kosten

Nieuwe append-only tabel `ai_gateway_log` (deny-by-default; lezen alleen via platformlaag):

`id, aangemaakt, fonds_id (null bij globaal), actor_soort ('gebruiker'|'systeem'), actor_id, proces, taaktype, taakgroep, provider, model, profiel_id, config_versie, poort_config_versie, resultaat ('ok'|'configuratiefout'|'poort_gesloten'|'providerfout'|'timeout'|'rate_limit'|'geannuleerd'), stop_reden, latency_ms, tokens_in, tokens_out, tokens_cache_lezen, tokens_cache_creatie, tokens_totaal, correlatie_id, actie_id, label`

Geen prompt, geen documentinhoud, geen secrets, geen providerrespons. De tabel heet `ai_gateway_private.gateway_log` en is alleen via `schrijf_log`/`lees_log_platform` bereikbaar (§3.3a). Schrijven gebeurt ná de call, **best-effort** (reviewbesluit R3): een mislukte insert blokkeert een al gegenereerd antwoord niet, maar wordt **gestructureerd geregistreerd** via `logAppFout({label, categorie:"retrieval_ai", severity:"hoog", correlatieId, …})` in `app_errors` mét correlatie-id, taaktype en fonds, en telt mee in een nieuw monitoringssignaal "gateway-logfouten" (`platform/lib/monitoring-signalen.ts`) zodat een stille uitval zichtbaar is. `governance_log.retrieval_meta.tokens` blijft de bron voor de bestaande dashboards (`monitoring-queries.ts`, `verbruik-bundel-lees.ts`), ongewijzigd; het chat-auditrecord krijgt additief `gateway: {provider, model, profiel_id, config_versie}` in `META_BASIS` (sanity-pin bijwerken). `p_model: AI_MODEL` in `schrijf_ai_interactie` wordt het **effectieve** model uit de gateway.

Onderscheid in foutcategorieën (`GatewayFout.categorie` + `resultaat`): configuratiefout, providerfout, timeout, rate limit, poort (kill switch/allowlist), quota (preflight, vóór de gateway), guardrail (route-eigen, vóór de gateway: PII-gate, bronintentie/verduidelijking, chat-invoer), gebruikersannulering (`signal`).

### 3.6 Bewust uitgesteld (eigenaar / risico / vervolg)

| Call-site | Waarom niet nu | Risico | Vervolg |
|---|---|---|---|
| Embeddings + OCR (Mistral) | andere modaliteit; per-fonds embeddingmodel wisselt de vectorruimte (reindex vereist); al poort+preflight | laag | eigen ticket "embedding-/OCR-profiel per fonds" na 2B; gateway-log krijgt wél een `modaliteit`-kolom gereserveerd |
| Message Batches (P3) | slapend, poortbewaakt | laag | mee bij activering |
| Health-probe (P11) | metadata-endpoint, bewust buiten kill switch | geen | blijft; endpoint komt uit dezelfde profielref |
| AQLab-challengers OpenAI/Mistral | synthetisch, fonds = null, governance-gepoort (0064) | laag | gebruiken de gedeelde adapters; geen fondsconfig |
| Offline scripts | geen servercontext | laag | grendel bestaat; spike-s1 verwijderen |
| G1/G2 quota-gaten | buiten letter #311, wél "geen omzeiling" | middel | in T4: actietype `semantische_extractie` + `generiek_curatie` aansluiten; gateway eist `actieId` bij bereik fonds |

## 4. Karakterisatie (uitgevoerd, fase 1)

Bewijs vóór de verplaatsing, in de repo-idioom (byte-identieke snapshots):

- **Vier SSE-golden-scenario's** in `tests/karakterisering/scenarios.mjs` (`w311.chat.post.bestuurder.sse-*`), opgenomen tegen ongewijzigde code, 3× verify stabiel, plus de volledige set (378 scenario's) 2× groen op de lokale stack:
  - `sse-bronloos`: volledige eventstroom + vingerafdruk van het providerverzoek (`claude-opus-4-8`, `max_tokens 5000`, stream, geen temperature/top_p/tools, sha256 van system-blokken en berichten);
  - `sse-met-bron`: retrieval → `[Bron 1]`-context → stream; vorm/budget vast, prompthashes expliciet niet (bron-sentinel + peildatum);
  - `sse-verduidelijking`: guardrail vóór het netwerk — verduidelijkingsvraag, **nul** providerverzoeken;
  - `sse-providerfout`: stub-500 → `{type:"error"}` zonder providerdetail; twee verzoeken (SDK-retry 1) vastgelegd.
- **Providerstub** (`tests/e2e/fixtures/ai-provider-stub.mjs`) bewaart per verzoek alleen vorm + hashes (`/verzoeken`), nooit inhoud — unit-getest.
- Harnas: `verwacht: "sse"`, `idempotentie: true` (verse sleutel per ronde), `nawerk`, `vereist: "ai-stub"` (zichtbaar overslaan), normalisatie `peildatum → <datum>`; seed: lokale AI-quota + één FTS-chunk onder document1; CI-workflow start de stub en laat de `AI_MODEL`-override vallen.
- Bestaand en blijvend: `generatie-kern.sanity.ts` (prompt-sha256), E2E-01..05 met dezelfde stub, W5-snapshots voor de foutpaden, `ai-poort.test.ts`.

**Acceptatie na de migratie:** `--verify` blijft byte-identiek voor alle `w311.*`- en `w5.chat.*`-snapshots (zelfde model, budget, prompthash, eventstroom, retrygedrag) zonder één snapshot bij te werken. Elke afwijking is per definitie een gedragswijziging die apart gemotiveerd moet worden.

## 5. Uitvoeringsplan (tranches, elk een PR naar `preview`)

| Tranche | Inhoud | Gates | Rollback |
|---|---|---|---|
| **T1** (deze branch) | inventarisatie, dit ontwerp, karakterisatie, stub-uitbreiding, CI-stub | harnas 3×, xtenant, e2e-guard, schema-niet-strenger | n.v.t. (alleen tests/docs) |
| **T2** DB | runbook + provisioning van loginrol `ai_gateway` (per omgeving, interactief wachtwoord); migratie `…_ai_gateway_config.sql`: privaat schema `ai_gateway_private`, 4 tabellen + log, functies met executes uitsluitend voor `ai_gateway`, profiel-eigenaarschap, trigger nieuwe fondsen (faalt bij ontbrekende default), **backfill alle fondsen** (per omgeving: verifieer vooraf de effectieve `AI_MODEL` op Vercel — geen stille modelwissel), gedragssuite, allowlist-tsv, rollback (`…_ROLLBACK.sql`; log-tabel faalt gesloten bij bestaande regels) | r1-gates A–H, V3-grants, `2026_08_16_ai_begrenzing.sql`, nieuwe suite, xtenant DB-laag | rollbackbestand; code raakt de tabellen nog niet |
| **T3** Gateway + chat | `core/lib/ai-gateway/*` incl. `config-db.ts` (`pg.Pool` op `AI_GATEWAY_DATABASE_URL`, patroon `microsoft-vault.ts`), Anthropic-adapter (stream + non-stream), foutnormalisatie, timeouts/annulering, gateway-log; chatroute C1–C7 en `vraagrouter-model`/`rerank`/`vergelijk-productie` over; `llm-providers` → adapters; boundarytest; unit-contracttests (gemockte adapter: spoofing van provider/model genegeerd, verkeerd fonds → weigering, ontbrekende config/adapter/secret → fail-closed zonder call, kill switch/quota/guardrail vóór de gemockte netwerkcall, stream/non-stream/timeout/cancel/rate-limit/fout-categorieën) | alles van T1 + `npm test`, typecheck, sanity (nieuwe prompt-pin alleen indien bewust), lint:boundaries, lint:quality, xtenant, security:secrets, build; **harnas byte-identiek** | code-revert; DB-tabellen blijven onschadelijk staan |
| **T4** Overige taken | P1, P2, P4–P8 over; `bewaakteAnthropic*` + client uit `ai-poort.ts`; G1/G2 actietypes; G3 verplicht; G5 opgelost door verwijdering van de client-parameter; spike-s1 weg; `ai-poort.test.ts` allowlist krimpt | idem + `aqlab:smoke` | code-revert |
| **T5** Docs + smoke | besluit met het dan eerstvolgende vrije nummer (in T5 opnieuw bepalen; niet vooraf gereserveerd), 0208 bijwerken met de implementatiekeuze, `security/DREIGINGSMODEL.md` (grens 4: gateway als enige uitgang; R-06/R-15), `security/ASVS-L2-REGISTER.md` (V13 providerconfig als bewijs, V14 logredactie), `HANDOVER.md`, `AI-GOVERNANCE-ONTWERP.md`, `SETUP.md` (env-refs); **Preview-smoke** met echte Anthropic: regulier gesprek, gestreamd antwoord met broncontext, geblokkeerde input (PII-gate), quota/kill switch, veilige providerfout; controle dat geen secret/prompt in respons, log of audit zit | — | — |

Volgorde per omgeving: T2-migratie eerst in Supabase (Preview, daarna Productie), dán T3-code — code zonder tabellen faalt gesloten (`config_ontbreekt`), tabellen zonder code zijn inert.

## 6. Reviewbesluiten (opdrachtgever, 2026-09-04)

| # | Besluit | Voorwaarde / consequentie |
|---|---|---|
| R1 | **Akkoord:** vier taakgroepen | het afzonderlijke taaktype blijft in de gateway-log staan, zodat latere verfijning mogelijk is |
| R2 | **Akkoord:** de database is na T3 leidend | Vercel gecontroleerd: er bestaat geen `AI_MODEL`-variabele (ook niet gedeeld); de effectieve backfill-default is `claude-opus-4-8`. Na T3 is `AI_MODEL` geen runtime-override voor productiepaden meer; hij blijft alleen seed-default en AQLab-baseline-constante |
| R3 | **Akkoord:** best-effort gateway-log | logfouten gestructureerd registreren met correlatie-id (`app_errors`) en als monitoringssignaal zichtbaar maken (§3.5) |
| R4 | **Akkoord:** beheer via migratie/beheerprocedure, geen UI in 2B | vervolgticket vastgelegd: [#317 Beheerscherm "Integraties en AI-configuratie"](https://github.com/merlinijzerman/Bestuurdersportaal/issues/317) |
| R5 | **Akkoord:** G1/G2 in T4 | anders blijft een pad bestaan dat quotum/preflight omzeilt |
| R6 | **Akkoord:** expliciete rijen voor nieuwe fondsen | de trigger maakt de vier regels transactioneel aan; ontbrekende of ongeldige defaults laten de fondscreatie falen, geen stille fallback |

**Twee verplichte aanpassingen vóór T2** (verwerkt in §3.3a en §3.3b): (1) aparte minimale DB-rol `ai_gateway` + privaat schema; geen `authenticated`-execute op configuratie- of log-RPC's; geen service-roleclient in tenantroutes; secret-/endpointreferenties verlaten de server nooit; (2) `provider_profiel.eigenaar_fonds_id` met afdwinging dat een fonds alleen een platformprofiel of zijn eigen profiel kan selecteren.

**Besluitnummer:** niet vooraf gereserveerd; wordt in T5 opnieuw bepaald op het dan eerstvolgende vrije nummer.

**Vervolgvolgorde:** T1 apart mergen na rebase op de actuele `origin/preview` en groene gates; T2 op een nieuwe branch vanaf de dan actuele `preview`; daarna T3.

## 7. Parallel werk en conflictrisico

- `origin/preview` op 2026-09-04 (377d781, na Microsoft fase 1 #309/#315/#316) is de basis na de rebase van T1. Open PR's die chat-/assistentbestanden raken: geen (PR #309 Microsoft fase 1 raakt ze niet; #138 raakt alleen een AQLab-auditroute).
- Lokale/remote branches met ongemergede wijzigingen aan `app/api/chat/route.ts`: `feat/v0-eenheidsdimensie-kolommen` (+2, 20-08, geen PR), `codex/sprint-1-preview-security` (+3, 14-08, inhoudelijk gemerged via PR #3). Beide ouder dan de laatste chat-refactors; T3 rebaset vóór merge opnieuw op `origin/preview`.
- De hoofd-worktree `mvp/` bevat ongecommitte wijzigingen aan `app/api/chat/route.ts` op `feat/p4-status-feitenmatrix` die inhoudelijk overeenkomen met de al gemergde Plateau-1-contextresolutie; niet aangeraakt.
