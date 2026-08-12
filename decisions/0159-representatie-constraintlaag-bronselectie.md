# 0159 — Representatie-constraintlaag in de chunkselectie (Epic bronselectie, T1)

- **Status:** Geaccepteerd
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin IJzerman (opdrachtgever), Claude Code (uitvoering); compliance (her-accordering meetset — openstaand)

## Context

De AI-assistent selecteerde bronnen als één gepoolde ranking met een vaste afkap (`maxResults = 8`, `maxPerDoc`). Onder een als "generiek" geclassificeerde vraag drukt de bronsoort-weging (`weegBronsoort`) fondsdocumenten categorisch naar achteren, waarna ze onder de afkap vallen. Gemeten casus (beslisnotitie v0.4, Deel A): een "partnerbegrip × wettelijke toets"-vraag leverde 7 generieke citaties en **0 fondsbronnen**. Er was geen mechanisme dat een minimumrepresentatie per bibliotheek/bron garandeert; de classificatie was zélf de beoogde oplossing en dat is te fragiel.

Randvoorwaarden: de selectie-helpers zijn puur en deterministisch (geen Supabase), tenant-isolatie loopt vóór deze laag via `handhaafFondsdiscipline`, en elke gedragswijziging op retrieval moet terugdraaibaar zijn (bisectiebeleid) en meetset-first aan compliance worden voorgelegd.

## Besluit

Introduceer een deterministische **representatie-constraintlaag** (`selecteerMetConstraints`) die gegarandeerde minima per bibliotheek/bron haalt *vóór* de budget-afkap, aangestuurd door constraints die uit het `bronsoortprofiel` worden afgeleid (`constraintsVoorProfiel`). De classificatie stuurt zo de constraints aan; de constraints doen het werk. De laag staat achter feature-flag `REPRESENTATIE_CONSTRAINTS` (env + per-fonds), **default uit = exact het huidige gedrag**.

Afleiding: `generiek`/undefined → `fondsMin 0` (geen quotum) · `fonds` → `fondsMin 1` · `gecombineerd` → `fondsMin 1 + generiekMin 1` · `vergelijking` → `perSourceMin q` (parameter voorbereid, toepassing in T5).

Expliciete bewerkingsvolgorde, vastgelegd in code + comment: `filters → weging (bronsoort) → [gereserveerd: regime-demotie, T4] → representatie-constraints → dedup → budget-afkap (maxTotal/maxPerSource)`.

## Overwogen alternatieven

- **Classifier-verfijning als enige oplossing** — verworpen als losstaande fix: een betere classificatie kiest weliswaar de juiste modus, maar zonder representatie-mechanisme kan de bronsoort-weging fondsdocs nog steeds onder de afkap duwen. De classifier-verfijning is gepaird als **T2**; T1 levert het mechanisme, T2 kiest de juiste constraints. Pas T1 + T2 samen lossen de partnerbegrip-casus end-to-end op.
- **Harde quota in de zoek-RPC (`p_bronsoort`)** — verworpen: dat sluit een bronsoort categorisch uit i.p.v. een minimum te garanderen, en verplaatst deterministische, testbare logica naar SQL zonder DB-loze sanity.
- **`selecteerChunks` uitbreiden i.p.v. een nieuwe functie** — verworpen: de nulminima-tak moet bit-identiek blijven aan het huidige gedrag; een aparte functie houdt dat bewijsbaar en laat de flag-uit-toestand ongemoeid.
- **`perSourceMin` nu al toepassen** — bewust beperkt: het mechanisme is generiek geïmplementeerd en getest, maar de afleiding zet het pas in de vergelijkmodus (T5) aan. Default 0 → volledig inert.

## Gevolgen

- **Geen RLS-/tenant-impact.** Pure TS-selectielaag ná retrieval; geen DB-toegang, geen service-role, geen policy/grant/`SECURITY DEFINER`-wijziging. `handhaafFondsdiscipline` draait ongewijzigd vóór deze laag.
- **Geen migratie.** De per-fonds vlag werkt via een gewone `fonds_feature_flags`-rij (`representatie_constraints`); `flag_key` is een vrij tekstveld zonder CHECK-allowlist. Globaal via env `REPRESENTATIE_CONSTRAINTS=on`.
- **Auditlog nog niet uitgebreid.** Kandidatenset + actieve constraints + drop-reden in `retrieval_meta` is bewust **T3** (apart vervolgticket). Append-only-garanties onaangeroerd.
- **Regime-plek vrijgehouden.** De bewerkingsvolgorde reserveert expliciet een positie vóór de constraints voor regime-demotie (**T4**).
- **Faalt nooit.** Onhaalbaar minimum (te weinig kandidaten) → de selectie gaat door met wat er is, nooit een exception. Signalering volgt in T3.
- **Terugdraaibaar** via de flag; nulminima reproduceren `selecteerChunks` exact (geborgd in sanity).
- **Nog niet productie-actief.** Flag-off, dus geen gedragswijziging in productie tot compliance de meetset-nulmeting + het gewijzigde retrievalgedrag heeft geaccordeerd (meetset-first).

## Referenties

- Code: `core/lib/rag-select.ts` (`RepresentatieConstraints`, `selecteerMetConstraints`), `core/lib/weeg-bronsoort.ts` (`constraintsVoorProfiel`, `RepresentatieProfiel`), `core/lib/rag.ts` (`weegEnSelecteer`, `RetrievalOpties`), `core/lib/fonds-config.ts` (`representatie_constraints`-vlag). Commit `b2740af` (2026-08-12, `main`).
- Sanity: `rag-select` (quota-cases, nulminima ≡ `selecteerChunks`), `weeg-bronsoort` (afleiding per profiel).
- Nulmeting: `core/lib/bronkeuze-meetset.ts` → `BRONKEUZE_NULMETING_T1` (14 "begrip × wettelijke toets"-vragen; her-accordering openstaand).
- Ontwerp: `RAG-VERBETERING-ONTWERP.md` (Fase 5). Bron: beslisnotitie bronselectie v0.4, Deel A + C.
- Vervolg: T2 (classifier, gepaird), T3 (auditlog), T4 (regime), T5 (vergelijkmodus op `perSourceMin`).
