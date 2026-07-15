# 0072 — Scenario A live web-retrieval: whitelist, retrievalgedrag en platform-beheerscherm

- **Status:** Geaccepteerd
- **Datum:** 2026-07-15
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder + compliance-akkoord), Claude (uitvoering/advies)
- **Relatie:** effectueert het voorstel uit [`0019`](./0019-scenario-a-live-web-retrieval.md) (Scenario A, Route 1); bouwt op [`0018`](./0018-increment-h-zoekmodule-en-i3-bronvermelding.md) (I-3 uniform bronmodel, Scenario B) en [`0021`](./0021-platformfundament-P0-keuzes.md)/[`0026`](./0026-p2-light-p4-light-en-vier-ogen-deferral.md) (platformfundament, vier-ogen). Leidend ontwerp: [`AI-WEBRETRIEVAL-ONTWERP.md`](../AI-WEBRETRIEVAL-ONTWERP.md).

## Context

De AI-assistent draait in **Scenario B**: geen live web-retrieval. Antwoorden over wet-/toezicht-/Wtp-actualiteit steunen op statische modelkennis met een kennis-cutoff; de UI toont daarom "Er is geen live web-retrieval actief; controleer bij formele besluitvorming de genoemde instantie zelf". `0019` analyseerde de overstap naar **Scenario A** (live opgehaalde webbronnen) en beval **Route 1** aan: Anthropic's server-side `web_search`-tool met ingebouwde `allowed_domains`-whitelist. De plumbing (het `web`-brontype in `core/lib/assistant-source.ts`, de vlag `web_retrieval_actief`, het voorbereide webbronnenblok in `OnderbouwingPaneel.tsx` en de `TODO(web-retrieval — Scenario A)`-seams in `app/api/chat/route.ts`) is sinds I-3 al aanwezig maar leeg.

Randvoorwaarden die meewegen: **anti-fabricage** (een bron wordt alleen getoond als de app hem daadwerkelijk ophaalde — KERNBESLUIT in `assistant-source.ts`), **bronvertrouwen** (herbruik van het bestaande `normgewicht`, geen parallel tier-veld), **prompt-injection** (opgehaalde webinhoud als data, gesandboxed), **AVG** (de uitgaande zoekvraag richting een externe provider), **append-only audit**, en **platform-/tenant-scheiding** (de whitelist is generieke platformconfiguratie).

## Besluit

We activeren **Scenario A via Route 1** (Anthropic `web_search`-tool), begrensd tot een **beheerde whitelist van gezaghebbende domeinen** die als platformconfiguratie in de database leeft (`bron_whitelist`, `fonds_id IS NULL`, read-only voor tenants, curatie via de platform-back-office). De DB-whitelist wordt per request naar `allowed_domains` vertaald; teruggekomen citaties worden **opnieuw** tegen de whitelist geverifieerd (defense-in-depth: dwingt `matchtype`/`padprefix` af en koppelt het `normgewicht`). Bronvertrouwen wordt gewogen op het **bestaande `normgewicht`**. AVG wordt geborgd door **live web-retrieval te blokkeren zodra de vraag persoonsgegevens bevat** (terugval op RAG/modelkennis), met logging van de keuze. Het beheerscherm hoort in de **platform-beheermodule** (capability `platform.config.manage`, **optioneel vier-ogen** met compenserende controls).

## Overwogen alternatieven

