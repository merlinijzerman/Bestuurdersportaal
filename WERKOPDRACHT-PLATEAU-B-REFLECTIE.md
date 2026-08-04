# Werkopdracht: reflectiedialoog in de privéchat (plateau B)

> **Opgesteld** 4 augustus 2026, ná oplevering en verificatie van plateau A.
> **Vorm** conform `WERKOPDRACHT-TEMPLATE.md`; tweede en laatste werkopdracht uit
> het technisch ontwerp *Reflectiefunctie en verwijderbare gesprekken, plateau A en B v0.1* §14.
> **Plak dit bestand als eerste bericht in een Claude Code-sessie in de repo-root.**

---

## ⛔ Gate — niet starten tenzij

Plateau B heeft één blokkerende voorwaarde die plateau A niet had, en die is
bewust zwaar gemaakt (besluit [`0122`](./decisions/0122-gebruikerstoets-voor-de-bouw-van-plateau-b.md)):

**De gebruikerstoets is uitgevoerd, zonder openstaande kritieke bevindingen**,
volgens de kritiek/niet-kritiek-systematiek uit ontwerp v1.0 §19.

Waarom dit niet mag verschuiven: of de reflectievorm werkt hangt af van toon,
moment en formulering, en dat is achteraf **niet meetbaar** — besluit
[`0112`](./decisions/0112-geen-reflectiemarkering-in-enige-registratie.md) sluit
elke registratie van reflectiegedrag uit. Er is dus geen telemetrie die een
verkeerde aanname later corrigeert. Bovendien hangen de toestandsmachine, de
bronsetbevriezing en vier conditioneringen in de chatlaag aan de gekozen
flowvorm; bijstellen ná de bouw is duur.

De toets moet minimaal drie werkhypothesen valideren:

| # | Werkhypothese | Waar vastgelegd |
|---|---|---|
| 1 | Fail-safe-termijn voor een onderbroken flow: **24 uur** | TO §6.1 |
| 2 | Triggermomenten **T1–T5** voor de uitnodiging | v1.0 §9.1 |
| 3 | De drie afrondlabels: *Klopt* · *Aanpassen* · *Afronden zonder aparte notitie* | [`0113`](./decisions/0113-persoonlijke-reflectienotitie-buiten-scope.md) |

**Overige gates** (uitvoeringsvoorwaarden, elke sessie): `tsc --noEmit
--skipLibCheck` groen vóór en na · `npm run sanity` en `npm run test:xtenant`
groen vóór en na · `supabase/checks/2026_07_31_r1_structurele_gates.sql` schoon
tegen de doeldatabase · `scripts/check-service-role-leak.sh` — **let op: die
staat pre-existing rood** op een commentaarregel in `core/lib/app-fout-schrijf.ts`
(OP‑A9); constateer dat het rood ongewijzigd is, niet dat het groen is.

**Niet blokkerend voor bouwen, wél voor livegang:** L1 t/m L4, L6, L10 en L12 uit
ontwerp v1.0 §21.

---

## Doel & context

De reflectiedialoog helpt een bestuurder zijn eigen afweging scherper te krijgen:
de assistent nodigt op geschikte momenten uit, stelt één tot drie
verdiepingsvragen en toont een concept. Het geheel is een **gewone privéchat** —
geen nieuw object, geen apart opslag-, logging- of verwijderpad.

Plateau A heeft de voorwaarde geleverd waarop dit rust: de chatinhoud is
gescheiden van het auditspoor en écht verwijderbaar. Daardoor kan de reflectie in
`gesprekken.berichten` leven zonder dat er een onuitwisbaar spoor van iemands
twijfel achterblijft.

## Goedgekeurd ontwerp

Leidend, in deze volgorde:

1. `03 Functioneel ontwerp/Bestuurdersportaal - Reflectiefunctie en verwijderbare gesprekken v1.0.md` — het *waarom* en de guardrails.
2. `04 Technische inrichting/… technisch ontwerp plateau A en B v0.1.md` §4.6, §5.2, §6 — het *hoe*.
3. Besluiten [`0108`](./decisions/0108-privechat-als-opslag-voor-de-reflectiedialoog.md) t/m [`0113`](./decisions/0113-persoonlijke-reflectienotitie-buiten-scope.md), [`0121`](./decisions/0121-uitnodigingsfrequentie-per-browsersessie.md), [`0122`](./decisions/0122-gebruikerstoets-voor-de-bouw-van-plateau-b.md).

**Bij twijfel wint de code.** Het TO is van vóór de bouw van plateau A en bevat
aantoonbaar onjuiste aannames — zie *Wat plateau A heeft geleerd* hieronder.

## Scope

**Wel** (B‑1 t/m B‑6 uit TO §3.2):

| # | Onderdeel |
|---|---|
| B‑1 | Tabel `gesprek_reflectie_state` + RPC `reflectie_transitie` + fail-safe herstel |
| B‑2 | Reflectie-uitnodiging als tijdelijke UI-kaart; frequentie per browsersessie in `sessionStorage` |
| B‑3 | Ingangen, verdiepingsvragen en conceptweergave — uitsluitend als chatberichten |
| B‑4 | Bevroren reflectiebronset: bepaling, versiehash, opslag in de flowstatus |
| B‑5 | G1–G4: vervolgacties, terugvraagtak, retrieval en modusdetectie conditioneren op de flowstatus |
| B‑6 | Profielinstelling voor de permanente opt-out |

