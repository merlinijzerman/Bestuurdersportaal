<!-- Kort en concreet. Verwijder wat niet van toepassing is. -->

## Wat en waarom

<!-- Eén alinea: wat verandert er en waarom. Link het issue: Fixes #… -->

## Checklist

- [ ] `./node_modules/.bin/tsc --noEmit --skipLibCheck` groen.
- [ ] Bij een tenant-pad (host/fonds/RLS/audit/retrieval/storage): `bash scripts/cross-tenant-ci.sh` groen.
- [ ] **Databaseobject of grant gewijzigd?** Regel toegevoegd/bijgewerkt in `supabase/checks/allowlist-grants.tsv` (regenereer met `scripts/gen/v3-allowlist-generate.sql`) en afwijking gemotiveerd in `allowlist-grants.toelichting.md` — anders faalt de **V3-grants-gate** op "onbekend object" of een rechtenverschil.
- [ ] RLS-/audit-impact gecontroleerd; `HANDOVER.md`/decision-log bijgewerkt waar van toepassing.