- **Route 2 — eigen zoek-/fetch-pijplijn (Brave/Bing + eigen extractie).** Volledige controle over caching/retentie/logging, maar weken meer bouw- en onderhoudswerk en het herbouwt wat Route 1 kant-en-klaar levert (zoeken + verplichte citaties + domeinfiltering). Niet gekozen als start; blijft de fallback als compliance een eigen retentielaag eist die Route 1 niet biedt.
- **Open web-retrieval (Tier-loos).** Bewust afgewezen in `0019`: maximaal aanvalsoppervlak en fabricagerisico, geen bronvertrouwen. Blijft uitgesloten.
- **AVG: zoekvraag schonen i.p.v. blokkeren.** Behoudt actualiteit vaker, maar bij Route 1 genereert het model de zoekquery zelf — schonen is niet waterdicht. Blokkeren is AVG-veiliger; gekozen.
- **Parallel tier-veld voor weging.** Afgewezen: `normgewicht` (`bindend`/`toezichtverwachting`/`sector_guidance`/`informatief`) bestaat al en voedt de weging (`weegBronsoort`-patroon). `tier`/`categorie` blijven puur beheerlabels.
- **Vier-ogen verplicht op activatie.** Increment P eist vier-ogen op *zware* capabilities; `platform.config.manage` is bewust niet-zwaar. Merlin koos optioneel vier-ogen (klein beheerdersteam) met compenserende controls (harde domeinvalidatie + notificatie aan overige beheerders + append-only log). Te bekrachtigen door compliance.

## Gevolgen

- **Datamodel/migraties:** nieuwe tabel `bron_whitelist` (generiek, `fonds_id IS NULL`) + append-only `bron_whitelist_log` (immutability-triggers + sha256-keten, patroon `document_metadata_log`). RLS: SELECT op actieve entries voor elke ingelogde gebruiker (de chat-route draait als tenant anon+RLS en bouwt hieruit `allowed_domains`), schrijven alleen via service-role achter `withPlatform`. Migratie-eerst-dan-deploy.
- **RLS/tenant-isolatie:** whitelist is generiek en read-only voor tenants; curatie loopt uitsluitend via de platform-surface (service-role + capability + audit). Geen tenant-lek.
- **Audit/reproduceerbaarheid:** retrieval-provenance (bevraagde domeinen, gebruikte webbronnen + normgewicht, ophaaltijdstip, fallback-status, PII-keuze) landt in het bestaande `governance_log.retrieval_meta` — géén tweede logmechanisme. Whitelist-wijzigingen via `platform_event_log` + `bron_whitelist_log`.
- **Gebruikers-/beheerervaring:** de bestuurder ziet geraadpleegde webbronnen (URL + titel + ophaaldatum + normgewicht) gescheiden van fondsbronnen; bij tijdgevoelige info blijft "verifieer bij de instantie zelf" zichtbaar. Platformbeheerders krijgen een curatie-scherm met domeinvalidatie, review-signalering en een test-knop.
- **Bewust geaccepteerde schuld / openstaand vóór productie:** (1) web_search moet op het Anthropic-account/-contract zijn aangezet en de **EU-dataresidentie** geborgd (sluit aan op `0064`); (2) de **normgewicht-mapping** van de startset en het **eigenaarschap/review-ritme** van de whitelist moeten door compliance worden bekrachtigd; (3) de **time-out-drempel** (voorstel 5–8 s) bepaalt FR-7. De **vergelijkende multi-fonds functionaliteit** (peer-corpus) is bewust buiten scope — zie `AI-WEBRETRIEVAL-ONTWERP.md` §Vervolg.

## Referenties

- Leidend ontwerp: [`AI-WEBRETRIEVAL-ONTWERP.md`](../AI-WEBRETRIEVAL-ONTWERP.md)
- Voorstel: [`0019`](./0019-scenario-a-live-web-retrieval.md); bronmodel: [`0018`](./0018-increment-h-zoekmodule-en-i3-bronvermelding.md)
- Code: `core/lib/assistant-source.ts`, `core/lib/bronsoort.ts`, `core/lib/web-whitelist.ts`, `core/lib/pii-gate.ts`, `core/lib/rag.ts`, `app/api/chat/route.ts`, `core/lib/generatie-kern.ts`, `app/(dashboard)/ai/_components/OnderbouwingPaneel.tsx`
- Migratie: `supabase/migrations/2026_07_15_bron_whitelist.sql`
- Beheerscherm: `app/(platform)/platform/(beveiligd)/bronnen-whitelist/`
- Platform: `platform/lib/platform-capabilities.ts` (`platform.config.manage`), `platform/lib/platform-wrapper.ts`, `platform_event_log`
