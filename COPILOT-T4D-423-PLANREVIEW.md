# #423 — Planreview T4-D: OAuth, tokenkluis en inerte rolloutpoorten

Status: **planreview, versie 4 — nog geen implementatieakkoord.** Worktree
`mvp-423-t4d-oauth`, branch `codex/423-t4d-oauth-tokenkluis`, vertakt van
`origin/preview` `730b08a`.

Niets in deze tranche activeert iets. Geen consent, geen scope toegevoegd, geen
licentie- of billingwijziging, geen featureflag, geen live Retrieval-call, geen
migratie gedraaid. De #421-worktree en zijn twee modules zijn niet aangeraakt.

## Verwerkte besluiten

| # | Besluit | Ronde | Verwerkt in |
|---|---|---|---|
| 1 | Productieadapter = confidential-clientconnector met gedelegeerde verbinding; labprofiel alleen voor de smokerunner | a | §0.2, §4 |
| 2 | Readiness bindt aan fonds, actor, tenant, client-id, verbindingsversie en beide scopes | a | §1, §5 |
| 3 | Private globale kill switch, ontbreekt = dicht | a | §1, §3 |
| 4 | Kill switch direct bedienbaar via geaudite operatorfunctie | a | §2, §3 |
| 5 | Geen backfill van `client_id`; herconsent vereist | b | §0.4 |
| 6 | Expand/contract; oude functie schrijft tijdelijk `client_id = NULL` | b | §0.4 |
| 7 | Eigen monotone `verbinding_versie` in plaats van `token_cache.versie` | b | §0.5 |
| 8 | `copilot_operator` vooraf provisionen; audit met actor, reden én `session_user` | b | §3 |
| 9 | **Aparte Copilot-tokenbron die beide scopes aanvraagt; `sharepointAccessToken()` is ongeschikt** | c | §0.6, §4 |
| 10 | **De tokenbron declareert zelf tenant, client-id en credentialmodel; readiness leidt dat niet opnieuw af uit `microsoftConfig()`** | c | §4, §5 |
| 11 | **Het werkelijk verkregen tokenresultaat bevestigt beide scopes, tenant, actor en app** | c | §4.2, §5 |
| 12 | **Verplichte lockvolgorde voor rollout, billing en verbinding** | c | §3.1 |
| 13 | **Rollbackpad expand/contract-compatibel** | c | §9.3 |

## 0. Bevindingen

### 0.1 — `bron_niet_geraadpleegd` bestaat niet in het retrievalcontract

`RetrievalFoutcategorie` (`core/lib/retrieval/contract.ts:244-253`) kent negen
waarden; deze zit er niet bij. T4-D kiest **fail-closed stoppen** en voegt de
categorie níét toe — dat is de T4-E-grens. Readiness levert wel een expliciete,
inhoudsvrije toestand die T4-E later kan afbeelden.

### 0.2 — Twee credentialmodellen, expliciet gescheiden

Labsmoke: public client, PKCE, labtenant, geen secret
(`scripts/smoke/m365-copilot-lab/registry.ts:29-33`). Productie:
`ConfidentialClientApplication` met clientsecret
(`core/lib/microsoft-connector.ts:66-68`). De productieadapter gebruikt uitsluitend
de confidential-connector; het labprofiel komt in geen readinesspad voor.

### 0.3 — Er bestaat geen globale kill switch

`fonds_feature_flags` is fondsgebonden en schrijfbaar met `fonds.config.manage`
(`2026_07_09_t8_config_manifestlaag.sql:172-190`). De globale rem komt in het
private schema, **afwezige rij = dicht**.

### 0.4 — Client-id via expand/contract

`microsoft_private.verbindingen` (`…fase1_connectorfundament.sql:41-44`) kent geen
client-id; `home_account_id` is `<oid>.<tid>` en bevat hem niet.

