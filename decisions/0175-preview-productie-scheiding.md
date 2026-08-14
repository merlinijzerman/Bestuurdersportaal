# 0175 — `app.*` wordt geïsoleerde Preview met AI; `horizon.*` blijft uitgefaseerd

- **Status:** Geaccepteerd
- **Datum:** 2026-08-14
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Codex (uitvoering/advies)
- **Relatie:** herziet de relevante hostkeuzes in [`0135`](./0135-fondshost-per-fonds-en-hardcode-guardrail.md), [`0043`](./0043-tenant-app-host-bridge-transitioneel.md), [`0030`](./0030-loginhost-en-backward-compat.md) en [`0029`](./0029-publieke-voorkant-host-indeling.md).

## Context

`app.bestuurdersportaal.com` is nu als Productiedomein gekoppeld en in de
Productiedatabase aan Horizon gemapt. De gewenste functie verandert: dit wordt
de stabiele Preview voor interne regressietests en tijdelijke toegang door
externen. AI moet daar aan blijven om de volledige gebruikersstroom, retrieval,
webonderzoek en stukvoorbereiding vóór Productie te kunnen testen.

Een Preview met externe gebruikers en AI is geen vrijblijvende demo. Als zij
Productiedata, service-role-secrets, providerkeys of Auth-config deelt, wordt ze
een direct aanvalspad naar Productie. Daarnaast verwijst de huidige algemene
Productie-login via `APP_HOST` naar `app.*`; die koppeling moet vóór de verhuizing
worden verbroken.

`horizon.bestuurdersportaal.com` is eerder verwijderd en wordt nergens gebruikt.
Er is geen functionele reden om het opnieuw als Productiedomein te introduceren.

## Besluit

1. `app.bestuurdersportaal.com` wordt de vaste **Preview** en mapt daar naar een
   synthetische Preview-tenant, niet naar Horizon.
2. Preview krijgt een eigen Supabase-isolatie (DB/Auth/Storage/secrets), eigen
   AI-providerprojecten/keys en eigen quota/budgetten. Productiedata en
   Productiesecrets zijn verboden; testdata is synthetisch of expliciet
   vrijgegeven. Echte e-mailnotificaties staan uit of gaan naar een sink.
3. AI blijft in Preview **ingeschakeld**, inclusief de functies die expliciet
   getest moeten worden, maar alleen onder capabilities, allowlists, quota,
   modelallowlists, budgetalerts en een Preview-only kill switch.
4. `horizon.bestuurdersportaal.com` blijft uitgefaseerd: geen DNS, Vercel-domain,
   Auth-redirect of `tenant_domains`-rij.
5. De fondsdomeinen en publieke apex/`www` blijven Productie. De beheeromgeving
   blijft een afzonderlijke Productiesurface.
6. De externe domeincutover gebeurt als laatste. Eerst worden Preview, Productie-
   login, Auth-redirects, accounts, data en secrets gescheiden en getest.
7. De historische migraties blijven ongewijzigd. Een nieuwe voorwaartse migratie
   verwijdert bij cutover de Productie-rij `app.* → Horizon`; Preview-seeding is
   omgevingsspecifiek en wordt niet als universele Productiedataseed uitgevoerd.

## Overwogen alternatieven

- **Preview zonder AI.** Afgevallen: hiermee worden juist de duurste en
  veiligheidskritische ketens pas voor het eerst in Productie getest.
- **Preview delen met Productie-Supabase of Productie-providerkeys.** Afgevallen:
  een fout of extern account zou direct Productiedata, secrets of budget raken.
- **Horizon naar `horizon.*` verhuizen.** Afgevallen: het domein heeft geen
  gebruiker of noodzakelijke functie; herintroductie vergroot DNS/Auth/monitoring-
  oppervlak zonder functionele winst.
- **`app.*` direct omzetten en later opruimen.** Afgevallen: de bestaande
  Productie-login- en Auth-afhankelijkheden kunnen dan Productiegebruikers naar
  Preview sturen.

## Gevolgen

- Er zijn twee echte omgevingen nodig, niet één Productieproject met een ander
  label. Dit brengt extra providerconfiguratie en beperkte kosten mee.
- Externe Preview-toegang is invite-only, minimaal geprivilegieerd en tijdgebonden.
- De algemene Productie-`/login` krijgt vóór cutover een fondskeuze of een
  neutrale uitleg met directe fondsdomeinlinks; hij mag niet naar Preview sturen.
- Supabase Auth krijgt per omgeving exacte Site URL-/redirectallowlists.
- `TENANT_ENFORCE` blijft in Preview én Productie fail-closed; RLS blijft de
  primaire datagrens en host↔fondscontrole defense-in-depth.
- Monitoring, AI-kosten en e-mail moeten per omgeving herkenbaar gescheiden zijn.
- Dit besluit vervangt uitsluitend de oude rol van `app.*` als Horizon-/
  Productiehost. De overige tenant-, audit- en brandingkeuzes uit 0135 blijven
  van kracht.

## Referenties

- [`../security/OMGEVINGEN-RUNBOOK.md`](../security/OMGEVINGEN-RUNBOOK.md)
- [`../security/DREIGINGSMODEL.md`](../security/DREIGINGSMODEL.md)
- [`../security/ASVS-L2-REGISTER.md`](../security/ASVS-L2-REGISTER.md)
- `supabase/migrations/2026_07_08_tenant_domains_bridge_app_host.sql`
- `supabase/migrations/2026_08_06_tenant_domains_demo_fondsen.sql`
- `supabase/migrations/2026_08_07_tenant_domains_horizon_verwijderen.sql`
