# 0177 — `app.*` blijft Productie; Preview en Preview-beheer komen ernaast

- **Status:** Geaccepteerd
- **Datum:** 2026-08-14
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Codex (uitvoering/advies)
- **Relatie:** herziet [`0175`](./0175-preview-productie-scheiding.md) voor de rol
  van `app.bestuurdersportaal.com` en [`0176`](./0176-fondsgerichte-preview-tenants.md)
  voor de generieke Preview-host. De overige eisen aan Preview-isolatie en
  fondsgerichte Preview-tenants blijven gelden.

## Context

`app.bestuurdersportaal.com` is al met gebruikers gedeeld en fungeert als de
bestaande Productie-/Horizonlogin. Verhuizing naar Preview zou bestaande links
en verwachtingen breken. De fondsgerichte Productiedomeinen bestaan daarnaast
al. De generieke Productielogin voor meerdere fondsen wordt later afzonderlijk
ontworpen; de huidige host↔fondsgrens laat terecht niet toe dat één app-host
tegelijk naar meerdere fondsen resolveert.

De huidige Supabase bevat Productie-Auth, data en Storage. Preview moet dezelfde
techniek en configuratiemogelijkheden testen zonder die Productie-inhoud of
secrets te delen. De platform-/beheersurface gebruikt bovendien een service-role
en vereist daarom dezelfde harde omgevingsscheiding.

## Besluit

1. `app.bestuurdersportaal.com` blijft Productie en blijft aan de bestaande
   Horizon-/legacytenant gekoppeld. De algemene marketing-`/login` mag voorlopig
   zijn bestaande redirect naar `app.*` behouden.
2. De generieke Preview verhuist naar
   `app.preview.bestuurdersportaal.com`. Fondsgerichte Preview-hosts blijven
   `<slug>.preview.bestuurdersportaal.com`.
3. `horizon.bestuurdersportaal.com` blijft volledig uitgefaseerd.
4. De huidige Supabase blijft Productie. Er komt een afzonderlijk project
   `bestuurdersportaal-preview` in dezelfde regio, opgebouwd uit dezelfde
   migraties plus een omgevingsspecifieke, gesaneerde Preview-seed.
5. Alleen schema, RLS/RPC/Storage-structuur en allowlisted fondsconfiguratie
   worden overgenomen. Auth-gebruikers/sessies, Productiedocumenten, chunks,
   embeddings, governance-/gespreks-/auditinhoud, Storage-objecten en secrets
   worden niet gekopieerd.
6. `beheer.bestuurdersportaal.com` beheert uitsluitend Productie.
   `beheer.preview.bestuurdersportaal.com` wordt een afzonderlijke interne
   Preview-surface met alleen de Preview-service-role en verplichte AAL2/MFA.
   Geen van beide beheersurfaces krijgt cross-environment-rechten.
7. Applicatie-e-mail en contactnotificaties vallen buiten deze fase. Preview
   krijgt geen Mailgun-/notifyconfig; testaccounts worden voorlopig handmatig
   aangemaakt. Bestaande Productie-Auth-mailinstellingen worden niet gewijzigd.
8. Codex voert de Vercel- en Supabase-inrichting zoveel mogelijk uit via de
   ingelogde beheerinterfaces. Preview-projectkeys worden eenmalig rechtstreeks
   in de juiste Vercel-environment geplaatst zonder weergave of opslag in git.
9. Supabase projectkeys zijn vanaf het begin Preview-specifiek; een Productie-
   service-role/JWT-secret wordt nooit tijdelijk hergebruikt. AI-keys mogen als
   tijdelijke Preview-key worden ingericht, mits Preview-scoped waar mogelijk en
   later aantoonbaar geroteerd.

## Overwogen alternatieven

- **`app.*` alsnog Preview maken.** Afgevallen wegens bestaande gedeelde
  Productielinks en onnodige gebruikersimpact.
- **De huidige Supabase Preview maken en Productie opnieuw bouwen.** Afgevallen:
  dit verplaatst Auth, wachtwoorden, Storage en live data zonder functionele winst
  en vergroot het cutoverrisico.
- **Productie-Supabase volledig klonen inclusief data.** Afgevallen voor externe
  Preview: onnodige kopie van gevoelige inhoud en accounts.
- **Eén beheerhost voor beide omgevingen.** Afgevallen: vereist cross-environment
  service-role-rechten en maakt één beheercompromis direct omgevingsoverschrijdend.

## Gevolgen

- Er is geen Productie-domeincutover voor `app.*`; Preview wordt volledig
  additief opgebouwd.
- De algemene Productielogin blijft voorlopig Horizon-/legacygericht. Een
  fondskeuze of veilige loginbroker blijft een apart productbesluit.
- De twee Vercel-projecten (`bestuurdersportaal` en
  `bestuurdersportaal-beheer`) krijgen elk een vaste Preview-/custom environment
  op dezelfde previewbranch, met verschillende surfaces (`app` versus
  `platform`) maar hetzelfde geïsoleerde Preview-Supabase-project.
- Secrets worden per project én per environment gesplitst. Variabelen die nu
  `Production and Preview` zijn, worden niet blind geïmporteerd.
- Providerwijzigingen worden pas als gereed gemarkeerd na gesaneerd bewijs,
  browser-smokes en cross-environment-negatieve tests.

## Referenties

- [`../security/OMGEVINGEN-RUNBOOK.md`](../security/OMGEVINGEN-RUNBOOK.md)
- [`../security/DREIGINGSMODEL.md`](../security/DREIGINGSMODEL.md)
- `core/lib/tenant-host.ts`
- `core/lib/platform-host.ts`
- `platform/lib/supabase-platform.ts`
