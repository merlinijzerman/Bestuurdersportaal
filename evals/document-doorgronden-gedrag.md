# Evaluatieset — "een document doorgronden" (P2 Deel B)

> **Type:** vast, herhaalbaar protocol voor de **menselijke** aftekening of elke
> sectiecombinatie van de taak "een document doorgronden" een **bruikbaar
> bestuurlijk antwoord** oplevert (werkopdracht P2, acceptatiecriterium 14).
>
> **Waarom dit spoor en niet AQLab.** AQLab (`ai-quality-lab/`) is de zware,
> DB-gedreven regressie-/assurancemachine (score + gate + review-enum). Twee
> redenen om criterium 14 hier af te tekenen en niet in AQLab:
> 1. De AQLab-generate-adapter draait het `SP_DOCUMENTEN_REGELS`-promptpad, niet
>    het live `SP_DOCUMENT_SCOPE_*`-pad met de sectiecompositie dat deze taak
>    gebruikt — een AQLab-run zou een *benadering* toetsen, niet het feature.
> 2. Criterium 14 vraagt een enkelvoudig **"bruikbaar bestuurlijk antwoord?
>    ja/nee"**-oordeel; dat is een menselijk oordeel op vrije tekst, precies wat dit
>    lichte `evals/`-protocol (zoals [`organisatieprofiel-gedrag.md`](./organisatieprofiel-gedrag.md))
>    als eersteklas uitkomst kent, en wat de AQLab-gate niet geeft.
>
> AQLab uitbreiden met een echte `document_doorgronden`-feature + adapter op het
> `SP_DOCUMENT_SCOPE_*`-pad is een mogelijk vervolg; buiten deze plateauscope.

## 1. Vaste parameters (vastgelegd; niet per run wijzigen)

| Parameter | Waarde | Motivatie |
| --- | --- | --- |
| **Model** | `claude-opus-4-8` | Exact `AI_MODEL` (`core/lib/generatie-kern.ts` r.34, env-default). Reproduceerbaar. |
| **Temperatuur** | **1.0** (model-default) | De chat-route zet géén `temperature` → Anthropic-default. Test op wat live draait. |
| **Promptvariant** | `doorgrond_v1_kort` | Vast; vaste lengtenorm "kort — ±1 A4" (geen lengteknop, werkopdracht "Niet in scope"). |
| **Runs per combinatie** | 3 | Bij temperatuur 1.0 vangt herhaling variatie op; 3 volstaat voor een bruikbaarheidsoordeel (geen governance-kritische 5/5 zoals E2). |
| **Slagingsdrempel** | **≥ 2/3 runs** een bruikbaar bestuurlijk antwoord | Bruikbaarheid is een kwaliteits-, geen veiligheidsdrempel. Een combinatie die < 2/3 haalt wordt gerepareerd of uitgezet — niet stil opgeleverd. |
| **Reviewer** | Eén functioneel reviewer + aftekening opdrachtgever | Menselijk oordeel op vrije tekst. |
| **Datum / commit** | In te vullen per uitvoering | Herleidbaarheid aan codeversie. |

## 2. De acht sectiecombinaties

De taak kent vier secties: **S** = Samenvatting, **A** = Bestuurlijke
aandachtspunten, **V** = Kritische vragen, **Afw** = Afwijkingen. Zonder de (bewust
geschrapte) lengteknop is de promptmatrix acht combinaties: de zeven niet-lege
deelverzamelingen van {S, A, V}, plus één Afw-inclusieve combinatie op een document
**mét** aantoonbaar eerdere versie (`documenten.vervangt_document_id` gezet).

| # | Combinatie | Document | Bijzonderheid |
| --- | --- | --- | --- |
| 1 | S | actueel stuk zonder voorganger | enkelvoudige sectie |
| 2 | A | idem | enkelvoudige sectie |
| 3 | V | idem | enkelvoudige sectie — let op: geen besluit/aanbeveling |
| 4 | S + A | idem | de default-selectie |
| 5 | S + V | idem | |
| 6 | A + V | idem | |
| 7 | S + A + V | idem | volledige niet-Afw-set |
| 8 | S + A + Afw | stuk **mét** eerdere versie | Afw vergelijkt met de voorganger (die óók in scope zit) |

> Voer combinaties 1–7 uit op een fondsstuk zónder voorganger (Afw uitgegrijsd).
> Combinatie 8 vereist een stuk waarvan `vervangt_document_id` verwijst naar een
> aantoonbaar eerdere versie in de fondsbibliotheek (via de reguliere
> `van_kracht → vervangen`-transitie). Ontbreekt zo'n stuk in de demo-data, seed er
> dan één (twee versies van hetzelfde rapport, de nieuwe vervangt de oude).

## 3. Beoordeling per run

Draai elke combinatie in de échte `/ai`-taak ("Een document doorgronden" →
secties aanvinken → Start). Beoordeel per run:

- **Sectiestructuur:** verschijnt elke gekozen sectie onder een eigen, correcte kop,
  en géén niet-gekozen sectie?
- **Bruikbaar bestuurlijk antwoord (het kernoordeel):** kan een bestuurder hiermee
  voorbereid de vergadering in? Concreet, gegrond in het stuk, geen schijnzekerheid.
- **Human-in-the-loop:** bij *Kritische vragen* — vragen, geen besluit/aanbeveling.
- **Afwijkingen (combinatie 8):** benoemt het antwoord de verschillen met de
  **voorganger** en niet een verzonnen vergelijking (schijnzekerheid-guardrail)?
- **Auditspoor (steekproef):** legt `governance_log.retrieval_meta.doorgrond` de
  parameters vast (`secties`, `document_ids`, `vorige_document_id`, `promptvariant`)?
  De zichtbare `vraag` is de korte zin; de parameters maken het antwoord
  reconstrueerbaar (criterium 13).

## 4. Reviewtabel (invullen bij uitvoering)

**Model:** `claude-opus-4-8` · **Temp:** 1.0 · **Variant:** `doorgrond_v1_kort` · **Datum:** _…_ · **Commit:** _…_ · **Reviewer:** _…_

| # | Combinatie | Run | Koppen correct? | Bruikbaar (ja/nee)? | Notitie |
| --- | --- | --- | --- | --- | --- |
| 1 | S | 1–3 | | | |
| 2 | A | 1–3 | | | |
| 3 | V | 1–3 | | | |
| 4 | S+A | 1–3 | | | |
| 5 | S+V | 1–3 | | | |
| 6 | A+V | 1–3 | | | |
| 7 | S+A+V | 1–3 | | | |
| 8 | S+A+Afw | 1–3 | | | |

## 5. Uitkomst + aftekening

- **Per combinatie:** ▢ bruikbaar (≥2/3) ▢ niet — reparatie/uitzetten: _…_
- **Samenvatting:** _…_
- **Datum / commit-hash:** _…_
- **Reviewer:** _…_ · **Opdrachtgever-akkoord:** _…_

> Deze uitkomst tekent acceptatiecriterium **14** af. Combinaties die zakken worden
> gerepareerd (promptinstructie in `core/lib/doorgrond.ts`) of uitgezet (sectie
> tijdelijk niet aanbieden) — niet stil opgeleverd.
