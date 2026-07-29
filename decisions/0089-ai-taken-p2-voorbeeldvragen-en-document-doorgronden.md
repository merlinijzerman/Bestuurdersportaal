# 0089 — AI-taken P2: voorbeeldvragen + "een document doorgronden"

- **Status:** Geaccepteerd
- **Datum:** 2026-07-29
- **Betrokkenen:** opdrachtgever (Merlin IJzerman), Claude Code (uitvoering)

## Context

Het AI-startpunt (0085) bood drie taakkaarten die alle drie hetzelfde deden: de
gebruiker in het invoerveld zetten. Werkopdracht P2 maakt twee ervan taakgericht:
de vrije vraag krijgt **voorbeeldvragen** uit de eigen context (Deel A), en "een
vraag over een document" wordt **"een document doorgronden"** — een opdracht met
kiesbare secties die de gebruiker scherpstelt vóór de assistent begint (Deel B).
Taakkaart 1 (agendapunt voorbereiden) blijft ongewijzigd.

Tijdens het plannen bleken drie aannames uit de werkopdracht niet te kloppen tegen
de code; die zijn hieronder als besluit vastgelegd.

## Besluit

**Deel A — voorbeeldvragen.** Een **vaste, generieke set** starters
(`core/lib/startvragen.ts`, `GENERIEKE_STARTVRAGEN`) — géén context-afleiding, géén
koppeling, géén query. De chips verschijnen op de lege staat van `/ai` **pas nadat
de gebruiker op "Een vrije vraag stellen" klikte** (patroon `STARTVRAGEN` in
`AgendapuntChat`). Een klik start de vraag meteen als vrije vraag; het auditspoor
krijgt een telemetrie-marker `governance_log.retrieval_meta.startvraag_bron =
"voorbeeldvraag"` (prefill vs. zelf getypt) — **geen nieuwe tabel, geen nieuw
`governance_events`-type**.

