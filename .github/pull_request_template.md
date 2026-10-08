<!-- Deze repository is publiek: geen geheimen, klantdata, exploiteerbare bevindingdetails of vertrouwelijk testbewijs. Verwijs neutraal naar afgeschermde bronnen. -->
<!-- Gebruik Refs #... zolang het issue pas na productiecontrole gesloten mag worden. Fixes #... sluit een issue mogelijk al bij merge naar main. -->

## Wat, waarom en gekoppeld werk

Refs #...

<!-- Beschrijf de behoefte of bug, de gewenste uitkomst en de concrete wijziging. -->

## Scope en impact

- Inbegrepen:
- Buiten scope:
- Geraakte dienst en omgeving:
- Changeklasse en reden (standaard, normaal, groot of emergency):
- Impact op data, RLS/tenantgrens, auth, audit, AI/retrieval, privacy, integraties en beheer:
- Migratie, configuratie, provider of feature flag (of n.v.t. met reden):
- Herstel- of terugvalpad:

## Toetsing en acceptatie

| Criterium | Toets en uitkomst | Versie/omgeving | Bewijs of open punt |
|---|---|---|---|
| AC-1 |  |  |  |

- Preview-deployment en menselijke waarneming (datum, rol, wat gezien; of n.v.t. met reden):
- Bekende beperkingen en niet-uitgevoerde toetsen:
- Functionele acceptant en besluit (voor productiepromotie):
- Bij een PR naar `main`: scopebaseline, go/no-go, beslisser en productie-nacontrole:

## Technische checklist

- [ ] `./node_modules/.bin/tsc --noEmit --skipLibCheck` groen, of n.v.t. met reden hierboven.
- [ ] Bij een tenant-pad (host/fonds/RLS/audit/retrieval/storage): `bash scripts/cross-tenant-ci.sh` groen, of n.v.t. met reden hierboven.
- [ ] Bij een databaseobject of grant: regel toegevoegd/bijgewerkt in `supabase/checks/allowlist-grants.tsv` (via `scripts/gen/v3-allowlist-generate.sql`) en afwijking gemotiveerd in `allowlist-grants.toelichting.md`, of n.v.t. met reden hierboven.
- [ ] RLS-/audit-impact beoordeeld; `HANDOVER.md` en decision-log bijgewerkt waar nodig.
