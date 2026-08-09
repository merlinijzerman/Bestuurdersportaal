# 0149 — Service-role afschrift-worker (jobmodel) en de gezichtshoek

- **Status:** Geaccepteerd
- **Datum:** 2026-08-09
- **Betrokkenen:** Merlin IJzerman (bouwmodelkeuze), Claude Code

## Context

T6 bouwt de afschrift-bundel via het **volledige jobmodel** (opdrachtgeverkeuze): de enqueue-route zet een rij op `status='bezig'`, een cron-gedrainde worker bouwt de zip. Ontwerpbeslissing 3 van het ticket schreef voor "bouw met de RLS-client van de gebruiker — nooit service-role", zodat de bundel het dossier bevat "zoals ⟨rol⟩ het kon zien". Een achtergrondworker heeft echter geen gebruikerssessie en kan die RLS-client niet gebruiken. Dit is een reëel conflict tussen de jobmodelkeuze en ontwerpbeslissing 3.

## Besluit

De afschrift-worker draait onder **service-role** (zoals de ingest-worker, uitsluitend in het beheer-project — variant C, besluit 0066). Hij scoopt in **code** expliciet op de `fonds_id` en `procedure_id` van de afschrift-rij bij élke query en storage-download. Ontwerpbeslissing 3 wordt hiermee geamendeerd: de gezichtshoek is *fonds + rol*, niet per-individu.

## Overwogen alternatieven

- **Synchroon bouwen onder de user-RLS-client** (de ticket-default) — geen service-role nodig, maar de opdrachtgever koos bewust het jobmodel voor opschaalbaarheid; verworpen.
- **Worker met een geïmiteerde user-JWT** — zou RLS behouden, maar vereist het minten/bewaren van gebruikers-tokens in een machineproces: een groter aanvalsoppervlak dan een gescope­te service-role. Verworpen.

## Gevolgen

- **RLS/security:** de worker omzeilt RLS; de tenant-grens leunt op de expliciete `fonds_id`-scoping in `afschrift-orchestrator.ts` (defense-in-depth: enqueue valideert toegang + bureau-gate vóórdat de rij ontstaat). In dit schema bestaat geen per-gebruiker-document-RLS, dus de gezichtshoek is in de praktijk *fonds + rol*; de reden `geen_toegang` blijft grotendeels theoretisch.
- **Gezichtshoek benoemd:** manifest én leeswijzer §6 stellen expliciet "dossier zoals ⟨rol⟩ het op ⟨datum⟩ kon inzien". Voor auditdoeleinden is die vaste lens een kwaliteit — mits benoemd.
- **Kolombevriezing:** de tabel heeft een `BEFORE UPDATE`-freeze-trigger die user-sessies tot `ingetrokken_*` beperkt; de service-role-worker (`auth.uid() IS NULL`) mag de resultaatvelden wél schrijven.

## Referenties

- Werkopdracht T6 v1.0, ontwerpbeslissing 3/7. Besluiten 0065 (service-role-RPC's), 0066 (variant C). `platform/lib/afschrift-orchestrator.ts`, `app/api/internal/afschrift-worker/route.ts`. [[0146-afschrift-als-vastgelegd-record]].
