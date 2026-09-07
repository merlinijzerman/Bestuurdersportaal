# Microsoft-login fase 1C — organisatiebreed loginbeleid en beheerde ontkoppeling (#344)

> **Status:** PR-A (beleid en afdwinging) geïmplementeerd; PR-B (beheer- en profielinterface) volgt.
> **Besluit:** [0212](./decisions/0212-microsoft-loginbeleid-drie-modi-en-beheerde-lifecycle.md) · **Bouwt op:** [0211](./decisions/0211-microsoft-login-expliciete-koppeling-tid-oid.md) en `MICROSOFT-365-LOGIN-F1B-ONTWERP.md`
> **Bron van waarheid blijft de code + `supabase/migrations/`.** Dit document beschrijft wat en waarom.

## 1. Probleem

Fase 1B koppelt een Microsoft-identiteit persoonlijk en exact aan een bestaand
portaalaccount (`fonds_id + user_id + tid + oid`). Wat ontbreekt is de **organisatiekant**:

- er is één binaire fondsvlag (`actief`), alleen met de hand in SQL te zetten;
- er is geen manier om Microsoft-login *verplicht* te stellen;
- de hele lifecycle (koppelen, ontkoppelen) zit bij de individuele gebruiker, ook waar de
  organisatie zou moeten beslissen;
- er is geen herstelpad als een gebruiker zijn Microsoft-identiteit kwijtraakt, en geen
  noodtoegang bij een Entra-storing.

## 2. Twee gemeten randvoorwaarden

Beide komen uit de karakterisering van #335 en sturen het hele ontwerp.

**(a) Het wachtwoordpad loopt niet door onze app.** `app/login/_components/LoginForm.tsx`
roept `supabase.auth.signInWithPassword` rechtstreeks bij GoTrue aan. Er is geen route om
te sluiten en geen middleware die ertussen zit. Het enige punt waar een wachtwoorduitgifte
te weigeren is, is de **Custom Access Token Hook** — die draait vóór élke tokenuitgifte,
inclusief refresh (0211, bevinding 4).

**(b) Een onbekende Microsoft-identiteit levert geen sessie op.** De flow vraagt uitsluitend
`openid profile`. Spike S7 (7 september 2026, `SPIKE-335-T0.5.md`) mat dat GoTrue dan
`422 signup_disabled` geeft in plaats van op e-mailadres te koppelen. Een eerste of
vervangen binding kan daarom **alleen** via `linkIdentity`, en dat vereist een bestaande
sessie voor exact dat account. Elke vorm van "sessieloos koppelen" zou de `email`-scope of
de service-role-admin-API terugbrengen — beide uitgesloten.

## 3. De drie modi

| Modus | Loginknop | Wachtwoord | Persoonlijk koppelen | Persoonlijk ontkoppelen | Lifecycle |
|---|---|---|---|---|---|
| `uit` | verborgen; start/callback 404 | open | nee | ja (bestaande koppeling opruimen) | n.v.t. |
| `optioneel` | zichtbaar | open | ja | ja | gebruiker |
| `verplicht` | zichtbaar, normale toegangsweg | **dicht** (hook 403) | alleen binnen een koppel-/herstelsessie | **nee** (DB weigert) | fondsbeheer |

`modus` is de semantische bron; `actief` blijft als compatibiliteitskolom met
`check (actief = (modus <> 'uit'))`. In `uit` blijven bestaande bindingen staan — ze geven
alleen geen tokenuitgifte meer (ongewijzigd gedrag uit fase 1B).

## 4. Afdwinging in lagen