Er is geen migratierunner; migraties worden handmatig geplakt en de volgorde is
*migratie eerst, deploy daarna*. Een `drop function` op de oude
`bewaar_koppeling`-signatuur in diezelfde migratie breekt dan elke lopende
Microsoft-koppeling, ook Outlook en SharePoint.

| Stap | Wat | Wanneer |
|---|---|---|
| **Expand** (migratie A) | `client_id` nullable + `verbinding_versie` toevoegen; nieuwe signatuur mét client-id aanmaken en granten; oude signatuur behouden maar herschrijven zodat zij expliciet `client_id = NULL` zet en `verbinding_versie` ophoogt | vóór deploy |
| **Deploy** | applicatiecode gaat over op de nieuwe signatuur | na A |
| **Contract** (migratie B) | oude signatuur droppen, grant vervalt, allowlist bijwerken | pas ná waargenomen deploy en verificatie (§9.1) |

De oude functie moet `client_id` *expliciet* op `NULL` zetten, niet de kolom
weglaten: bij `on conflict do update` blijft de vorige waarde anders staan, en dan
houdt een herkoppeling onder oude code een client-id uit een eerdere consent vast.
En zij moet `verbinding_versie` ophogen, anders verandert de verbinding zonder dat
het bewijs meebeweegt.

**Geen backfill.** Een bestaande rij invullen met de client-id van de huidige
omgeving legt een aanname als feit vast. `client_id is null` ⇒
`configuratie_ongeldig`; herconsent is de enige weg naar `gereed`.

### 0.5 — Eigen `verbinding_versie`

`token_cache.versie` loopt op bij elke tokenverversing (`bewaar_cache`, `…:60`) en
is als bewijs ongeschikt. `verbindingen` krijgt
`verbinding_versie integer not null default 1`, monotoon, uitsluitend opgehoogd bij
koppelen, herkoppelen (`bewaar_koppeling`, beide signaturen) en ontkoppelen
(`ontkoppel`). Nooit bij `bewaar_cache`, nooit gereset.

Bewust **niet** opgehoogd bij `registreer_test` (`…:61`), die `status` op `fout` kan
zetten: readiness leest `status` rechtstreeks, dus die omslag wordt hoe dan ook
gezien. De versie dekt identiteits- en consentwijzigingen; de status dekt zichzelf.

### 0.6 — NIEUW: de bestaande tokenketen kan de Copilot-arm niet bedienen

Geverifieerd in `core/lib/microsoft-connector.ts:218-243`. Drie dingen:

1. **`gedelegeerdToken(ctx, scope)` neemt exact één scope.** De parametertypering is
   `"Calendars.Read.Shared" | "Sites.Selected" | "Files.Read.All"`; `Sites.Read.All`
   komt er niet eens in voor. De functie toetst `verbinding.scopes.includes(scope)`
   en roept `acquireTokenSilent({ account, scopes: [scope] })` met dat ene scope aan.
2. **`sharepointAccessToken()` vraagt `Sites.Selected`** (`…:237-239`) — inderdaad
   ongeschikt. `sharepointSearchAccessToken()` vraagt alleen `Files.Read.All` en
   zit bovendien achter `retrievalSmokeOmgeving()` (`…:240-243`), dus ook die is
   geen productieweg.
3. **Het retourobject bewijst niets over het token.** `gedelegeerdToken` geeft
   `{ accessToken, tenantId: verbinding.tenant_id, objectId: verbinding.microsoft_object_id }`
   terug (`…:231`): tenant en actor komen **uitsluitend uit de opgeslagen
   verbinding**. Zou readiness daarop vertrouwen, dan controleren we onze eigen
   database tegen zichzelf en weten we nog steeds niet wat Microsoft daadwerkelijk
   heeft uitgegeven. Dat is precies het gat dat besluit 11 dicht.

T4-D bouwt daarom een **eigen** tokenbron (§4), zonder de bestaande functies te
wijzigen — die blijven van Outlook en SharePoint.

