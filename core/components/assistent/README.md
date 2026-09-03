# De assistent in drie lagen

> Besluit `0201`. Ontwerp: `ONTWERP-EEN-GENERIEKE-ASSISTENT-2026-09-03.md` §4.
> Deze map is L1, L2 en — sinds T1 — de PANEELSCHIL. L3 (het oppervlak) is
> `app/(dashboard)/ai/_components/AssistentOppervlak.tsx`, dat als slot binnenkomt.
> Het ontwerpdoc staat **buiten de repo**, één niveau hoger in de projectmap.

```
┌─ L3  PRESENTATIE ────────────────────────────────────────────────┐
│  AssistentOppervlak — inhoud van het paneel; /ai = volledig scherm │
│  kijkstaat, opmaak, gedeelde weergavecomponenten                 │
└──────────────────────────────────────────────────────────────────┘
┌─ L2  GESPREK — useAssistent() ───────────────────────────────────┐
│  berichten · streaming · events · verduidelijking · reflectie    │
│  vervolgacties · opslag · idempotency                            │
│  → altijd de VOLLEDIGE payload (core/lib/assistent-payload.ts)   │
└──────────────────────────────────────────────────────────────────┘
┌─ L1  CONTEXT — AssistentContextProvider ─────────────────────────┐
│  fondsbreed · document · agendapunt · proces · risicomatrix ·    │
│  risico   (+ de herkomst-ingang)                                 │
└──────────────────────────────────────────────────────────────────┘
```

**De regel die divergentie voorkomt.** Een module levert alléén *context* aan (L1).
Ze bouwt geen eigen aanroep en kent de payloadvelden niet. Kan een module iets niet,
dan is dat een keuze in L1 — zichtbaar in de contextchip — en geen stilzwijgend
verschil in wat er naar de server gaat.

Waarom die regel bestaat: `AgendapuntChat.tsx` is ooit als kopie van een oudere
aanroep ontstaan en niet meegegroeid. Haar object-literal draagt **13 van de 24**
payloadsleutels; elf ontbreken. (Het ontwerpdoc noemt 9 — dat is het geserialiseerde
minimum, waarbij conditionele velden als `undefined` wegvallen.)
Dezelfde vraag geeft daar dus een ander antwoord dan op `/ai`, en niets in de
interface legt dat uit. Dat is geen bug maar een verschil dat niemand heeft
ontworpen. `core/lib/assistent-payload.sanity.ts` sluit herhaling uit voor elke surface die
de bouwer gebruikt — vandaag alleen `/ai`; `AgendapuntChat` volgt in P2b, en er is geen
CI-poort die een derde handgebouwd lichaam tegenhoudt.

## Bestanden

| Bestand | Laag | Rol |
|---|---|---|
| `AssistentContextProvider.tsx` | L1 | de contextstaat + `useAssistentContext()` |
| `useAssistent.ts` | L2 | het hele gesprek, één hook |
| `core/lib/assistent-context.ts` | L1 | afgeleide soort, chiplabel, teruglezen uit een opgeslagen gesprek |
| `core/lib/assistent-url-ingang.ts` | L1 | de deeplinks — één ingang, pure parse + resolver |
| `core/lib/assistent-payload.ts` | L2 | **de enige** bouwer van het `/api/chat`-verzoek |
| `core/lib/assistent-stream.ts` | L2 | de SSE-stroom als pure reducer |
| `core/lib/assistent-types.ts` | — | gedeelde typen |
| `core/lib/vraagtype.ts` | — | kreeg `leesAntwoordmodus` erbij (verhuisd uit `AntwoordWeergave.tsx`) |
| `core/lib/voortgang.ts` | — | kreeg `pasVoortgangToe` + types erbij (verhuisd uit `Voortgang.tsx`) |

De laatste twee zijn bestaande modules: `core/` mag niet uit `app/` importeren (boundary T9),
dus die twee pure helpers moesten mee. Beide oude plekken re-exporteren, zodat geen enkele
bestaande importregel wijzigt.

