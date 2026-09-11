# Karakteriseringsharnas (W1)

Snapshot-harnas dat van een vaste set API-routes de **volledige respons** vastlegt
en na een wijziging byte-voor-byte vergelijkt. Doel: bewijzen dat de deploy-2-codemod
**niets** aan het gedrag verandert ("nul verschil"). Zie issue #88 en
`05 Security en compliance/TICKET-W1-karakteriseringsharnas.md`.

> **Status:** compleet — 62 scenario's over 25 routes, verify 3× stabiel,
> negatieve controle bewezen, CI groen. Elke §3-variant gedekt; SSE/LLM-routes
> bewust uitgesloten (W5) — **sinds #311 gedeeltelijk opgeheven:** het streamende
> happy path van `/api/chat` is gekarakteriseerd via de lokale WP4-providerstub
> (zie "SSE via de providerstub" hieronder).

## Bestanden

| Bestand | Rol |
|---|---|
| `config.mjs` | Vaste UUID's, rollen, env. |
| `seed.mjs` | Deterministische seed (1 fonds, 4 rollen + profielen; domein-fixtures per tier). Idempotent. |
| `sessie.mjs` | Sessie→cookie-brug: rol → geldige `Cookie`-header via de `@supabase/ssr` cookie-jar. |
| `normaliseer.mjs` | §2-normalisatie: UUID-mapping `<uuid:N>`, `<ts>`, array-sort, header-whitelist. |
| `scenarios.mjs` | Datatabel: één rij = één snapshot (pad, methode, rol, body, verwacht, preseed). |
| `run.mjs` | Runner: `--record` legt vast, `--verify` vergelijkt byte-voor-byte. |
| `__snapshots__/` | De vastgelegde snapshots (tegen `main`). |
| `spike.mjs` | Throwaway cookie-brug-bewijs (historisch; opgevolgd door `run.mjs`). |

## Opnemen / verifiëren

```bash
node --env-file=.env.local tests/karakterisering/run.mjs --record   # snapshots vastleggen
node --env-file=.env.local tests/karakterisering/run.mjs --verify   # vergelijken (CI)
node --env-file=.env.local tests/karakterisering/run.mjs --verify --only=<slug>
```

## Lokaal draaien (deze Mac: geen psql/supabase op PATH, wel Docker)

Shims vóór PATH (zie het projectgeheugen `project-lokale-db-testketen`):

```bash
export PATH="<scratchpad>/bin:$PATH"   # supabase→npx-pin 2.114.0, psql→postgres:17-container
```

1. **Stack starten** (verbergt migrations tijdens boot):
   ```bash
   bash scripts/start-ephemeral-supabase.sh
   ```
2. **Schema opbouwen** (baseline + post-cutoff-migraties):
   ```bash
   TEST_DATABASE_URL=postgresql://postgres:postgres@host.docker.internal:54322/postgres \
     bash scripts/testdb-apply-migrations.sh
   ```
3. **App-env**: `.env.local` in de worktree — `NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321`
   + de CLI-demo anon/service-keys + dummy `AUDIT_HMAC_*`/`ANTHROPIC_API_KEY`. (Gitignored.)
4. **Bouwen + draaien**:
   ```bash
   npm run build && PORT=3000 npm run start
   ```
5. **Spike**:
   ```bash
   node --env-file=.env.local tests/karakterisering/spike.mjs
   ```

## SSE via de providerstub (#311, M365 fase 2B)

Vier scenario's (`w311.chat.post.bestuurder.sse-*`) leggen de **volledige
SSE-eventstroom** van `/api/chat` vast én, onder `nawerk.provider_verzoeken`, de
**vingerafdruk van wat de provider ontving**: model, stream-vlag, `max_tokens`,
sampling, tools en sha256 van system-blokken en berichten (nooit inhoud). Dat is
de acceptatie-eis van #311 — de migratie naar de centrale AI-gateway moet
hetzelfde verzoek sturen en dezelfde stroom teruggeven.

Ze draaien uitsluitend in de **lokale E2E-modus** met de WP4-stub
(`tests/e2e/fixtures/ai-provider-stub.mjs`, poort 8790):

```bash
node tests/e2e/fixtures/ai-provider-stub.mjs &         # deterministische Anthropic-stub
# in .env.local: WP4_E2E_AI_PROVIDER=local  WP4_E2E_AI_PROVIDER_URL=http://127.0.0.1:8790
node --env-file=.env.local tests/karakterisering/run.mjs --verify --only=w311.chat.post.bestuurder.sse-bronloos
```

`core/lib/ai-provider-endpoint.mjs` grendelt de omleiding dubbel (alleen
`SEED_DOELOMGEVING=local` én de lokale Supabase-URL), dus Preview/Productie kunnen
hier nooit in belanden. Ontbreekt de stub-URL, dan slaat `run.mjs` de scenario's
**zichtbaar** over (`vereist: "ai-stub"`); in CI staat de stub aan.

Twee bewuste normalisaties (BESLUIT-comments in de code): de sleutel `peildatum`
→ `<datum>` (de route zet "vandaag" in het meta-event), en bij de beurt mét
broncontext ontbreken de prompthashes expliciet (`prompthash_niet_gekarakteriseerd`),
omdat de bronkop een willekeurige bron-sentinel en de peildatum draagt.

## Wanneer een snapshot bijwerken mag

Alleen als het gedrag **bewust** is gewijzigd (dan opnieuw `--record` en de diff
in de PR motiveren). Een onverwacht verschil is een **fout**, geen ruis. Elke
uitbreiding van de normalisatielaag hoort een `BESLUIT:`-comment bij issue #88 te
zijn — voeg nooit een normalisatieregel toe alleen om een diff weg te poetsen.