## 1. Readiness-state-machine

Eén functie, één conjunctie, geen `OR`-fallback, vaste volgorde.

| # | Toestand | Gezaghebbende bron | Bij falen |
|---|---|---|---|
| 1 | `uit` | globale kill switch (**afwezig = dicht**) **of** fondsflag | géén spoor, géén call |
| 2 | `configuratie_ongeldig` | `client_id` gelijk aan **`tokenbron.profiel.clientId`** (§4.1); `null` = ongeldig | stop |
| 3 | `consent_ontbreekt` | verbinding: `status='gekoppeld'`, tenant, object-id, fonds exact | stop |
| 4 | `configuratie_ongeldig` | opgeslagen scopes: beide aanwezig | stop |
| 5 | `billing_ontbreekt` | privaat billingbewijs | stop |
| 6 | `tijdelijk_geblokkeerd` | eerdere `copilot_toegang_geweigerd`/429 in het venster | stop, backoff |
| 7 | `gereed_onder_voorbehoud` | alles hierboven uit één momentopname, met `verbinding_versie` als stempel | door naar §4.2 |
| 8 | `gereed` | **tokenresultaat bevestigd** (§4.2) | doorlaten |

Stap 7 heet bewust *onder voorbehoud*: de opgeslagen verbinding is een bewering van
onze eigen database. Pas stap 8 maakt er een bevestigd feit van.

**Bewust uit** (1): arm wordt niet aangemaakt — geen adapter, geen tokenaanvraag,
geen auditspoor, geen foutcategorie. **Readinessgat met open schakelaars** (2-8):
fail-closed stoppen, nooit stil doorgaan op een kleinere bronverzameling.

## 2. Eigenaarschap

| Schakelaar | Eigenaar | Muteerbaar via | Leesbaar door |
|---|---|---|---|
| Globale kill switch | platform/DBA | migratie of operatorfunctie | server-only readiness |
| Fondsflag | fondsbeheerder | configlaag, `fonds.config.manage` | idem + statusprojectie |
| Billingbewijs | platform/DBA | migratie of operatorfunctie | server-only readiness |
| Consent, client-id, verbindingsversie | de gebruiker, via de koppelflow | `microsoft_private`-definers via `microsoft_vault` | server-only readiness |
| Tokenbron + profiel | server-only injectie | niet via HTTP | alleen de adapterfabriek |

Een fondsbeheerder kan zijn eigen fonds **dicht** zetten, maar niet de globale rem,
het billingbewijs of het consentbewijs openzetten.

## 3. Private objecten, rollen en grants

Patroon: `microsoft_private` + `microsoft_vault`, met het NOLOGIN-eigenaarpatroon
van `login_hook_owner` (`2026_09_06_microsoft_login_fase1b.sql:25,48,65`).

Nieuw: `copilot_rollout` (afwezig = dicht), `copilot_billingbewijs`,
`copilot_operator_log` (append-only, inhoudsvrij), en op `verbindingen` de kolommen
`client_id` en `verbinding_versie`.

**`copilot_operator` wordt vooraf via het runbook geprovisioned.** Migratie A begint
met een `raise exception` wanneer de rol ontbreekt, zodat de migratie niet half
landt en de rol niet stilzwijgend met onbedoelde rechten ontstaat.

| Functie | Grant aan | Bewust NIET aan |
|---|---|---|
| `copilot_lees_readiness(uuid,uuid)` | `microsoft_vault` | `copilot_operator` |
| `copilot_zet_rollout(boolean,text,text)` | `copilot_operator` | `microsoft_vault`, `authenticated`, `anon`, `service_role` |
| `copilot_zet_billingbewijs(uuid,boolean,text,text)` | `copilot_operator` | idem |
| `bewaar_koppeling(…, text)` — nieuw | `microsoft_vault` | — |
| `bewaar_koppeling(…)` — oud | `microsoft_vault`, tot migratie B | — |

