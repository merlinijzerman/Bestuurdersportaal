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
    ├── oauth-uitgifte      → login_private.identiteit_toegestaan      (fase 1B, ongewijzigd)
    └── niet-oauth-uitgifte → login_private.wachtwoordlogin_toegestaan (fase 1C, NIEUW)
        · modus <> 'verplicht'                                → toegestaan
        · break-glass live én geverifieerde MFA-factor         → toegestaan
        · koppel-/herstelvenster open                          → toegestaan
        · anders                                               → 403, neutrale tekst

L2  Startroutes (host → fonds → configuratie → modus)         geen knop, geen flow in `uit`

L3  Guard beoordeelPortaalSessie — élk serververzoek, ongecachet
    withFondsRoute · haalFondsSessie · dashboard-, login- en platformlayout

L4  /auth/callback — hosted-flow-restant opruimen             (fase 1B, ongewijzigd)

L5  Persoonlijke acties — login_private.start_intrekking weigert in `verplicht`
    (de route weigert ook, maar de DB is het slot)
```

**Intrekkingsvenster.** De hook weigert de eerstvolgende refresh; de guard beëindigt de
sessie bij het eerstvolgende serververzoek; de harde bovengrens is `jwt_exp` (≤ 600 s op
Preview, 0211 D12). Bewust geen cache in de guard: dat zou het venster onvoorspelbaar maken.

**Fail-closed-richting (asymmetrisch, zie 0212 D5).** Geen profiel, geen configrij of geen
logingateway → **wachtwoord open, Microsoft dicht**. Alleen een expliciete `verplicht` sluit
het wachtwoordpad. Binnen `verplicht` is elke twijfel dicht.

## 5. Datamodel

```
public.fonds_microsoft_login
  + modus text not null default 'uit'  check (modus in ('uit','optioneel','verplicht'))
  + check (actief = (modus <> 'uit'))                       -- spiegel, geen drift
  - pilotstatus                                             -- vervallen (nergens gelezen)

login_private.break_glass                                   -- RLS aan, alle rechten dicht
  fonds_id, user_id, reden_categorie ∈ {entra_storing, beheerherstel, migratie},
  uitgegeven_door, uitgegeven_op, geldig_tot, ingetrokken_op/door, correlatie_id
  check (user_id <> uitgegeven_door)                        -- niet zelf toe te kennen
  check (geldig_tot > uitgegeven_op)                        -- altijd tijdgebonden

login_private.herkoppel_uitnodigingen                       -- RLS aan, alle rechten dicht
  token_hash (pk, ^[0-9a-f]{64}$)                           -- ALLEEN de hash
  fonds_id, user_id, entra_tenant_id, doel='herkoppelen',
  uitgegeven_door/op, verloopt_op, geactiveerd_op, venster_tot, voltooid_op,
  ingetrokken_op/door, correlatie_id
```

Tien nieuwe gatewayfuncties (`activering_preflight`, `zet_modus`, `dekkingsrapport`,
`beheer_intrekking`, `verleen_break_glass`, `trek_break_glass_in`, `maak_uitnodiging`,
`activeer_uitnodiging`, `trek_uitnodiging_in`, `sessiebeleid`), EXECUTE uitsluitend voor
`login_gateway` — samen met fase 1B dus 24. Eén nieuwe hookhelper
(`wachtwoordlogin_toegestaan`), eigendom van `login_hook_owner`, `search_path ''`, EXECUTE
alleen voor `supabase_auth_admin`; niet voor de gatewayrol.

## 6. De twee herstelpaden

### 6.1 Break-glass (Entra-/Microsoft-storing)

Minimaal, expliciet, tijdgebonden, **niet zelf toe te kennen** en volledig geaudit. Pas
werkzaam met een **geverifieerde** MFA-factor: de hook leest `auth.mfa_factors` zelf (hij
draait als `supabase_auth_admin`) en geeft het resultaat als argument aan de helper, zodat
`login_hook_owner` geen enkel recht in het auth-schema nodig heeft.

De eerste uitgifte ná een wachtwoordlogin is `aal1` — die moet de hook doorlaten, anders
komt niemand ooit bij de MFA-challenge. De AAL2-eis ligt daarom in de app-laag, zoals bij de
platformlayout (`heeftActueleMFA`).

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
`activering_preflight` **binnen dezelfde transactie**. Een race tussen toets en omslag faalt
daarmee gesloten. De preflight eist:

- een gezette Entra-tenant (`tenant_ontbreekt`);
- volledige dekking: elk profiel in het fonds heeft een `active` binding óf een levende
  break-glassuitzondering (`dekking_onvolledig`, met een telling voor het beheerscherm);
- minstens één break-glassaccount met geverifieerde MFA (`breakglass_ontbreekt`);
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
| DB-structuur en -gedrag (17 scenario's, zelf-seedend, eindigt op `rollback`) | `supabase/checks/2026_09_07_microsoft_login_beleidsmodus.sql` |
| Bijgewerkt op de veranderde feiten | F1B-suite en -contracttest, R1-gate (uitzondering `login_hook_owner`), karakteriseringssuite `login-keten` |

De gedragssuite bewijst onder meer: nieuw fonds staat op `uit`; de spiegelconstraint laat
geen drift toe; wachtwoord/magic link/herstel worden in `verplicht` geweigerd en break-glass
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

## 13. Openstaand voor PR-B

Beheerpagina (modus + tenant, dekkingslijst, blokkeeroverzicht, intrekken/vrijgeven,
break-glass en uitnodigingen), de profielkaart per modus, de HTTP-routes met W13-declaratie
en registers, de `/koppelen/<token>`-ingang van de koppel-/herstelsessie, browsertests en
het bijgewerkte Preview-smokeplan.
