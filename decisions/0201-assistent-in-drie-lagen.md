# 0201 — De assistent in drie lagen: context, gesprek, presentatie

- **Status:** Geaccepteerd
- **Datum:** 2026-09-03
- **Betrokkenen:** productowner (bestuurdersportaal), Claude Code

## Context

`AssistentClient.tsx` was 3.298 regels en deed drie dingen tegelijk: bijhouden waar de
bestuurder naar kijkt, het gesprek voeren, en dat presenteren. Dat is geen esthetisch
bezwaar maar de directe oorzaak van drie concrete problemen, vastgesteld tegen de code op
`origin/preview` (peildatum 3-9-2026) en beschreven in
`ONTWERP-EEN-GENERIEKE-ASSISTENT-2026-09-03.md` §2–§3:

1. **De assistent kan alleen als pagina bestaan.** Alles zit in één routecomponent, dus er
   kan geen paneel naast een module staan.

2. **De aanroep is verschraald op de tweede plek.** `AgendapuntChat.tsx` is ooit als kopie
   van een oudere aanroep ontstaan en niet meegegroeid: haar object-literal draagt **13 van
   de 24** payloadsleutels; **elf ontbreken**. (Het ontwerpdoc noemt 9 — dat is het
   *geserialiseerde* minimum, waarbij de conditionele velden als `undefined` wegvallen. Het
   literal zelf telt er 13; geteld op `origin/preview`.) Wat ontbreekt: bronrestrictie,
   module-scope, niet-vastgestelde stukken, `doorgrond`/`stukvoorbereiding`,
   `startvraag_bron`, `algemeen_perspectief`, `bronkeuze_vorige_log_id` en een deel van het
   auditspoor (`bron_intent_bron`, `bron_intent_herkomst`). Daarbovenop ontbrak de
   idempotency-header — die is in een **aparte branch** hersteld (`fix/agendapunt-idempotency`)
   en zit dus **niet** in deze wijziging; wordt alleen deze branch gemerged, dan blijft de
   agendapuntchat kapot.

   Gevolg van de verschraling: dezelfde vraag geeft daar een ánder antwoord dan op `/ai`,
   zonder dat iets in de interface dat uitlegt. Dat is geen bug in de zin van "het werkt niet"; het is een
   verschil dat niemand bewust heeft ontworpen.

3. **Het brosste pad was onverifieerbaar.** De SSE-verwerking (acht eventsoorten, dertien
   mutabele lokalen, setState ertussendoor) was alleen te toetsen door te klikken. Precies
   daar zitten de subtiliteiten: een terugvraag die `done` moet negeren, een afgebroken
   stream die géén kopieerknop mag krijgen (besluit 0098 §4), een reflectiestatus die
   uitsluitend van de server mag komen (FR-67, besluit 0110).

Randvoorwaarden: geen wijziging aan `/api/chat`, aan de prompts, aan de retrieval of aan de
governance-logging; geen migratie, geen policy, geen RLS-raakvlak; en — bindend — **geen
enkele gedragswijziging voor de gebruiker**.

## Besluit

Splits de assistent in drie lagen, met een vaste richting van afhankelijkheid:

- **L1 · context** (`core/components/assistent/AssistentContextProvider.tsx`,
  `core/lib/assistent-context.ts`, `core/lib/assistent-url-ingang.ts`) — houdt vast wáár de
  bestuurder naar kijkt: `fondsbreed · document · agendapunt · proces · risicomatrix ·
  risico`, plus de herkomst-ingang. De deeplinks `?doc=`, `?agendapunt=`, `?proces=`,
  `?risicomatrix=1` en `?intent=` lopen door één ingang.
- **L2 · gesprek** (`core/components/assistent/useAssistent.ts`) — berichten, streaming,
  events, verduidelijking, reflectie, vervolgacties, opslag, en via
  `core/lib/assistent-payload.ts` **altijd de volledige payload**.
- **L3 · presentatie** — vandaag `/ai`; in P1b óók het paneel.

**De regel die de divergentie structureel voorkomt: modules leveren alléén context aan. Ze
bouwen geen eigen aanroep en kennen de payloadvelden niet.** Kan een module iets niet, dan
is dat een keuze in L1 — zichtbaar in de contextchip — en geen stilzwijgend verschil in wat
er naar de server gaat.

## Overwogen alternatieven

- **Eerst het paneel bouwen (P1b), daarna pas splitsen** — verworpen. Het paneel vraagt de
  splitsing toch; hem uitstellen betekent dat de eerste paneelversie een derde surface met
  een eigen aanroep wordt, en dan is het probleem verdrievoudigd in plaats van opgelost.