**Audit.** Elke operatoraanroep schrijft actor, reden én `session_user`. Die laatste
legt de functie **zelf** vast, nooit als parameter: binnen een `SECURITY DEFINER`
wijst `current_user` naar de eigenaar en is dus waardeloos voor attributie, en een
parameter zou vervalsbaar zijn.

### 3.1 — Verplichte lockvolgorde

Eén vaste volgorde voor elke schrijvende transactie die meer dan één van deze
objecten raakt:

> **`copilot_rollout` → `copilot_billingbewijs` → `verbindingen` → `token_cache`**

Regels:

1. **Nooit in omgekeerde richting.** Wie `verbindingen` vasthoudt, mag daarna geen
   `copilot_rollout` of `copilot_billingbewijs` meer locken.
2. **Readiness leest zonder `for update`**, in één momentopname, in dezelfde
   volgorde. Een leespad dat locks neemt zou de koppelflow kunnen blokkeren.
3. **De bestaande functies blijven monogaam.** `bewaar_koppeling`, `bewaar_cache` en
   `ontkoppel` raken alleen `verbindingen`/`token_cache` (`…:59-63`); de
   operatorfuncties raken alleen `copilot_rollout` of `copilot_billingbewijs`. Er
   bestaat vandaag dus geen cyclus. Het risico ontstaat pas zodra een toekomstige
   functie er twee tegelijk pakt — daarom is de volgorde nu vastgelegd en niet
   later, wanneer de deadlock zich al in productie heeft voorgedaan.
4. De volgorde staat als commentaarblok boven elke nieuwe definer, zodat hij
   zichtbaar is op de plek waar iemand hem zou schenden.

## 4. De Copilot-tokenbron

### 4.1 — Zelfdeclarerend profiel

De bron declareert haar eigen identiteit; readiness leidt die **niet** daarnaast uit
`microsoftConfig()` af. Twee afleidingen van hetzelfde feit kunnen uiteenlopen, en
dan is onduidelijk welke won.

```ts
interface CopilotTokenbronProfiel {
  readonly tenantId: string;
  readonly clientId: string;
  readonly credentialmodel: "confidential_client_secret";
  readonly vereisteScopes: readonly ["Files.Read.All", "Sites.Read.All"];
}

interface CopilotTokenbron {
  readonly profiel: CopilotTokenbronProfiel;
  haalToken(ctx: { fondsId: string; gebruikerId: string }): Promise<CopilotTokenbewijs>;
}
```

Readiness vergelijkt `verbinding.client_id` en `verbinding.tenant_id` uitsluitend
met `tokenbron.profiel`. Een test bewijst dat `readiness.ts` `microsoftConfig` niet
importeert — statisch, zodat de tweede afleiding niet kan terugsluipen.

`credentialmodel` staat op één literal: een bron die `public_client_pkce` zou
declareren, is per type geen geldige productiebron. Zo kan het labprofiel er niet
per ongeluk in.

### 4.2 — Het tokenresultaat bevestigt zichzelf

De bron vraagt **beide** scopes in één stille aanvraag en toetst daarna wat er
werkelijk terugkwam:

```ts
interface CopilotTokenbewijs {
  accessToken: string;
  bevestigd: {
    tenantId: string;      // uit het resultaat, niet uit de verbinding
    actorObjectId: string; // idem
    clientId: string;      // idem
    scopes: readonly string[];
  };
}
```

Wat er gecontroleerd wordt:

- **beide scopes aanwezig** in de toegekende scopes van het resultaat, niet in de
  opgeslagen verbinding;
- **tenant** en **actor** uit het accountobject van het resultaat, vergeleken met de
  verbinding én met het profiel;
- **app** uit de `aud`-claim van het **id-token** van het account, vergeleken met
  `profiel.clientId`.

Twee implementatievalkuilen die de bouw expliciet moet afvangen, met een test per
stuk:

1. **Scopenormalisatie.** Microsoft levert scopes vaak als volledige URI
   (`https://graph.microsoft.com/Files.Read.All`) en de casing kan verschillen. De
   vergelijking normaliseert op het laatste padsegment, hoofdletterongevoelig, en
   doet een **exacte** vergelijking per scope. Een losse `includes()` op de
   samengevoegde string zou `Files.Read.All` laten matchen op
   `Files.Read.All.Something`.
2. **Nooit het Graph-accesstoken parsen.** Dat token is van Graph en het formaat is
   niet gegarandeerd; Microsoft ontraadt het expliciet. De app-bevestiging komt
   daarom uit het **id-token** van ons eigen account, dat wél aan onze
   appregistratie is uitgegeven.

Als de exacte veldnamen van het MSAL-resultaat in de praktijk afwijken van wat hier
staat, wint de werkelijkheid: de bouw stelt de vorm vast met een test op een echt
resultaatobject en past deze paragraaf aan — niet andersom.

### 4.3 — Grenzen

- `gedelegeerdToken`, `sharepointAccessToken` en `sharepointSearchAccessToken`
  blijven **ongewijzigd**; die zijn van Outlook, SharePoint en de smoke.
- De Copilot-bron leeft server-only, wordt **geïnjecteerd** in de adapterfabriek en
  is geen module-level singleton.
- Fonds- en tenantroutes zien alleen de interface: geen client, geen secret, geen
  service-role.
- Readiness stap 1-7 gaat **vooraf** aan `haalToken`. Niet `gereed_onder_voorbehoud`
  ⇒ geen tokenaanvraag.

## 5. Scopecontrole en client-id-binding

`MICROSOFT_SEARCH_SPIKE_SCOPE = "Files.Read.All"` bestaat al
(`microsoft-config.ts:13`) achter een smoke-poort. `Sites.Read.All` bestaat nog
niet.

**Harde grens.** De nieuwe constante komt in een declaratieve lijst voor
claimcontrole en readiness en gaat **niet** in `MICROSOFT_TOEGESTANE_SCOPES` of
`toegestaneScopes()` — het verschil tussen "kunnen controleren of iemand de scope
heeft" en "de scope kunnen aanvragen".

De controle loopt over twee lagen die allebei moeten kloppen: de **opgeslagen**
verbinding (stap 4) en het **verkregen token** (stap 8). Beide toetsen dezelfde
conjunctie — beide scopes, fonds, actor, tenant, client-id, verbindingsversie — en
één afwijking is niet gereed. Geen gedeeltelijke doorgang, en geen aanname dat de
andere laag het al deed.

## 6. Foutgedrag

**Maken de arm niet aan:** kill switch dicht, fondsflag dicht.

**Stoppen fail-closed:** `configuratie_ongeldig` (ontbrekende/afwijkende client-id,
profielmismatch), `consent_ontbreekt`, `billing_ontbreekt`, `tijdelijk_geblokkeerd`,
readinessverlies tijdens het verzoek, en **tokenbevestiging mislukt** (§4.2).

Wijziging tijdens een verzoek: readiness wordt vóór toelating opnieuw gelezen. Een
gewijzigde `verbinding_versie`, statuswijziging of scope-/tenant-/client-id-wijziging
maakt de eerdere lezing ongeldig. Een tokenrefresh raakt `verbinding_versie` niet.

Alle categorieën zijn vast en inhoudsvrij: geen fouttekst, tokenclaim, client-id,
URL, pad, item-id of Graph-body in browserrespons of audit.

## 7. Bestandsgrenzen

**#421 bezit** (niet aanraken): `core/lib/microsoft-retrieval/download.ts`,
`.../extractlokalisatie.ts` en hun twee tests.

