# Werkopdracht: bronkeuze antwoord-eerst — de verduidelijkingsvraag niet-blokkerend maken

> Overdracht van plansessie (Cowork, 06-08-2026) naar Claude Code. Plak dit als eerste bericht in een Claude Code-sessie in de repo-root. Zie `decisions/0004` en `WERKOPDRACHT-TEMPLATE.md`.
>
> **Deze opdracht herziet een compliance-sign-off (`decisions/0014`, 22-06-2026). Voorfase M0 is niet optioneel: zonder die twee metingen mag de bouw niet starten.** Zie ook §Compliance-gesprek achteraan.

---

## Doel & context

De assistent stelt bij twijfel over de bronsoort eerst een blokkerende wedervraag: *"Wilt u dit weten voor uw fonds specifiek, of in algemene zin?"* Bedoeld als waarborg tegen schijnzekerheid (`decisions/0014`, FO §11a). In de praktijk vuurt hij bij vrijwel elke vraag.

`decisions/0091` bevat de meting: **17 van de 18 realistische portaalvragen** (besluiten, agendapunten, notulen, stukken, risico's, openstaande acties) vielen in de twijfelbak. De geaccordeerde meetset van 54 vragen bevat **nul** portaalobject-vragen, waardoor de drempel `maxTerugvraagFractie: 0.2` groen meet (19,6%) op een populatie die het echte gebruik niet representeert. `decisions/0092` stelde vast dat zelfs twee van de vier eigen `GENERIEKE_STARTVRAGEN` de wedervraag uitlokten.

**Het inhoudelijke argument voor deze wijziging.** Een waarborg die bij circa 94% van de vragen vuurt, is geen waarborg meer — hij traint de bestuurder om hem weg te klikken. Op het moment dat de keuze fonds-versus-algemeen materieel verschil maakt, is de reflex al ingesleten. `0014` wilde schijnzekerheid voorkomen; in de huidige vorm produceert de maatregel die een laag dieper.

Deze opdracht verplaatst de keuze van **vóór** naar **ná** het antwoord: de assistent antwoordt fondsgericht en toont de twee keuzes als chips onder het antwoord. Het principe uit `0014` blijft overeind — de bestuurder ziet dat er een keuze is gemaakt en kan hem corrigeren — maar de frictie verdwijnt.

Dit is bewust **niet** de goedkopere variant "wedervraag uitzetten". Die haalt de correctiemogelijkheid volledig weg en laat de assistent stilzwijgend fondsgericht antwoorden; vanuit `0014` geredeneerd is dat slechter, niet veiliger.

`decisions/0070` noemt deze oplossing al onder *"Overwogen alternatieven"*: **"Terugvraag niet-blokkerend maken (antwoord-eerst) — een beleidskeuze die FO §11a raakt; bewust uitgesteld."** Deze opdracht haalt dat uitstel in.

## Waarom het risico kleiner is dan het lijkt (feit, te herverifiëren)

Drie eigenschappen van de huidige code dempen het risico van antwoord-eerst. Verifieer ze aan het begin van de bouw; als één niet meer klopt, verandert de risicoweging en moet dat terug naar de plansessie.

1. **De onzekere fallback is al fondsgericht.** `core/lib/vraagtype.ts:911` — `return { intent: "fonds", vertrouwen: "onzeker" };`. Antwoord-eerst beweegt dus wég van de gevaarlijke fout uit `0014` (een fondsvraag stil als algemeen beantwoorden, nul-tolerantie), niet ernaartoe.

2. **De intentie stuurt de retrieval niet.** `core/lib/vraagtype.ts:995-997`, `bepaalAutoBronModus`, met het letterlijke commentaar: *"De INTENT verandert deze modus niet (gedragsneutraal t.o.v. Increment G); intent stuurt promptframing en meldingen, niet de retrieval-modus."* Zonder expliciete fondsrestrictie geldt altijd de combineren-vloer. Een antwoord vóór de chipkeuze doorzoekt dus exact dezelfde bronnen als een antwoord erna.
   **Te verifiëren bij de bouw:** dat er nergens anders alsnog een intent-afhankelijk retrievalfilter zit (controleer `weeg-bronsoort.ts`, de web-gate op `route.ts:1587-1596` en `promptModus` op `route.ts:1253`). De weging en de promptframing mógen intent-afhankelijk zijn; de bronselectie niet.

3. **De terugvraag wordt al gelogd.** `decisions/0092`; `route.ts:846-880` schrijft een `governance_log`-regel met `retrieval_meta.verduidelijking = true`. De nulmeting is dus beschikbaar zonder nieuwe instrumentatie.

## M0 — Verplichte voorfase: twee metingen

Rapporteer beide uitkomsten vóór het implementatieplan. Ze bepalen of en hoe M-B1 gebouwd wordt.

**M0.1 — Werkelijke terugvraagfrequentie voor dit fonds.**

```sql
select count(*) filter (where retrieval_meta->>'verduidelijking' = 'true') as terugvragen,
       count(*)                                                            as beurten,
       round(100.0 * count(*) filter (where retrieval_meta->>'verduidelijking' = 'true')
             / nullif(count(*),0), 1)                                      as pct
from governance_log
where retrieval_meta is not null
  and aangemaakt > now() - interval '30 days';
```

Dit is het bewijsstuk voor het compliance-gesprek. Neem het cijfer op in het decision-record.

**M0.2 — Wat de júíste intentie was geweest.** Van de 18 portaalvragen uit `0091` is bekend dát ze in de twijfelbak vielen, niet wat het correcte antwoord was. Label ze alsnog (`fonds` / `algemeen` / `gecombineerd`) en bereken het aandeel dat **niet** `fonds` is.

Dit is de beslissende meting: bij antwoord-eerst met fondsdefault krijgt precies dat aandeel een verkeerd gekaderd antwoord vóór de chipklik.

- **≤ 10% niet-fonds** → bouw M-B1 zoals hieronder beschreven.
- **10–25%** → bouw M-B1, maar met een prominentere bronbasis-melding en de chips boven de vouw; leg de keuze vast in het besluit.
- **> 25%** → **stop en terug naar de plansessie.** Antwoord-eerst met fondsdefault is dan niet verdedigbaar; er is eerst betere intentiedetectie nodig (M-B4 zwaarder, of een ander default-mechanisme).

## Ontwerp

### M-B1 — Drieweg-configuratie in plaats van aan/uit

Nieuwe sleutel in `fonds_feature_flags`: **`bronkeuze_modus`**, met drie waarden:

| Waarde | Gedrag |
|---|---|
| `blokkerend` | **Default.** Huidig gedrag, ongewijzigd — de tak retourneert vroeg met het `verduidelijking`-event |
| `antwoord_eerst` | De beurt loopt door met `{ intent: "fonds", vertrouwen: "onzeker" }`; de twee keuzes reizen mee als chips in het `meta`-event en worden ónder het antwoord getoond |
| `uit` | Geen wedervraag, geen chips — puur fondsgericht doorlopen |

Waarom drieweg en niet een boolean: `uit` is de vangnetstand als `antwoord_eerst` in productie tegenvalt, en `blokkerend` als default betekent dat er niets verandert zolang de vlag niet expliciet is gezet. Eén sleutel, per fonds omkeerbaar, en het landt in het bestaande config-auditspoor (`fn_fonds_config_capture`, migratie `2026_07_09_t8b_...`).

**Geen migratie nodig** — `fonds_feature_flags` is generiek (`flag_key text`, `waarde jsonb`). Volg het patroon van `hybrideZoekenAan` (`core/lib/fonds-config.ts:158-162`): flag lezen, anders env-default, anders `blokkerend`.

Onbekende of ongeldige waarde ⇒ **`blokkerend`** (fail-safe naar het geaccordeerde gedrag, nooit naar het nieuwe).

### M-B2 — Route: de vroege return wordt conditioneel

Raakpunt: `app/api/chat/route.ts:835-905`. De conditie wordt uitgebreid met de modus; alleen bij `blokkerend` blijft de vroege `return` bestaan.

Bij `antwoord_eerst`:
- de beurt loopt normaal door met `bronIntentResultaat = { intent: "fonds", vertrouwen: "onzeker" }`;
- de `VERDUIDELIJKING_OPTIES` reizen mee in het `meta`-event dat de client al ontvangt, samen met een markering dat het een *aanbod* is en geen gestelde vraag;
- er komt **geen** aparte `schrijf_ai_interactie`-regel meer voor de terugvraag (die tak draait niet); in plaats daarvan krijgt de antwoordregel `retrieval_meta.bronkeuze_aanbod = true` naast de bestaande `bron_intent` / `bron_vertrouwen`.

Alle bestaande vangrails blijven ongewijzigd gelden en mogen niet verslappen: `scopeActief || agendapuntModusActief || bronloosBureau` (`route.ts:694`), `intentOverride` (`:696`), `bevestigingNaAntwoord` (`:698-702`), `reflectieActief`, `transformatieActief` en `neemNietVastgesteldeMee` (`:835-841`). In die gevallen is er geen twijfel en dus ook geen chipaanbod.

### M-B3 — Client: chips onder het antwoord

Raakpunten: `AssistentClient.tsx` (het `verduidelijking`-event rond `:1290-1308`, `kiesVerduidelijking` rond `:1621`) en `AgendapuntChat.tsx`.

- De chips renderen ónder de antwoordbubbel, niet als eigen bubbel.
- Labeling verschuift van vraag naar aanbod: **"Dit antwoord gaat uit van uw fonds — liever in algemene zin?"** met de twee bestaande opties. De bestaande `kiesVerduidelijking` blijft het herstelpad; een klik hergenereert met `bron_intent_override` en `vertrouwen: "zeker"`, precies zoals nu.
- De bronbasis-melding die het antwoord al kadert, blijft staan en wordt **niet** vervangen door de chips. Bij uitkomst 10–25% uit M0.2: prominenter.

### M-B4 — Portaalobject-patronen (dit hoort erbij, niet erna)

Bij circa 94% twijfel staan de chips onder vrijwel elk antwoord — niet blokkerend, maar opnieuw betekenisloos. Verlaag daarom de twijfelbak door `FONDS_INTENT_PATRONEN` (`core/lib/vraagtype.ts:836-843`) uit te breiden met objecten die per definitie fondsspecifiek zijn: besluit, agendapunt, notulen, vergadering, actiepunt, bestuursvoorstel, risicomatrix, jaarplan.

`decisions/0091` stelt terecht dat scherpere patronen het probleem niet oplossen — dat is een argument tegen patronen *in plaats van* antwoord-eerst, niet tegen patronen *ernaast*.

Breid `core/lib/bronkeuze-meetset.ts` uit met de 18 gemeten portaalvragen inclusief hun M0.2-labels. **Dit vergt her-accordering door compliance** (`0070`, `0091`) — plan die in dezelfde ronde als het besluit uit §Compliance-gesprek, niet als losse tweede gang.

### M-B5 — Auditvraag vooraf beslissen, niet gaandeweg

Bij antwoord-eerst kan één vraag twee antwoorden opleveren: het fondsgerichte antwoord en, na een chipklik, het hergegenereerde antwoord. **Welke regel is hét antwoord in het governance-spoor?**

Dit moet vóór de bouw vastliggen, niet erna. Voorstel om te bevestigen of te verwerpen in Plan-modus: beide beurten blijven als volwaardige regels staan (het eerste antwoord *is* aan de bestuurder getoond en kan zijn overgenomen), en de tweede regel draagt een verwijzing naar de eerste plus `bronkeuze_herzien = true`. Zo is bij een beroep op "de assistent zei…" navolgbaar welke van de twee is bedoeld en in welke volgorde ze zijn getoond.

Verlies uit `0092` niet: de reden dat de terugvraag überhaupt gelogd wordt, is dat een interactie zonder antwoord anders nergens stond. Antwoord-eerst mag geen nieuwe variant van dat gat introduceren.

## Scope

**Wel**
- `core/lib/fonds-config.ts` — resolutie van `bronkeuze_modus`
- `app/api/chat/route.ts:835-905` — conditionele tak, chipaanbod in het `meta`-event, `retrieval_meta`-velden
- `AssistentClient.tsx`, `AgendapuntChat.tsx` — chips onder het antwoord, hergebruik van `kiesVerduidelijking`
- `core/lib/vraagtype.ts:836-843` — portaalobject-patronen (M-B4)
- `core/lib/bronkeuze-meetset.ts` — 18 portaalvragen met labels
- Governance-logica voor de twee-antwoordensituatie (M-B5)

**Niet**
- `bepaalBronIntent` zelf herschrijven — de functie blijft puur en meetbaar; de modus wordt in de route toegepast, niet in de classifier. Anders breekt de geaccordeerde meetset-runner en is her-accordering onvermijdelijk om de verkeerde reden
- De retrievalketen (dat is `WERKOPDRACHT-RETRIEVAL-RECALL.md`)
- De voortgangsteller "30 passages gevonden" — apart te beleggen
- `standaard_bron_intent` met waarde `"algemeen"` — dat zou de nul-tolerantie uit `0014` actief schenden en is bewust geen onderdeel van dit ontwerp

## Impactklasse

**Architectuur**, met een expliciete compliance-component.

- **Documentatiehaak: vuurt.** `00 Overzicht en status/release-template.md` (de `00–09`-markdown én de as-built Word-doc), daarna pas de marker in `doc-actualisatie-log.md`.
- **Structurele gates: niet vereist** — geen policy, geen grant, geen `SECURITY DEFINER`-functie, geen datamodelwijziging. `fonds_feature_flags` is generiek, dus geen migratie. Wordt de `schrijf_ai_interactie`-RPC alsnog aangepast voor M-B5, dan is een gate-run wél vereist (`supabase/checks/2026_07_31_r1_structurele_gates.sql`).
- **FO §11a wijzigt.** Dit is geen implementatiedetail maar een herziening van een geaccordeerd ontwerpbesluit. Zonder de compliance-stap uit §Compliance-gesprek is de opdracht niet af, ook al is de code groen.

## Guardrails

Naleving van `CLAUDE.md` §Niet-onderhandelbare guardrails bevestigen. Bijzondere aandacht:

1. **Geen schijnzekerheid.** Het antwoord moet zichtbaar zeggen waarop het steunt. De chips vervangen de bronbasis-melding niet, ze vullen hem aan.
2. **Nooit stil algemeen.** De fallback blijft `intent: "fonds"`. Er komt geen pad waarin een ankerloze vraag zonder zichtbare melding als algemene vraag wordt beantwoord.
3. **Geen stille gedragswijziging per tenant.** Default `blokkerend`; `antwoord_eerst` wordt bewust per fonds gezet en landt in het configauditspoor.
4. **Fail-safe richting het oude gedrag.** Onbekende vlagwaarde, leesfout of ontbrekende config ⇒ `blokkerend`.

## In te zetten subagents

Zie `SUBAGENTS-ONTWERP.md` §4. Minimaal `ai-governance-reviewer` (dit wijzigt wat de bestuurder als waarborg ziet), `audit-evidence-reviewer` (M-B5), `code-reviewer`, en `ontwerp-sync-reviewer` vóór merge.

## Werkmodus

Begin in **Plan-modus**.

1. Voer eerst M0.1 en M0.2 uit en rapporteer beide uitkomsten. Bij M0.2 > 25%: stop en leg terug.
2. Herverifieer de drie dempende eigenschappen uit §Waarom het risico kleiner is dan het lijkt.
3. Lever dan pas een implementatieplan: geraakte bestanden, het voorstel voor M-B5, de UI-plaatsing van de chips, de testaanpak en de risico's.

**Wijzig pas na expliciet akkoord.**

## Acceptatiecriteria

### A. Gedrag per modus

| # | Situatie | Verwachting |
|---|---|---|
| 1 | `bronkeuze_modus` niet gezet | Gedrag exact gelijk aan vandaag — blokkerende wedervraag, `governance_log`-regel met `verduidelijking = true` |
| 2 | `blokkerend` expliciet gezet | Idem 1 |
| 3 | `antwoord_eerst`, ankerloze vraag | Antwoord verschijnt fondsgericht; chips onder het antwoord; **geen** blokkerende bubbel |
| 4 | `antwoord_eerst`, klik op "In algemene zin" | Hergeneratie met `vertrouwen: "zeker"`; tweede `governance_log`-regel met verwijzing naar de eerste |
| 5 | `antwoord_eerst`, vraag mét fondsanker ("ons beleggingsbeleid") | Geen chips — de intentie is zeker |
| 6 | `antwoord_eerst` + "Alleen fondsdocumenten" aan | Geen chips (`moetVerduidelijken` is al `false`) |
| 7 | `antwoord_eerst` tijdens reflectie / transformatie / bureau-taak / actieve scope | Geen chips — alle bestaande vangrails blijven gelden |
| 8 | `antwoord_eerst`, korte bevestiging "ja graag" na een antwoord | Geen chips (T5 C3, `route.ts:698-702`) |
| 9 | `uit` | Geen wedervraag, geen chips, fondsgericht antwoord met ongewijzigde bronbasis-melding |
| 10 | Ongeldige vlagwaarde (`"waar"`, `null`, getal) | Fail-safe naar `blokkerend` |

### B. Meet- en regressiecriteria

- Terugvraagfractie op de uitgebreide meetset **na M-B4** aantoonbaar lager dan de huidige 19,6%; rapporteer het cijfer op de oude én de uitgebreide meetset apart, zodat vergelijking met `0070` mogelijk blijft.
- `maxFondsAlsAlgemeen: 0` blijft **hard** — nul tolerantie, ook na patroonuitbreiding.
- `bepaalBronIntent` is functioneel ongewijzigd op de bestaande 54 meetsetvragen, op de M-B4-patroonuitbreiding na. De sanity-runner moet dat aantonen, niet aannemen.
- Nieuwe sanitytest: `bronkeuze_modus`-resolutie, inclusief de fail-safe bij een ongeldige waarde.
- Nieuwe sanitytest die aantoont dat bij `antwoord_eerst` de retrieval-modus identiek is aan die bij `blokkerend` na een klik op "Voor mijn fonds" (bewijst dempende eigenschap 2 — dezelfde bronnen, alleen andere framing).
- `npm run sanity` volledig groen; het script moet alle suites doorlopen (les T-01, `BEVINDINGENLOG.md`).

### C. Bewijs bij oplevering

Twee schermopnamen — één beurt in `blokkerend` en dezelfde vraag in `antwoord_eerst` — plus de bijbehorende `governance_log`-regels, zodat zichtbaar is dat de navolgbaarheid in beide standen compleet is.

## Definition of Done

Volg `CLAUDE.md` §Definition of Done (gezaghebbend; niet hier kopiëren). Opdracht-specifiek:

- **Decision-record:** nieuw record (`decisions/` staat op `0136`) dat **`0014` herziet** en `0070`, `0090`, `0091`, `0092` als voorgeschiedenis noemt. Neem de M0.1- en M0.2-cijfers op als onderbouwing; een besluit zonder die getallen is een voorkeur, geen besluit.
- **FO §11a** bijwerken: de verduidelijking is niet langer per definitie blokkerend, maar configureerbaar per fonds met `blokkerend` als default.
- **Meetset her-accordering** door compliance vóór productie (`0070`, `0091`).
- **Documentatiehaak** vuurt (architectuur).
- **Tests:** tabellen A en B in de bestaande suite, niet alleen in deze werkopdracht.

## Openstaande punten

Op te nemen in `00 Overzicht en status/openstaande-punten-en-risicos.md`, **elk mét eigenaar**:

1. **De sanitydrempel `maxTerugvraagFractie: 0.2` meet een populatie die het echte gebruik niet representeert.** M-B4 repareert de meetset; blijf bewaken dat nieuwe vraagtypes erin landen. Dit is de systemische oorzaak, niet de terugvraag zelf.
2. **Restrisico antwoord-eerst:** de bestuurder klikt de chip niet en neemt het fondsgerichte antwoord voor waar aan, terwijl de vraag algemeen bedoeld was. Grootte = de uitkomst van M0.2. Mitigatie = bronbasis-melding; monitor de chipklikfractie na livegang.
3. **Chipklikfractie is zelf een signaal.** Wordt er vrijwel nooit geklikt, dan is dat óf bewijs dat de fondsdefault klopt, óf bewijs dat de chip niet gezien wordt. Die twee zijn niet uit elkaar te houden zonder aanvullende meting — beleg wie dat na drie maanden beoordeelt.
4. **`0092`-besluitpunt over dubbele beurten** krijgt met M-B5 een nieuwe variant; controleer dat de retentie- en exportlogica (`GOVERNANCE-LOG-RETENTIE-ONTWERP.md`) beide regels correct meeneemt.

## Terugkoppeling

Rapporteer in het antwoordformat uit `CLAUDE.md`: samenvatting, aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact, test/verificatie, openstaande risico's. Neem de M0-uitkomsten en de vóór/ná-terugvraagfractie expliciet op.

---

## Compliance-gesprek — hoe dit wordt voorgelegd

`0014` is een sign-off van iemand anders, van 22-06-2026. De volgorde bepaalt hier de uitkomst.

**Doe dit niet:** een afgerond voorstel voorleggen. Dat maakt er een verdedigingsgesprek over een eerder besluit van.

**Doe dit wel:** eerst de meting delen — de 17-van-18 uit `0091` plus het M0.1-cijfer uit productie — en de conclusie samen laten trekken. De framing is niet "bestuurders vinden het vervelend", maar:

> De maatregel vuurt bij circa 94% van het echte gebruik. Daarmee is hij gedegradeerd tot ruis en traint hij bestuurders om hem weg te klikken — precies op het moment dat hij ertoe doet, werkt hij niet meer. Dit ontwerp herstelt zijn functie: de bestuurder ziet nog steeds welke keuze is gemaakt en kan hem corrigeren, maar wordt niet meer bij elke vraag onderbroken.

Drie punten die het gesprek makkelijker maken, allemaal onderbouwd:

1. De fallback blijft fondsgericht — de nul-tolerantie uit `0014` (fondsvraag stil algemeen beantwoord) wordt niet geraakt.
2. De intentie stuurt de bronselectie niet, alleen de framing en de melding (`vraagtype.ts:995-997`). Er wordt dus niet in andere bronnen gezocht dan nu.
3. Default blijft `blokkerend`, per fonds omkeerbaar, met auditspoor. Valt het tegen, dan is terugdraaien één configuratieregel.

Wat compliance terecht terug kan vragen: het M0.2-cijfer. Zorg dat u dat hebt vóór het gesprek — het is de enige vraag waarop "dat weten we niet" het voorstel onderuithaalt.
