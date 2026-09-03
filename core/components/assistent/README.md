# De assistent in drie lagen

> Besluit `0201`. Ontwerp: `ONTWERP-EEN-GENERIEKE-ASSISTENT-2026-09-03.md` §4.
> Deze map is L1 en L2; L3 is vandaag `app/(dashboard)/ai/_components/AssistentClient.tsx`.

```
┌─ L3  PRESENTATIE ────────────────────────────────────────────────┐
│  /ai (AssistentClient) — straks óók het paneel (P1b)             │
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
aanroep ontstaan en niet meegegroeid. Zij stuurt **9 van de 24** payloadvelden.
Dezelfde vraag geeft daar dus een ander antwoord dan op `/ai`, en niets in de
interface legt dat uit. Dat is geen bug maar een verschil dat niemand heeft
ontworpen. `core/lib/assistent-payload.sanity.ts` maakt herhaling ervan onmogelijk.

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

---

## Ingangenregister

**Eén AI-ingang per object.** Modules hebben al een AI-knop. Die knop opent straks
het paneel; er komt géén tweede knop naast. De enige generieke ingang is de knop
rechtsonder.

*Geverifieerd tegen de code op `origin/preview` (8f74663), 3-9-2026.*

| Bestaande ingang | Nu | Straks (P1b) |
|---|---|---|
| `procedures/[id]/page.tsx:564` — "Bespreek dit proces met de AI" | `→ /ai?proces=` | opent paneel, context = dossier |
| `risicomatrix/page.tsx:77` — "Bespreek met de AI" | `→ /ai?risicomatrix=1` | opent paneel, context = risicomatrix; een risicorij zoomt in op één risico |
| `bibliotheek/page.tsx:756` — "Vraag de AI over dit stuk" | `→ /ai?doc=` | opent paneel, context = document |
| `procedures/_components/StapPaneel.tsx:1989` — bronverwijzing | `→ /ai?doc=` | opent paneel, context = document |
| `vergaderingen/_components/AgendapuntChat.tsx:1087` — "Openen in volledige assistent" | `→ /ai?agendapunt=` | vervalt: de paneelknop "volledig scherm" doet dit zonder navigatie |
| `(dashboard)/page.tsx:407` — recente vraag op de home | `→ /ai` | opent paneel op dat gesprek |
| **`core/lib/module-registry.ts:82` — het nav-item "AI Assistent"** | `→ /ai` | **nog te besluiten in P1b** |
| Agendapuntkaart | inline chat + startchip | **één** knop "Bereid dit punt voor"; is het punt voorbereid, dan alleen "Doorvragen" in het resultaatblok |

### Twee aantekeningen bij dit register (P1a)

1. **Het nav-item stond niet in de oorspronkelijke lijst.** `module-registry.ts:82`
   zet "AI Assistent" in de zijbalk onder *Kennisbase*. Dat is een zevende ingang,
   en de vraag die bij het topbalk-besluit hoort geldt er onverkort: is de knop
   rechtsonder de enige generieke ingang, dan concurreert dit nav-item ermee.
   Blijft hij, dan opent hij het paneel of de volledig-schermstand — beslis dat in
   P1b, niet impliciet.

2. **`?intent=` / `?herkomst=` is een levend codepad met een dode ingang.** Geen
   enkele knop in het portaal zet deze parameters; ze zijn alleen bereikbaar door
   de URL met de hand te typen. De code eromheen leeft wél: de herkomst-chip, de
   precedentie boven een verduidelijkingskeuze, en het auditveld
   `bron_intent_bron: "herkomst"`. Geregistreerd in
   `00 Overzicht en status/openstaande-punten-en-risicos.md`; beslissing in P1b —
   knop erbij of pad eruit.

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
- **De URL-afhandeling is client-side** en dus niet via HTTP te roken. Wijzig je
  een deeplink, breid dan `assistent-url-ingang.sanity.ts` uit — daar zit de enige
  dekking.
- **`contextChipLabel()` heeft nog geen consument.** De chip zelf wordt in P1b
  gebouwd; de functie legt vast hoe hij hoort te luiden en is op de letter getest.
