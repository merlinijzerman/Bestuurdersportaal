# 0194 — De schrijfpoort onder de status-feitenmatrix (#214-a) en de P4-statusbesluiten

- **Status:** Geaccepteerd (bindend; #214-a vóór P4-tranche 4)
- **Datum:** 2026-08-28
- **Betrokkenen:** Merlin IJzerman (opdrachtgever/eigenaar), Claude (analyse en uitwerking)
- **Raakt:** [#214](https://github.com/merlinijzerman/Bestuurdersportaal/issues/214) (RLS-schrijfpoort), [#169](https://github.com/merlinijzerman/Bestuurdersportaal/issues/169) (P4), wrapperspoor [#209](https://github.com/merlinijzerman/Bestuurdersportaal/issues/209)/[#212](https://github.com/merlinijzerman/Bestuurdersportaal/issues/212). Bouwt op [[0192]], [[0193]].

## Context

P4 bouwt `besluitstatus_vereist_feit` (§4.6): een matrix die vóór een statusomslag toetst of het **vereiste feit** bestaat. De RLS-reikwijdtemeting bij #214 (`METING-RLS-reikwijdte-214.md`, 28-08) meet dat precies dat feit vervalsbaar is: `procedure_stappen` draagt een `for all`-policy met alleen fondsisolatie, `authenticated` heeft een tabel-brede UPDATE-grant, en er is geen trigger of kolomprivilege. `afgerond_met_afwijking`, `afwijking_motivering`, `afwijking_door`, `status`, `voltooid_door` zijn dus met één directe PostgREST-`PATCH` te zetten door **elk** fondslid — ook zonder de capability, want RLS toetst alleen fondslidmaatschap, niet de route-capability. `procedure_besluiten` zit in dezelfde klasse en is bovendien hard te `DELETE`-en.

`fn_stap_afronden_met_afwijking` (PR-C) dóét de rolgate + fondsgrens + motivering, maar leeft in een SECURITY DEFINER-RPC die een directe tabel-`PATCH` nooit raakt. De constructie is dus volledig omzeilbaar.

**Daarom komt #214-a vóór de matrix, niet erna.** Een matrix die toetst of `afgerond_met_afwijking` bestaat terwijl iedereen die vlag kan fabriceren, is een slot op een deur naast een open raam: hij geeft schijnzekerheid over een feit dat geen feit is. De hardste invariant van P4 (I1: een status die een feit stelt, vereist dat feit) is alleen zinvol als het feit zelf onvervalsbaar is. Dit is bovendien geen toekomstig risico maar een defect dat **vandaag op productie** staat.

## Besluit

### A. #214-a — de twee vervalsbare tabellen dicht, in TWEE pakketten

#214-a is **geen P4-tranche maar een productiefix**, en hij valt uiteen in twee stukken met verschillende urgentie en verschillende thuisbranch. Mechanisme in beide = de kolomniveau-revoke van PR-D op `decision_objects.status` ([[0193]] §6 / migratie `2026_08_28_p3d_03`: declaratief privilege, niet te spoofen, statisch toetsbaar — geen GUC, geen conventie).

**A1 — wat vandaag op productie geldt (zelfstandig pakket op `main`/`preview`, NIET in de epic).** `procedure_stappen.status`, `voltooid_op`, `voltooid_door` en `procedure_besluiten` (incl. `DELETE`) staan nú open op `main` en op productie — de kolommen bestaan al, het defect is live: elk fondslid kan een stap op `afgerond` zetten of een besluit hard verwijderen. Dit is onafhankelijk van EPIC P en mag niet achter een epic-promotie (die op #192/#207/#208 wacht) blijven staan. Levering als losstaand pakket: revoke (status/voltooid_op/voltooid_door + de her-grant van de overige kolommen; UPDATE+DELETE op `procedure_besluiten`) + rollback + de SECURITY DEFINER-RPC's voor de brekende schrijfpaden + de statische gate + een **gedragstoets** die aantoont dat een directe `PATCH` faalt (42501) en het legitieme pad blijft werken. Merlin bepaalt of/wanneer dit naar productie gaat; let op #210 (**nooit twee gedragsveranderingen in één release** — A1 is er één).

> **Review-uitkomst (28-08, twee reviewers) + verscherping.** Geen blocker in het revoke/RPC-mechanisme. De RLS-review vond dat de defectklasse zonder verscherping maar half dicht was: (i) **INSERT-forging** — `authenticated` hield tabel-brede INSERT, dus een stap kon direct als `afgerond` met vervalste `voltooid_door` worden *aangemaakt*; en (ii) `procedure_stappen`-**DELETE** was niet ingetrokken (asymmetrisch met besluiten). Beide zijn dezelfde klasse en zijn in A1 gedicht: een BEFORE INSERT-poort (`fn_guard_stap_insert`, migratie `p214a1_04`) weigert `status in (afgerond,heropend)` en niet-lege `voltooid_*` bij aanmaken voor het clientpad; en `revoke delete on procedure_stappen from authenticated`. De statische gate toetst nu **assertief** het ontbreken van een tabel-brede UPDATE-grant (één zo'n grant heropent alle kolommen stil) en van DELETE, plus de INSERT-poort; de gedragstoets bewijst INSERT-forging, DELETE, fondsgrens en de rolgate (bestuurder mag niet heropenen) allemaal geweigerd. Migratie-replaycheck: de énige tabel-brede UPDATE-grant staat in de baseline (14-08); geen migratie ná a1 verleent hem opnieuw, dus de revoke is het laatste woord.

**A2 — de afwijkingskolommen (in de epic, reist mee met PR-C).** `afgerond_met_afwijking`, `afwijking_motivering`, `afwijking_snapshot`, `afwijking_door` bestaan alléén op de epic. Hun revoke hoort dáár, naast PR-C. (Zodra A1 in de epic landt, vallen deze vier al fail-closed uit A1's her-grant; A2 maakt het **expliciet** en breidt de gate uit naar de volle zeven.) `fn_stap_afronden_met_afwijking` houdt het recht als SECURITY DEFINER.

**Statische gate** in beide pakketten (familie #209/#212): faalt ROOD als een bewaakte kolom UPDATE aan `authenticated` (her)krijgt, of als `procedure_besluiten` DELETE (her)krijgt — tegen de grant-drift die `p3d_03` al benoemt.

**Verificatievoorwaarde (zoals bij PR-D, Q2), uitgevoerd.** Élk pad dat deze kolommen als `authenticated` schrijft is geïnventariseerd: de normale afronding, handmatig activeren, stap-heropenen (+ compensatie) en de activatiecascade — alle omgelegd naar de RPC's. Owner/`service_role`-paden (migraties, seeds) blijven ongemoeid.

**Branch-strategie (Optie A — expliciete afhankelijkheid, geen duplicatie).** A1 is de basis; de epic **rebaset op een `main` die a1 bevat**, zodat de branch de afhankelijkheid zelf draagt en er geen "epic zónder a1"-configuratie is om synchroon te houden. A2 is daarmee **dun en additief**: een aparte afwijking-gate-regel (assertie, geen documentatie) die toetst dat de vier afwijkingskolommen niet-schrijfbaar zijn — a1's her-grant (alleen de main-kolommen) maakt ze op de epic al fail-closed, a2 borgt dat tegen drift. A2 herschrijft géén regels van a1 (aparte gate-file; niets aan de allowlist want kolomgrants zijn onzichtbaar voor V3). Het énige niet-additieve artefact is `audit-inventaris.json`: de epic-routes zijn helper-gebaseerd en verschillen van main, dus de inventaris divergeert en vergt bij de merge handmatige resolutie — dat kan niet additief. (De eerdere eis "epic mét én zónder a1 beide groen" is ingetrokken: die dwong juist de duplicatie af die ze wilde voorkomen. "Epic zonder a1 = rood" is de afhankelijkheid die zichtbaar wordt, niet een defect.)

**Bouwvolgorde, geen wachttijd.** "Toepassen" is geen bouwvoorwaarde: er wordt tegen een lokale prod-gelijke container gebouwd (main mét a1, dán de epic erop). P4-tranche 4 hoeft niet te wachten tot A1/A2 in Supabase geplakt zijn — hij hoeft alleen ná A2 in de **migratievolgorde** te staan.

### B. `procedures.beeindigen` = voorzitter + bestuurder

Dezelfde rolset als `procedures.afwijking.vastleggen` ([[0192]]). Redenering: de aanvankelijke aantekening "voorzitter, bij P4" leunde op *onomkeerbaarheid* ("beëindigen is zwaarder, dus smaller"). Maar #169 bevat **heropenen** — een beëindigde procedure kan terug. Daarmee is beëindigen niet zwaarder in de zin die telt; het is dezelfde soort handeling als afwijkend afronden: een bestuurlijk oordeel over de voortgang van een proces, geen administratieve ingreep. Twee rolsets voor twee aangrenzende bestuurlijke handelingen levert een matrix op die niemand meer uitlegt — precies wat we willen voorkomen. Beheerder valt af op de grond van 26-08: technisch-administratieve rol, velt geen bestuurlijk oordeel.

**Vastleggingsvorm gelijk aan afwijken:** verplichte motivering (I2, non-empty, server-afgedwongen, minimumlengte), append-only governance-event, en de **actor mét diens rol als momentopname**. Anders is de zwaarste handeling in de module de enige zonder verantwoordingstekst.

### C. Heropenen-van-een-procedure = voorzitter + bestuurder (idem B)

Wie mag heropenen wordt in dezelfde tranche belegd, niet later ontdekt. Als beëindigen voorzitter+bestuurder is maar heropenen-procedure onder `procedures.manage` (alle vier) valt, kan het bestuursbureau ongedaan maken wat het bestuur besloot. Daarom krijgt heropenen-procedure dezelfde rolset als beëindigen. Nieuwe capability `procedures.heropenen` (voorzitter+bestuurder), niet `procedures.manage`.

### D. §6.3 — `besloten → heropend` (van een besluit) onder `decisions.manage`, met getypeerde reden

De edge komt erbij, onder de bestaande statusrol `decisions.manage`, **zonder** aparte correctie-capability. Reden: de tweestapsroute die vandaag bestaat (via `afgesloten` als doorgang) is niet zwaarder bevoegd dan de gewone statusrol; een aparte capability zou de nette route poorten terwijl de lelijke open blijft — theater. En `afgesloten` gebruiken als doorgang maakt het auditspoor onwaar (wie later leest "afgesloten, meteen daarna heropend" ziet een gebeurtenis die nooit plaatsvond). De directe edge is eerlijker.

Twee eisen die zwaarder wegen dan de capability-vraag:

1. **Getypeerde reden, niet alleen vrije tekst.** Het event legt de categorie vast — `correctie_bindingsfout` versus `gewijzigde_omstandigheden` — plus de verplichte motivering. Dat neemt §6.3's bezwaar weg: het spoor vertelt dan zélf dat dit een correctie was, geen inhoudelijke heropening. Zonder die typering is het spoor alleen mínder onwaar in plaats van waar.
2. **Keten-reconstrueerbaarheid (gedragstoets).** Heropenen ontgrendelt het I1-ontkoppelslot (P2b). Wat daarna wordt losgemaakt logt zijn eigen regel. De gedragstoets bewijst dat de volgorde **heropening → ontkoppeling → herbinding → opnieuw besluiten** als één navolgbare reeks terugleesbaar is in `procedure_log` + `governance_events`. Zonder die keten is het een slot met een sleutel maar geen logboek.

I1 blijft heel: `heropend` stelt geen feit (lege rij in de feitenmatrix), dus de edge verzwakt de invariant niet.

### E. Twee heropeningen, expliciet uit elkaar

Er zijn **twee** heropen-handelingen op **twee** objecten, en ze worden overal — in [[0193]]/dit record, in de statusmatrix, en in de code — apart benoemd:

| | Object | Overgang | Capability | Reden-typering |
|---|---|---|---|---|
| **Heropenen-procedure** | `procedures` (procesinstantie), ná beëindigen | `beeindigd → heropend` (procedure) | `procedures.heropenen` (voorzitter+bestuurder) | motivering (I2) |
| **Heropenen-besluit** | `decision_objects` (§6.3) | `besloten → heropend` (besluit) | `decisions.manage` | getypeerde reden + motivering |

Zonder deze scheiding staat er over een half jaar één regel over "heropenen" en weet niemand welk object bedoeld is.

### F. I5-extensie: composite-FK, geen trigger

De cross-fonds-referentiecheck (I5, "elk gerefereerd object hoort bij hetzelfde fonds") krijgt de vorm die bij `governance_events` is vastgesteld ([[0192]] §2e): `(bron_id, fonds_id)` refereert aan `(id, fonds_id)` van de doeltabel, met een unieke index op `(id, fonds_id)` van het doel. Declaratief, dekt óók `service_role`, en kan niet stilvallen zoals een trigger. Alleen waar een composite FK niet kan (geen `fonds_id` op de bron, of een polymorfe verwijzing) valt I5 terug op een routecheck, expliciet gemotiveerd.

## Gevolgen en afhankelijkheden

- **P4-tranche 4 (de matrix) hangt aan #214-a** — expliciete afhankelijkheid, geen volgorde-toeval. De matrix landt niet vóór de schrijfpoort dicht is, anders toetst hij tegen een vervalsbaar feit.
- **Release-regel op [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171): de epic promoveert niet vóór A1 op `main` staat** — de hele schrijfpoort van de epic (RPC's + revoke) rust op A1. Naast de bestaande blokkades (#192, #207, #208) en "P3 niet zonder P4". A1's review moet daarom rond zijn vóór A1 gemerged wordt.
- #214-a levert: revoke-migratie(s) `procedure_stappen` + `procedure_besluiten` (kolom-revoke + DELETE-revoke), de omgelegde brekende `authenticated`-paden (RPC's), de statische gate, en de bijgewerkte `allowlist-grants.tsv` (gewijzigde grants + nieuwe functies).
- De P4-plan-tranches 6/7 implementeren B–E; tranche 8 implementeert F.
- Het bredere #214-restant (overige `decision_objects`-kolommen/velden, `is_primary_decision`, event-loze DELETE, de andere fonds-only ALL-tabellen) blijft in #214 als vervolg — #214-a is alleen de twee tabellen die de matrix direct ondergraven.

## P4-uitvoeringsstatus (29-08)

Op de epic geland en geverifieerd (tsc + sanity + container-gedragstoets waar DB-logica):

| Tranche | Inhoud | Migraties/bestanden |
|---|---|---|
| 1 | statusdragers (`+beeindigd`, `+niet_begonnen`/`+vervallen`, dossierstatus 9, StapStatus) | `p4_01` + TS |
| 2 | fasestatus `vervallen` (UI-laag) | `procedure-fase-status.ts` |
| 3 | `niet_begonnen` + actief-trigger (`actief_sinds`/`gestart_door`) | `p4_03` + TS |
| 5 | `besluitmoment_stap`-arm in `fn_stap_open_per_zwaarte` (§7) | `p4_05` |
| 6 | `procedures.beeindigen`/`.heropenen` (voorzitter+bestuurder) + RPC's + matrix-`beeindigd`-randen + 2 routes | `p4_06` + caps + routes |
| 7 | §6.3 `besloten→heropend`-besluit (getypeerde reden, `decisions.manage`) + guard | `p4_07` + statusroute |
| 8 | I5-composite-FK's (3) + gedragstoets | `p4_08` + `p4_i5_composite_fk.sql` |

**Uitgesteld tot ná a1 op main (Optie A):** tranche 4 (status-feitenmatrix) en a2 (afwijkingskolom-revoke). Zie de promotieketen op [#171](https://github.com/merlinijzerman/Bestuurdersportaal/issues/171).

**I1–I7-borging (§4.5):** I2 (motivering DB-afgedwongen in alle status-RPC's), I3 (capability voor afwijking + beeindigen), I4 (transitiematrix), I5 (composite-FK + routecheck-terugval), I6 (schemavorm), I7 (template-immutabiliteit, PR-B) zijn geborgd. **I1 (voorwaarts) hangt aan tranche 4** (de status-feitenmatrix) en is dus pas sluitend ná a1→a2→tranche 4; achterwaarts (P2b-ontkoppelslot) is I1 al geborgd.

**Meting-correctie:** `procedure_vaststelling` bestáát op de epic (P2a `2026_08_24`); de #214-meting draaide op `main`, waar hij niet bestaat. Op de epic is het een echte fonds-only tabel met een eigen I5-composite-FK (tranche 8) — de rest van zijn schrijfpoort-profiel valt onder het bredere #214.

## Referenties

- Meting: `METING-RLS-reikwijdte-214.md` (28-08).
- Sjabloon kolom-revoke: `supabase/migrations/2026_08_28_p3d_03_status_kolomrevoke.sql` + [[0193]] §6.
- Composite-FK-vorm: `supabase/migrations/2026_08_27_govevent_tenantketen.sql` + [[0192]] §2e.
- Ontwerp: `PROCEDURE-ENGINE-V2-ONTWERP.md` §4.5 (I1–I7), §4.6 (feitenmatrix), §5.2 (beëindigen/heropenen), §6.3 (ontkoppelslot).
- Issues: [#214](https://github.com/merlinijzerman/Bestuurdersportaal/issues/214), [#169](https://github.com/merlinijzerman/Bestuurdersportaal/issues/169), [#209](https://github.com/merlinijzerman/Bestuurdersportaal/issues/209), [#212](https://github.com/merlinijzerman/Bestuurdersportaal/issues/212).