- **De contextvelden in één discriminated union** (`{soort, ...}`) — verworpen. Vandaag
  kunnen ze samen bestaan: een agendapunt draagt zijn stukken als documentscope, en een
  module-scope sluit een documentscope niet uit. Een union dwingt dat af en verandert dus
  gedrag. De soort wordt daarom **afgeleid** (`bepaalContextSoort`), niet opgeslagen.
- **Vijf contextsoorten in plaats van zes** — verworpen. `risicomatrix` en `risico` zijn in
  de code echt verschillend (besluit 0151): alleen bij één risico bestaat de chip "← hele
  risicomatrix". Neutraliteit wint van een nettere opsomming.
- **De URL-ingang als eigen effect in de provider** — verworpen. De vier takken draaien
  vandaag *sequentieel* ná het laden van het profiel en ná de auto-restore, en ze gebruiken
  de gepersonaliseerde welkomsttekst. Een eigen effect introduceert een race waarin een
  deeplink de generieke begroeting toont. "Eén ingang" is daarom één **functie**, aangeroepen
  op dezelfde plek in dezelfde volgorde.
- **De URL-takken tot één keuze maken** (`else if`) — verworpen, ná een fout. De eerste versie
  deed dit wél, met een modulekop die "precedentie gelijk aan het origineel" claimde. Het
  origineel had helemaal geen precedentie: drie ONAFHANKELIJKE `try`-blokken die allemaal
  draaiden, waarbij een latere tak een eerdere overschreef. `?doc=X&agendapunt=A` eindigde
  dus op de agendapunt-framing, niet op de documentscope — de keten draaide dat om.
  Onbereikbaar via de UI (elke knop zet één parameter) en door geen enkele test gedekt; de
  code-review vond het. De parse levert nu een LIJST in bronvolgorde. Alleen `proces` en
  `risicomatrix` sluiten elkaar uit, want die stonden in het origineel in één blok.
- **De streamverwerking ongewijzigd meeverhuizen** — verworpen. Dan blijft het enige pad dat
  je niet zonder browser kunt verifiëren precies zo onverifieerbaar, terwijl de grootste
  verhuizing eroverheen gaat. Het is nu een pure reducer met twee testlagen.
- **De payloadbouwer zónder bevroren referentie testen** — verworpen. Golden fixtures die
  mét de nieuwe bouwer zijn opgenomen, bakken een transcriptiefout in zichzelf: de test
  bewijst dan dat latere stappen gelijk zijn aan de eerste, niet dat de eerste gelijk is aan
  het origineel.

## Gevolgen

**Structuur.** `AssistentClient.tsx` 3.298 → 1.437 regels. Nieuw: twee React-modules in
`core/components/assistent/` (de provider en de hook) en **vijf** `core/lib/assistent-*`-
modules (`context`, `payload`, `stream`, `types`, `url-ingang`). Daarnaast zijn twee
bestaande modules uitgebreid met verhuisde code: `core/lib/vraagtype.ts` kreeg
`leesAntwoordmodus` en `core/lib/voortgang.ts` de UI-reducer `pasVoortgangToe` + haar types.
Beide waren nodig omdat `core/` niet uit `app/` mag importeren (boundary T9); beide oude
plekken re-exporteren, dus geen importregel wijzigt. `AgendapuntChat.tsx` is in deze branch
**byte-identiek** aan `origin/preview`: het verdwijnt in P2b.

**RLS en tenant-isolatie.** Ongewijzigd. Er is geen query toegevoegd, verwijderd of
verbreed; de deeplink-reads staan nu in `resolveerAssistentContext` met dezelfde `select`,
`eq` en `order` als voorheen, onder dezelfde anon-key + RLS.

**Auditspoor.** Ongewijzigd en nu afgedwongen. `gesprek_id`, `bron_intent_bron`,
`bron_intent_herkomst`, `startvraag_bron`, `bronkeuze_vorige_log_id` en de
inhoudszegel-koppeling gaan één-op-één mee, en `CHAT_PAYLOAD_VELDEN` maakt het wegvallen van
één ervan een rode test in plaats van een stille verschraling.

**Datamodel/migraties.** Geen.

**Testdekking.** **+54** sanity-tests — payloadcontract 13, streamreducer 15, URL-ingang 19,
contextlaag 7 — **plus zes** componenttests op de SSE-verwerking, dus zestig in totaal.
`core/lib/ai-begroeting-copy.sanity.ts` is bijgesteld omdat de begroeting naar de
gesprekslaag verhuisde en de badge-tooltip in de presentatielaag bleef; de check leest nu
beide bestanden en is niet verzwakt. `npm test` blijft exit 0 met
dezelfde tellingen als de baseline op `origin/preview`.

