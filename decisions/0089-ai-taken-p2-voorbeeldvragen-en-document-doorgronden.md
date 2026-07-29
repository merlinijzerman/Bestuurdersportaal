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

**Deel A — voorbeeldvragen.** Een pure vragenpool (`core/lib/startvragen.ts`) met
twee generatoren (`context`, `signaal`) vult kandidaten; een selectieregel toont er
**maximaal drie, elk van een verschillende `vraagsoort`** (Antwoordmodus), met de
signaalvraag bovenaan. Alles uit de **al geladen** portaalcontext — **nul nieuwe
query's** (criterium 6). Chips renderen inline op de lege staat van `/ai` (patroon
`STARTVRAGEN` in `AgendapuntChat`), niet als apart scherm. Een klik start de vraag
meteen en logt de herkomst-`bron` in `governance_log.retrieval_meta.startvraag_bron`
(criterium 4) — **geen nieuwe tabel, geen nieuw `governance_events`-type**.

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

### Scope-resolutie — `signaal`-generator en fase-weging begrensd tot geladen data

De werkopdracht noemde als signaalbronnen ook een onvervulde
`procedure_requirements`-regel, en een procesfase-weging (A3). Bij verificatie bleek:
- `procedure_requirements` is **niet** in de portaalcontext geladen; ophalen zou een
  nieuwe query zijn en schendt criterium 6.
- De vier fasenamen (beeldvorming/oordeelsvorming/besluitvorming/in_evaluatie) komen
  **nergens in de code** voor en zijn niet geladen.

Daarom gebruikt de `signaal`-generator in dit plateau **uitsluitend** de twee wél
geladen signalen (agendapunt zonder eigen inbreng, naderende deadline op de
eerstvolgende processtap) — genoeg voor criterium 3 (OR-formulering). Fase-weging en
de requirement-signaalvariant zijn **gedeferd** (vervolgpunt), niet benaderd met een
gok — conform "geen schijnzekerheid".

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
