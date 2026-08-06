# 0128 — Vierde tenant-rol `bestuursbureau`: rechten, afscherming en twee correcties op het ontwerp

- **Status:** Geaccepteerd
- **Datum:** 2026-08-05
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)
- **Werkopdracht:** T1, plateau A — `04 Technische inrichting/Bestuurdersportaal - Werkopdracht T1 - Rol Bestuursbureau (rol, rechten en afscherming) v1.1.md`
- **Ontwerp:** `03 Functioneel ontwerp/Bestuurdersportaal - Rol Bestuursbureau ontwerp v0.3.md` (hernoemd van v0.1 bij T3)

## Context

Het portaal is ontworpen rond de bestuurder als lezer en beoordelaar. Het bestuursbureau — bij het
vragende fonds circa vijf personen — werkt aan de productiekant: het maakt de stukken die het bestuur
beoordeelt. Er was geen rol die daarbij past. Wie bureauwerk doet krijgt nu `beheerder`, en dus
catalogusbeheer, fondsconfiguratie en reviewbevoegdheden die governance-technisch bij het bestuur
horen — én stem-, inbreng- en dissentrecht, dat een ondersteunende functie juist niet hoort te hebben.

De harde randvoorwaarde bij dit increment is de **nulgrens (G23)**: het gedrag en de rechten van
`bestuurder`, `voorzitter` en `beheerder` wijzigen op geen enkel vlak.

Eén feit uit de as-built bepaalt de hele opzet: **RLS isoleert in dit schema op `fonds_id`, niet op
rol.** Een nieuwe rol ziet daardoor by default álles wat fondsbreed leesbaar is — inclusief
persoonlijke inbreng en individueel stemgedrag — en mag by default álles schrijven wat een fondslid
mag. De afscherming is dus geen vanzelfsprekendheid maar een actieve predicaat-uitbreiding.

## Besluit

1. **B-1 — de rol bestaat.** `profielen.rol` accepteert een vierde waarde `bestuursbureau`
   (migratie `2026_08_05_bestuursbureau_rol.sql`). De default blijft `bestuurder`; `maak_profiel()`
   zet de rol niet en wordt niet gewijzigd. De rol wordt via het bestaande service-role-pad in
   `/platform/gebruikers` gezet (P3-B) en blijft bevroren door `fn_profiel_bevries_kolommen()`.

2. **B-2 — het bureau mag documentmetadata, documentstatus en bronstatus wijzigen.** De rol draagt
   `documents.metadata.update`, `documents.status.change` en `documents.bronstatus.change`, analoog
   aan de I-2-lijn voor bestuurders. Dit is **RAG-beïnvloedend**: documentstatus bepaalt welke versie
   de assistent als actuele bron behandelt, dus bureauhandelen beïnvloedt wat de assistent van de
   *bestuurder* aanreikt. Dat mechanisme bestaat al tussen bestuurders onderling; wat verandert is de
   kring van mensen die eraan draait. Terugdraaien is drie regels in `ROL_CAPABILITIES`.
   **Openstaand (V3 uit het ontwerp):** de bevestiging door fonds én compliance is niet in deze repo
   vastgelegd. Dit record legt het besluit vast met datum en eigenaar; de inhoudelijke bevestiging
   blijft een actiepunt voor de opdrachtgever.

3. **B-7 — het multi-rolmodel blijft dicht.** Eén rol per persoon. Wie zowel bureau- als
   beheerderswerk doet, krijgt twee accounts of het fonds belegt het beheerderswerk elders.

4. **B-10 — geen per-fonds aan/uit-schakelaar voor capabilities.** Die bestaat niet en komt er niet.
   Aan/uit = wel of niet de rol toewijzen.

5. **Twee nieuwe capabilities, gedefinieerd en toegekend maar NIET bedraad.** `ai.deskresearch` en
   `ai.stukvoorbereiding` hangen uitsluitend aan `bestuursbureau` en sturen vandaag geen enkele
   functionaliteit aan. Ze bestaan nu al zodat T2 (producerende taken + Word-export) en het
   deskresearch-ticket erop kunnen gaten zonder de rolstructuur opnieuw te openen. `ai.deskresearch`
   wordt daar de gate op het webpad, met `WEB_RETRIEVAL_ACTIEF` als systeemvoorwaarde — zonder die
   omkering zou live web-retrieval het gedrag van álle rollen wijzigen en G23 breken.

