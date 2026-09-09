# 0212 — Microsoft-loginbeleid (fase 1C): drie fondsmodi, afdwinging in de Auth-hook, en een beheerde bindingslifecycle met twee begrensde herstelpaden

- **Status:** Voorgesteld (PR-A gemerged op `preview`; PR-B — beheerpagina, herstelingang en browsertests — als draft-PR geopend, zie de aanvulling van 9 september)
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

**D5 — de fail-closed-richting is asymmetrisch, maar drift telt niet als "afwezig beleid".**
Een account **zonder profielrij** (platformidentiteit) valt buiten het fondsbeleid en houdt het
gewone wachtwoordpad; ook een ontbrekende logingateway betekent dat Microsoft-login in die
omgeving niet bestaat. Maar een account **mét profiel in een fonds zonder configuratierij** is
drift — elke fonds krijgt zo'n rij uit de migratie en de trigger — en wordt geweigerd
(reviewbevinding 3, 7 september). Binnen `verplicht` is elke twijfel dicht.

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

## Herziening na reviewronde 1 (7 september 2026)

De opdrachtgever vond vier mergeblokkers op de eerste implementatie. Alle vier zijn in dezelfde
PR hersteld; de eerste dwong een echte uitbreiding van het besluit af.

**D10 — een uitzonderingssessie krijgt een BEPERKTE databaserol, geen portaaltoegang.** De hook gaf
een break-glass- of koppelsessie het gewone `authenticated`-token. Dat token bereikt PostgREST,
Storage en Realtime rechtstreeks — precies het gat dat 0211 (bevinding 3) beschrijft en dat een
app-guard per definitie niet dicht. Gemeten tegen de lokale GoTrue+PostgREST-stack: met alléén een
wachtwoord kwam zo'n sessie bij `/rest/v1/profielen` en `/rest/v1/fondsen`.
De hook zet nu voor die sessies de claim `role = portaal_beperkt`: een NOLOGIN-rol, lid van
`authenticator`, met `USAGE` op `public` en verder **uitsluitend** kolom-`SELECT` op de eigen
profielrij (`id, fonds_id, rol, naam`, policy `id = auth.uid()`). PostgREST doet `set role` op die
claim, dus de begrenzing zit in de database. Dezelfde meting na de wijziging: `documenten` en
`fondsen` geven 403, alleen de eigen profielrij komt terug. De normale rol verschijnt pas ná AAL2
(break-glass) of via een geldige Microsoft-koppeling. De app volgt: `withFondsRoute` laat een
beperkte sessie alleen op het koppelpad toe en de layouts sturen haar naar `/beperkte-toegang`.

**D11 — break-glass is een DUURZAME aanwijzing met korte activeringsvensters.** De eerste versie gaf
de uitzondering een harde einddatum van hooguit zeven dagen; daarna stond het fonds nog op
`verplicht` zonder herstelpad. Dat is geen noodpad. De aanwijzing geldt nu tot intrekking. Wat kort
is, zijn de **activeringsvensters**: elke verhoging naar de normale rol opent een venster van een uur
in `login_private.break_glass_activeringen` en levert precies één `breakglass.gebruikt` in de audit.
Loopt dat venster af, dan zakt de sessie bij de eerstvolgende tokenuitgifte terug naar de beperkte
rol en is een nieuwe MFA-verificatie nodig — die opent een nieuw, apart geaudit venster. De
verloopBEWAKING zit in `herzien_voor`: die datum blokkeert niets, maar preflight, beheeroverzicht en
runbook melden dat de aanwijzing herzien moet worden. Intrekken beëindigt lopende verhogingen direct.

## Herziening na reviewronde 2 (7 september 2026)

**D12 — verhogen is een expliciete, geaudite handeling; de hook vertrouwt nooit op "de app komt
straks wel langs".** In de eerste herstelronde gaf de helper na een verse MFA-verificatie meteen
`vol`, met de gedachte dat de guard daarna het activeringsvenster zou openen. Een client kan dat
verzoek overslaan en rechtstreeks bij GoTrue refreshen: dan blijven volledige tokens komen zonder
venster en zonder auditregel — en een mislukte opening werd bovendien stil genegeerd
(reviewbevinding P1). De helper geeft nu `vol` **uitsluitend** wanneer er al een lopend venster is
dat bij díe MFA-verificatie hoort; in alle andere gevallen `beperkt`. Het openen loopt via één
route, `POST /api/microsoft-login/verhoging`, met eigen audithandeling en een harde 403 als het
mislukt. De guard heeft geen bijwerking meer.

