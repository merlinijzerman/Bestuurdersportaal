# 0162 — Regime-borging: demotie van niet-geldend wettelijk regime (Epic bronselectie, T4)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering); compliance (bevestiging mapping + juridisch eigenaar generieke bibliotheek — openstaand)

## Context

De retrieval behandelde alle wetgeving als top-autoriteit. Er was geen regime-facet; `organisatietype` is vrije tekst en context-only. Daardoor haalt de assistent de Pensioenwet (PW) als geldend recht op voor een fonds dat onder de Wet verplichte beroepspensioenregeling (Wvb) valt (beroepspensioenfonds). Besluit [0159](0159-representatie-constraintlaag-bronselectie.md) (T1) hield hiervoor expliciet een plek vrij in de bewerkingsvolgorde: `… → weging (bronsoort) → [gereserveerd: regime-demotie, T4] → representatie-constraints → …`.

Randvoorwaarden: de software mag de **juridische kwalificatie niet zelf vaststellen**; die moet uit gestructureerde, door compliance beheerde data komen. Geen harde uitsluiting van een regime (dat zou een legitiem extern kader onbereikbaar maken). Gedrag terugdraaibaar (bisectie). Geen schijnzekerheid: alleen wat zeker is (beroepspensioenfondsen → Wvb, overige → PW) wordt als data vastgelegd, gemarkeerd als "door compliance te bevestigen".

## Besluit

Introduceer een **demoterende** regime-weging (`lib/weeg-regime.weegRegime`) op de gereserveerde plek: ná de bronsoort-weging, vóór de representatie-constraints. Chunks met een **tegengesteld, specifiek** regime (PW als het fonds Wvb is, of andersom) zakken naar onderaan; `beide`/`algemeen`/`NULL` (cross-cutting) worden **nooit** gedemoveerd. Geen harde uitsluiting: een gedemoveerd regime blijft als **aanvullend extern kader** beschikbaar.

Gedreven door beheerde data, niet door code:
- Documentfacet `documenten.wettelijk_regime` (`pw`/`wvb`/`beide`/`algemeen`; `NULL ≡ algemeen`), gedenormaliseerd naar `document_chunks` via `fn_chunk_denorm*` en teruggegeven door beide zoek-RPC's (return-only, **geen** WHERE-filter).
- Fonds-velden `fondsen.fondstype` + `fondsen.primair_wettelijk_regime` (compliance/platform-beheerd, **niet** tenant-writable — daarom op `fondsen`, niet op het tenant-zelfservice `organisatie_profielen`, besluit 0039). De retrieval leest `primair_wettelijk_regime`.
- Reference-tabel `wettelijk_regime_per_fondstype` legt de mapping fondstype → regime **expliciet in data** vast (compliance-eigenaar; seed = voorstel, `bevestigd_door_compliance` per rij).

Prompt-blok **B6** (`lib/organisatieprofiel.bouwRegimeKaderBlok`, in het dynamische — ongecachte — contextblok, nooit in de gepinde toon-systeemprompt): labelt een bron uit een niet-geldend regime als "[extern kader — niet geldend recht voor dit fonds]", **zonder** verplichte verificatievraag.

**Flag `REGIME_WEGING` default AAN** (env + per-fonds via `RetrievalOpties.regimeWeging`). Bewust anders dan de default-uit van T1: default-aan is hier gedrag-neutraal omdat (a) de ~104 generieke documenten nog geen `wettelijk_regime` dragen (`NULL ≡ algemeen` → geen demotie; curatie-tagging is out of scope) en (b) `weegRegime` no-opt op een fonds zonder specifiek regime. De demotie gaat pas "bijten" zodra compliance documenten als `pw`/`wvb` tagt — dan is het mechanisme al gedeployed en getest. Zet `REGIME_WEGING=off` om uit te zetten.

## Overwogen alternatieven

