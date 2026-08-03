# 0119 — Least-privilege audittoegang: capabilities in plaats van een rol, met inzagelogging

- **Status:** Geaccepteerd
- **Datum:** 2026-08-04
- **Betrokkenen:** IB, productverantwoordelijke, ontwikkeling

## Context

De policy `"fonds log"` op `governance_log` was `for all` op fondsniveau. Iedere gebruiker in het fonds — in de praktijk elke beheerder — kon de vragen van alle collega's lezen, met de volledige vraagtekst, zonder dat daar iets van werd vastgelegd. Dat is geen rolmodel maar de afwezigheid ervan, en het is als blokkerend aangemerkt voor een tweede fonds.

## Besluit

Drie capabilities in `governance_audit_grants`, deny-by-default en met geldigheidsvenster: `governance_audit_read` (metadata van anderen), `governance_audit_read_sources` (bron-ID's, herkomst, objectreferenties) en `governance_redacties_read`. Rol `beheerder` geeft géén toegang meer. Elke inzage in andermans metadata schrijft een regel in `governance_audit_inzage`; bronniveau vraagt bovendien een expliciete, niet-lege motivering.

## Overwogen alternatieven

- **Rol `beheerder` als autorisatie houden** — verworpen: een rol is permanent en grofmazig, terwijl auditinzage per persoon, per periode en per aanleiding hoort te worden toegekend.
- **Bestaande beheerders automatisch een grant geven bij migratie** — zou de governancepagina laten werken zoals nu, maar ondermijnt de kern van dit besluit en maakt het acceptatiecriterium onhaalbaar. Verworpen.
- **`vw_governance_audit` rechtstreeks leesbaar voor `authenticated`** — verworpen tijdens de bouw: de view past de bronniveau-projectie toe op basis van de capability alléén. Een houder van `…_read_sources` had daarmee het spoor van collega's kunnen lezen zónder inzageregel en zónder motivering. De view is nu uitsluitend leesbaar binnen de definer-RPC.
- **Bronniveau automatisch bij aanwezige capability** — verworpen: dan zou elke routineweergave een motivering afdwingen en zou de applicatie er een vaste zin invullen. Bronniveau is nu een expliciet verzoek (`p_bronniveau => true`) met een echte reden.

## Gevolgen

- **Zichtbaar gedragsverschil:** een beheerder zonder grant ziet op `/governance` alleen zijn eigen interacties, met een panel dat dat vóóraf uitlegt in plaats van een foutmelding achteraf. Dat is het beoogde gedrag.
- **Beheer:** binnen dit ticket worden grants toegekend via een gedocumenteerde SQL-stap door de databank-eigenaar. Bewust geen beheer-UI — dat zou een volledige beheersurface aan dit ticket toevoegen. Openstaand punt.
- **Nieuwe testlaag:** de bestaande cross-tenant-suite toetst tenantgrenzen, niet rolgrenzen. `supabase/checks/2026_08_04_a_rollen_capabilities.sql` toetst de grenzen bínnen één fonds.
- **Bewust geaccepteerd restrisico:** een houder van `…_read_sources` ziet in rijen van vóór plateau A nog de `zoekvraag`, omdat die rijen niet worden herschreven.

## Referenties

- `supabase/migrations/2026_08_04_a2_audit_least_privilege.sql`
- `app/(dashboard)/governance/page.tsx`
- `supabase/checks/2026_08_04_a_rollen_capabilities.sql`
- [[0102]] (definer-view als projectie), [[0107]], [[0114]]
