# 0090 — AI-contextbesef: persoonlijke intentie + portaalstand meesturen

- **Status:** Geaccepteerd
- **Datum:** 2026-07-29
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude Code (uitvoering)

## Context

Sinds het AI-startpunt (0085) toont het scherm wat er voor de bestuurder speelt:
de komende vergadering, de eerstvolgende processtap, agendapunten zonder eigen
inbreng. Het chatvenster wist daar niets van. Twee gaten:

1. **Persoonlijke vragen matchten geen enkel fondssignaal.** `FONDS_INTENT_PATRONEN`
   in `core/lib/vraagtype.ts` kende alleen collectieve ankers (ons/onze/wij/…).
   "Wat is mijn volgende actie om op te pakken?" viel daardoor terug op
   `{ intent: "fonds", vertrouwen: "onzeker" }` → de verduidelijkingstak vuurde een
   terugvraag ("Voor uw fonds of algemeen?") terwijl het antwoord letterlijk boven
   het chatvenster stond.
2. **De portaalstand ging alleen mee in agendapunt-modus** (`modulesBlok`), en zelfs
   dáár fondsbreed — niet de persoonlijke stand die het startpunt berekent.

Randvoorwaarden: RLS/tenant-isolatie (de persoonlijke stand mag nooit via een
fondsbrede query), append-only audit, human-in-the-loop (signaleren, niet
adviseren — het zwaarste punt hier), geen schijnzekerheid, en de kostbare
toon-systeemprompt niet herschrijven.

## Besluit

**Persoonlijke intentie.** Een aparte `PERSOONLIJK_INTENT_PATRONEN`-lijst
(`mijn`, `voor mij`, `van mij`, `moet ik`, `ik moet`) telt in `bepaalBronIntent`
als **fonds-anker, vertrouwen "zeker"**: persoonlijke staat bestaat alleen binnen
dit fonds. Combinatie met een generiek signaal blijft "gecombineerd". Bewust een
**aparte lijst** (niet de fondslijst opgerekt), zodat in de code afleesbaar blijft
dat dit een ander soort signaal is. De verduidelijkingstak zelf blijft ongewijzigd
en vuurt nog steeds bij een echt ambigue vraag.

**Portaalstand meesturen, conditioneel.** Een nieuwe pure conditie
`heeftPortaalstandNodig(vraag)` (= persoonlijk óf statusgericht) bepaalt of de
route de portaalstand meestuurt. Bij een zuiver algemene vraag gaat er niets
extra's mee (kosten/ruis-afweging intact). De **persoonlijke** stand komt uit de
bestaande `getPortaalContext` (`core/lib/portaalcontext.ts`) — dezelfde bron als
het startpunt, uitsluitend query's onder RLS op de sessie — en wordt via
`bouwPortaalstandBlok` (`core/lib/portaalstand-blok.ts`) compact als **benoemde
tekst** (geen genummerde bron) meegestuurd, samen met de fondsbrede
risico's/procedures (`modulesBlok`, nu ook buiten agendapunt-modus).

### Besluitpunt 1 — grens van "persoonlijk" en "statusgericht"

- **`moet ik` mét negatieve lookahead `(?!\s+weten\b)`** — bewuste afwijking van de
  letterlijke werkopdracht-regex. "Wat moet ik **weten** over tegenstrijdig belang?"
  (meetset-item 39) is een KENNISvraag, geen taakvraag, en moet in de twijfelbak
  (`mag-terugvragen`) blijven. Kaal `\bik\b` is bewust niet opgenomen (te ruim).