**Niet:** plateau C, D en E (publicatiepad, `decision_concerns`, rollen- en
capabilitymodel, recipient-safe bronset, AI-provenance, dissent, retentie).
Persoonlijke reflectienotities ([`0113`](./decisions/0113-persoonlijke-reflectienotitie-buiten-scope.md)).
Undo bij verwijderen, reflectiemarkering en geaggregeerde analyse — principieel uitgesloten.

## Impactklasse

**Architectuur + data + security.** Weging expliciet:

- **Architectuur** — nieuwe server-controlled toestandslaag over de chatflow.
- **Data** — één nieuwe tabel, geen wijziging aan bestaande.
- **Security** — nieuwe `SECURITY DEFINER`-functie, nieuwe RLS-policy, grants.
- **Tenant** — geraakt maar niet gewijzigd: het fonds-scope-predicaat blijft.

**Gevolg 1:** de documentatiehaak vuurt (`00 Overzicht en status/release-template.md`,
de `00–09`-markdown én de as-built Word-doc; daarna pas de marker in
`doc-actualisatie-log.md`).
**Gevolg 2:** de structurele gates zijn verplicht.

## Relevante bestanden

| Pad | Waarvoor |
|---|---|
| `core/lib/vraagtype.ts:648` `bepaalVervolgacties` | G1 — parameter `reflectieActief` |
| `app/api/chat/route.ts` terugvraagtak (~`:660`) | G2 — overslaan bij actieve flow |
| `core/lib/rag.ts` `RetrievalFilters` (`:25-40`), `rpcFilterParams` (`:153-163`), `handhaafFondsdiscipline` (`:98-119`) | G3 — bevroren bronset op **elk** retrievalpad, inclusief de PostgREST-terugval (`:1032-1145`) |
| `app/api/chat/route.ts` moduskeuze (~`:790`) | G4 — vaste modus bij actieve flow |
| `app/(dashboard)/ai/_components/AssistentClient.tsx` | Reflectiekaart, reflectie-invoerveld, statusweergave |
| `app/(dashboard)/vergaderingen/_components/AgendapuntChat.tsx` | Idem — let op: dáár is de terugvraagtak al uitgeschakeld (`agendapuntModusActief`) |
| `core/lib/ai-sessie.ts` | Patroon voor de `sessionStorage`-sleutel (besluit 0086) |
| `app/api/profiel/route.ts` + `app/(dashboard)/profiel/page.tsx` | B‑6 opt-out; strikt zelfbeheerd (besluit 0017) |
| Nieuw: `core/lib/reflectie-flow.ts` (+ `.sanity.ts`), `core/components/ReflectieKaart.tsx`, `ReflectieInvoer.tsx`, `app/api/reflectie/transitie/route.ts` | |
| Nieuw: `supabase/migrations/2026_XX_XX_b1_reflectie_state.sql` (+ `_ROLLBACK`) | |

## Guardrails met bijzondere aandacht

Naast `CLAUDE.md` §Niet-onderhandelbare guardrails:

- **Geen reflectiemarkering, nergens.** Niet in `modus`, niet in `retrieval_meta`,
  niet in een aparte tabel, ook niet geaggregeerd. De allowlist in
  `core/lib/audit-meta.ts` moet dit blijven afdwingen: een nieuw veld valt
  fail-closed naar de inhoud en laat `audit-meta.sanity.ts` falen. Zie
  [`0112`](./decisions/0112-geen-reflectiemarkering-in-enige-registratie.md).
- **De client mag de flowstatus niet muteren.** `gesprekken` wordt client-side
  beschreven met de anon-key en de gebruiker heeft UPDATE-recht op de eigen rij —
  daarom een aparte tabel met alleen een SELECT-policy en mutatie uitsluitend via
  `reflectie_transitie()`. Vijf pogingen moeten falen (TO §9, AC‑18).
- **`revoke all on function … from public, anon`**, daarna gericht `grant execute
  … to authenticated`. `revoke … from public` alleen is op Supabase aantoonbaar
  niet genoeg (bevinding H‑18).
- **Expliciete tabelgrants** op de nieuwe tabel; niet op de default-ACL leunen
  (zie migratie A1 en besluit [`0117`](./decisions/0117-geen-direct-delete-recht-op-chat-en-audittabellen.md)).
- **Geen retrieval op vrije reflectietekst.** De bevroren bronset moet op élk
  retrievalpad worden afgedwongen, inclusief de PostgREST-fallback — dat is een
  aparte codepad naast de RPC's.

## Wat plateau A heeft geleerd — lees dit vóór je het TO volgt

Zes dingen die tijdens de bouw van A aan het licht kwamen en die het TO voor B
raken:

1. **`fondsen.slug` is `text unique not null`.** De checksuites van vóór
   31‑07‑2026 (t3 t/m t17) laten hem weg en werken daardoor niet meer tegen dit
   schema. Kopieer je seed van `2026_07_31_r1_tenantgrenzen.sql` of
   `2026_08_03_p5_monitoring.sql`, niet van `2026_07_08_t3_cross_tenant.sql`. Zie OP‑A8.
2. **De `?`-jsonb-operator wordt door SQL-clients als parameterplaceholder
   gelezen.** Gebruik `jsonb_exists()` in alles wat buiten een dollar-quoted body
   staat.
3. **`now()` is de transactiestarttijd.** Binnen één transactie dragen alle rijen
   hetzelfde tijdstip; `order by … desc limit 1` is dan niet bepaald. Toets in
   checksuites op het *bestaan* van de verwachte rij.
4. **Zet een check die een periode lang rood staat onderaan**, niet bovenaan —
   anders breekt hij de suite af vóór het echte werk (les uit AC‑2, bevinding T‑01).
5. **De Supabase SQL-editor kent geen psql-metacommando's.** Geen
   `\set ON_ERROR_STOP` en geen `\echo` in een checksuite; dat is de praktische route.
6. **Vercel: tenant en beheer zijn gescheiden projecten** (variant C, besluit 0066).
   Een omgevingsvariabele voor de chatroute hoort in **`bestuurdersportaal`**, en
   een bestaande deployment pikt hem pas op na een redeploy. Dit heeft bij A twee
   interacties permanent zonder integriteitszegel opgeleverd.

## Testaanpak

**Nieuw — SQL-check** `supabase/checks/2026_XX_XX_b_reflectie_flow.sql`, patroon
van `2026_08_04_a_rollen_capabilities.sql`:

- Structureel: `gesprek_reflectie_state` heeft **alleen** een SELECT-policy;
  `reflectie_transitie` heeft een vaste `search_path` en geen `anon`-EXECUTE;
  cascade vanaf `gesprekken` bestaat.
- Gedrag (AC‑18): direct op `afgerond` zetten, beurtteller verlagen, willekeurige
  bronset kiezen, andermans status wijzigen, ongeldige transitie aanvragen — alle
  vijf falen.
- Gedrag (AC‑24): een gesprek verwijderen ruimt de flowstatus mee op.

**Nieuw — TypeScript-sanity** in `core/lib/`:

| Bestand | Wat het bevriest |
|---|---|
| `reflectie-flow.sanity.ts` | De volledige transitietabel + de fail-safe; elke ongeldige overgang faalt |
| `bronset.sanity.ts` | Versiehash deterministisch bij herordening van de bronlijst |

**Uitbreiden:** `audit-meta.sanity.ts` met een expliciete assertie dat er geen
reflectiesleutel in enige allowlist staat (AC‑17).

**Acceptatiecriteria:** AC‑15 t/m AC‑26 uit TO §9.

## In te zetten subagents

`ai-governance-reviewer` (verplicht — reflectiegedrag, G1–G4, geen
schijnzekerheid), `supabase-rls-reviewer` (verplicht — nieuwe policy en
definer-functie), `code-reviewer`, `ontwerp-sync-reviewer` vóór merge.

*Let op: bij de bouw van plateau A bleken deze subagent-typen in de gebruikte
omgeving niet beschikbaar. Constateer dat expliciet als het opnieuw zo is, in
plaats van de review stilzwijgend over te slaan.*

## Werkmodus

Begin in **Plan-modus**. Lever eerst een implementatieplan met bestanden,
RLS-impact, migratie-impact, testaanpak en risico's — inclusief een expliciete
verificatie van de TO-aannames tegen de werkelijke code. **Wijzig pas na expliciet
akkoord.**

## Definition of Done

Volg `CLAUDE.md` §Definition of Done. Opdracht-specifiek:

- Ontwerpdoc: v1.0 + het TO; werk het TO bij waar de bouw ervan afwijkt.
- Decision-records: de besluiten 0108–0113, 0121 en 0122 bestaan al. Een
  **nieuw** record alleen bij een afwijking van het vastgestelde ontwerp — die
  is dan per definitie een herziening en moet als zodanig worden vastgelegd.
- Tests: de SQL-check en de twee sanity-suites hierboven, plus AC‑15 t/m AC‑26.

## Openstaande punten

Nieuwe restrisico's en bewust uitgestelde onderdelen in
`00 Overzicht en status/openstaande-punten-en-risicos.md`, **mét eigenaar**. Een
punt dat alleen in de release-historie staat, geldt als niet belegd.

Openstaand uit plateau A dat plateau B raakt: OP‑A2 (historische
`retrieval_meta` niet herschreven), OP‑A4 (geen beheerscherm voor auditgrants),
OP‑A5 (back-uptermijn onbekend), OP‑A9 (service-role-leak-script rood op een
false positive).

## Terugkoppeling

Rapporteer in het antwoordformat uit `CLAUDE.md`: samenvatting, aangepaste
bestanden, RLS/security-impact, audit-logging-impact, datamodel/migratie-impact,
test/verificatie, openstaande risico's.
