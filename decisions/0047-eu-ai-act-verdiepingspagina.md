# 0047 — EU AI Act als verdiepingspagina onder /governance-ai

- **Status:** Geaccepteerd
- **Datum:** 2026-07-09
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

De EU AI Act is bestuurlijk relevant en komt in gesprekken met fondsbesturen
steeds vaker langs. De vraag was hoe het portaal daarop inhaakt zonder de
positionering te verschuiven. Het contentplan "EU AI Act en verantwoord
AI-gebruik" (v1.0, definitief) legt de lijn vast: de EU AI Act is een
*versterking* van de bestaande governance-propositie, geen zelfstandig
juridisch-compliance-onderwerp. Het portaal verkoopt geen wetgevingsadvies; het
maakt aannemelijk dat verantwoord AI-gebruik in de bestuurspraktijk navolgbaar
is, met het oordeel altijd bij het bestuur.

Randvoorwaarden die meewogen: geen nieuw hoofdmenu-item (de verdieping hangt
onder de bestaande `/governance-ai`, conform het richtingsbesluit 0035 dat het
aantal top-level pagina's bewust beperkt houdt); strikte claimdiscipline (alleen
Live/Beperkt-live-claims uit het §6-claimregister van het contentplan, géén
absolute uitspraken als "EU AI Act compliant", "juridisch geborgd" of
"voldoet aan DNB/AFM"); host-model en allowlist-borging (0029/0037) ongemoeid.

## Besluit

De EU AI Act-content wordt gepubliceerd als één verdiepingspagina op
`/governance-ai/eu-ai-act`, ontsloten vanuit de bestaande governance-pagina en
de homepage-teaser — **geen** nieuw navigatie-item. Een korte deelbare alias
`/ai-act` redirect permanent (308) naar de canonieke URL. De pagina claimt
uitsluitend wat in het §6-claimregister als Live/Beperkt-live staat; menselijk
oordeel blijft expliciet leidend.

## Overwogen alternatieven

- **EU AI Act als eigen hoofdmenu-item** — verworpen: verschuift de
  positionering naar compliance-aanbieder en verbreekt de beperkte top-level
  navigatie van 0035. De verdieping onder governance houdt de boodschap
  "versterking van dezelfde uitgangspunten" intact.
- **Absolute compliance-claims voeren ("EU AI Act compliant")** — verworpen:
  in strijd met de claimdiscipline; niet waarmaakbaar en bestuurlijk risicovol.
  Alleen brongebonden, verifieerbare formuleringen.
- **`/ai-act` in de marketing-allowlist opnemen** — niet nodig: redirects
  draaien vóór de middleware (volgorde headers → redirects → middleware →
  rewrites), dus de redirect vuurt al voordat de allowlist-check wordt bereikt.
  De alias hoeft daarom niet in `MARKETING_PUBLIEKE_PADEN`.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. Publieke marketingpagina, geen
  besluitlogica, geen datamodel-impact.
- **Routing:** `/governance-ai/eu-ai-act` toegevoegd aan
  `MARKETING_PUBLIEKE_PADEN` (`lib/platform-host.ts`) — `door` op de
  marketing-surface, `404` op de app-surface (geen marketing-lek, tegenhanger
  REQ-PV-050/051). Sitemap-entry toegevoegd (prio 0.7). `/ai-act`-redirect in
  `next.config.ts` (permanent 308, deelt SEO-signaal met de canonieke URL).
- **Audit/reproduceerbaarheid:** n.v.t. (marketing).
- **Gebruikers-/beheerervaring:** governance-verhaal krijgt een bestuurlijk
  relevante verdieping zonder de navigatie te verbreden; homepage- en
  governance-teaser leiden ernaartoe.
- **Bewust geaccepteerde schuld:** geen. Claimregister blijft de buildregel;
  bij nieuwe claims moet het register worden bijgewerkt vóór publicatie.

## Referenties

- `decisions/0035-publieke-voorkant-richtingsbesluit-meerpagina.md`
- `decisions/0037-publieke-voorkant-fase1-bouwkeuzes.md`
- `Archief/Bestuurdersportaal - Contentplan EU AI Act en verantwoord AI-gebruik v1.0 (uitgevoerd - verwerkt in code + besluit 0047).md` (§6 claimregister, §11 webcopy — gearchiveerd na uitvoering)
- `app/(public)/governance-ai/eu-ai-act/page.tsx` (nieuw)
- `app/(public)/governance-ai/page.tsx`, `app/(public)/home/page.tsx` (teasers)
- `lib/platform-host.ts`, `app/sitemap.ts`, `next.config.ts`
