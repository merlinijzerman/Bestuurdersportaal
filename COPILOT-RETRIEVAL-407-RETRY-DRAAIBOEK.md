# #407 labsmoke — draaiboek voor de ene SEM01-retry

Status: **UITGEVOERD op 22-09-2026.** Zie §0 voor de uitkomst. De tekst hieronder
beschrijft het draaiboek zoals het vóór die retry is opgesteld; dat is bewust
niet herschreven, zodat zichtbaar blijft waaróp de retry is gebaseerd.

## 0. Uitkomst van de retry (22-09-2026)

**De 403 is weg.** Na het propagatievenster van 48 uur is één gecontroleerde
Retrieval-call uitgevoerd, conform V5 (één poging, ongeacht de uitkomst).

| Waarneming | Uitkomst |
|---|---|
| Accountherkenning | M365 Copilot **Premium** |
| Delegated scopes werkelijk aanwezig | `Files.Read.All`, `Sites.Read.All`, `User.Read` |
| Indexpreflights | beide groen |
| Retrieval-call | **geslaagd** — geen 401/403 meer |
| Kandidaten voor SEM01 | **0** |

**De blokkade is dus verplaatst, niet opgelost.** Zij was
`copilot_toegang_geweigerd` (entitlement/consent) en is nu
`endpoint_toegankelijk_semantische_query_nul_resultaten`. Dat is een ander
soort probleem en vraagt een ander vervolg: toegang is geen verklaring meer.

**Wat nul kandidaten NIET zegt.** Het endpoint is bereikbaar en de index is
gereed verklaard, maar daaruit volgt niet of de nulmeting een semantisch
kwaliteitsprobleem is (de query vindt de passage niet) of een index-/
filterprobleem aan de Copilot-kant (de passage zit niet in de doorzochte set).
Die twee vragen een verschillende oplossing en zijn met SEM01 alleen niet uit
elkaar te houden.

Daarom is een **afzonderlijke canary-call met `Zandloperbaken 12`** voorwaarde
voor iedere volgende conclusie: die term is uniek en letterlijk aanwezig, dus
komt hij wél terug, dan werkt de index en is SEM01 een semantische kwestie;
komt hij niet terug, dan zoekt Copilot niet in wat wij denken.

**Registry:** PR #6 mag de 403-entitlementstatus niet langer als actuele
blokkade vastleggen. De actuele waarde is
`endpoint_toegankelijk_semantische_query_nul_resultaten`.

## 1. Waarom dit draaiboek er is

*(Historisch — de stand vóór de retry van 22-09; zie §0 voor de uitkomst.)*

De labstand van 21-09 registreerde dat een Retrieval-call fail-closed eindigde
als `copilot_toegang_geweigerd`. Van die call staat **geen rapport op schijf**.
Dat is geen slordigheid van de uitvoerder maar een gat in de runner: bij een
`CopilotFout` gooide `meet()`, stelde `voerSmokeUit()` nooit een rapport samen
en printte `run.ts` één regel op stderr. Het ene toegestane verzoek was
verbruikt en er lag niets vast.

Dat gat is in deze tranche gedicht (`eindstand: "retrieval_afgewezen"`,
exitcode 5, met foutcode, foutcategorie, HTTP-status en het aantal feitelijk
verbruikte netwerkpogingen). Zonder die correctie zou de retry hetzelfde
overkomen: quotum op, bewijs weg.

## 2. Voorwaarden vóór de retry

| # | Voorwaarde | Stand op 21-09 |
|---|---|---|
| V1 | Deze tranche is op `preview` gemerged | open — PR wacht op go |
| V2 | Entitlement-/licentiepropagatie afgewacht (≈24 u na de afwijzing) | afwijzing was 21-09; venster loopt tot ±22-09 |
| V3 | Registry actueel: `index_status: content_search_verified`, `activation: blocked_on_copilot_retrieval_access` | **vervuld** — registry-PR #2 gemerged als `73c192d` op `main` |
| V4 | Accounteigenaar aan het toetsenbord voor de PKCE-aanmelding | per afspraak |
| V5 | Geen tweede poging in dezelfde ronde, ongeacht de uitkomst | codevast: requestbudget 1 + grendel |