Dit is niet met een SQL-suite te bewijzen — die roept de hookfunctie aan, niet GoTrue. Daarom draait
`scripts/breakglass-directe-refresh.mjs` in de blokkerende gate: hij logt echt in, verifieert echt
MFA, refresht **rechtstreeks bij de Auth-API zonder de app aan te raken**, en toetst daarna PostgREST
met het verkregen token. Met het oude gedrag teruggezet gaat die test rood op precies vier
asserties (negatieve controle uitgevoerd).

**D13 — de fondslock gaat in canonieke volgorde.** De profieltrigger vergrendelde bij een
verplaatsing eerst het oude en dan het nieuwe fonds; twee gelijktijdige wissels A→B en B→A konden
elkaar zo deadlocken (reviewbevinding P2). De trigger sorteert de betrokken fondsen nu op UUID en
vergrendelt ze in die volgorde, ongeacht de richting.

## Herziening na reviewronde 3 (7 september 2026)

**D14 — één verhoging per MFA-verificatie: vers, eenmalig en atomair.** Na ronde 2 hing de verhoging
nog aan "AAL2 én geen lopend venster". Een oude AAL2-sessie behoudt haar AAL na afloop van het
venster, dus zij kon telkens opnieuw verhogen zónder nieuwe code — het venster was daarmee feitelijk
onbeperkt heropenbaar (reviewbevinding P1, ronde 3). De activering legt nu het tijdstip van de
MFA-verificatie vast (`mfa_geverifieerd_op`, uit de `amr`-claim) en:

- **fail-closed zonder tijdstip** — ontbreekt de amr-timestamp, dan is er niets om de verhoging aan
  te hangen: `mfa_ontbreekt`, zowel in de route als in de database;
- **alleen vers** — ouder dan vijf minuten (of meer dan een minuut in de toekomst) is
  `mfa_verlopen`; die marge dekt klokverschil tussen GoTrue en Postgres;
- **eenmalig, atomair** — een unieke index op `(user_id, mfa_geverifieerd_op)` maakt een tweede
  venster op dezelfde verificatie onmogelijk (`mfa_hergebruikt`); twee gelijktijdige pogingen kunnen
  elkaar niet inhalen, want de database beslist, niet de route;
- **de hook koppelt op exact dezelfde verificatie** — `a.mfa_geverifieerd_op = p_mfa_op` — zodat een
  venster van een eerdere verificatie een latere sessie niet verhoogt.

Na afloop van het venster is dus een nieuwe `challengeAndVerify` nodig, en die opent een nieuw,
apart geaudit venster. Dat is in de echte GoTrue-test vastgelegd (dezelfde AAL2-sessie → geweigerd;
na een nieuwe verificatie → toegestaan, tweede `breakglass.gebruikt`), inclusief negatieve controle:
zonder de unieke index gaat die test rood op vier asserties.

## Herziening na reviewronde 4 (7 september 2026)

**D15 — een activering hoort bij één aanwijzing, en verhogen kruist geen intrekking.** De hook toetste
"is er érgens een levende aanwijzing?" en "is er érgens een lopende activering met dit MFA-tijdstip?"
onafhankelijk van elkaar. Werd aanwijzing A ingetrokken of vervangen door B, dan verhoogde de oude
activering van A ineens B — zonder nieuwe MFA-verificatie en zonder expliciete verhoging
(reviewbevinding P1, ronde 4). Drie correcties:

- de hook én `sessiebeleid` koppelen de activering aan de aanwijzing
  (`a.break_glass_id = g.id`, en die aanwijzing moet levend zijn);
- `open_breakglass_venster` vergrendelt de aanwijzingsrij met `FOR UPDATE`, zodat verhogen en
  intrekken elkaar niet kunnen kruisen;
- intrekken en vervangen **beëindigen** lopende vensters (`venster_tot = now()`) in plaats van ze te
  verwijderen: die rij is óók het bewijs dat déze MFA-verificatie al is verbruikt, en dat mag een
  intrekking niet wegnemen — anders opent dezelfde code straks een venster op de vólgende aanwijzing.
  De CHECK op de vensterduur is daarvoor verruimd naar `venster_tot >= geopend_op`.

Het regressiescenario staat als M22 in de gedragssuite, met negatieve controle: haal je de join weg,
dan faalt precies de assertie "een activering van een ingetrokken aanwijzing verhoogt niets".

**Rollback getest tegen de actuele migratie.** De rollback dropte nog de eerste signatuur van
`open_breakglass_venster (uuid, integer, text)`; de huidige is `(uuid, timestamptz, integer, text)`.
Daardoor bleef de functie staan en faalde het droppen van `break_glass_activeringen` op de
afhankelijkheid. Beide signaturen worden nu idempotent verwijderd, en de rollback is opnieuw
uitgevoerd tegen de actuele migratie: nul resterende functies, nul resterende tabellen,
`pilotstatus` terug en `modus` weg.