6. **Correctie 1 op ontwerp §5.4 — de schrijfkant is NIET fail-closed.** Het ontwerp stelt dat de
   nieuwe rol buiten de bestaande `rol in ('voorzitter','beheerder')`-schrijfpolicies valt en dus
   correct wordt geweigerd. Dat klopt voor de config- en stuurinfolaag, maar niet voor de drie
   handelingen die §5.3 juist uitsluit:

   | Policy | Predicaat vóór T1 | Gevolg |
   |---|---|---|
   | `"eigen inbreng schrijven"` | `gebruiker_id = auth.uid()` + eigen fonds | bureau mág inbrengen |
   | `"fonds stem insert"` | `uitgebracht_door = auth.uid()` + eigen fonds | bureau mág stemmen |
   | `"fonds stemmingen insert/update"` | `geopend_door = auth.uid()` + fonds | bureau mág een ronde openen/sluiten |
   | `"dissent zichtbaarheid write"` | `bestuurder_id = auth.uid()` **or** privileged | bureau mág dissent vastleggen |

   De app gebruikt een browser-client met de anon-key (`core/lib/supabase.ts`), dus de gebruiker
   heeft zijn eigen JWT en kan PostgREST rechtstreeks aanroepen — langs elke route heen. Een check in
   een API-route dekt dat niet af. **Daarom breidt T1 ook de schrijfpolicies uit**: elf policies in
   totaal, niet de drie leespolicies uit M1–M3. Zonder die uitbreiding zou FR-7 klasse D zijn
   (UI/route) in plaats van klasse H (RLS), en dat is precies wat de kernregel uit guardrailmatrix
   §7.2 verbiedt voor een compliance-relevante guardrail.

7. **Correctie 2 op ontwerp §5.4 — het predicaat is NULL-veilig.** Het ontwerp schrijft
   `(select rol …) <> 'bestuursbureau'`. Bij een profiel met `rol IS NULL` levert dat `NULL` op, en
   dus een onzichtbare rij — een gedragswijziging voor een **bestaande** gebruiker en daarmee een
   doorbraak van de nulgrens. `profielen.rol` is nullable (alleen een DEFAULT, geen NOT NULL).
   Overal staat daarom `is distinct from 'bestuursbureau'`: identiek voor elke bekende rol,
   NULL-veilig voor de rest.

8. **Startpunt: een tweede maatstaf, geen tweede kaart.** Voor `bestuursbureau` vervalt de telling
   "agendapunten zonder uw eigen inbreng" (besluit 0085) en komt "agendapunten zonder gekoppeld stuk"
   ervoor in de plaats. De eerste maatstaf zou voor deze rol actief misleiden: het bureau plaatst
   geen inbreng en leest sinds deze migratie geen inbrengrijen, dus de teller zou stelselmatig "alle
   agendapunten" tonen. `AgendapuntTelling` draagt daarom een expliciete `maatstaf`-discriminator; de
   promptregel in `portaalstand-blok.ts` volgt diezelfde maatstaf, zodat de assistent tegen een
   bureaugebruiker niet over "uw eigen inbreng" spreekt. De bestaande regel blijft byte-voor-byte
   gelijk.

9. **De motiveringseis bij agendapuntwijziging is fail-safe gemaakt.** `PATCH /api/agendapunten/[id]`
   telt bestaande bijdragen via de RLS-client om te bepalen of een motivering verplicht is. Voor het
   bureau levert die telling sinds deze migratie altijd 0, waardoor een governancecontrole — met
   notificatie aan de bijdragers — stil zou verdwijnen precies wanneer er wél bijdragen zijn. Voor
   deze rol is de motivering daarom onvoorwaardelijk verplicht: wie de bijdragen niet kan zien,
   motiveert altijd.

## Overwogen alternatieven

- **Alleen de leespolicies afschermen, zoals letterlijk in ontwerp §5.4** — afgewezen. Het laat een
  direct PostgREST-schrijfpad open dat een server-side routecheck niet kan dichten, en degradeert
  FR-7 tot een cosmetische maatregel.
- **De rol als trap op de bestaande ladder (`beheerder` min een paar rechten)** — afgewezen; het is
  een zijtak: ruimer op documentbeheer, strikt smaller op alles wat beoordelen of besturen is.
- **Een `voting.*`/`meetings.*`-capability introduceren** voor de zeven schrijfroutes — overwogen,
  niet gedaan. Het vergaderdomein toetst op ~17 plaatsen met losse rolstrings; dat opruimen is een
  eigen refactor met eigen regressierisico en hoort niet in T1. In plaats daarvan één gedeelde,
  testbare gate (`core/lib/bureau-gate.ts`) die de bestaande conventie volgt.