```
L1  Auth-hook (public.fn_access_token_hook, SECURITY INVOKER als supabase_auth_admin)
    ├── oauth-uitgifte      → login_private.identiteit_toegestaan   (fase 1B, ongewijzigd)
    └── niet-oauth-uitgifte → login_private.wachtwoordlogin_niveau  (fase 1C) → drie niveaus:
        · geen profielrij (platformidentiteit)                 → 'vol'
        · profiel zonder configuratierij (DRIFT)               → 'geweigerd'
        · modus <> 'verplicht'                                 → 'vol'
        · koppel-/herstelvenster open                          → 'beperkt'
        · break-glassaanwijzing zonder geverifieerde MFA       → 'geweigerd'
        · break-glass mét MFA, sessie op AAL1                  → 'beperkt'
        · break-glass, AAL2, lopend venster van DEZE MFA-verificatie → 'vol'
        · break-glass, AAL2, geen amr-tijdstip of geen bijpassend venster → 'beperkt'
      'beperkt' = hetzelfde token met claim `role = portaal_beperkt`; 'geweigerd' = 403.

L2  Startroutes (host → fonds → configuratie → modus)         geen knop, geen flow in `uit`

L3  Guard beoordeelPortaalSessie — élk serververzoek, ongecachet
    withFondsRoute · haalFondsSessie · dashboard-, login- en platformlayout

L4  /auth/callback — hosted-flow-restant opruimen             (fase 1B, ongewijzigd)

L5  Persoonlijke acties — login_private.start_intrekking weigert in `verplicht`
    (de route weigert ook, maar de DB is het slot)
```

**De beperkte rol is de kern van de afdwinging.** PostgREST doet `set role` op de `role`-claim.
`portaal_beperkt` is een NOLOGIN-rol, lid van `authenticator`, met `USAGE` op `public` en verder
uitsluitend kolom-`SELECT` op de eigen profielrij (`id, fonds_id, rol, naam`, policy
`id = auth.uid()`). Een uitzonderingssessie bereikt daarmee geen documenten, dossiers, storage of
realtime — ook niet buiten de app om. Zonder die afschaling zou een break-glassaccount met alléén
een wachtwoord het hele portaal via PostgREST kunnen lezen; dat is gemeten vóór en na de wijziging
(besluit 0212, D10).

**Intrekkingsvenster.** De hook weigert de eerstvolgende refresh; de guard beëindigt de
sessie bij het eerstvolgende serververzoek; de harde bovengrens is `jwt_exp` (≤ 600 s op
Preview, 0211 D12). Bewust geen cache in de guard: dat zou het venster onvoorspelbaar maken.

**Fail-closed-richting (0212 D5).** Geen profielrij (platformidentiteit) of geen logingateway →
**wachtwoord open, Microsoft dicht**. Een profiel in een fonds **zonder configuratierij** is drift en
wordt geweigerd. Binnen `verplicht` is elke twijfel dicht.

## 5. Datamodel

```
public.fonds_microsoft_login
  + modus text not null default 'uit'  check (modus in ('uit','optioneel','verplicht'))
  + check (actief = (modus <> 'uit'))                       -- spiegel, geen drift
  - pilotstatus                                             -- vervallen (nergens gelezen)

login_private.break_glass                                   -- RLS aan, alle rechten dicht
  fonds_id, user_id, reden_categorie ∈ {entra_storing, beheerherstel, migratie},
  uitgegeven_door, uitgegeven_op, herzien_voor, ingetrokken_op/door, correlatie_id
  check (user_id <> uitgegeven_door)                        -- niet zelf toe te kennen
  check (herzien_voor > uitgegeven_op)                      -- bewaking, geen einddatum

login_private.break_glass_activeringen                      -- RLS aan, alle rechten dicht
  break_glass_id, fonds_id, user_id, correlatie_id,
  mfa_geverifieerd_op                                       -- amr-tijdstip: één venster per verificatie
  geopend_op, venster_tot
  check (venster_tot >= geopend_op)                          -- beëindigen mag samenvallen met openen
  unique (user_id, mfa_geverifieerd_op)                      -- eenmalig, atomair afgedwongen

login_private.herkoppel_uitnodigingen                       -- RLS aan, alle rechten dicht
  token_hash (pk, ^[0-9a-f]{64}$)                           -- ALLEEN de hash
  fonds_id, user_id, entra_tenant_id, doel='herkoppelen',
  uitgegeven_door/op, verloopt_op, geactiveerd_op, venster_tot, voltooid_op,
  ingetrokken_op/door, correlatie_id
```