## Correctie na de Preview-smoke (9 september 2026)

**D16 — een weigering die geaudit moet worden, wordt door de database geweigerd.** De DELETE-route
had een vroege 403 vóór de gatewayaanroep. Functioneel klopte de uitkomst, maar de auditregel
`ontkoppelen.geweigerd` bleef weg: die wordt geschreven door `login_private.start_intrekking`, en
daar kwam het verzoek nooit. Vroege poorten mogen dus alleen bestaan waar zij géén geaudite
beslissing overslaan. Aanvullend toont de profielkaart in `verplicht` geen ontkoppelknop meer en
gebruikt zij bij een weigering de tekst van de server.

## Aanvulling PR-B (9 september 2026)

Drie aanscherpingen uit de review vóór de bouw van PR-B, alle drie overgenomen:

**D17 — het herkoppeltoken staat in het URL-fragment, nooit in het pad.** De uitnodigingslink is
`https://<fondshost>/koppelen#<token>`. Een token in het pad komt in serverlogs, `Referer`,
browsergeschiedenis en in de fetch van linkpreviews en mailscanners — en een eenmalig token dat
door een scanner wordt "geopend" is daarna verbruikt. Het fragment gaat niet naar de server; de
client wist het direct (`history.replaceState`), rendert het niet, en verstuurt het uitsluitend in
de body van een `POST` naar een vast endpoint zonder GET, achter dezelfde atomische startlimiet als
de inlogstart. De pagina heeft `no-store` en `no-referrer`; de analytics van de algemene
root-layout is routebewust en rendert op `/koppelen` niets (reviewbevinding van 9 september: een
geneste layout onder `app/layout.tsx` is geen root-layout en erft dus `<Analytics/>`).

**D18 — afronden is een afzonderlijke, nadrukkelijk bevestigde beheeractie.** Beheerintrekking
gaat standaard naar `revoking`. "Intrekking afronden" is een eigen dialoog met bevestigingswoord
(`AFRONDEN`), geen checkbox naast de standaardactie, en vermeldt dat de GoTrue-identiteit
achterblijft en hergebruik van die identiteit kan blokkeren.

**D19 — het beheerbeleid toont geen tenant-id.** `GET beleid` retourneert `tenantGeconfigureerd`,
niet `entraTenantId`; de contracttest pint de verboden sleutels. Ongeldige, verlopen en al gebruikte
uitnodigingen delen één neutrale fout; de uitnodigingslink wordt na uitgifte eenmaal getoond,
uitsluitend in client-state, met een kopieerknop.

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
- **De hook een verlopen activeringsvenster laten weigeren in plaats van afschalen** — dan zou een
  break-glassaccount na een uur helemaal buiten staan, ook om de MFA-stap opnieuw te doen.
  Afschalen naar de beperkte rol houdt precies één weg open: opnieuw verifiëren. Verworpen.
- **De activeringsduur als bovengrens op de aanwijzing** — dat is exact de fout uit
  reviewbevinding 4. Het venster begrenst de SESSIE; de aanwijzing eindigt door intrekking of
  herziening. Verworpen.
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
  de gebruiker zelf kan losmaken. (d) De rol `portaal_beperkt` moet net als `login_gateway` worden
  geprovisioneerd (runbook §1C.0) en lid zijn van `authenticator`; ontbreekt zij, dan weigert de
  migratie te draaien. (e) Een verhoogde break-glasssessie kan zichzelf na afloop van het venster
  opnieuw verhogen met een nieuwe MFA-stap **plus een nieuwe, geaudite verhogingsaanroep**; het
  venster begrenst dus de sessie en maakt elk gebruik zichtbaar, maar het is geen rem op de
  entitlement — die begrenzen intrekking en herziening.

## Referenties

- Migratie `supabase/migrations/2026_09_07_microsoft_login_beleidsmodus.sql` + rollback
- Gedragssuite `supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql`
- `core/lib/microsoft-login-beleid-core.ts` (+ sanity), `core/lib/microsoft-login-gateway.ts`,
  `core/lib/microsoft-login-sessieguard.ts`
- `tests/cross-tenant/microsoft-login-beleid-contract.test.ts`
- Besluit 0211 en `MICROSOFT-365-LOGIN-F1B-ONTWERP.md` (§2 karakterisering, S7-spike)
- `security/MICROSOFT-365-F1B-RUNBOOK.md` §fase 1C
