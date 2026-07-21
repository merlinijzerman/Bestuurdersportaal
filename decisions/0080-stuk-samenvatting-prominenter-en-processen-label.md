# 0080 — Stuk-samenvatting prominenter (variant A+B) + navigatietabblad Procedures → Processen

- **Status:** Geaccepteerd
- **Datum:** 2026-07-20
- **Betrokkenen:** Merlin (opdrachtgever/PO), Claude (bouw)

## Context

In het agendapunt (`AgendapuntKaart` → `StukKaart`) zat de AI-samenvatting per stuk verstopt achter een klein, rechts uitgelijnd chevron-pijltje (▸). Zwakke affordance, geen prikkel om te openen; de bestuurder zag alleen de passieve tekst "AI-samenvatting beschikbaar". Daarnaast sloot het navigatielabel "Procedures" niet aan bij het interne taalgebruik ("processen"; de paginasubtitel sprak al van "Lopende processen, beleidswijzigingen en besluittrajecten").

## Besluit

1. **Stuk-samenvatting (variant A+B):** het stuk toont nu een zichtbaar snippet (eerste ~160 tekens uit `gevraagd_besluit` / `aanleiding` / eerste hoofdpunt) plus een duidelijke knop **"Lees samenvatting"** (zachte accentstijl `bg-accent-tint text-accent-ink`) in plaats van het chevron. De volledige samenvatting blijft uitklapbaar, met een **AI-disclaimer** onderaan. De passieve badge-tekst is verwijderd (bewust minimalistisch).
2. **Label-rename:** het navigatietabblad "Procedures" heet voortaan **"Processen"** — uitsluitend het weergavelabel in `core/lib/module-registry.ts` + de paginakop. Route, module-key en tabellen (`/procedures`, `procedures`) blijven ongewijzigd.

## Overwogen alternatieven

- **Chevron prominenter maken** — lost de affordance deels op maar houdt de inhoud verborgen; afgewezen.
- **Standaard uitgeklapt (variant C)** — maximale prominentie, maar lange lijst bij meerdere stukken én groter overrelance-risico (bestuurder leest de samenvatting i.p.v. de onderbouwing); afgewezen.
- **Aparte samenvattingskaart per agendapunt (variant D)** — sterkere governance-plek met ruimte voor validatiestatus, maar meer bouwwerk; niet nodig voor deze iteratie (per stuk volstaat).
- **Tab hernoemen inclusief route/key (`/processen`)** — zou bestaande links/bladwijzers breken en raakt module-key/tabellen; afgewezen, alleen het label.

## Gevolgen

- **UI:** stukken tonen snippet + "Lees samenvatting"; volledige samenvatting uitklapbaar met AI-disclaimer; de nav-tab heet "Processen".
- **Governance / bewust geaccepteerd:** de validatiestatus van de samenvatting is niet meer zichtbaar in de ingeklapte weergave (badge verwijderd voor minimalisme). Een prominentere samenvatting verhoogt het overrelance-risico; als mitigatie blijft de AI-disclaimer in de uitgeklapte weergave staan. Openstaand: beslis of/waar validatiestatus terug moet vóór livegang (zie `openstaande-punten-en-risicos.md`).
- **Route onaangetast:** `/procedures` blijft; geen redirect nodig. Zou de route ooit meeveranderen, dan is een 308-redirect vereist (blinde vlek vastgelegd).
- **Verificatie:** `tsc --noEmit` en `eslint` groen op de gewijzigde bestanden; browser-smoke (uitklappen, label) na deploy handmatig.
- **Front-end-only:** geen migratie/tabel/kolom/RPC/RLS.

## Referenties

- Code: `app/(dashboard)/vergaderingen/_components/AgendapuntKaart.tsx` (`StukKaart`: snippet + knop + disclaimer), `core/lib/module-registry.ts` (label), `app/(dashboard)/procedures/page.tsx` (paginakop)
- Commit: `7cdf3b3`
- Voortraject: prototype variant A+B + requirements met acceptatiecriteria (Cowork-sessie 2026-07-20)
- Eerdere besluiten: 0036 (inline agendapunt-chat), 0035 (beperkte top-level navigatie)
