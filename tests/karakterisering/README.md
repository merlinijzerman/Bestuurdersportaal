# Karakteriseringsharnas (W1)

Snapshot-harnas dat van een vaste set API-routes de **volledige respons** vastlegt
en na een wijziging byte-voor-byte vergelijkt. Doel: bewijzen dat de deploy-2-codemod
**niets** aan het gedrag verandert ("nul verschil"). Zie issue #88 en
`05 Security en compliance/TICKET-W1-karakteriseringsharnas.md`.

> **Status:** in aanbouw. De sessie→cookie-brug is bewezen (`spike.mjs`, groen).
> Runner (`run.mjs`), volledige seed, normalisatielaag en routetabel volgen.

## Bestanden

| Bestand | Rol |
|---|---|
| `sessie.mjs` | Sessie→cookie-brug: rol → geldige `Cookie`-header via de `@supabase/ssr` cookie-jar. Definitief. |
| `spike.mjs` | Throwaway bewijs van de cookie-brug (seed 1 rol → GET `/api/profiel` 200 + 401). Wordt vervangen door `run.mjs`. |

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

## Opnemen / verifiëren / bijwerken

_Volgt bij `run.mjs` (`--record` / `--verify`)._ Regel voor nu: een snapshot mag
alleen worden bijgewerkt als het gedrag **bewust** is gewijzigd; elke uitbreiding
van de normalisatie hoort een `BESLUIT:`-comment bij issue #88 te zijn.
