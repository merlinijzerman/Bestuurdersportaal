# 0187 — De readiness-ladder vervalt; vervuldheid per vereiste blijft

- **Status:** Geaccepteerd (richting; uitfasering in drie stappen)
- **Datum:** 2026-08-21
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitwerking)

## Context

De readiness-ladder kent zes niveaus (`onderbouwing_compleet` → `reviewrijp` → `bespreekrijp` → `besluitrijp` → `verantwoordingsrijp` → `evaluatierijp`). Elk niveau is gedefinieerd als een verzameling `requirement_type`-waarden die vervuld moeten zijn; die mapping staat als één `case`-blok in `fn_decision_readiness_check`. Vijf overgangen op het Decision Object zijn erop gegated (`in_review`, `geagendeerd`, `besloten`, `voorwaardelijk_besloten`, `afgesloten`), met een `override_reden` als ontsnapping.

Vier observaties, in oplopende zwaarte, brachten het model aan het wankelen.

**1. Schaalmismatch: readiness meet procesbreed, besluitvorming gebeurt stapsgewijs.** De check loopt over *alle* verplichte vereisten van het hele proces; `stap_volgorde` dient alleen als adres om vervulling te bepalen, niet als begrenzing. Bij `pf_wtp_invaarbesluit@2.0.0` tellen daardoor **50 van de 63** vereisten mee voor `besluitrijp`, waaronder zes uit stap 12 (Nazorg & verantwoording) en vier uit stap 11 (go/no-go). Het voorgenomen invaarbesluit valt in **stap 7**. `Besluitrijp` is bij dit proces dus onbereikbaar op het moment dat het besluit genomen wordt — de gate kan alleen met een override worden gepasseerd en is daarmee geen gate meer.

**2. Botsing met "definitie als data" ([[0002]]).** De ladder is dubbel gesloten: zes vaste niveaus én een gesloten lijst van twaalf requirement-typen. Zodra fondsen zelf processen modelleren, past dat niet:

- De volgorde is procesafhankelijk. `external_submission` staat in de ladder op niveau 5 (verantwoordingsrijp), terwijl de melding bij de incident-meldplicht DNB stap 3 van 6 is en binnen 72 uur moet. De ladder zou zeggen dat zo'n proces aan het begin al verantwoordingsrijp moet zijn. Hetzelfde geldt voor de geschiktheidstoetsing, waar de DNB-indiening vooraan zit.
- Een nieuw type bewijs vraagt een tak in `fn_decision_readiness_check` én in `buildEvidenceLijst`: een code-release plus migratie. Dat is precies de bottleneck die definitie-als-data moest wegnemen.

**3. Inconsistent met D8 ([[0174]]).** Daar is expliciet vastgesteld dat fasen **niet** universeel I–VI zijn maar bij de definitie horen, juist omdat een incidentprocedure andere fasen kent. Readiness hield vervolgens wél een universele, zesdelige ladder aan. Die twee besluiten spreken elkaar tegen; readiness is het overblijfsel van vóór dat inzicht.

**4. De gates waren toch al zacht, en worden dat nu formeel.** Met het besluit over validatie en afwijking (D9: een stap kan altijd worden afgerond, mits gemotiveerd; de beoordeling ligt bij de gebruiker) is een blokkerende poort principieel geen poort meer. Een gate die altijd te passeren is, kost onderhoud en levert geen zekerheid.

Randvoorwaarden die meewogen: snapshot-integriteit, append-only audit, de eis dat het model uitlegbaar blijft aan een bestuurder en aan een fondsbeheerder die zelf een proces modelleert, en de wens om het model niet complexer te maken dan nodig.

## Besluit

**De readiness-ladder vervalt.** Dat betreft de zes niveaus, de mapping van requirement-type naar niveau, en de vijf gates op de statusovergangen van het Decision Object.

**De vervuldheidstoets per vereiste blijft.** Dat is een andere laag: de evidence-unie (template-vereisten met classificatie-conditionals ∪ actieve instantie-vereisten − uitsluitingen) met vervulling via `procedure_bewijs.requirement_sleutel` ([[0183]]). Die laag is al onafhankelijk geïmplementeerd in `buildEvidenceLijst()` en voedt nu al de bewijslast-dekking, de aandachtsvlaggen per fase en het afschrift.

Wat de ladder aggregeerde, wordt vervangen door één telling op vier schalen — zonder configuratie, zonder mapping, zonder eigen woordenlijst:

| Schaal | Wat je toont |
|---|---|
| Stap | openstaande vereisten, waarvan blokkerend |
| Fase | afgeleid uit de stappen van die fase (bestaat al) |
| Proces | totaal openstaand, waarvan blokkerend |
| Besluitmoment | openstaand tot en met deze stap |

**Uitfasering in drie stappen**, zodat er geen big bang nodig is:

1. **Readiness stopt met beslissen** — de vijf gates op de statusovergangen vervallen en worden vervangen door een waarschuwing bij openstaande vereisten. De overgangen blijven begrensd door de toegestane-overgangenmatrix.
2. **Readiness verdwijnt uit beeld** — `ReadinessLadder.tsx`, de horde-teksten en de resterende niveau-labels; overal komt "n openstaande vereisten" voor in de plaats.
3. **Opruimen** — pas als niets het meer leest: `fn_decision_readiness_check`, `fn_decision_readiness_overview`, `READINESS_LABEL`/`READINESS_VOLGORDE` en de readiness-tak in `buildDecisionDossierView`.

