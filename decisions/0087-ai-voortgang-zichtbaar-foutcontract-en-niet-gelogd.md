# 0087 — AI-voortgang zichtbaar: stream eerder open, foutcontract verschuift, voortgang niet gelogd

- **Status:** Geaccepteerd
- **Datum:** 2026-07-28
- **Betrokkenen:** Merlin (opdrachtgever/PO), Claude (bouw)

## Context

Tussen het versturen van een vraag en de eerste letter van het antwoord zat een merkbare stilte. Die viel samen met het duurste werk in `app/api/chat/route.ts`: de history-aware reformulatie (een volledige call op het sterke model), de hybride RAG-zoek, de reranker en de promptopbouw draaiden **vóórdat** de `ReadableStream` werd geopend. De browser kreeg in die periode niets; de drie stuiterende puntjes waren een client-animatie zonder relatie tot het serverwerk.

Om voortgang te kunnen tonen moet de stream eerder open. Dat raakt twee dingen die een besluit vergen. Randvoorwaarde: het is een **transparantie**-tranche, geen versnelling — geen model-/reranker-/retrievalwijziging, geen promptwijziging, en bovenal **geen schijnzekerheid** (elke melding volgt een bereikt servermoment; overgeslagen stappen worden weggelaten, niet grijs getoond).

## Besluit

Het retrieval- en promptopbouwblok verhuist **binnen** de `ReadableStream` van `/api/chat`, zodat het per fase `{type:"progress"}`-events kan sturen (`reformulatie`, `retrieval`, `rerank`, `web`, `analyse`, `generatie`; statische labels + aantallen uit de werkelijke verwerking). Auth, rate-limiting, de fonds-/host-/module-gates en de verduidelijkingstak blijven **vóór** het stream-openpunt (die moeten een echte HTTP-status kunnen geven). Twee samenhangende deelbesluiten:

**1. Het foutcontract van `/api/chat` verschuift.** Fouten in retrieval/reformulatie/promptopbouw leverden een HTTP-foutstatus op (afgevangen door de POST-catch). Nu die stappen ín de stream draaien — ná het verzenden van HTTP 200 — worden ze een `{type:"error"}`-event binnen de 200-respons. De client toont dat als begrijpelijke chatmelding (bestaand gedrag). Auth/rate-limiting/gating behouden hun HTTP-status omdat ze vóór het openpunt staan.

**2. Voortgang wordt bewust niet gelogd.** De `progress`-events zijn vluchtige UI-state en worden nooit naar `governance_log`/`governance_events` geschreven. Het auditspoor (inclusief `retrieval_meta`) blijft ongewijzigd op zijn plek ná het streamen.

## Overwogen alternatieven

- **Kunstmatige voortgang** (timer-tekst, geschatte percentages, minimale weergaveduur) — precies de schijnzekerheid die het project uitsluit. Verworpen: elke fase volgt een bereikt servermoment.
- **Aparte `rerank`-fase met eigen lopende regel** — de reranker draait ín `zoekRelevanteChunksMetMeta`, niet als losse call. Daarom wordt `rerank` gemeld als afgeronde stap ná de retrieval (met het aantal relevant bevonden passages), alleen als de fondsvlag `rerank` aan staat.
- **Voortgang loggen als reproduceerbaar spoor** — zou suggereren dat de getoonde stappen een auditgebeurtenis zijn. Verworpen: vluchtige UI-state hoort niet in het append-only spoor.
- **Nieuwe API-route i.p.v. `/api/chat` ombouwen** — onnodige duplicatie; de bestaande SSE-vorm (`meta → delta → done`, besluit 0071) leende zich voor uitbreiding.

## Gevolgen

- **UX (positief):** binnen ~1 s verschijnt een inhoudelijke melding; de bestuurder ziet vóór het antwoord waarop het straks steunt (aantallen doorzochte/relevante passages). Dezelfde transparantielijn als de bronbasis-melding (0071).
- **API-contract (bewust geaccepteerd nadeel):** het foutcontract van `/api/chat` is minder expliciet — een retrievalfout is nu een 200 met een `error`-event i.p.v. een HTTP-foutstatus. De enige consument is de assistent-client (en de agenda-chat via dezelfde SSE-vorm), die het al als chatmelding afhandelt. Een externe consument die op de statuscode zou leunen bestaat niet.
- **Audit/reproduceerbaarheid:** ongewijzigd. `governance_log` (incl. `retrieval_meta`) en `governance_events` bevatten na een vraag exact dezelfde records; geen `progress`-event belandt in het spoor.
- **RLS/tenant-isolatie:** géén wijziging — geen nieuwe queries, geen datamodelwijziging (daarom is de `supabase-rls-reviewer` hier niet ingezet).
- **Datamodel/migraties:** géén.
- **Prestaties:** géén echte versnelling; alleen de *waargenomen* wachttijd verbetert. De reformulatie op het sterke model blijft vermoedelijk het grootste stille-tijd-blok — kandidaat voor een latere model-tiering-tranche (0067).
- **Verificatie:** `tsc`, `lint:colors`, `lint:boundaries` groen; nieuwe `voortgang.sanity.ts` groen (9 tests, o.a. "reranker+web uit → die fasen verschijnen niet"); cross-tenant app-laag groen. *Openstaand (vereist inlog):* browser-smoke van de fasenweergave, de schone overgang bij het eerste delta, de foutpad-melding, en het bewijs dat `governance_log`/`governance_events` vóór/na identiek zijn.

## Referenties

- Code: `app/api/chat/route.ts` (stream-openpunt + progress-events + foutcontract), `core/lib/voortgang.ts` (+ `voortgang.sanity.ts`; fase-labels + pure afleiding), `app/(dashboard)/ai/_components/AssistentClient.tsx` (voortgangsconsument, gegeneraliseerd).
- Eerdere besluiten: **0071** (voorbereidingsroute SSE `meta → delta → done` — precedent; kan deze eventvorm ongewijzigd overnemen), **0005** (rate limiting — blijft vóór de stream), **0067** (generatiemodel — model-tiering als aparte, latere tranche), **0073** (reranker — ongewijzigd), **0042** (fonds uit de sessie, nooit uit de body).
