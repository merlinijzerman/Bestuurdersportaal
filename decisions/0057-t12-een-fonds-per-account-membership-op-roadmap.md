# 0057 — T12: één fonds per account als geaccepteerde beperking; `fonds_memberships` naar de roadmap

- **Status:** Geaccepteerd
- **Datum:** 2026-07-10
- **Betrokkenen:** Merlin (akkoord), Claude (onderzoek + vastlegging)

## Context

T12 (membershipmodel) is een **voorwaardelijk** ticket: bouw `fonds_memberships` pas
wanneer een rol legitiem **meerdere fondscontexten** nodig heeft; zo niet, leg de
tijdelijke één-fonds-beperking bewust vast (werkopdracht T12, twee geldige uitkomsten;
beslisnotitie multi-tenant v0.4 §17). Bij het aftikken van de trigger bleek het
volgende, geverifieerd tegen de code:

- **As-built = strikt één fonds per account.** `profielen.fonds_id` koppelt elke
  gebruiker aan precies één fonds; `maak_profiel()` (R1, besluit
  [`0044`](./0044-maak-profiel-deterministische-fondstoewijzing.md)) dwingt bij
  registratie deterministisch één `fonds_id` per account af (geen `limit 1`, fail-closed).
- **De resolver (T1) is membership-klaar.** [`bepaalFondsContext`](../lib/tenant-host.ts)
  is puur host→fonds; alleen [`beoordeelToegang`](../lib/tenant-enforce.ts) vergelijkt de
  host-fonds met één `sessieFondsId`. Voor membership zou die vergelijking van
  "== profiel-fonds" naar "∈ toegestane fondsen" moeten verschuiven — de resolver zelf niet.
- **De aangedragen trigger (platformbeheerder met meerdere fondscontexten) botst met de
  3b-scheiding** (besluit [`0021`](./0021-platformfundament-P0-keuzes.md)): een
  platform-identiteit heeft **geen** `profielen`-rij en de platform-surface toont **nooit**
  per-fonds tenant-data (geverifieerd: `app/(platform)` raakt alleen generieke/platform-
  tabellen, geen `dossiers`/`procedures`/`vergaderingen`/`decision_objects`).
  `fonds_memberships` is een **tenant**-mechanisme; het toepassen op een platform-identiteit
  is óf de verkeerde laag óf het doorbreken van 3b.
- **Herkaderd als "een persoon moet echt als fonds-gebruiker in ≥2 fondsen werken"** is de
  werkelijke kostenpost het **herschrijven van het fonds-scope-predicaat in ~28 tenant-RLS-
  policies** (van "= mijn profiel-fonds" naar "∈ mijn toegestane fondsen"). Dat raakt het
  **primaire isolatiemechanisme** — precies de aanvals-/complexiteitsoppervlakte in het
  tenant-pad die de werkopdracht verbiedt speculatief op te bouwen.

## Besluit

**Uitkomst (a): de één-fonds-per-account-beperking wordt bewust geaccepteerd; het
membershipmodel (`fonds_memberships`, multi-fonds per persoon) gaat naar de roadmap.**

- **Werkmodel nu:** één uniek e-mailadres = één fonds. Multi-fonds-toegang voor één
  persoon is **expliciet niet ondersteund**. Wie in twee fondsen moet werken, gebruikt
  **twee losse accounts** (één per fonds), elk single-fonds — dat werkt binnen het huidige
  model zonder enige isolatie-ingreep.
- **`fonds_memberships` wordt opgepakt** zodra (1) een legitieme multi-fonds-behoefte
  bevestigd én terugkerend is, én (2) de RLS-set-predicaat-herschrijving is gescoped. De
  resolver is er al op voorbereid.

## Overwogen alternatieven

- **Nu `fonds_memberships` bouwen — Ontwerp B** (profiel-rol leidend, membership = alleen
  toegang) — verworpen voor nu: klein op de rolkant (`requireCapability` blijft ongewijzigd),
  maar vereist alsnog het fonds-scope-predicaat over ~28 tenant-RLS-policies te verruimen naar
  een set. Te grote blast radius op de primaire isolatie voor één nog niet terugkerende behoefte.
- **Nu bouwen — Ontwerp A** (membership-rol per context, v0.4 §17-voorstel) — verworpen voor
  nu: bovenop de RLS-herschrijving een signatuurwijziging van `requireCapability` op ~36
  aanroepplekken/20 bestanden. Grootste regressierisico.
- **Platform "enter fonds context"-brug** (geaudite, read-only support-toegang van een
  platform-identiteit tot een specifiek fonds) — apart, groter ontwerp; buiten T12-scope.
- **Twee-accounts-workaround (gekozen interim)** — werkt binnen het bestaande single-fonds-
  model, geen RLS-/isolatie-ingreep, geen nieuw aanvalsoppervlak.

## Gevolgen

- **RLS/tenant-isolatie:** ongewijzigd. Geen policy geraakt; de primaire fonds-isolatie
  (`fonds_id = mijn profiel-fonds`) blijft intact.
- **Datamodel/migraties:** geen wijziging, geen migratie. `profielen.fonds_id` blijft de
  enige fonds-binding per account.
- **Autorisatie:** ongewijzigd; profiel-rol via [`capabilities.ts`](../lib/capabilities.ts)
  blijft leidend, één rol per (single-fonds-)account.
- **Beheer/operationeel:** elke tenant-account-aanmaak zet één `fonds_id` in de User
  Metadata (bestaand, besluit 0044). Een persoon met een multi-fonds-behoefte krijgt
  meerdere accounts; er is bewust géén koppeling tussen die accounts.
- **Bewust geaccepteerde beperking:** multi-fonds-toegang voor één identiteit is niet
  ondersteund tot T12(b) van de roadmap wordt opgepakt. Dit is nu expliciet, geen
  impliciete aanname (v0.4 §17 randvoorwaarde).
- **Trigger voor heropening (T12 op roadmap):** een bevestigde, terugkerende legitieme
  multi-fonds-behoefte, plus scoping van de RLS-set-predicaat-herschrijving (~28 policies)
  en de keuze Ontwerp A vs B.

## Referenties

- Werkopdracht T12 (P1, multi-tenant T-serie); beslisnotitie multi-tenant v0.4
  **§16 (R1)** + **§17 (membershipmodel)**
- Besluiten [`0040`](./0040-bridge-ready-pool-standaard-dedicated-isolatie-premium.md) (B4,
  membership additief), [`0021`](./0021-platformfundament-P0-keuzes.md) (3b platform/tenant),
  [`0044`](./0044-maak-profiel-deterministische-fondstoewijzing.md) (R1)
- Code: [`lib/tenant-host.ts`](../lib/tenant-host.ts),
  [`lib/tenant-enforce.ts`](../lib/tenant-enforce.ts),
  [`lib/fonds-sessie.ts`](../lib/fonds-sessie.ts),
  [`lib/capabilities.ts`](../lib/capabilities.ts),
  [`lib/platform-auth.ts`](../lib/platform-auth.ts)
- Roadmap: `02 Architectuur/Bestuurdersportaal - Implementatieroadmap multi-tenant (T-serie) v0.1.md` (T12)