- **Statusgerichte patronen** (`STATUS_INTENT_PATRONEN`) zijn verankerd op proces-/
  voortgangsformuleringen ("wat staat er open", "hoe ver zijn we", "wat is de
  status"), niet op kale onderwerpwoorden — "hoe ver mag de dekkingsgraad dalen"
  is géén status-treffer. Deze lijst stuurt **alleen** het meesturen van de
  portaalstand, **niet** de intent-classificatie (en dus niet de
  verduidelijkingsbeslissing). Een statusvraag die tóch ankerloos is, blijft
  onzeker → verduidelijking (ongewijzigd).

De grens is programmatisch vastgelegd in de meetset (54 vragen, contrastief) en in
`vraagtype.sanity.ts`.

### Besluitpunt 2 — portaalstand vs. document dat elkaar tegenspreekt

Leidraad, verankerd in de instructie bij het standblok:

- De **portaalstand** is leidend voor de **actuele proces-/taakstand** (staat deze
  stap nog open voor mij, welke agendapunten hebben nog geen inbreng).
- Een **document / genotuleerd besluit** is leidend voor **wat is vastgelegd/besloten**
  (de auditbare inhoud; append-only audit is de bron van waarheid voor besluitinhoud).
- Ze beschrijven doorgaans verschillende dingen. Bij een **echte** tegenspraak op
  hetzelfde punt lost de assistent niets stilzwijgend op: hij **benoemt beide
  expliciet** en markeert de discrepantie als iets om te verifiëren (geen
  schijnzekerheid, human-in-the-loop).

## Overwogen alternatieven

- **De bestaande fondslijst oprekken met persoonlijke woorden** — verworpen: dan is
  in de code niet meer afleesbaar dat persoonlijk een ander soort signaal is, en de
  contrastieve meetset-borging verwatert.
- **De verduidelijkingstak versoepelen** (onzeker → stil fonds beantwoorden) —
  verworpen: dat is precies de schijnzekerheid-guardrail; alleen de signaallijst
  wordt breder, de tak blijft.
- **Een LLM voor de intentieclassificatie** — verworpen: de heuristiek blijft puur
  en reproduceerbaar, wat de verduidelijkingsbeslissing auditeerbaar houdt.
- **Portaalstand altijd meesturen** — verworpen: kosten/ruis bij zuiver algemene
  vragen; daarom conditioneel op persoonlijk/status.
- **Instructie in de toon-systeemprompt (TOON_BLOK)** — verworpen: die is byte-gepind
  (`generatie-kern.sanity.ts`) en kostbaar. De instructie reist mee **ín het
  standblok** in de gebruikersprompt (gelijk aan `modulesBlok`), zodat de toon-prompt
  byte-identiek blijft.

## Gevolgen

- **Pure lagen:** `core/lib/vraagtype.ts` (persoonlijke/status-patronen,
  `isPersoonlijkeVraag`/`isStatusgerichteVraag`/`heeftPortaalstandNodig`,
  persoonlijk anker in `bepaalBronIntent`), nieuw `core/lib/portaalstand-blok.ts`
  (+ `.sanity.ts`). Meetset uitgebreid naar 54 vragen; alle geaccordeerde drempels
  gehaald (0 fondsvraag→stil-algemeen, 16,7% terugvraag, 100% niet-stil-verkeerd).
- **Route:** `app/api/chat/route.ts` — `modulesBlok` als herbruikbare inner helper,
  portaalstand-opbouw ná de verduidelijkingstak (onzekere statusvraag verspilt geen
  query's), context-prefix in de algemeen/combineren/documenten-takken,
  `portaalstand_gebruikt` in `retrieval_meta` (UI-meta + auditspoor).
- **UI:** `OnderbouwingPaneel.tsx` toont "Portaalstand — meegewogen als uw eigen
  proces-/taakstand", onderscheiden van Documentbronnen (transparantielijn 0071).
  `AssistentClient.tsx` mapt het meta-veld door.
- **RLS/tenant:** de persoonlijke stand komt uitsluitend van `getPortaalContext`
  (anon-key-RLS, eigen inbreng/eigen procedure-eigenaarschap); **geen fondsbrede
  query voor iets persoonlijks**. De fondsbrede `modulesBlok` blijft fonds-gescoped
  op de server-side `fondsId`.
- **Audit:** `governance_log.retrieval_meta.portaalstand_gebruikt` legt herleidbaar
  vast of de stand meeging. Append-only ongemoeid; geen nieuw event-type.
- **Human-in-the-loop:** de instructie bij het standblok stuurt op signaleren ("hier
  staat nog open…"), nooit op een besluit/opdracht.
- **Geen migratie, geen nieuwe tabel/kolom.** `retrieval_meta` is vrije jsonb.
- **Bewust geaccepteerde schuld:** `core/lib/generatie-kern.sanity.ts` was al rood
  vóór dit ticket (byte-snapshot + modelconstanten niet ge-herpind na de Opus
  4.8-overstap, besluit 0067); staat los van deze wijziging en is als apart punt
  belegd. De TOON_BLOK-hash zelf blijft groen (toon-prompt ongewijzigd).

## Referenties

- Code: `core/lib/vraagtype.ts`, `core/lib/portaalstand-blok.ts`,
  `core/lib/bronkeuze-meetset.ts`, `app/api/chat/route.ts`, `core/lib/rag.ts`
  (RetrievalMeta), `app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx`,
  `app/(dashboard)/ai/_components/AssistentClient.tsx`.
- Hergebruik: `core/lib/portaalcontext.ts` / `portaalcontext-afleiding.ts` (0085).
- Besluiten: [`0085`](./0085-ai-startpunt-p1-ingang-ipv-leeg-invoerveld.md),
  [`0014`](./0014-increment-i2-automatische-bronkeuze.md) (bronkeuze),
  [`0070`](./0070-bronkeuze-plicht-patronen-en-meetset-uitbreiding.md) (meetset),
  [`0071`](./0071-agendavoorbereiding-streaming-en-bronmelding.md) (transparantielijn).
- Ontwerp: `03 Functioneel ontwerp/Bestuurdersportaal - Doorontwikkeling v2 functioneel ontwerp v1.3.md` (§11a).