- **`rolVereist: "bestuursbureau"` in de module-registry** — afgewezen en actief getest tegen. De
  sidebar filtert op strikte gelijkheid, dus `beheer` en `governance` (beide `rolVereist:
  "beheerder"`) verdwijnen vanzelf voor de nieuwe rol. §5.5 vraagt hier dus géén codewijziging; de
  eis is als test vastgelegd in plaats van als code. `rolVereist` blijft UI-cosmetica, nooit
  autorisatie.
- **`ROL_LABEL` in `core/lib/generatie-kern.ts` uitbreiden** — bewust niet gedaan. Dat bestand voedt
  de AI-systeemprompt, is sha256-gepind en valt onder assistentgedrag (T2). Gevolg: een
  bureaugebruiker wordt in de AI-prompt voorlopig als "bestuurslid" aangeduid. Zie openstaand.

## Gevolgen

- **RLS/security:** elf policies zijn herschreven als `<bestaand predicaat> AND <rol is distinct from
  'bestuursbureau'>`. Voor de drie bestaande rollen is de tweede term altijd waar, dus het
  evaluatieresultaat is per definitie identiek aan vóór de migratie. Er komt geen policy bij of af.
  `"fonds stemmingen select"` (ronde + uitslag) en `"dissent zichtbaarheid select"` blijven bewust
  ongemoeid. Zeven API-routes weigeren de rol bovendien server-side met 403 — defense in depth en een
  leesbare melding, niet de beveiligingslaag.
- **Audit-logging:** geen wijziging aan `governance_log`, `governance_events` of de `*_log`-tabellen.
  Er komt geen event-type bij. De bestaande audit rond inbreng, stemmen en dissent blijft gelden voor
  de rollen die die handelingen nog uitvoeren.
- **Datamodel/migraties:** `2026_08_05_bestuursbureau_rol.sql` + `_ROLLBACK.sql`. Idempotent,
  transactioneel, met een fail-closed verificatieblok in dezelfde transactie. De ROLLBACK weigert
  zolang er nog een profiel met `rol = 'bestuursbureau'` bestaat. `schema.sql` als documentatie
  bijgewerkt (CHECK + de vier inbreng-policies).
- **AS-RUN 05-08-2026** tegen de doeldatabase (project `aebwiufuegsiwhwpdrfb`, branch `main`/PRODUCTION),
  conform "toets de uitkomst in de database, niet de intentie in de migratie":
  - **Pre-flight uitgevoerd en schoon.** Alle dertien live policies op de vier tabellen zijn
    vergeleken met de basispredicaten in de migratie; geen enkel predicaat week af en er waren geen
    wees-policies. Dat was de dragende onbekende, want `"fonds inbreng lezen"` staat in geen enkele
    migratie. Bijvangst: de live INSERT-policy droeg de M-01-tenantgrens, wat bevestigt dat
    `2026_07_31_r1_rls_tenantgrenzen.sql` daadwerkelijk op productie heeft gedraaid en dat
    `schema.sql` alleen op dát punt achterliep.
  - **Migratie gedraaid:** "Success. No rows returned" — het fail-closed verificatieblok binnen
    dezelfde transactie is dus schoon gepasseerd.
  - **Geverifieerd in de database:** de CHECK draagt
    `('bestuurder','voorzitter','beheerder','bestuursbureau')`; exact elf policies dragen de
    rol-uitsluiting (`agendapunt_inbreng` 4, `stem_uitbrengingen` 4, `stemmingen` 2,
    `decision_dissent` 1); en precies twee SELECT-policies dragen hem bewust níét
    (`fonds stemmingen select`, `dissent zichtbaarheid select`).
  - **Nog niet gedraaid:** `supabase/checks/2026_07_31_r1_structurele_gates.sql` (gates A–H over het
    hele schema). `supabase/checks/2026_08_05_bb_rolgrenzen.sql` hoort niet op productie — die seedt
    in `auth.users` en draait in CI of tegen een wegwerp-DB.
  - **Tussentoestand is veilig.** De code is op dit moment nog niet gedeployed. Dat is zonder risico:
    de migratie beperkt uitsluitend een rol die nog aan geen enkel profiel is toegekend, en voor
    `bestuurder`/`voorzitter`/`beheerder` is de toegevoegde term altijd waar.
- **Gebruikerservaring:** het inbrengpaneel toont voor deze rol een expliciete melding in plaats van
  een lege lijst; de samenvattingsregel en de vergaderstatistiek tonen "inbreng afgeschermd" in
  plaats van "0"; de stemronde toont status en uitslag, maar niet de tussenstand en niet het
  per-persoonsblok.
