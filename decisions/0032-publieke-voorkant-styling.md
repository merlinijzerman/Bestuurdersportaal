# 0032 — Publieke voorkant: styling (scoped CSS, app ongemoeid)

- **Status:** Geaccepteerd
- **Datum:** 2026-06-29
- **Betrokkenen:** Merlin (besluit), Claude Code (uitvoering)

## Context

De goedgekeurde marketing-mockups (v4) gebruiken losse CSS-variabelen (`--paper/--ink/--accent/--serif/--sans`); de app gebruikt Tailwind. Bij de bouw van de publieke pagina's (W1) moet de styling 1:1 met de mockup overeenkomen, zonder risico op visuele drift en zonder de bestaande app-styling te raken.

## Besluit

**Scoped CSS met marketingtokens** voor de publieke voorkant: de mockup-CSS-variabelen in `(public)/layout.tsx` + een kleine, gescheiden stylesheet, los van de Tailwind-app. Tailwind blijft ongemoeid voor de besluitomgeving. Porteren naar Tailwind-theme-tokens is **fase 2**.

> **W0-scope:** dit besluit legt alleen de stylingrichting vast; de daadwerkelijke `(public)`-componenten/stylesheet zijn **W1**.

## Overwogen alternatieven

- **Direct porteren naar Tailwind-theme-tokens** — consistenter met de app, maar meer werk en kans op visuele drift t.o.v. de goedgekeurde mockup. Uitgesteld naar fase 2.

## Gevolgen

- Snel en 1:1 met de mockup; geen risico voor de app-styling.
- Tijdelijke duale styling-aanpak (Tailwind voor app, scoped CSS voor marketing) tot een eventuele fase-2-port. Bewust geaccepteerd.

## Referenties

- `04 …/Publieke voorkant technisch ontwerp v1.0.md` §3.2
- Mockups: `homepage-mockup-v4.html`, `contact-mockup-v4.html`, `login-mockup-v4.html`, `privacy-mockup-v4.html`