---

## Ingangenregister

**Eén AI-ingang per object.** Modules hebben al een AI-knop. Die knop opent straks
het paneel; er komt géén tweede knop naast. De enige generieke ingang is de knop
rechtsonder.

*Bestandspad én regelnummer geverifieerd tegen `origin/preview` (8f74663), 3-9-2026.
Alle zeven bestanden zijn in P1a onaangeraakt, dus deze nummers gelden ook op HEAD.*

| Ingang | Was | Is nu (T1, besluit 0204) | ✓ |
|---|---|---|---|
| `procedures/[id]/page.tsx` — "Bespreek dit proces met de AI" | `→ /ai?proces=` | `AssistentIngang`, module-scope proces | ✓ |
| `risicomatrix/page.tsx` — "Bespreek met de AI" | `→ /ai?risicomatrix=1` | `AssistentIngang`, risicomatrix; een rij zoomt in de chat in op één risico | ✓ |
| `bibliotheek/page.tsx` — "Vraag de AI over dit stuk" | `→ /ai?doc=` | `AssistentIngang`, documentscope | ✓ |
| `procedures/_components/StapPaneel.tsx` — "Vraag de AI over dit stuk" | `→ /ai?doc=` | `AssistentIngang`, documentscope (anker blijft: `fieldset disabled`) | ✓ |
| `(dashboard)/page.tsx` — recente vraag op de home | `→ /ai` | `AssistentIngang`, **fondsbreed** — zie de correctie hieronder | ✓ |
| `vergaderingen/_components/AgendapuntChat.tsx` — "Openen in volledige assistent" | `→ /ai?agendapunt=` | vervalt met `AgendapuntChat` (PR 2 van T1) | — |
| `core/lib/module-registry.ts` — nav-item "AI Assistent" | `→ /ai` | **ongewijzigd**: `/ai` ís de volledig-schermstand, en dit is de enige manifest-schakelbare ingang | ✓ |
| Knop rechtsonder (`AssistentKnopRechtsonder`) | bestond niet | de enige generieke ingang; toggle met `aria-expanded` | ✓ |
| Agendapuntkaart | inline chat + startchip | **één** knop "Bereid dit punt voor"; daarna alleen "Doorvragen" in het resultaatblok | PR 2 |

**De regel.** Elke ingang loopt door `AssistentIngang`. Een knop die dat niet doet, is een
fout — het register is alleen aftoetsbaar als er één component is om tegen af te toetsen.
Staat module `ai` uit, dan rendert `AssistentIngang` niets; die vlag dekt daarmee alle
ingangen tegelijk, plus het paneel en de knop rechtsonder.

### Correctie op dit register (T1)

De rij voor de home beloofde "opent paneel op dat gesprek". Dat kan niet: de recente vragen
komen uit een **logtabel** (`LogItem` in `app/(dashboard)/page.tsx`) en dragen geen
gespreks-id — het oude `href="/ai"` was dan ook een constante zonder id. Het paneel opent
fondsbreed: het gedrag van vandaag, minus de navigatie. Het terughalen van dát gesprek staat
als openstaand punt in besluit 0204.

### Twee aantekeningen bij dit register (P1a) — beide afgehandeld in T1

1. **Het nav-item stond niet in de oorspronkelijke lijst.** `module-registry.ts:82`
   zet "AI Assistent" in de zijbalk onder *Kennisbase*. Dat is een zevende ingang,
   en de vraag die bij het topbalk-besluit hoort geldt er onverkort: is de knop
   rechtsonder de enige generieke ingang, dan concurreert dit nav-item ermee.
   **Besloten (0204):** hij blijft en gaat naar `/ai` — dat ís de
   volledig-schermstand. Hij concurreert niet met de knop rechtsonder maar vult
   hem aan: het is de enige ingang die naar een deelbare, bookmarkbare stand
   gaat, én de enige die het manifest per fonds kan uitzetten.

