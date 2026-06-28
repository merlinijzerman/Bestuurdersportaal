# 0028 — Agendapunt-toelichting als seed-context voor de AI-assistent

- **Status:** Geaccepteerd
- **Datum:** 2026-06-28
- **Betrokkenen:** Merlin IJzerman (producteigenaar/architect), platformteam

## Context

Bestuurders kunnen de AI-assistent vandaag op één specifiek stuk scopen via `/ai?doc=<id>` (document-scope, increment 1/2). Wat ontbreekt is een interactieve AI-ingang op **agendapunt**-niveau: doorvragen op een agendapunt óók als er nog geen stukken zijn geüpload. De gestructureerde "Mijn voorbereiding" (`app/api/agendapunten/[id]/voorbereiding`) gebruikt de titel + toelichting al, maar is eenmalig en niet-interactief.

De toelichting (`agendapunten.beschrijving`) is **ongevalideerde vrije tekst** van een bestuurder — geen bestuurlijk vastgestelde fondsbron. Dat stelt eisen aan herkomst/labeling (een AI-antwoord mag deze input niet als vastgestelde bron of als algemene kennis presenteren) en aan het auditspoor (herleidbaar dat de vraag door een agendapunt-toelichting is geframed).

Randvoorwaarde die zwaar meeweegt: de bestaande document-scope-tak in `app/api/chat/route.ts` schakelt bij een gevulde `document_scope.document_ids` naar **strict-document gedrag** (`scopeActief`): antwoord uitsluitend op het document, vul niets aan uit andere context of algemene kennis, meld anders letterlijk "Dit is niet in dit document aangetroffen". Die strict-modus verbiedt juist het gebruik van de toelichting als context. De retrieval-scoping (alleen chunks uit de gekoppelde stukken ophalen) is herbruikbaar; de prompt-/modus-laag niet.

## Besluit

De toelichting van een agendapunt gaat als **gelabelde seed-context** de prompt in (niet gechunkt, niet geëmbed, niet als pseudo-document-id), via een **aparte agendapunt-tak** in de chat-route die het strict-document gedrag niet activeert. Toelichting-afgeleide claims dragen het herkomstlabel `[Toelichting agendapunt]`, naast `[Bron N]` (vastgestelde fondsbron) en `[Algemene kennis]`. Het auditspoor legt herkomst `agendapunt:<id>` vast. De route haalt titel + toelichting **server-side zelf op** via RLS op `agendapunten`; de client levert alleen het agendapunt-id (+ titel voor de chip).

## Overwogen alternatieven

- **Toelichting chunken/embedden (retrievebaar via RAG)** — verworpen: de toelichting is kort (enkele regels) en niet-vastgesteld; chunking is overkill en wekt onterecht de suggestie van een retrievebare fondsbron.
- **Gekoppelde stukken als bestaande document-scope hergebruiken zónder aparte tak** (aanname #4 uit het bouwticket) — verworpen: `scopeActief` forceert strict-document gedrag, dat het gebruik van de toelichting verbiedt en bij combinatie toelichting + stukken "Dit is niet in dit document aangetroffen" zou opleveren. De scope-rails zijn alleen voor retrieval-scoping herbruikbaar, niet voor de prompt-/modus-laag. Daarom een aparte `SP_AGENDAPUNT_REGELS`-tak (combineren-stijl).
- **Client stuurt `{ id, titel, toelichting }` mee** (letterlijke ticket-vorm §2.1 C) — verworpen ten gunste van server-side fetch op id: zo wordt de RLS-grens server-side afgedwongen (vreemd-fonds-id geeft niets terug) en logt het auditspoor de échte toelichting in plaats van door de client aanleverbare tekst.
- **Strict-toelichting als eigen modus** (aanname #3) — niet nu: combineren (toelichting + stukken + waar nodig algemene kennis, elk apart gelabeld) is de default; een strict-toelichting-vlag is een latere, additieve keuze.

## Gevolgen

- **RLS/tenant-isolatie:** geen nieuwe tabellen of RLS-wijziging. De fonds-grens loopt via bestaande RLS op `agendapunten` (server-fetch van de toelichting), `documenten` (page-load van de stukken) en de retrieval (chunks alleen uit eigen fonds). Een vreemd-fonds agendapunt-id is op alle drie niet laadbaar.
- **Audit/reproduceerbaarheid:** `governance_log.retrieval_meta.herkomst = "agendapunt:<id>"` naast de bron-modus; append-only insert ongewijzigd. `[Toelichting agendapunt]`-markeringen blijven herleidbaar in het gelogde antwoord.
- **Datamodel/migraties:** geen. `agendapunten.beschrijving` en `documenten.agendapunt_id` bestaan al; `retrieval_meta` is jsonb (herkomst additief). Het `agendapunt_context` in `gesprekken.document_scope` (jsonb) is een additieve sleutel — geen migratie.
- **Gebruikers-/beheerervaring:** nieuwe knop "Vraag de AI over dit agendapunt" op een actief agendapunt (ook bij 0 stukken); scope-chip toont "Agendapunt: «titel»"; "verbreden" gedraagt zich als bij document-scope.
- **Bewust geaccepteerd:** geen drempel/samenvatting voor zeer lange toelichtingen (aanname #2); de seed-context vertrouwt erop dat toelichtingen kort blijven. Een verse, nog niet geïndexeerde gekoppelde stuk wordt stil uit de retrieval-scope weggelaten in plaats van de vraag te blokkeren (geen hard 400 zoals bij `valideerScope` in pure document-scope).

## Referenties

- Bouwticket "Vraag de AI over dit agendapunt" v1.0 (28-06-2026).
- `mvp/app/api/chat/route.ts` (`scopeActief`/`SP_DOCUMENT_SCOPE_REGELS`, nieuwe agendapunt-tak), `mvp/lib/agendapunt-context.ts` (seed-blok + labelregels + herkomststring), `mvp/lib/rag.ts` (`RetrievalMeta.herkomst`).
- `mvp/app/(dashboard)/ai/page.tsx` (`?agendapunt=`-tak), `mvp/app/(dashboard)/vergaderingen/_components/AgendapuntKaart.tsx` (knop).
- ADR `0027` / increment 1/2 document-scope (de rails die hier deels herbruikt en deels bewust niet herbruikt worden).