## Overwogen alternatieven

- **A — Readiness begrenzen tot en met de betrokken stap** (`stap_volgorde <= N` als derde parameter). Lost de schaalmismatch (1) netjes en goedkoop op, maar niets van (2) en (3): de ladder blijft een gesloten model naast de stappen en blijft botsen zodra fondsen zelf modelleren. Verworpen als symptoombestrijding, hoewel het als tussenstap technisch prima zou werken.
- **B — Eén Decision Object per besluitmoment.** Modelmatig het zuiverst; het schema bereidt het al voor (`is_primary_decision`, "bereidt 1:n voor"). Verworpen voor nu: het raakt het dossier, de afschriften, de statusmachine en de volledige UI, en het lost (2) evenmin op. Blijft beschikbaar als later blijkt dat bestuurders per besluitmoment een eigen dossier met eigen dissent, aannames en afschrift willen; dit besluit staat dat niet in de weg.
- **C — De ladder per definitie configureerbaar maken.** Verworpen. Dan bouwen we een tweede configuratiemodel bovenop het eerste — dezelfde redenering waarmee [[0002]] §11 de bouwblokkenlaag uitstelde. Bovendien zou een fondsbeheerder moeten begrijpen wat "bespreekrijp" betekent, en zouden de gates per fonds verschillen, wat dossiers juist minder vergelijkbaar maakt.
- **D — Alles laten staan en in de praktijk altijd overrulen.** Verworpen: dat holt de gate uit tot formaliteit en vult het auditspoor met overrides die niets onderscheiden.

## Gevolgen

**Datamodel/migraties.** Geen tabelwijziging, in geen van de drie stappen. Pas in stap 3 vervallen de twee SQL-functies; tot dat moment blijven ze bestaan en worden ze alleen niet meer gelezen. Terugdraaien is daardoor triviaal zolang stap 3 niet is uitgevoerd.

**Code.** Eenendertig bestanden raken readiness. De kern zit in `core/lib/decision.ts`, `core/lib/decision-view.ts`, `app/api/decisions/[id]/status/route.ts`, `app/(dashboard)/procedures/_components/ReadinessLadder.tsx`, `StatusOvergangPaneel.tsx` en `app/(dashboard)/procedures/page.tsx`. Twee consumenten liggen buiten de proceduremodule en zijn makkelijk te missen: **`app/api/chat/route.ts`** (de AI-assistent leest readiness om over de stand van een dossier te kunnen antwoorden) en **`app/api/stemmingen/[id]/sluiten/route.ts`**. Beide moeten mee in stap 2, anders verwijzen ze naar een begrip dat de gebruiker nergens meer ziet.

**Audit en verantwoording.** Het afschrift verliest het label "verantwoordingsrijp" en toont in plaats daarvan expliciet de vervulde én openstaande vereisten. Dat is bewust: voor een accountant of toezichthouder zijn de feiten sterker bewijs dan ons oordeel erover. Reeds gegenereerde afschriften blijven ongewijzigd en dragen het oude label — append-only, en historisch correct.

**Statusovergangen.** `override_reden` op de statusroute verliest zijn readiness-betekenis. De overgangen blijven begrensd door de toegestane-overgangenmatrix; bij openstaande vereisten volgt een waarschuwing, geen blokkade. Dat sluit aan op D9: het oordeel ligt bij het bestuur, het systeem registreert.

**Modelleren en beheer.** Wie een procesdefinitie schrijft hoeft niets meer te weten van readiness-niveaus. Er resteren twee vragen per vereiste: *op welke stap hoort dit* en *is het verplicht en/of blokkerend*. De ordening die de ladder uitdrukte — aannames hoeven niet compleet voor onderbouwing maar wel voor bespreking — verhuist naar de stap waaraan de vereiste hangt, en is daar zichtbaar in bestuurstaal in plaats van in een niveau-label.

**Bewust geaccepteerd.** Je verliest één woord waarmee dossiers over processen heen vergelijkbaar waren ("dit dossier is besluitrijp"). Daarvoor komt "n openstaande vereisten, waarvan m blokkerend" terug — vergelijkbaar, maar niet meer in één etiket te vangen. `evaluatierijp` verdwijnt eveneens; nazorg is bij het invaarproces gewoon stap 12 en hoort daar thuis.

## Referenties

- `supabase/migrations/2026_08_14_readiness_blokkerend_ambiguiteit_fix.sql` — de type→niveau-mapping (`case p_target`) en de evidence-unie
- `core/lib/decision.ts::buildEvidenceLijst` — de vervuldheidstoets die blijft
- `core/lib/decision-view.ts` — `READINESS_LABEL`, `READINESS_VOLGORDE`, `eersteOntbrekendeReadiness`
- `core/lib/procedure-fase-status.ts` — `bewijslastDekking`, de afgeleide fase-status en aandachtsvlaggen die de vervanging voeden
- `definities/pensioenfondsen/pf_wtp_invaarbesluit@2.0.0.json` — bron van de telling 50/63
- Besluiten: [[0002]] (definitie als data), [[0174]] (D6/D7/D8, fasen niet universeel), [[0183]] (bewijsbinding)
- `PROCEDURE-GENERIEK-ONTWERP.md` v0.4 §2, §5, §9, §10 · `PROCEDURE-ENGINE-V2-ONTWERP.md` §5.3
- `VISUAL-statusmodel-processen-v0.2.html` — de one-pager waarin dit besluit is verwerkt