**T4-D bezit** (nieuw): `core/lib/microsoft-retrieval/readiness.ts`,
`.../copilot-tokenbron.ts`, `.../rollout-core.ts`, twee migraties (expand +
contract) met rollbacks en checks, `tests/cross-tenant/copilot-readiness*.test.ts`,
allowlist-regels, runbook.

**Gedeeld, alleen additief**: `microsoft-config.ts` (één declaratieve
scopeconstante) en de fase-1-migratieketen (`client_id`, `verbinding_versie`).
`microsoft-connector.ts` wordt **niet** gewijzigd (§4.3).

## 8. Hermetische testmatrix

| # | Test | Bewijsvorm |
|---|---|---|
| 1-2 | kill switch / fondsflag dicht | tellende tokenstub 0, fetch-stub 0 |
| 3-4 | billing- of consentbewijs ontbreekt | niet gereed, 0 netwerkcalls |
| 5 | slechts één van beide scopes opgeslagen | niet gereed |
| 6 | verkeerde tenant/actor/fonds | niet gereed |
| 7 | tokenbron ontbreekt of onleesbaar | `configuratie_ongeldig`, nooit fail-open |
| 8 | intrekking tijdens verzoek | herlezing wijst af |
| 9 | readiness valt weg met open schakelaars | stop, géén kleinere bronset |
| 10 | beheerder muteert kill switch/billing/consent | geweigerd |
| 11 | audit en respons | inhouds- en identifier-vrij |
| 12 | bestaande goldens en Microsoft-routes | ongewijzigd met poorten dicht |
| 13 | rollback stap A | route aantoonbaar inert |
| N-1 | scopeconstante bereikt geen consentroute | statisch + gedrag |
| N-2 | `gereed` uit twee momentopnames | faalt |
| N-3 | afwezige `copilot_rollout`-rij | dicht |
| N-4 | readiness-lezen roept `haalToken` nooit aan | tellende stub 0 |
| N-5 | `client_id is null` | niet gereed; Outlook/SharePoint ongewijzigd |
| N-6 | `client_id` van een andere omgeving | niet gereed |
| N-8 | `microsoft_vault` roept operatorfunctie aan | geweigerd |
| N-9 | operatoraudit bevat actor, reden én `session_user` | alle drie |
| N-10 | `session_user` via parameters sturen | lukt niet |
| N-11 | tokenrefresh tijdens verzoek | versie ongewijzigd, beurt loopt door |
| N-12 | koppelen/herkoppelen/ontkoppelen | versie +1, monotoon, nooit reset |
| N-13 | oude signatuur in expand-venster | schrijft `NULL`, ook bij `on conflict` op een rij mét client-id |
| N-14 | oude signatuur hoogt versie op | ja |
| N-15 | migratie A zonder `copilot_operator` | stopt, landt niet half |
| N-16 | ná migratie B | oude signatuur weg |
| **N-17** | tokenresultaat mist één scope | niet gereed, ook als de verbinding beide claimt |
| **N-18** | tokenresultaat heeft andere tenant of actor dan de verbinding | niet gereed |
| **N-19** | `aud` van het id-token ≠ `profiel.clientId` | niet gereed |
| **N-20** | scopes in URI-vorm en afwijkende casing | correct herkend |
| **N-21** | scope `Files.Read.All.Something` | **niet** geaccepteerd als `Files.Read.All` |
| **N-22** | `readiness.ts` importeert `microsoftConfig` | statisch verboden |
| **N-23** | bron met `credentialmodel: "public_client_pkce"` | compileert niet / wordt geweigerd |
| **N-24** | `sharepointAccessToken`/`gedelegeerdToken` | ongewijzigd t.o.v. `origin/preview` |
| **N-25** | lockvolgorde | elke schrijvende definer neemt locks in de vaste volgorde |
| **N-26** | rollback B vóór herstel van de oude signatuur | wordt geweigerd (§9.3) |

*N-7 uit versie 2 is vervallen (besluit 6) en vervangen door N-13 t/m N-16.*