**Bewust geaccepteerd.**

- `contextChipLabels()` heeft nog geen consument: de chip wordt in P1b gebouwd. De functie
  legt op de letter vast hoe de chips vandaag luiden — inclusief het gegeven dat er bij een
  samengestelde context (module + document) vandaag **twee** chips naast elkaar staan. Dat is
  bestaand gedrag, geen ontwerpkeuze; P1b moet expliciet beslissen wat het paneel daarmee
  doet. Deze fout zat er eerst wél in: één enkel label had de actieve documentscope
  stilzwijgend verzwegen — precies de chip die moet zeggen waarop geantwoord wordt.
- De payloaddivergentie van `AgendapuntChat` blijft bestaan tot P2b (geregistreerd).
- Vier wijzigingen die verder gaan dan verplaatsen, afgedwongen door de blokkerende
  `lint:quality`-gate (React Compiler). Die gate meldde **vijf** bevindingen, opgelost met
  **vier** ingrepen (de vier `preserve-manual-memoization`-meldingen kwamen uit één
  dependency-lijst): geen refs over de laaggrens, het actieve gesprek-id ook als waarde, de
  highlight-timer als effect, en het initialisatie-effect aan de losse stabiele setters.
  Geverifieerd dat alle vijf nieuw waren — de preview-versie levert er nul door dezelfde
  config — dus opgelost in plaats van de baseline opgerekt.

**Eén regressie, in dit werk ontstaan en hersteld.** Bij het verhuizen van de gesprekslaag
hernoemde een zoek-en-vervang de closure-variabele `herkomst` óók binnen de stringliteral
`params.get("herkomst")`. Elke `/ai?intent=fonds&herkomst=<module>` viel daardoor stil terug
op `"portaal"`. Niets ving dat: `tsc` niet (het blijft een geldige string), de componenttests
niet, en een rooktest evenmin — de URL-afhandeling draait client-side, en **geen enkele knop
in het portaal zet die parameter**. Dat laatste is nu apart geregistreerd. De les is niet
"beter opletten" maar dat een deeplink een pure functie hoort te zijn die je kunt uitrekenen;
`assistent-url-ingang.sanity.ts` doet dat.

## Waar oudere besluiten naar `AssistentClient` verwijzen

Besluitregisters worden niet herschreven; deze tabel is de brug. Verwijst een eerder besluit
naar `AssistentClient.tsx` voor iets dat gespreksstaat, streaming of de payload betreft, lees
dan de rechterkolom.

| Besluit / document | Verwees naar | Staat sinds 0201 in |
|---|---|---|
| 0086 (auto-restore), 0092 (`bewaarGesprek`), 0120 (`gesprekBestaatInDb`), 0089 (scherpstel) | `AssistentClient.tsx` | `core/components/assistent/useAssistent.ts` |
| 0158 (`stukContextUitBerichten` + Word-export) | `AssistentClient.tsx` | `core/components/assistent/useAssistent.ts` |
| 0090 (meta-veld doormappen) | `AssistentClient.tsx` | `core/lib/assistent-stream.ts` |
| 0088, 0138 (`pasVoortgangToe`) | `Voortgang.tsx` | `core/lib/voortgang.ts` (re-export blijft) |
| `T5-VERGELIJKMODUS-ONTWERP.md` (consumptie van de vergelijk-events) | `AssistentClient.tsx` | `core/lib/assistent-stream.ts`; alleen de rendering bleef |
| `AI-PRIMAIRE-DOCUMENTMODUS-ONTWERP.md` (werkstand-staat) | `AssistentClient.tsx` | `useAssistent.ts`; het chiplabel bleef in de weergave |
| `WERKOPDRACHT-*`-documenten met regelnummers in `AssistentClient.tsx` | — | vervallen door de krimp 3.298 → 1.437; uitgevoerde opdrachten, historisch |

## Referenties

- `ONTWERP-EEN-GENERIEKE-ASSISTENT-2026-09-03.md` §2 (divergentieanalyse), §4 (doelbeeld),
  §6 (plateaus) — staat **buiten de repo**, één niveau hoger in de projectmap
- `core/components/assistent/README.md` — de drie lagen + het ingangenregister (bindend P1b)
- Besluit 0079 (één weergave, twee ingangen), 0098 §4 (alleen een afgeronde generatie is
  kopieerbaar), 0110 + FR-67 (reflectiestatus is server-controlled), 0151 (module-scope),
  0137 (bronkeuze antwoord-eerst), 0087 (voortgangsfasen)
- Volgt op: de idempotency-fix in `AgendapuntChat` (eigen PR, herstelt een lopende storing
  op het doorvraagpad sinds `c872331`, 15-08-2026)