- **Harde uitsluiting van niet-geldend regime (RPC-WHERE)** — verworpen: sluit een legitiem extern/vergelijkend kader categorisch uit en verplaatst testbare logica naar SQL. De demotie is een pure, DB-loze herordening (spiegelt `weegBronsoort`).
- **Regime afleiden uit `fondstype` in code** — verworpen: dan stelt de software de juridische kwalificatie zelf vast. De kwalificatie leeft in data (`primair_wettelijk_regime` per fonds + de reference-mapping).
- **Velden op `organisatie_profielen`** — verworpen: dat is tenant-zelfservice (0039); het geldende regime mag niet door de tenant zelf muteerbaar zijn.
- **Prompt-blok met verplichte verificatievraag** (zoals de organisatieprofiel-CONFLICTREGEL) — verworpen voor B6: dat zou elke regime-rakende vraag vertragen. De labeling volstaat.
- **Flag default UIT** — overwogen (spiegelt 0159), maar niet gekozen: met lege facetdata is default-aan al gedrag-neutraal, en het mechanisme schakelt vanzelf scherp zodra de mapping-data er is.

## Gevolgen

- **Migratie** `2026_08_12_t4_regime_borging.sql` (+ ROLLBACK): facet + denorm-kolom + `fn_chunk_denorm*`-uitbreiding + `fondsen`-velden + reference-tabel + Horizon-seed (`primair_wettelijk_regime='pw'`) + beide zoek-RPC's krijgen `wettelijk_regime` in de return (drop-and-recreate, ACL-hygiëne herhaald). Idempotent; EERST in Supabase, DÁN code-deploy.
- **RLS/tenant.** Denorm-kolom erft de bestaande `document_chunks`-policies. De `fondsen`-velden en de reference-tabel zijn fonds-/codelijst-niveau (geen PII); reference-tabel leesbaar voor `authenticated` (using true), schrijven alleen via service-role, `anon` nergens. Structurele gates (F+H, ACL na RPC-drop) draaien.
- **Audit.** Regime-curatie op `documenten` werkt via `document_metadata_log` (bestaand patroon) en de `trg_chunk_denorm_refresh`-trigger spiegelt naar de chunks. Uitgebreide `retrieval_meta`-logging van de demotie zelf is nu minimaal (de bestaande selectie-diagnostiek attribueert een enkel door de weging afgevallen chunk op reden "weging").
- **Prompt.** B6 rijdt op het dynamische contextblok — de gepinde `dyn_block`- en toon-hashes (`generatie-kern.sanity.ts`) blijven groen (geverifieerd).
- **Governance-gate (openstaand).** De juridische mapping (`fondstype → regime`, en per-documenttype-kwalificatie) én de exacte Horizon-`fondstype` zijn door **compliance** te bevestigen. T4 levert het mechanisme + de seed als voorstel; de kwalificatie is een data-beslissing.
- **Out of scope.** De handmatige regime-tagging van de ~104 bestaande generieke documenten (aparte curatie-actie).
- **Terugdraaibaar** via `REGIME_WEGING=off` (weging) en de ROLLBACK-migratie (data/RPC's).

## Referenties

- Code: `core/lib/weeg-regime.ts` (`weegRegime`, `isExternKaderVoorFonds`, `Regime`), `core/lib/rag.ts` (`weegEnSelecteer` regime-tak, `RetrievalFilters.primairRegime`, `RetrievalOpties.regimeWeging`), `core/lib/organisatieprofiel.ts` (`bouwRegimeKaderBlok`), `core/lib/generatie-kern.ts` (`BestuurderContext.regimeKader`, `bouwDynamischeContext`), `app/api/chat/route.ts` (fondsregime → filter + B6).
- Migratie: `supabase/migrations/2026_08_12_t4_regime_borging.sql` (+ ROLLBACK).
- Sanity: `core/lib/weeg-regime.sanity.ts` (demotie, no-op bij cross-cutting/leeg regime, stabiliteit); `core/lib/generatie-kern.sanity.ts` (dyn_block/toon-hashes ongewijzigd).
- Voorganger: besluit [0159](0159-representatie-constraintlaag-bronselectie.md) (T1 — gereserveerde plek). Ontwerp: `RAG-VERBETERING-ONTWERP.md`. Bron: T4-epic (beslisnotitie bronselectie, Deel B).