Twaalf nieuwe gatewayfuncties (`activering_preflight`, `zet_modus`, `dekkingsrapport`,
`beheer_intrekking`, `verleen_break_glass`, `trek_break_glass_in`, `open_breakglass_venster`,
`breakglass_overzicht`, `maak_uitnodiging`, `activeer_uitnodiging`, `trek_uitnodiging_in`,
`sessiebeleid`), EXECUTE uitsluitend voor `login_gateway` — samen met fase 1B dus 26. Eén nieuwe
hookhelper (`wachtwoordlogin_niveau`), eigendom van `login_hook_owner`, `search_path ''`, EXECUTE
alleen voor `supabase_auth_admin`; niet voor de gatewayrol. En de beperkte portaalrol
`portaal_beperkt` (provisioning, runbook §1C.0).

## 6. De twee herstelpaden

### 6.1 Break-glass (Entra-/Microsoft-storing)

**De aanwijzing is duurzaam** — geldig tot intrekking. Een noodpad met een harde einddatum is bij
een storing juist geen noodpad meer (besluit 0212, D11). Zij is minimaal, expliciet, **niet zelf toe
te kennen**, volledig geaudit en pas werkzaam met een **geverifieerde** MFA-factor: de hook leest
`auth.mfa_factors` zelf (hij draait als `supabase_auth_admin`) en geeft het resultaat als argument
aan de helper, zodat `login_hook_owner` geen enkel recht in het auth-schema nodig heeft.

**Kort is het activeringsvenster, en verhogen is een expliciete handeling.** De eerste uitgifte ná
een wachtwoordlogin is `aal1`; die krijgt de beperkte rol, zodat de gebruiker de MFA-stap kán doen
maar nog nergens bij kan. Ook ná de verificatie (`aal2`) blijft de sessie beperkt: de hook geeft de
normale rol **pas als het venster er al is**. Dat venster openen doet `POST
/api/microsoft-login/verhoging` — één expliciete route met eigen audithandeling, die faalt met 403
als het niet lukt. Pas daarna vernieuwt de client zijn token en volgt de normale rol.

Die volgorde is bewust: zou het venster als bijwerking van een willekeurig verzoek ontstaan, dan kan
een client de app overslaan en rechtstreeks bij GoTrue refreshen — en volledige tokens houden zonder
venster en zonder auditregel (besluit 0212 D12).

**Elke verhoging hangt aan één aanwijzing én één MFA-verificatie** (0212 D14/D15). De hook koppelt de
activering aan de aanwijzing (`a.break_glass_id = g.id`, levend), zodat een activering van een
ingetrokken of vervangen aanwijzing niets verhoogt; `open_breakglass_venster` vergrendelt de
aanwijzingsrij met `FOR UPDATE` zodat verhogen en intrekken elkaar niet kruisen; en intrekken of
vervangen béëindigt lopende vensters in plaats van ze te verwijderen — de rij blijft het bewijs dat
die MFA-verificatie is verbruikt. De activering legt het tijdstip uit de
`amr`-claim vast; dat tijdstip moet er zijn (anders `mfa_ontbreekt`), vers zijn (ouder dan vijf
minuten is `mfa_verlopen`) en mag maar één keer worden gebruikt — afgedwongen door een unieke index
op `(user_id, mfa_geverifieerd_op)`, dus atomair en niet door de route. De hook koppelt op exact
datzelfde tijdstip. Zonder die binding kon een oude AAL2-sessie, die haar AAL na afloop behoudt,
telkens opnieuw verhogen zonder nieuwe code. Nu is na afloop een nieuwe `challengeAndVerify` nodig,
en die opent een nieuw, apart geaudit venster. Intrekken van de aanwijzing beëindigt lopende
verhogingen direct.

**Verloopbewaking.** `herzien_voor` blokkeert niets, maar preflight (`breakglass_herziening_verlopen`),
het beheeroverzicht (`breakglass_overzicht`) en het runbook melden dat een aanwijzing herzien moet
worden. Zo verdwijnt het herstelpad nooit ongemerkt, en blijft het toch onder periodieke toetsing.

### 6.2 Beperkte koppel-/herstelsessie

Voor een vervangen of verloren Microsoft-identiteit in `verplicht`. Het beheer selecteert
vooraf het portaalaccount en geeft een opaak token uit (32 bytes, base64url).

1. **Uitgifte** — alleen `sha256(token)` gaat naar de database; het token zelf staat nergens
   in de database, het log of de audit. Gebonden aan fonds, gebruiker, tenant en doel;
   standaard 24 uur geldig; eerdere openstaande uitnodigingen van dat account vervallen.