Elke negatieve controle wordt ook **omgekeerd** getest: eerst bewijzen dat de guard
rood gaat bij een ingespoten fout.

Daarnaast: typecheck, boundaries, secretscan, security-baseline, cross-tenant
inclusief DB-laag, karakterisering en productiebuild. De DB-gedragssuite wordt
aangesloten in `scripts/cross-tenant-ci.sh`, anders draait ze niet in de gate.

## 9. Uitrol, activatie en rollback (opgeschreven, niet uitgevoerd)

### 9.1 Uitrol

0. `copilot_operator` provisionen volgens runbook → 1. migratie A (expand) →
2. deploy → 3. deploy waarnemen → 4. verifiëren dat het oude pad niet meer schrijft
(een verse koppeling levert een niet-lege `client_id`, en er draait geen instantie
meer op de oude signatuur) → 5. migratie B (contract).

Stap 4 is de poort vóór de contract-stap. Zolang die niet is aangetoond blijft de
oude signatuur staan; hij is veilig, alleen niet netjes.

### 9.2 Activatie

Herconsent voor de PGB-testidentiteit zodat `client_id` gevuld raakt → billingbewijs
vastleggen → fondsflag open → kill switch open via
`copilot_zet_rollout(true, actor, reden)` → readiness aantoonbaar `gereed`,
inclusief tokenbevestiging → pas dán één geautoriseerde call.

### 9.3 Rollback — gefaseerd, spiegelbeeld van de uitrol

Een vlakke rollback zou hetzelfde venster openbreken als een vlakke uitrol: de
kolommen of de nieuwe signatuur weghalen terwijl de nieuwe applicatiecode nog
draait, breekt elke koppeling.

| Fase | Wat | Voorwaarde | Effect |
|---|---|---|---|
| **A — direct** | `copilot_zet_rollout(false, actor, reden)` | geen | arm onmiddellijk inert; **dit alleen voldoet aan het herstelpad uit de DoD** |
| **B — poorten weg** | grants intrekken, `copilot_*`-definers en -tabellen droppen | arm staat uit (A) | Copilot-poorten verdwenen; koppelflow ongemoeid |
| **C — code terug** | oude applicatiecode terugzetten | **eerst** de oude `bewaar_koppeling`-signatuur opnieuw aanmaken en granten als migratie B al gedraaid is | anders roept de teruggezette code een functie aan die niet meer bestaat |
| **D — kolommen weg** | `client_id` en `verbinding_versie` droppen | geen enkele draaiende instantie schrijft ze meer | schema terug op de oude vorm |

Fase C is de omkering van de contract-stap en de enige waar de volgorde
tegen-intuïtief is: **eerst de functie terug, dan pas de code**. Een test (N-26)
legt die voorwaarde vast, zodat de runbookvolgorde niet alleen in proza bestaat.

In de praktijk stopt een incident bij fase A. B tot en met D zijn alleen nodig bij
een volledige terugbouw.

## 10. Openstaand

Alle dertien besluiten zijn verwerkt; ik heb geen open vragen. Wat ik nodig heb is
**akkoord op deze versie**, waarna ik bouw in de opleververdeling uit het ticket:
readinesscontract en migraties, dan de tokeninterface met stubtokens, dan
statusprojectie, audit en runbook.

Vier dingen die ik bij de bouw zal **aantonen** in plaats van beweren:

1. de expand-migratie is herhaalbaar op een uit de repo opgebouwde wegwerp-DB,
   inclusief rollback;
2. de oude signatuur schrijft in het venster daadwerkelijk `NULL` — gemeten in de
   database, niet afgelezen uit de migratietekst;
3. de werkelijke vorm van het MSAL-resultaat, met een test op een echt
   resultaatobject, vóór ik §4.2 als waar behandel;
4. de lockvolgorde, met een gedragstest die twee gelijktijdige transacties op
   elkaar laat wachten in plaats van te deadlocken.
