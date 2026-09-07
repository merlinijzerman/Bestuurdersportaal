# 0212 — Microsoft-loginbeleid (fase 1C): drie fondsmodi, afdwinging in de Auth-hook, en een beheerde bindingslifecycle met twee begrensde herstelpaden

- **Status:** Voorgesteld (PR-A geïmplementeerd; PR-B — beheer- en profielinterface — volgt)
- **Datum:** 2026-09-07
- **Betrokkenen:** Merlin (opdrachtgever/productowner, vier expliciete keuzes hieronder), Claude (ontwerp en implementatie)
- **Ticket:** [#344](https://github.com/merlinijzerman/Bestuurdersportaal/issues/344) — M365 fase 1C, organisatiebreed Microsoft-loginbeleid en beheerde ontkoppeling
- **Ontwerp:** `MICROSOFT-365-LOGIN-F1C-ONTWERP.md` · **Bouwt op:** besluit 0211 (#335)

## Context

Fase 1B (0211) levert Microsoft-login voor bestaande portaalaccounts. De binding is
persoonlijk en exact (`fonds_id + user_id + tid + oid`), en dat blijft zo. Maar de
**beleidskeuze** — is Microsoft-login beschikbaar, optioneel of verplicht — en de
**lifecycle** van een koppeling worden vandaag vanuit het persoonlijke profiel bediend,
met één binaire fondsvlag (`actief`) die alleen met de hand in SQL te zetten is. Voor een
Microsoft-georiënteerd fonds is dat de verkeerde plek: de organisatie bepaalt het regime,
niet de individuele bestuurder.

Twee harde randvoorwaarden bepalen de vorm van de oplossing:

1. **Het wachtwoordpad loopt niet door onze app.** `LoginForm` roept
   `supabase.auth.signInWithPassword` rechtstreeks bij GoTrue aan. Er ís geen route om te
   sluiten. Het enige punt waar wij een wachtwoorduitgifte kunnen weigeren is de **Custom
   Access Token Hook**, die vóór élke tokenuitgifte draait, ook bij refresh.
2. **Een onbekende Microsoft-identiteit kan geen sessie opleveren.** De flow vraagt
   uitsluitend `openid profile` (geen `email`-scope). Spike S7 (7 september 2026) heeft
   gemeten dat GoTrue dan `422 signup_disabled` geeft in plaats van op e-mailadres te
   koppelen — precies de bescherming die 0211 wilde. Gevolg: een eerste of vervangen
   binding kan alleen via `linkIdentity`, en dat vereist een bestaande sessie voor exact
   dat account. Een "sessieloze" koppeluitnodiging is dus technisch onmogelijk zonder de
   `email`-scope terug te zetten (verworpen in 0211) of de service-role-admin-API te
   introduceren (verboden zonder apart voorstel).

## Besluit

Het fondsbeleid krijgt drie getypeerde modi — `uit`, `optioneel`, `verplicht` — die
**server-side in de Auth-hook** worden afgedwongen, niet alleen in de UI. In `verplicht`
is het wachtwoordpad voor normale fondsgebruikers dicht en ligt de bindingslifecycle bij
bevoegd fondsbeheer. Twee begrensde uitzonderingen houden het regime werkbaar: een
**MFA-plichtig break-glassaccount** voor een Entra-storing, en een **beperkte
koppel-/herstelsessie** voor één vooraf geselecteerd account.

Vier keuzes zijn expliciet door de opdrachtgever gemaakt (7 september 2026):

**D1 — `modus` is de semantische bron; `actief` blijft als compatibiliteitskolom.**
`check (actief = (modus <> 'uit'))` maakt drift onmogelijk en laat de hookhelper, de
kolomgrants op `login_hook_owner` en de bestaande policies uit 0211 ongemoeid. Een
opruimmigratie verwijdert `actief` zodra alle code uitsluitend `modus` leest. `pilotstatus`
vervalt (nergens geconsumeerd). Migratie is deterministisch: actief → `optioneel`
(gedragsneutraal), rest → `uit`.

**D2 — in `verplicht` weigert de hook élke niet-oauth-uitgifte, niet alleen wachtwoord.**
Magic link, herstel en OTP vallen er ook onder; een wachtwoordherstelmail zou anders een
volledige omweg om Microsoft zijn.

**D3 — één smalle capability `login.beleid.manage`, uitsluitend voor de rol `beheerder`.**
Bewust niet meeliftend op `fonds.config.manage` (die ook de voorzitter draagt): deze gate
kan een heel fonds buitensluiten.

**D4 — herkoppelen loopt via een beperkte koppel-/herstelsessie, niet via een verlaagd
fondsbeleid.** Het beheer geeft een opaak token uit; daarvan wordt **alleen sha256**
bewaard. Het token **authenticeert niet**: het identificeert het vooraf geselecteerde
portaalaccount en opent voor ten hoogste één kort venster (standaard 15 minuten, eenmalig,
intrekbaar, gebonden aan fonds, gebruiker, tenant en doel) het koppelpad. De gebruiker
heeft daarnaast zijn bestaande wachtwoord nodig. Het venster sluit onmiddellijk zodra
`tid + oid` actief gekoppeld is. Is het wachtwoord óók niet beschikbaar, dan is aanvullende
identiteitscontrole nodig — de link mag nooit het enige authenticatiemiddel zijn.

Afgeleide, dragende ontwerpkeuzes:

**D5 — de fail-closed-richting is asymmetrisch.** Ontbreekt het profiel, de configuratierij
of de logingateway, dan is het **wachtwoordpad open** en het **Microsoft-pad dicht**. Alleen
een expliciete `verplicht` sluit wachtwoord. Een afwezig beleid mag nooit als het strengste
beleid worden gelezen — anders sluit één ontbrekende rij een heel fonds buiten. Binnen
`verplicht` is elke twijfel wél dicht.

**D6 — de "byte-identiek wachtwoordpad"-invariant uit 0211 vervalt.** Guard L3 heet nu
`beoordeelPortaalSessie` en raadpleegt de gateway voor élke sessie (één functieaanroep op
de bestaande pool), bewust **ongecachet**: een omslag naar `verplicht`, een ingetrokken
break-glass of een gesloten koppelvenster werkt zo bij het eerstvolgende serververzoek. De
bovengrens blijft `jwt_exp` (≤ 600 s op Preview, 0211 D12).

**D7 — break-glass is niet zelf toe te kennen (`check (user_id <> uitgegeven_door)`),
tijdgebonden, met een vaste redencategorie in plaats van vrije tekst, en pas werkzaam met
een geverifieerde MFA-factor.** De hook leest `auth.mfa_factors` zelf — hij draait als
`supabase_auth_admin` — zodat `login_hook_owner` géén rechten in het auth-schema krijgt. De
eerste uitgifte na een wachtwoordlogin is `aal1`; die moet de hook doorlaten, anders komt
niemand ooit bij de MFA-stap. De AAL2-eis is daarom app-laag (patroon platformlayout).

**D8 — de omslag naar `verplicht` is transactioneel en hertoetst zichzelf.** `zet_modus`
neemt een advisory lock op het fonds, vergrendelt de configrij en draait de preflight ín
dezelfde transactie. Een race tussen preflight en activering faalt daarmee gesloten. De
preflight eist volledige bindingsdekking én minstens één aantoonbaar werkend
break-glasspad; is `auth.mfa_factors` voor de functie-eigenaar niet leesbaar, dan is dat pad
**niet aantoonbaar** en weigert de activering (`breakglass_onverifieerbaar`) in plaats van
op een aanname door te gaan.

**D9 — beheerintrekking zet standaard `revoking`, niet `revoked`.** De hook weigert dan
onmiddellijk, maar het levende slot blijft bezet zodat de gebruiker de GoTrue-identiteit in
de eigen sessie nog netjes kan losmaken vóór een nieuwe koppeling. Voor een vertrokken
gebruiker is er `afronden`: het slot komt vrij, de GoTrue-identiteit blijft achter.

## Overwogen alternatieven

- **`actief` omzetten naar een generated column** — formeel één bron van waarheid, maar
  vereist droppen en opnieuw aanmaken van de kolom inclusief de kolomgrants op
  `login_hook_owner` en de policies. Te riskant voor een migratie die met de hand in de
  Supabase-SQL-editor wordt geplakt. Verworpen (D1).
- **Herkoppelen door het fonds tijdelijk op `optioneel` te zetten** — kost niets extra, maar
  verlaagt het beleid voor álle gebruikers om één persoon te helpen. Blijft in het runbook
  staan als laatste redmiddel, niet als werkwijze. Verworpen als hoofdpad (D4).
- **`email`-scope + provider linking domain, zodat `signInWithIdToken` sessieloos kan
  koppelen** — zet precies de automatische e-mailkoppeling terug die 0211 heeft
  uitgesloten, met het risico dat een identiteit aan het verkeerde portaalaccount hangt.
  Verworpen.
- **Service-role-admin-API (`generateLink`) voor een herstelsessie** — introduceert de
  service-role in een authenticatiepad en is opnieuw een e-mailgebonden route. Verworpen.
- **Alleen in de UI afdwingen, met een controle in de routes** — een sessie die via Supabase
  ontstaat, bereikt PostgREST/Storage/Realtime rechtstreeks (0211, bevinding 3). Een
  controle die alleen in Next.js zit, is nooit de primaire beveiliging. Verworpen.
- **Sessiebeleid cachen (5–30 s TTL)** — scheelt een round trip per verzoek, maar maakt het
  intrekkingsvenster onvoorspelbaar precies wanneer het ertoe doet. Niet gedaan; als de
  latency in Preview knelt, is dat een aparte, gemeten afweging.

## Gevolgen

- **RLS/tenant-isolatie.** Twee nieuwe private tabellen (`login_private.break_glass`,
  `login_private.herkoppel_uitnodigingen`) met RLS aan, alle rechten gerevoked — ook voor
  `login_gateway` — en uitsluitend een leespolicy voor `login_hook_owner`. Publiek verandert
  alleen `fonds_microsoft_login` (kolom `modus` erbij, `pilotstatus` eraf) en
  `fn_access_token_hook`. Geen nieuwe browserrechten; de V3-allowlist blijft ongewijzigd.
  De uitzondering voor `login_hook_owner` in gates B/C is met exact één kolom (`modus`) en
  één functie (`wachtwoordlogin_toegestaan`) verbreed, en het volledige rolcontract wordt
  nog steeds getoetst.
- **Audit.** Nieuwe, inhoudsvrije gebeurtenissen: `beleid.gewijzigd`,
  `beleid.activering_geweigerd`, `beheer.ingetrokken`, `beheer.vrijgegeven`,
  `breakglass.verleend/geweigerd/ingetrokken`, `herkoppelen.uitgenodigd/venster_geopend/
  geweigerd/ingetrokken` en `ontkoppelen.geweigerd` — met fonds, actor, doelprofiel,
  correlatie-id en tijdstip, zonder tokens, claims of e-mailadres. Weigeringen geven een
  categorie terug in plaats van te raisen, anders verdwijnt de auditregel met de
  subtransactie (dezelfde les als bij `reserveer_identiteit` in 0211).
- **Datamodel/migraties.** `2026_09_07_microsoft_login_beleidsmodus.sql` met rollback en een
  eigen gedragssuite; de F1B-suite en de R1-gate zijn bewust bijgewerkt op de veranderde
  feiten (24 gateway-executes, `modus` in het kolomcontract, drie policies in
  `login_private`, niet-oauth zonder `user_id` is nu fail-closed).
- **Gebruikers- en beheerervaring.** In `optioneel` verandert er niets. In `verplicht` toont
  de profielkaart alleen status, verdwijnt de persoonlijke ontkoppelknop en wijst de tekst
  naar het beheer. Het loginscherm krijgt één extra, sturende melding bij een hookweigering
  — die verschijnt pas ná geldige credentials en onderscheidt dus geen bestaande van
  niet-bestaande accounts (geen accountenumeratie).
- **Bewust geaccepteerd.** (a) Eén gatewayaanroep per serververzoek, ook op het
  wachtwoordpad. (b) Een fout in het hookpad blijft een 403; valt `login_private` uit, dan
  kan niemand meer een token krijgen. Dat is de prijs van fail-closed en het laatste
  redmiddel is platformniveau (hook uitzetten in het Supabase-dashboard, runbook).
  (c) Een door het beheer vrijgegeven binding laat een GoTrue-identiteit achter die alleen
  de gebruiker zelf kan losmaken.

## Referenties

- Migratie `supabase/migrations/2026_09_07_microsoft_login_beleidsmodus.sql` + rollback
- Gedragssuite `supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql`
- `core/lib/microsoft-login-beleid-core.ts` (+ sanity), `core/lib/microsoft-login-gateway.ts`,
  `core/lib/microsoft-login-sessieguard.ts`
- `tests/cross-tenant/microsoft-login-beleid-contract.test.ts`
- Besluit 0211 en `MICROSOFT-365-LOGIN-F1B-ONTWERP.md` (§2 karakterisering, S7-spike)
- `security/MICROSOFT-365-F1B-RUNBOOK.md` §fase 1C