- **FR-4 is NIET aantoonbaar gehaald — zie OP-T1-7.** Bij het sluiten van een ronde bevriest
  `berekenUitslag()` een `per_stemgerechtigde[]` met naam, keuze en motivering in de jsonb-kolom
  `stemmingen.uitslag`, en die tabel is voor het bureau bewust leesbaar. Het individuele stemgedrag
  van een gesloten ronde is daarmee alsnog bereikbaar — rechtstreeks via PostgREST met de eigen
  anon-key. In T1 is dit **klasse D** afgedekt (per-persoonsblok verborgen, auditdossier-export
  geweigerd met 403); de onderliggende jsonb blijft leesbaar. Dat is precies het patroon dat de
  kernregel uit guardrailmatrix §7.2 verbiedt voor een compliance-relevante guardrail, en het vraagt
  een structurele keuze die het datamodel of de betekenis van de bevroren auditsnapshot raakt. Dat
  besluit is bewust niet in T1 genomen. Dezelfde payload lekt via `decision_audit_snapshots`
  (OP-T1-8); de DELETE-kant wordt ondergraven door cascade-delete (OP-T1-9).
- **Openstaand:**
  - **Niet gedraaid tegen de database.** `psql`, `docker` en de Supabase-CLI ontbreken op de
    werkplek. De migratie en de checksuite zijn geschreven en de app-laag is groen, maar de
    DB-laag draait pas in CI of bij handmatige uitvoering. Zelfde patroon als OP-B2/OP-A1.
  - **Bijdragers krijgen geen notificatie als het bureau een agendapunt wijzigt.**
    `notifyAgendapuntBijdragers()` bepaalt de ontvangers met een lees-query op
    `agendapunt_inbreng` over de RLS-client, en die levert voor deze rol nul rijen. De verplichte
    motivering landt wél append-only in `agendapunt_log`, dus de informatie is herleidbaar — ze wordt
    alleen niet actief gepusht. Oplossen vergt een `SECURITY DEFINER`-functie die de ontvangers
    bepaalt zonder de inhoud te lezen; dat is een nieuw geprivilegieerd oppervlak en hoort een eigen
    voorstel te krijgen (OP-T1-5).
  - De AI-prompt duidt een bureaugebruiker voorlopig aan als "bestuurslid"
    (`core/lib/generatie-kern.ts`) — overgedragen aan T2.
  - Doorwerking naar `03 Functioneel ontwerp/gebruikersrollen-en-rechten.md` en
    `09 Objectenmodel/rollen-rechten-objecten.md` is **aangemeld voor T3**, niet hier afgehandeld.

## Referenties

- Migratie: `supabase/migrations/2026_08_05_bestuursbureau_rol.sql` (+ `_ROLLBACK.sql`);
  documentatie in `supabase/schema.sql`.
- Code: `core/lib/capabilities.ts` (`ROL_CAPABILITIES.bestuursbureau`, twee nieuwe capabilities),
  `core/lib/bureau-gate.ts` (nieuw), `core/lib/portaalcontext.ts` +
  `core/lib/portaalcontext-afleiding.ts` (`telZonderGekoppeldStuk`, `maatstaf`),
  `core/lib/portaalstand-blok.ts`,
  `app/(platform)/platform/(beveiligd)/gebruikers/gedeeld.ts` (`TENANT_ROLLEN`, `ROL_LABEL`).
- Tests: `tests/cross-tenant/bureau-rolgrenzen.test.ts` (21 tests),
  `supabase/checks/2026_08_05_bb_rolgrenzen.sql` (DB-laag onder échte RLS, incl. nulgrensblok),
  `core/lib/bureau-gate.sanity.ts`, `core/lib/capabilities.sanity.ts`.
- Eerdere besluiten: [`0006`](./0006-doorontwikkeling-v2-beslispunten-B1-B10.md) (B11: capability-mapping
  in code, geen `rol_capabilities`-tabel),
  [`0017`](./0017-increment-f-keuzes.md) (strikt zelfbeheerde profielen),
  [`0044`](./0044-maak-profiel-deterministische-fondstoewijzing.md) (expliciet fonds bij registratie),
  [`0046`](./0046-cross-tenant-testsuite-testdb-strategie.md) (fasering van de RLS-CI),
  [`0083`](./0083-p3b-tenant-gebruikersbeheer.md) (rolkeuze via het service-role-pad),
  [`0085`](./0085-ai-startpunt-p1-ingang-ipv-leeg-invoerveld.md) (Startpunt en portaalcontext).
