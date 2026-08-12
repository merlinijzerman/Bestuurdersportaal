# 0168 — Tegenperspectief als vraag, niet als argument ("Wat pleit er tegen?")

- **Status:** Geaccepteerd (impl.; B-opt tranche 4a)
- **Datum:** 2026-08-12
- **Betrokkenen:** Merlin (opdrachtgever), ontwikkeling

## Context

De reflectiefunctie wint aan waarde als kritische sparringspartner wanneer de bestuurder ook het tegengeluid kan opzoeken. Maar dit is het onderdeel met het **grootste governancerisico** van de hele optimalisatie (VOORSTEL §G): een assistent die het sterkste tegenargument *formuleert*, doet drie verboden dingen tegelijk — nieuwe inhoud toevoegen tijdens de reflectie, een positie innemen, en overtuigingskracht uitoefenen op een bestuurder die zijn oordeel nog vormt.

## Besluit

Bouwen, maar **strikt als vráág**: de assistent vraagt de bestuurder om het tegenargument; hij levert het niet.

- **Alleen op initiatief van de bestuurder** — de knop **"Wat pleit er tegen?"** naast "Nog een stap verdiepen". Nooit automatisch (een automatische tegenvraag na uitgesproken overtuiging leest als tegenspraak van de AI).
- **Nul extra state:** zelfde transitie als `verdiepen` (`conceptweergave → verdieping_{beurt}`), zelfde beurtplafond (3), alleen een andere promptvariant. De knop verdwijnt bij het plafond; de RPC weigert de transitie dan óók.
- **De assistent mag ankeren in de bevroren bronset** ("in de stukken staat ook X — weegt dat mee?"), maar mag geen argument construeren dat daar niet staat en geen nieuw feit toevoegen.
- **Correctie op de voorgestelde formulering:** niet "tegen uw huidige oordeel" (dat veronderstelt dat de bestuurder al een oordeel heeft en duwt hem in een verdedigende positie), maar "wat pleit er de andere kant op" / "wat zou uw vertrouwen doen wankelen".

## Borging

- **Promptblok `SP_REFLECTIE_TEGENPERSPECTIEF`** (`core/lib/generatie-kern.ts`, gepind): kern *"u vraagt om het tegenargument, u levert het niet"*; geen positie, geen weerlegging, geen nieuw feit. Achter `SP_REFLECTIE_REGELS` geplakt; alleen actief bij de knop.
- **Dezelfde gebufferde validatie als elke verdiepingsvraag** (tranche 3b): niet gestreamd, getoetst tegen AC-R1 t/m R7. Faalt de vraag, dan de **deterministische terugval** `tegenperspectiefVraag(ingang)` (`core/lib/reflectie-richtingen.ts`) — een vaste, komma-vrije open vraag die zijn eigen validator passeert. Zo kan het model nooit ongemerkt een argument construeren: de terugval is altijd een vraag.
- **Onderscheid met de `risico`-ingang bewaakt:** bij `risico` mag de constatering van de bestuurder niet ter discussie worden gesteld (AC-E7); de tegenperspectiefvraag vraagt naar wat de andere kant op pleit, niet of het risico wel klopt.

## Gevolgen

- Geen datamodel-/RLS-/migratiewijziging: hergebruikt de bestaande `verdiepen`-transitie.
- Nieuwe gepinde promptconstante + content-guard (`generatie-kern.sanity.ts`) die borgt dat de kern ("vraagt, levert niet") niet stilzwijgend wegkantelt.
- Blijvend aandachtspunt: de kwaliteit van de tegenvraag is niet-deterministisch (behalve de terugval) en per ontwerp onmeetbaar — post-hoc gebruikerstoets aanbevolen (criterium 6: "behulpzaam of betuttelend?").

## Referenties

- `VOORSTEL-REFLECTIE-OPTIMALISATIE.md` §G · `VOORSTEL-REFLECTIE-ANTWOORDPAD.md` §2/§3 (AC-E7)
- [[0167]] (guardrails + validator), [[0112]], [[0164]]
