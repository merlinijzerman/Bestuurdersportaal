# 0035 — Publieke voorkant: richtingsbesluit meerpagina + scope fase 1

- **Status:** Geaccepteerd
- **Datum:** 2026-07-05
- **Betrokkenen:** Merlin (besluit), Claude (advies/uitvoering)

## Context

De publieke voorkant wordt gepositioneerd als generieke **AI-ondersteunde besluitomgeving**, met pensioenfondsen als eerste, diepst uitgewerkte specialisatie. Er lag een open richtingskeuze tussen een **onepager** en een **modulaire meerpagina-structuur**, plus een reeks afgeleide inhoudelijke en operationele keuzes (doelgroepen, sectorpagina, contactmapping, claimborging, owners). De SEO-migratie is als randvoorwaarde eerst afgepeld: de werkelijke Google-footprint is triviaal (1 geïndexeerde homepage + varianten, 15 impressies totaal), dus **SEO is geen rem** op de richting (zie SpoorB v6 §2.1/§5). De keuze is daarmee een scope-/positioneringsbesluit, niet SEO-gedreven.

Randvoorwaarden die meewegen: claimdiscipline (geen ISO/SOC/hosting-/encryptieclaims — SpoorB §12), feitelijke juistheid van pensioen-domeininhoud, tenant-isolatie/auth ongemoeid, terugdraaibare cutover, beperkte schrijfcapaciteit.

## Besluit

De publieke voorkant wordt een **modulaire meerpagina-structuur**, en **alle publieke pagina's gaan in fase 1 tegelijk live**: homepage, `/product`, `/voor-wie`, `/sectoren` (Variant A — nu live, met geschiktheidskenmerken), `/governance-ai`, `/over-ons`, `/contact`. Content wordt in één keer geschreven en gereviewd; Claude levert claim-veilige concepten per pagina, Merlin reviewt en stelt vast.

Afgeleide besluiten (5 juli 2026, contentplan v1.2 §14):

- **`/voor-wie`** — 5 rollen: Bestuur/directie · Commissies · RvT/RvC · Bestuursbureau/secretariaat · GRC/Compliance.
- **`/sectoren`** — Variant A nu live; alleen pensioen benoemd + "meer volgt" (geen overclaiming van andere sectoren).
- **`/sectoren/pensioenfondsen`** — feitelijke validatie door **Merlin zelf** (afwijkend van advies onafhankelijke SME; zie Gevolgen).
- **`/governance-ai`** — claimborging via **schrijverszelfcheck** (veilige formuleringen); jurist optioneel, geen kritisch pad.
- **`/contact`** — geen reactietermijn toezeggen (open houden); 6 klantvriendelijke labels → mapping naar de 4 bestaande DB-waarden (`demo, pilot, vraag, samenwerking`), front-end stuurt DB-waarde mee (geen migratie, sluit aan op 0031/0034).
- **Owners copy** — Claude draft → Merlin reviewt/stelt vast.

## Overwogen alternatieven

- **Onepager** — verworpen: minder schaalbaar, geen per-doelgroep/-sector diepgang, minder SEO-oppervlak, moeilijker uitbreidbaar naar nieuwe sectoren.
- **Gefaseerde livegang (kernset eerst)** — verworpen: levert tijdelijk een halve site en een minder consistente commerciële indruk; content wordt toch in één keer geschreven, dus weinig tijdwinst.
- **`/sectoren` Variant B (later, alleen pensioenpagina)** — als fallback behouden indien Variant A niet substantieel te vullen blijkt; niet gekozen als uitgangspunt.
- **Onafhankelijke pensioen-SME-validatie** — geadviseerd maar niet gekozen; Merlin valideert zelf (zie Gevolgen).

## Gevolgen

- **Schrijffase kan starten:** alle blokkerende scope-aannames zijn beslist; Claude draft de resterende copy (homepage-differentiatieblok, `/product`-voorbeeldflow, `/voor-wie`, `/sectoren` Variant A), Merlin reviewt.
- **Één harde poort vóór livegang blijft:** de feitelijke pensioen-SME-validatie op `/sectoren/pensioenfondsen` (9 punten, concept-copy v0.2). Claimborging op de overige pagina's loopt via zelfcheck, geen formele juristreview op het kritische pad.
- **Bewust geaccepteerd risico:** Merlin valideert de pensioenpagina zelf i.p.v. een onafhankelijke SME. Dit verhoogt het reputatie-/complianserisico op de commercieel belangrijkste pagina (geen tweede paar ogen op eigen aannames/blinde vlekken). **Mitigatie:** collega-sanity-check op de 9 validatiepunten vóór livegang aanbevolen.
- **Geen datamodel-/migratie-impact:** contactmapping gebruikt de bestaande `type_verzoek`-check-constraint (0031); alleen front-end mapping. Host-indeling/auth (0029/0030) ongemoeid.
- **SEO:** cutover blijft laag risico; 301-redirectmap gefinaliseerd (SpoorB v6 §5, één hop, geen keten).

## Referenties

- `03 Functioneel ontwerp/Bestuurdersportaal - Publieke voorkant contentplan v1.2.md` (§14 beslistabel, §15 risico's)
- `03 Functioneel ontwerp/Bestuurdersportaal - Copy pensioenfondsen (concept ter SME-validatie) v0.1.md` (concept v0.2, 9 validatiepunten)
- `04 Technische inrichting/SpoorB-SEO-migratie-en-developer-overdracht-v6.md` (§2.1 footprint, §5 redirectmap)
- Eerdere besluiten: 0029 (host-indeling), 0030 (loginhost), 0031 (contact-opslag), 0032 (styling), 0034 (contact-inbox/backoffice)