2. **`?intent=` / `?herkomst=` is een levend codepad met een dode ingang.** Geen
   enkele knop in het portaal zet deze parameters; ze zijn alleen bereikbaar door
   de URL met de hand te typen. De code eromheen leeft wél: de herkomst-chip, de
   precedentie boven een verduidelijkingskeuze, en het auditveld
   `bron_intent_bron: "herkomst"`. Geregistreerd in
   **Besloten (0204): in T1 ongemoeid gelaten, aansluiten verhuist naar T2.**
   `/api/chat` logt `bron_intent_bron`/`bron_intent_herkomst` alleen als er óók
   een `bron_intent_override` is (route.ts r. 3184-3187 en r. 3814-3826). Een
   ingang die alleen de module meestuurt levert dus niets in de log; een die
   óók `intent` zet, verandert het gedrag van het gesprek. Beide breken een
   guardrail van T1, dus landt het in T2 — route en ingangen in één keer, één
   auditreview. Het label "geopend vanuit …" in de paneelkop is clientstaat.

   Dat dit pad ongebruikt is, is niet onschuldig gebleken: tijdens P1a hernoemde
   een zoek-en-vervang de variabele `herkomst` óók binnen `params.get("herkomst")`.
   Geen enkele test zag dat, juist omdat niemand die URL aanroept. Vandaar
   `core/lib/assistent-url-ingang.sanity.ts`.

### Twee besluiten die hierbij horen (vastgelegd 3-9-2026)

1. **Geen assistentknop in de topbalk.** De generieke ingang is uitsluitend de knop
   **rechtsonder**. Een knop in de topbalk zou naast de module-eigen knoppen een
   tweede, concurrerende ingang zijn — precies de dubbeling die we vermijden. Het
   effect is meetbaar: gebruikt niemand de knop rechtsonder, dan is de topbalk
   alsnog een optie; andersom is een knop terugnemen lastiger.

2. **Context volgt wat open staat.** Een stuk openen, een risico aanklikken of een
   dossier openen *zet* de context, maar opent het paneel **niet**. Alleen een
   expliciete klik opent het. Zo blijft de assistent beschikbaar zonder zich op te
   dringen, en opent de knop rechtsonder altijd met de juiste scope.

---

## Voor wie hierop verder bouwt

- **Voeg nooit een veld toe aan het `/api/chat`-verzoek buiten
  `assistent-payload.ts` om.** `CHAT_PAYLOAD_VELDEN` is een handmatige lijst; de
  contracttest faalt als een surface een veld laat vallen. Dat is het punt.
- **De reflectiestatus komt uitsluitend uit het `done`-event** (FR-67, besluit
  0110). De client leidt hem nooit af uit wat hij verstuurde.
- **De URL-afhandeling is client-side** en dus niet via een kale HTTP-rooktest te
  bewijzen. Wijzig je een deeplink, breid dan zowel
  `assistent-url-ingang.sanity.ts` (pure parse/resolver) als
  `tests/e2e/specs/assistent-context-deeplinks.spec.ts` (echte React/Supabase-route)
  uit.
- **`contextChipLabels()` heeft nog geen consument** — het paneel gebruikt
  `contextChip()` ernaast (T1). Deze functie blijft staan als geverifieerde
  weergave van wat `/ai` vóór T1 toonde;
  de functie legt op de letter vast hoe de chips vandaag luiden. Let op wat zij
  blootlegt: bij een module-scope náást een documentscope toont `/ai` vandaag **twee**
  chips — de module-chip heeft geen `!agendapuntContext`-guard, de documentchip wel.
  Bestaand gedrag, geen ontwerpkeuze. **Besloten (0204):** het paneel dikt in tot
  één chip, maar de tweede scope valt niet weg — die staat op de bronbereikregel
  eronder. Een enkel label zonder die regel zou een actieve documentscope
  verzwijgen.
