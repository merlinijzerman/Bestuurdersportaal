# 0151 — AI-modulecontext: `module_scope` als expliciete, RLS-geresolveerde scope-soort

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman, Claude Code

## Context

De AI-assistent kent fondsbrede, documentgerichte en persoonlijke context, maar geen
*objectcontext*: een vraag over het object waar de bestuurder op dat moment naar kijkt (een
risicothema/-risico of een procesdossier) valt terug op de te grove fondsbrede context of op een
verduidelijkingsvraag. De data staat wél in het portaal (`risicos`, `risico_log`,
`decision_objects`, `procedure_stappen/requirements/bewijs`), maar het chatvenster weet niet naar
welk object gekeken wordt. Randvoorwaarden: tenant-isolatie via RLS per `fonds_id`, append-only
audit/reproduceerbaarheid, human-in-the-loop (AI signaleert, besluit nooit), en de op sha256
gepinde toon-systeemprompt mag niet wijzigen.

## Besluit

Er komt een expliciet client→server-contract **`module_scope`** met drie soorten —
`{ soort: "proces", procedure_id }`, `{ soort: "risicomatrix" }` en `{ soort: "risico", risico_id }` —
dat de server **onder RLS resolveert** en dat, net als een actieve `document_scope`, de
heuristische intent-classificatie **uitzet**. Er wordt géén nieuw retrievalmechanisme gebouwd:
de scope specialiseert de twee bestaande bouwstenen (het benoemde contextblok en de
`document_scope`). Geen migratie, geen nieuwe tabel of kolom.

## Overwogen alternatieven

- **De heuristiek (`vraagtype.ts`) vervangen door een LLM-classificatie van "welke module".**
  Verworpen: de scope is expliciet (de bestuurder klikt de knop), dus raden is onnodig en zou de
  auditeerbare verduidelijkingsbeslissing troebel maken.
- **Risico-ingang per categorie of per individueel risico.** Verworpen als ingang: de bestuurder
  wil de volledige risicoscope kunnen bevragen. De enige ingang is de risicomatrix (matrixbreed);
  inzoomen op één risico is een **in-chat verfijning** (`{ soort: "risico" }`), geen tweede
  instappunt.
- **Inline chat in de module i.p.v. uitrouteren naar `/ai`.** Verworpen: zou een tweede
  chat-implementatie vergen; uitrouteren geeft de volle ervaring incl. onderbouwingspaneel en is
  consistent met `?doc=`/`?agendapunt=`.
- **Een nieuwe scope-tabel/kolom.** Niet nodig: de data bestaat al; een migratie zou een teken
  zijn dat de scope verkeerd begrepen is (dan stoppen en voorleggen).

## Gevolgen

- **RLS/tenant-isolatie:** de client stuurt alleen de sleutel (`procedure_id`/`risico_id`), nooit
  inhoud. Resolutie draait onder RLS op de sessie-`fonds_id`; een vreemd-fonds-id valt weg en
  wordt **geweigerd (400), nooit stille terugval**. De `risicomatrix`-soort is altijd geldig; een
  leeg fonds levert een expliciet "geen geregistreerde risico's"-blok (legitiem leeg ≠ weigering).
- **Audit/reproduceerbaarheid:** elke modulescope-beurt logt in `governance_log.retrieval_meta`
  een `module_scope`-subobject (soort, id, validatiestatus, gebruikte bron-ids, blokgrootte) plus
  een TTFT-timestamp. `audit-meta.ts` classificeert id's/bron-ids als `bron` (identiteit) en
  titels als `inhoud`, spiegel van de bestaande `scope`-classificatie. `risico_log` en het
  procedure-log worden alleen gelézen.
- **Human-in-the-loop:** de gedragsinstructie reist mee ín het contextblok (niet in de
  systeemprompt → sha256-pin ongewijzigd). Bij "hoe weeg je zelf dit risico?" spiegelt het model
  de geregistreerde weging + motiveringen en benoemt open punten — het draagt nooit een eigen
  weging als besluit op. Bij tegenspraak worden modulestand én document/besluit expliciet
  benoemd, niets stilzwijgend gekozen.
- **Datamodel/migraties:** geen. Bron: `risicos` (+ `status='gesloten'`, `sluit_motivering`),
  `risico_log` (event_types `risico_gewijzigd`/`risico_gesloten`/legacy `niveau_gewijzigd`),
  `decision_objects`, `procedure_stappen`, `procedure_requirements`, `procedure_bewijs`. Er is
  géén `archief`-DB-view — gesloten = `status='gesloten'`.
- **Bewust geaccepteerde schuld / restrisico:** het matrixbrede blok + het verdiepingsblok kunnen
  fors worden; N=15 (recentste weegregels) is de begrenzing en de tokenmeting (criterium 11) is de
  knop. Stapniveau-scope voor processen en een eventuele inline-variant zijn bewust uitgesteld.

## Review (09-08-2026)

`supabase-rls-reviewer`: **groen**, geen blocking issues — tenant-veilig, defense-in-depth
(RLS → RPC-fondsfilter → app-guard `handhaafFondsdiscipline`), geen migratie. `ai-governance-reviewer`:
**toestaan achter de module-gate voor demo/MVP**, met twee MIDDEN-punten die zijn weggewerkt:

- **Meta↔realiteit.** Een module-gesprek stuurt `module_scope` óók mee bij een transformatie-/
  reflectiebeurt, die een andere prompt-tak wint en het contextblok niet injecteert. Opgelost met
  één "in effect"-vlag (`moduleScopeInPrompt`): het blok wordt alleen geïnjecteerd, de retrieval
  alleen tot de bewijsstukken beperkt, én de beurt alleen als modulecontext gelogd wanneer hij
  daadwerkelijk in de prompt landt.
- **Weiger-tak.** Een geweigerde cross-fonds `procedure_id`/`risico_id` logt nu een `console.warn`-
  manipulatiesignaal (vgl. de `body.fonds_id`-lijn). Een volledig `governance_log`-signaal op de 400
  blijft een B10-verfijning (OP-MC).
- **Instructie-pin.** De human-in-the-loop-kernzinnen in `RISICO_INSTRUCTIE`/`PROCES_INSTRUCTIE`
  zijn inhoud-gepind in `module-scope.sanity.ts`, zodat ze niet stil kunnen verzwakken (ze reizen in
  de user-prompt, niet in de sha256-gepinde systeemprompt).

## Referenties

- Ontwerp: [`AI-MODULECONTEXT-ONTWERP.md`](../AI-MODULECONTEXT-ONTWERP.md), werkopdracht
  `WERKOPDRACHT-AI-MODULECONTEXT.md`.
- Code: `core/lib/module-scope.ts` (nieuw), `app/api/chat/route.ts`, `core/lib/document-scope.ts`,
  `core/lib/portaalstand-blok.ts`, `core/lib/audit-meta.ts`, `core/lib/risico-config.ts`,
  `core/lib/decision.ts`, `app/(dashboard)/ai/_components/AssistentClient.tsx`.
- Migraties (bron, ongewijzigd): `2026_04_29_risicomatrix.sql`, `2026_05_07_decision_object.sql`,
  `2026_04_29_procedures.sql`, `2026_05_08_phase_1b_template_requirements.sql`.
- Eerdere besluiten: [[0028-agendapunt-toelichting-seed-context]] (aparte scope-tak, server-fetch
  onder RLS), 0071 (bronherkenbaarheid), [[0145-vergaderingarchief-en-risico-bewerken]]
  (risico-logboek), 0090 (contextbesef/portaalstand).