2. **Activering** — atomisch en eenmalig (`update … where geactiveerd_op is null`); opent
   een venster van standaard 15 minuten. Is de fondstenant sindsdien gewijzigd, dan vervalt
   de uitnodiging (`tenant_mismatch`).
3. **Gebruik** — het token authenticeert niet: de gebruiker heeft daarnaast zijn bestaande
   wachtwoord nodig. Binnen het venster laat de hook uitsluitend dít account door en staat
   het koppelpad open (inclusief het losmaken van de oude identiteit).
4. **Sluiting** — het venster sluit onmiddellijk zodra `tid + oid` actief gekoppeld is
   (in `activeer_identiteit` én `herstel_koppeling`, in dezelfde transactie). Daarna is het
   wachtwoordpad voor dat account weer dicht en logt de gebruiker met Microsoft in.

Is het wachtwoord óók niet beschikbaar, dan is aanvullende identiteitscontrole nodig; de
uitnodigingslink mag nooit het enige authenticatiemiddel zijn.

## 7. Activering van `verplicht`

`zet_modus` neemt een advisory lock op het fonds, vergrendelt de configuratierij en draait
`activering_preflight` **binnen dezelfde transactie**. **Élke andere mutatie die de dekking kan
veranderen neemt dezelfde lock** — beheerintrekking, break-glass verlenen en intrekken,
uitnodigingen uitgeven/activeren/intrekken en de persoonlijke intrekking — en een trigger op
`public.profielen` doet hetzelfde voor een nieuw of verplaatst profiel, dat niet door een van die
functies heen loopt. Een race tussen toets en omslag faalt daarmee gesloten. De preflight eist:

- een gezette Entra-tenant (`tenant_ontbreekt`);
- volledige dekking: elk profiel in het fonds heeft een `active` binding óf een levende
  break-glassuitzondering (`dekking_onvolledig`, met een telling voor het beheerscherm);
- minstens één break-glassaanwijzing met geverifieerde MFA (`breakglass_ontbreekt`); het aantal dat
  herzien moet worden komt als apart telveld terug en blokkeert niet;
- dat dat MFA-bewijs **verifieerbaar** is: is `auth.mfa_factors` voor de functie-eigenaar
  niet leesbaar, dan is het pad niet aantoonbaar en weigert de activering
  (`breakglass_onverifieerbaar`) in plaats van op een aanname door te gaan.

Een nieuw account dat ná de omslag wordt aangemaakt heeft geen binding en kan dus niet
inloggen — fail-closed, en het verschijnt in het blokkeeroverzicht van het beheer.

## 8. Beheerintrekking

Standaard zet `beheer_intrekking` de binding op `revoking`: de hook weigert onmiddellijk,
maar het levende slot blijft bezet zodat de gebruiker de GoTrue-identiteit in de eigen
sessie nog netjes kan losmaken vóór een nieuwe koppeling. Met `afronden` gaat de binding
direct naar `revoked` — bedoeld voor een vertrokken gebruiker; de GoTrue-identiteit blijft
dan achter en is alleen door die gebruiker zelf te ontkoppelen.

## 9. Meldingen en enumeratie

Eén extra publieke tekst op het loginscherm ("Voor deze omgeving logt u in met Microsoft")
en één op de profielkaart ("Uw organisatie beheert deze koppeling"). De loginmelding
verschijnt **pas ná geldige credentials** — een fout wachtwoord of onbekend account geeft
onverminderd de ene generieke melding. Er is dus geen orakel: de weigering zegt iets over
het *fondsbeleid*, niet over het bestaan van een account.

## 10. Wat NIET verandert

- De Microsoft 365 Graph-connector (Outlook/SharePoint) — gescheiden vertrouwensdomein
  (0211 D7), geen gedeelde sleutels, geen gedeelde scopes.
- De identitybinding zelf: persoonlijk en exact op `tid + oid`. Geen gedeeld
  Microsoft-account, geen JIT-provisioning, geen SCIM, geen autorisatie op e-mailadres.
- Microsoft-login voor platformbeheerders (R-34 blijft: een `oauth`-sessie op de
  platformsurface wordt geweigerd). Een platformaccount heeft geen `profielen`-rij en valt
  daarmee buiten het fondsbeleid.
