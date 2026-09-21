# #407 labsmoke — draaiboek voor de ene SEM01-retry

Status: **voorbereid, niet uitgevoerd.** Er is in deze ronde geen indexscan,
geen Retrieval-call en geen consent-, billing- of configuratiewijziging gedaan.

## 1. Waarom dit draaiboek er is

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
| V3 | Registry actueel: `index_status: content_search_verified`, `activation: blocked_on_copilot_retrieval_access` | voorbereid op branch `codex/pgb-lab-indexstatus-20260921`, niet gemerged |
| V4 | Accounteigenaar aan het toetsenbord voor de PKCE-aanmelding | per afspraak |
| V5 | Geen tweede poging in dezelfde ronde, ongeacht de uitkomst | codevast: requestbudget 1 + grendel |

V1 en V3 zijn geen formaliteit: zonder V1 levert een afwijzing weer geen
rapport, en zonder V3 leest het rapport een indexstand die niet meer klopt.

## 3. Het commando

```bash
cd mvp-420-retry-bewijs
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

`copilot_toegang_geweigerd` blijft bewust neutraal: 401 en 403 zijn niet van
buiten te onderscheiden tussen ontbrekende consent en ontbrekende licentie. Dat
onderscheid maakt een mens aan de hand van de readinessstand, niet de adapter.

## 5. Wat de retry níet mag doen

- geen tweede Retrieval-poging, ook niet na 429 of 5xx (budget 1 + grendel);
- geen consent-, permission-, billing-, licentie- of featureflagwijziging om de
  call te laten slagen — een afwijzing is een uitkomst, geen obstakel;
- geen extract of documentinhoud vastleggen; het rapport draagt alleen
  categorieën, tellingen, latency, fixturecodes en foutcodes;
- de registry pas bijwerken ná de retry, op grond van het rapport.

## 6. Na de retry

Het rapport is het bewijsstuk. Werk daarna in de registry bij:

- bij `gemeten`: `activation` naar de stand die de meting rechtvaardigt;
- bij `retrieval_afgewezen`: `activation` blijft
  `blocked_on_copilot_retrieval_access`, met `index_checked_at` ongemoeid — de
  indexstand is niet opnieuw gemeten en mag niet meebewegen met een
  Retrieval-uitkomst.

Die laatste regel is belangrijk: indexgereedheid en Retrieval-toegang zijn twee
onafhankelijke poorten. Ze in één veld samenvatten is precies de fout die de
nulstand-splitsing van #420 ongedaan zou maken.
