# 0037 — Publieke voorkant fase 1: CSS-scoping en afgeleide bouwkeuzes

- **Status:** Geaccepteerd
- **Datum:** 2026-07-06
- **Betrokkenen:** Merlin (akkoord), Claude (uitvoering)

## Context

Besluit 0035 zette de publieke voorkant op meerpagina en bracht álle publieke
pagina's naar fase 1 (`/`, `/product`, `/voor-wie`, `/sectoren`,
`/sectoren/pensioenfondsen`, `/governance-ai`, `/over-ons`, `/contact`). De
Bouwoverdracht v1.0 en SpoorB v6 leveren de spec. Bij het bouwen bleek de
bestaande `(public)`-implementatie nog de v4-onepager: één lange homepage, geen
navigatie-items, primaire CTA "Plan een demo", en gedeelde marketingcomponenten
(`.flow`, `.steps`, `.blocks`, `.chip`, `.principles`, `.cta-band`) die CSS-scoped
zaten onder `.bp-home`. De subpagina's hebben die componenten óók nodig. Dit
besluit legt de bouwkeuzes vast die tijdens de uitvoering zijn gemaakt en die
niet 1-op-1 in 0035/SpoorB stonden, conform de regel "nieuwe technische keuze
tijdens de bouw → decision-entry, niet stil in code".

Randvoorwaarden: scoped CSS met marketingtokens (0032) blijft leidend, los van de
Tailwind-app; host-model/tenant-isolatie (0029/0030) ongemoeid; contact-datamodel
(0031) ongemoeid; claimdiscipline (SpoorB §12) als buildregel.

## Besluit

1. **Gedeelde CSS-scope `.bp-page`.** Naast `.bp-home` (homepage) en `.bp-doc`/
   `.bp-contact` (tekstpagina's/formulier) komt er een scope `.bp-page` voor de
   nieuwe subpagina's. De herbruikbare marketingcomponenten (sectie-typografie,
   `.flow`, `.steps`, `.blocks`, `.chip`, `.principles`, `.cta-band`, plus de
   nieuwe `.phero`, `.crumb`, `.cmp`, `.duo`, `.pledge`) worden gedeeld via
   `:is(.bp-home, .bp-page)`-selectors, zodat homepage en subpagina's dezelfde
   stijl delen zonder duplicatie. Homepage-eigen secties blijven onder `.bp-home`.
2. **Contactvelden = contract Bouwoverdracht §4, zonder migratie (optie a).** De
   front-end verplicht alleen naam, organisatie, e-mail en type; `bericht` is
   optioneel; `rol`/`telefoon` vervallen uit het formulier. De DB-kolommen
   `rol`/`bericht` zijn `NOT NULL`; bij een lege waarde slaan we `''` op (een lege
   string voldoet aan `NOT NULL`). Geen migratie, geen RLS-wijziging.
3. **App-host-lek dichtgezet.** De nieuwe publieke paden worden in
   `lib/platform-host.ts` als één set gedeeld: op de marketing-surface staan ze in
   de allowlist, op de app-surface geven ze `404` (net als `/home` al deed), zodat
   marketingpagina's niet op `app.bestuurdersportaal.com` lekken.
4. **Harde poort `/sectoren/pensioenfondsen`.** De pagina wordt gebouwd maar staat
   bewust **niet** in de marketing-allowlist en **niet** in de sitemap tot de
   feitelijke pensioen-validatie akkoord is. Tot dat moment geeft het pad `404` op
   de marketing-host — een technische borging van de gate uit 0035.

## Overwogen alternatieven

- **Componenten-CSS dupliceren per scope** — verworpen: onderhoudslast en
  drift-risico; `:is()` houdt één bron van waarheid.
- **Subpagina's op `.bp-home` laten draaien** — verworpen: semantisch onjuist en
  homepage-specifieke secties zouden meelekken.
- **`bericht`/`rol` echt nullable maken via migratie (optie c)** — verworpen voor
  fase 1: onnodige schema-wijziging voor een marketingformulier; lege string is
  functioneel afdoende. Kan later alsnog als het datamodel opgeschoond wordt.
- **Pensioenpagina helemaal niet bouwen tot validatie** — verworpen: bouwen mag
  vooruit (0035); alleen publicatie is gepoort. Zo is de pagina review-klaar.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. `contact_aanvragen` blijft deny-by-default;
  insert via service-role in `/api/contact` ongemoeid. Host-routing blijft
  defense-in-depth, geen autorisatie.
- **Datamodel/migraties:** geen migratie. `rol`/`bericht` krijgen `''` bij leeg.
  Gevolg voor de back-office (`/platform/contact`): deze twee velden kunnen nu
  leeg (lege string) binnenkomen; dat is bewust geaccepteerd.
- **Audit/reproduceerbaarheid:** n.v.t. (publieke marketing, geen besluitlogica).
- **Gebruikers-/beheerervaring:** consistente styling over homepage en
  subpagina's; kortere, contractconforme contactformulier.
- **Bewust geaccepteerde schuld:** lege strings i.p.v. `NULL` voor `rol`/`bericht`;
  op te ruimen bij een eventuele datamodel-schoonmaak.

## Referenties

- `decisions/0035-publieke-voorkant-richtingsbesluit-meerpagina.md`
- `decisions/0029` (host-indeling), `0031` (contact-opslag), `0032` (styling)
- `04 Technische inrichting/Bouwoverdracht-publieke-voorkant-fase1-v1.0.md`
- `04 Technische inrichting/SpoorB-SEO-migratie-en-developer-overdracht-v6.md`
- `lib/platform-host.ts`, `app/(public)/public.css`, `app/api/contact/route.ts`,
  `lib/contact-validatie.ts`
</content>
</invoke>