- Wachtwoordlogin van andere fondsen: de modus is strikt per fonds.

## 11. Verificatie

| Laag | Waar |
|---|---|
| Pure beslisregels (modi, uitzonderingen, fail-richting, tokenvorm) | `core/lib/microsoft-login-beleid-core.sanity.ts` |
| Bron-invarianten (migratie, rollback, gateway, guard, routes, capability, CI) | `tests/cross-tenant/microsoft-login-beleid-contract.test.ts` |
| DB-structuur en -gedrag (19 scenario's, zelf-seedend, eindigt op `rollback`) | `supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql` |
| **Echte GoTrue + PostgREST** — directe refresh zonder de app, hergebruik van een MFA-verificatie, tweede verificatie; twee negatieve controles uitgevoerd | `scripts/breakglass-directe-refresh.mjs` (in `cross-tenant-ci.sh`) |
| Bijgewerkt op de veranderde feiten | F1B-suite en -contracttest, R1-gate (uitzondering `login_hook_owner`), karakteriseringssuite `login-keten` |

De gedragssuite bewijst onder meer: de beperkte rol kan géén documenten, fondsen of storage lezen
en ziet alleen de eigen profielrij (M19); de hook schaalt een break-glass- of koppelsessie af naar
die rol en geeft de normale rol pas op AAL2 binnen een lopend venster (M7, M10, M20); een profiel
zonder configuratierij wordt geweigerd terwijl een platformaccount het gewone pad houdt (M18);
nieuw fonds staat op `uit`; de spiegelconstraint laat geen drift toe; wachtwoord/magic link/herstel worden in `verplicht` geweigerd en break-glass
werkt alleen mét geverifieerde MFA; de koppel-/herstelsessie is eenmalig, kort en sluit bij
activering; persoonlijk ontkoppelen wordt geweigerd én geaudit; activering faalt gesloten
zonder dekking of break-glasspad en hertoetst binnen de schrijftransactie; `authenticated`
en `service_role` kunnen geen enkele beleidsfunctie uitvoeren; de audit blijft inhoudsvrij.

## 12. Uitrol (Preview, PGB)

1. Migratie toepassen (PGB gaat naar `optioneel` — gedragsneutraal), beide suites draaien.
2. PR-A deployen; regressie op de reeds gekoppelde PGB-testgebruiker.
3. PR-B mergen en de profielkaart per modus controleren.
4. Break-glassaccount inrichten (MFA verifiëren) en de preflight groen krijgen.
5. Pas dán PGB gecontroleerd op `verplicht`; smoke volgens `security/MICROSOFT-365-F1B-RUNBOOK.md` §fase 1C.
6. Na de test terug naar de expliciet gekozen bedrijfsmodus; uitkomst en rollbackbewijs vastleggen.

## 12b. Wat lokaal end-to-end is gemeten (7 september 2026)

De Custom Access Token Hook draait sinds deze tranche óók in de wegwerpstack
(`supabase/config.toml`), zodat het echte pad meetbaar is. Tegen die stack, met een fonds op
`verplicht`:

| Stap | Uitkomst |
|---|---|
| Wachtwoordlogin zonder uitzondering | GoTrue `403` — "Voor deze omgeving logt u in met Microsoft" |
| Break-glass op AAL1 | token met `role = portaal_beperkt`; `GET /rest/v1/documenten` → 403, alleen de eigen profielrij komt terug |
| MFA-verificatie → AAL2 | token met `role = authenticated`; portaal weer bereikbaar |
| Activeringsvenster verlopen, daarna refresh | token zakt terug naar `portaal_beperkt`; PostgREST → 403 |
| Venster openen via de gateway | precies één `breakglass.gebruikt` in `login_private.audit_log` |

## 13. Openstaand voor PR-B

Beheerpagina (modus + tenant, dekkingslijst, blokkeeroverzicht, intrekken/vrijgeven,
break-glass en uitnodigingen), de profielkaart per modus, de HTTP-routes met W13-declaratie
en registers, de `/koppelen/<token>`-ingang van de koppel-/herstelsessie, browsertests en
het bijgewerkte Preview-smokeplan.
