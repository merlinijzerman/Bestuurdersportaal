# 0189 — Tweefasen-model voor `ENFORCE_*`-vlaggen: fase 1 (env-vlag) per ticket, fase 2 (code fail-closed) bij de fonds-1-go-live

- **Status:** Geaccepteerd
- **Datum:** 2026-08-24
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse & uitvoering)
- **Werkopdracht:** EPIC W — handhavingsvlaggen (deploy 3). Generaliseert 0186 en 0188 tot één regel voor alle `ENFORCE_*`-vlaggen.

## Context

De centrale securitywrapper handhaaft elke grens achter een eigen `ENFORCE_*`-env-vlag:
`ENFORCE_CAPABILITY` (W6/W7), `ENFORCE_SCHEMA` (W8/W9), en de nog komende
`ENFORCE_RATELIMIT` (W10) en `ENFORCE_AUDIT` (W11). Besluit 0186 legde voor
capability de **kale opt-in** vast; 0188 de **fase-2-flip** (code fail-closed per
omgeving) voor capability specifiek.

De open vraag was hoe je die flips volgtijdelijk landt zónder dat ze zich opstapelen
tot één riskant moment — en hoe je dat rijmt met het feit dat er **vóór fonds 1 geen
live verkeer** is, dus geen signaal of de handhaving klopt.

## Besluit

Splits elke `ENFORCE_*`-vlag bewust in **twee momenten**:

**Fase 1 — env-vlag aan (de gedragswijziging).** Zet de env-var (bv.
`ENFORCE_CAPABILITY=on`) op de beschermde omgeving **zodra het bijbehorende ticket
landt**. Dat ís de handhaving. Omkeerbaar: env-var weghalen + redeploy zet hem uit.
Eén vlag per moment → **gedragsflips clusteren niet**.

**Fase 2 — code fail-closed default (de hardening).** Zet de omgevings-default in
`*EnforceVoorOmgeving()` op altijd-fail-closed (de vorm van
`tenantEnforceVoorOmgeving`, besluit 0042): op production/preview/staging handhaaft
de grens ook zónder env-waarde, en zelfs als de vlag per ongeluk op `off` staat.
Dit **geeft de omkeerbaarheid op**: de env-var weghalen werkt niet meer, uitzetten
wordt een revert. **Cluster deze fase bewust bij de fonds-1-go-live**, als stap in
de onboardingchecklist.

## Waarom

- **Gedragsflips clusteren niet.** Elke vlag gaat aan wanneer zijn eigen ticket klaar
  is, met de env-var-terugval als goedkope noodrem. Precies wat het gefaseerde
  ontwerp moest borgen.
- **De onomkeerbaarheids-hardening clustert — en dat hóórt zo.** Fase 2 is één moment
  waarop je zegt: "vanaf nu geen stille uitweg meer; een configuratiefout mag een
  beveiligingsgrens niet uitschakelen." Dat is exact wat 0042 voor de tenantgrens doet.
- **Vóór fonds 1 is er geen verkeer**, dus geen signaal of de handhaving klopt. Juist
  dán is de omkeerbare env-var-terugval waardevol. Fase 2 (de noodrem opgeven) loont
  pas als er verkeer is dat je wilt beschermen — dat is de go-live.

## Gevolgen / toepassing

- **W10, W11 en W12 hoeven deze discussie niet over te doen:** hun fase 1 gaat aan bij
  landing, hun fase 2 hoort in de go-live-checklist.
- **Fase-2-PR's blijven bewust draft**, gelabeld "gepland voor fonds-1-go-live", niet
  "wachtend op observatie" (zie #162).
- **Stand op 2026-08-24 (geverifieerd in Vercel):**
  - `ENFORCE_CAPABILITY` fase-1 **aan op Production** (+ preview-stable). Fase 2 = #162
    (besluit 0188), gepland voor go-live; voorwaarde #163 (`profielen.rol NOT NULL`)
    mag eerder, want gedragsneutraal.
  - `ENFORCE_SCHEMA` fase-1 **aan op Preview + preview-stable**, niet op Production.
    Fase 2 nog te schrijven, gepland voor go-live.

## Alternatieven overwogen

- **Meteen fase 2 bij landing (geen env-var-fase).** Verworpen: geeft de omkeerbare
  noodrem op vóór er verkeer is, op een grens die vandaag niemand raakt — je ruilt een
  goedkope terugval in voor bescherming tegen een risico dat nu niet bestaat.
- **Fase 1 óók clusteren bij go-live.** Verworpen: dan flippen vier gedragswijzigingen
  tegelijk — precies wat de fasering moest voorkomen.