V1 is geen formaliteit: zonder deze tranche levert een afwijzing of een
afbreking weer geen rapport, en is het quotum voor de tweede keer weg zonder
bewijs. V3 is inmiddels vervuld.

## 3. Het commando

Vanuit de root van de repository-checkout waarin deze tranche zit:

```bash
npm run smoke:m365-copilot-lab -- --rapport=VERIFICATIERAPPORT-labsmoke-SEM01-retry.md
```

Zonder `--dry-run`, want de retry ís de call. De runner vraagt vlak vóór het
verzoek om een letterlijk getypt akkoord (`JA, VOER DE RETRIEVAL-CALL UIT`).
Wie dat niet typt, krijgt exitcode 4 en géén call.

Wijs `INTEGRATIES_REGISTRY_DIR` naar de registry-checkout waarin V3 is gemerged,
als dat niet de zustermap is.

## 4. De vier uitkomsten, en wat elk betekent

| eindstand | exit | betekenis | vervolgstap |
|---|---|---|---|
| `gemeten` | 0 | de call is gelukt; categorieën en fixturecodes staan in het rapport | kwaliteitsoordeel opmaken |
| `retrieval_afgewezen` + `copilot_toegang_geweigerd` | 5 | 401/403 — consent óf licentie; de API duidt dat niet | entitlement narekenen; **niet** meteen opnieuw |
| `retrieval_afgewezen` + `copilot_billing` | 5 | 402 — het enige eenduidige billingsignaal | billing/provisioning beleggen |
| `gestopt_op_poort` | 3 | de scans openden de poort niet; er is geen call gedaan | poortcode volgen (`geen_zoekresultaat` / `…_niet_verifieerbaar` / `…_buiten_root`) |
| `retrieval_afgebroken` | 6 | de beurt stopte (Ctrl-C of deadline) ná het vertrek van het verzoek | ga uit van een verbruikt verzoek; wacht een ronde vóór een nieuwe poging |

`retrieval_afgebroken` is met opzet géén `retrieval_afgewezen`: de provider
heeft niets geweigerd. Wie die twee samenvoegt, leest later een afgebroken run
als een toegangsprobleem en gaat entitlements uitzoeken die niets mankeren.
Viel de afbreking vóór het vertrek, dan is er niets verbruikt en schrijft de
runner bewust géén rapport — de run stopt dan gewoon.

`copilot_toegang_geweigerd` blijft bewust neutraal: 401 en 403 zijn niet van
buiten te onderscheiden tussen ontbrekende consent en ontbrekende licentie. Dat
onderscheid maakt een mens aan de hand van de readinessstand, niet de adapter.

## 5. Wat de retry níet mag doen

- geen tweede Retrieval-poging, ook niet na 429 of 5xx (budget 1 + grendel);
- geen consent-, permission-, billing-, licentie- of featureflagwijziging om de
  call te laten slagen — een afwijzing is een uitkomst, geen obstakel;
- geen extract of documentinhoud vastleggen; het rapport draagt alleen
  categorieën, tellingen, latency, fixturecodes, foutcodes en afbrekingsredenen;
- de registry pas bijwerken ná de retry, op grond van het rapport.

## 6. Na de retry

Het rapport is het bewijsstuk. Werk daarna in de registry bij:

- bij `gemeten`: `activation` naar de stand die de meting rechtvaardigt;
- bij `retrieval_afgewezen`: `activation` blijft
  `blocked_on_copilot_retrieval_access`, met `index_checked_at` ongemoeid — de
  indexstand is niet opnieuw gemeten en mag niet meebewegen met een
  Retrieval-uitkomst;
- bij `retrieval_afgebroken`: niets in de registry wijzigen. Er is geen uitspraak
  gedaan over toegang, licentie of index; alleen het quotum is vermoedelijk op.

Die laatste regel is belangrijk: indexgereedheid en Retrieval-toegang zijn twee
onafhankelijke poorten. Ze in één veld samenvatten is precies de fout die de
nulstand-splitsing van #420 ongedaan zou maken.