> **Herziening 2026-07-29 (opdrachtgever).** Deel A is bewust vereenvoudigd t.o.v.
> de oorspronkelijke werkopdracht (A1–A4: context-afgeleide vragen met twee
> generatoren, spreiding over `vraagsoort`, herkomst-logging per generator). Reden:
> een voorbeeldvraag die een specifiek stuk/agendapunt bij naam noemt zonder dat het
> gekoppeld is, "slaat nergens op"; en wie een vraag over een document heeft,
> gebruikt taakkaart 2 ("Een document doorgronden"), die wél de scope zet. Daarmee
> vervallen de acceptatiecriteria 1/2/3 (echte context, verschillende vraagsoort,
> signaal-vraag) en de bijbehorende koppeling-/scope-machinerie; criterium 6 (nul
> query's) blijft triviaal gehaald (de set is statisch). De eerder gebouwde
> generatoren + koppeling zijn verwijderd.

**Deel B — document doorgronden.** Klik opent een **scherpsteltoestand binnen `/ai`**
(geen route). Eén document (kiezer hergebruikt de bestaande documentzoek-suggestiebron
— één implementatie, criterium 8), vier kiesbare secties, recap, en een start die in
het **gewone chatvenster** landt met een **korte leesbare gebruikersbeurt** (B5).
De samengestelde instructie (koppen per sectie + vaste lengtenorm) wordt **server-side**
opgebouwd uit `core/lib/doorgrond.ts` en in de gebruikersprompt geïnjecteerd; de
zichtbare/gelogde `vraag` blijft de korte zin. De **parameters** (secties,
document-id's, eventuele voorganger, promptvariant) worden vastgelegd in
`governance_log.retrieval_meta.doorgrond` (B6/criterium 13) — meeliftend op de
bestaande chat-logging.

**Vaste lengtenorm, geen lengteknop.** "Kort — ±1 A4" is vast (promptvariant
`doorgrond_v1_kort`); lengte stuur je achteraf met de bestaande vervolgacties
`maak_korter`/`maak_concreter`. Dit halveert de promptmatrix (criterium 14: acht
combinaties). De referentiemockup toonde nog een lengteblok; dat is bewust geschrapt
en de mockup is meegetrokken.

### Besluitpunt 1 — asymmetrie taak 1 vs. taak 2: **convergentie op de roadmap**

Na P2 is "agendapunt voorbereiden" een vaste prompt (3 vaste secties) en "document
doorgronden" een opdracht met kiesbare secties — twee mentale modellen voor "iets
voorbereiden". De asymmetrie wordt **nu geaccepteerd** en als expliciet vervolgpunt
op de roadmap gezet (convergeren: taak 1 later óók kiesbare secties, of taak 2 een
vaste variant). Reden om niet nu te convergeren: taak 1 (agendavoorbereiding, 0071)
is fijn afgestemd en raakt de vergader-AI; convergentie is een eigen tranche waard.

### Besluitpunt 2 — "vorige versie" bij Afwijkingen: **sectie blijft in scope**

Anders dan de werkopdracht als risico benoemde, kent het datamodel **wél** een
sluitende versierelatie: `documenten.vervangt_document_id` (self-FK naar
`documenten(id)`), server-side afgedwongen bij de overgang naar status `vervangen`
(`document-metadata-service.ts`, `document-status-transities.ts`, decision 0022).
"Afwijkingen" is dus selecteerbaar dan-en-slechts-dan als het gekozen document een
niet-lege `vervangt_document_id` heeft; anders uitgegrijsd **mét reden**. Geen
titelheuristiek nodig. Om de vergelijking eerlijk te maken (geen schijnzekerheid)
wordt bij "Afwijkingen" de **voorganger óók in de retrieval-scope** opgenomen
(`document_scope.document_ids = [primair, voorganger]`) — dat is één stuk + zijn
aantoonbare voorganger, niet het uitgestelde "meerdere willekeurige documenten"
(plateau 2c).

### Scope-resolutie — vervallen door de herziening (context-afleiding geschrapt)

> **Achterhaald door de herziening 2026-07-29.** Deze afweging gold voor de
> oorspronkelijke, context-afgeleide Deel A: de werkopdracht noemde als
> signaalbronnen ook een onvervulde `procedure_requirements`-regel en een
> procesfase-weging (A3). Bij verificatie bleek `procedure_requirements` niet in de
> portaalcontext geladen (ophalen = nieuwe query, schendt criterium 6) en kwamen de
> vier fasenamen (beeldvorming/oordeelsvorming/besluitvorming/in_evaluatie) **nergens
> in de code** voor. Met de generieke set is er geen context-afleiding meer, dus deze
> hele resolutie is niet meer van toepassing — de vragen zijn statisch en fondsneutraal.

## Gevolgen

- **Nieuwe pure lagen:** `core/lib/startvragen.ts` + `core/lib/doorgrond.ts` (beide
  met `.sanity.ts`; `npm run sanity` groen). Eén bron van waarheid voor UI, route en
  eval.
- **UI:** `Startpunt.tsx` (hernoemde kaart + inline voorbeeldchips),
  `DocumentDoorgronden.tsx` (nieuw), `AssistentClient.tsx` (scherpstel-state,
  gedeelde documentzoek + voorganger-lookup, doorgrond-/startvraag-parameters in
  `stuurBericht`).
- **Route:** `app/api/chat/route.ts` — body-velden `doorgrond` + `startvraag_bron`,
  breed forceren bij doorgronden, server-side instructiecompositie, uitbreiding
  `RetrievalMeta` (`doorgrond`, `startvraag_bron`).
- **Nieuw AI-gedrag (samengestelde instructies):** volledig gelogd (prompt-parameters
  + output) — conform CLAUDE.md (geen nieuwe AI-functionaliteit zonder logging).
- **Geen migratie, geen RLS-/tenant-impact.** `retrieval_meta` is vrije jsonb;
  `vervangt_document_id` bestaat al; alle reads blijven op de anon-key-RLS-client
  (de voorganger-lookup is fondsgescoped). Append-only audit ongemoeid.
- **Eval:** `evals/document-doorgronden-gedrag.md` (menselijke aftekening 8
  combinaties, criterium 14). AQLab bewust niet gebruikt (ander promptpad, geen
  bruikbaar-ja/nee-oordeel).

## Referenties

- Code: `core/lib/startvragen.ts`, `core/lib/doorgrond.ts`,
  `app/(dashboard)/ai/_components/{Startpunt,AssistentClient,DocumentDoorgronden}.tsx`,
  `app/api/chat/route.ts`, `core/lib/rag.ts` (RetrievalMeta).
- Besluiten: [`0085`](./0085-ai-startpunt-p1-ingang-ipv-leeg-invoerveld.md),
  [`0088`](./0088-ai-scherm-compositie-en-vergader-ai-consistentie.md),
  [`0022`](./0022-increment-P1-generieke-curatie-keuzes.md) (versierelatie),
  [`0071`](./0071-agendavoorbereiding-streaming-en-bronmelding.md) (taak 1).
- Ontwerp: `03 Functioneel ontwerp/Designrichtingen portaal/document-doorgronden.html`
  (normatief; lengteblok verwijderd), `evals/document-doorgronden-gedrag.md`.
