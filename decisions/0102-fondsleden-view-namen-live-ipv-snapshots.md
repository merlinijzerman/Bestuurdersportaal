# 0102 — `vw_fondsleden`: namen live tonen in plaats van bevroren kopieën

- **Status:** Geaccepteerd
- **Datum:** 2026-08-02
- **Betrokkenen:** Merlin (opdrachtgever), Claude (analyse en uitvoering)
- **Raakt:** [0017](./0017-increment-f-keuzes.md) — het zelfbeheerde profiel blijft afgeschermd; alleen naam en rol worden zichtbaar
- **Raakt:** [0001](./0001-append-only-audit-geen-harddelete.md) — auditsporen blijven ongewijzigd en worden bewust níét herschreven

## Context

Op het procedurescherm stond bij de co-eigenaars een e-mailadres in plaats van
een naam. Dat bleek geen weergavefout maar de zichtbare punt van een
structureel patroon.

`procedure_eigenaars.gebruiker_naam` is een **snapshot** van `profielen.naam`,
genomen op het moment van aanmaken. Die kopie bestaat omdat de RLS op
`profielen` strikt de eigen rij afdekt (`profiel select eigen`, migratie
2026-07-03): niemand kan de naam van een collega lezen, dus moest die bij elke
schrijfactie worden meegekopieerd. Datzelfde patroon staat op meer plekken —
`procedure_log.actor_naam`, `stemmingen`, `inbreng`.

Twee gevolgen. Ten eerste verouderen die kopieën stil: wijzigt iemand zijn
weergavenaam, dan blijft overal de oude staan. Ten tweede bevriezen ze fouten.
`maak_profiel()` valt bij registratie zonder naam terug op `new.email`, dus een
account dat zonder naam is aangemaakt heeft het e-mailadres *als* weergavenaam —
en dat adres stond vervolgens permanent in het dossier.

Het co-eigenarenveld bij een nieuwe procedure was bovendien **vrije tekst**: wie
daar een e-mailadres intypte, kreeg een e-mailadres in het dossier, zonder dat
iets dat tegenhield.

## Besluit

**1. Eén smalle, fonds-gescopete view — geen ruimere RLS.**

`public.vw_fondsleden` geeft `id`, `fonds_id`, `naam` en `rol` van de leden van
het eigen fonds. De view draait met definer-semantiek
(`security_invoker = false`) en omzeilt daarmee bewust de policy op `profielen`.

De policy zelf blijft **ongewijzigd**. Dat is geen detail: `profielen` draagt
naast naam en rol ook het persoonlijke bestuurdersprofiel (`bestuurlijke_rol`,
`primaire_expertise_id`, `antwoordvoorkeur`, `standaard_ai_modus`,
`detailniveau`), en dat is per besluit 0017 strikt zelfbeheerd. RLS werkt op
rij-niveau en kan geen kolommen afschermen — een ruimere SELECT-policy zou dus
het hele profiel openzetten. Een projectie kan dat wel.

De prijs van definer-semantiek is dat de scoping in de view zélf moet kloppen.
Daarvoor is `supabase/checks/2026_08_02_fondsleden_cross_tenant.sql`, die onder
echte RLS zes scenario's afdwingt: isolatie in beide richtingen, dat de view
exact vier kolommen exposeert, nul rijen zonder sessie, geen `SELECT` voor
`anon`, en — als regressietoets — dat een lid via `public.profielen` nog steeds
alleen de eigen rij kan lezen.

**2. Zichtbaar wordt: weergavenaam én rol.**

Rol (`bestuurder` / `voorzitter` / `beheerder`) is meegenomen omdat een kiezer
zonder rol slecht werkt: bij gelijkende namen is dat het onderscheidende veld.
Gevolg dat expliciet is aanvaard: de rolverdeling binnen het bestuur is daarmee
voor elk lid zichtbaar. Dat is bestuurlijk gezien geen geheim, maar het is wel
méér dan strikt nodig was voor de naam alleen.

**3. Live naam wint, snapshot blijft als terugval.**

`core/lib/fondsleden.ts` levert de opzoektabel; `weergaveNaam()` kiest de live
naam waar een `gebruiker_id` bekend is en anders de snapshot. De snapshots zijn
**niet** gemigreerd en worden ook niet afgeschaft:

- ze zijn de terugval voor een co-eigenaar zonder account;
- in `procedure_log.actor_naam` zijn ze juist gewenst — dat spoor legt vast wie
  iets deed op dát moment en is append-only (besluit 0001). Een naam daar met
  terugwerkende kracht herschrijven zou het auditspoor vervalsen. Die tabel is
  dus bewust niet aangeraakt.

Bestaat de view nog niet (migratie nog niet gedraaid), dan faalt de query stil,
blijft de opzoektabel leeg en valt alles terug op de snapshot. De volgorde van
migratie en deploy is daarmee vrij.

**4. Co-eigenaars worden gekozen, niet getypt.**

Het vrije tekstveld in `NieuweProcedureForm` is vervangen door een multiselect
uit de fondsleden. `POST /api/procedures` accepteert nu `eigenaar_ids` in plaats
van `eigenaren` en **valideert die server-side tegen `vw_fondsleden`** — die
view is op het eigen fonds gescopet, dus een id van buiten het fonds valt er
vanzelf uit. Nooit vertrouwen op wat de client meestuurt.

Dit is het deel dat het probleem structureel oplost: zonder vrij tekstveld kan
er geen e-mailadres meer als "naam" in een dossier belanden.

## Gevolgen

- **Geen wijziging aan de RLS van `profielen`.** De hardening uit migratie
  2026-07-03 (WITH CHECK op UPDATE, bevroren `fonds_id`/`rol`) blijft intact.
- **Eén nieuwe view, één nieuwe check, geen tabelwijziging, geen datamigratie.**
- **Externe co-eigenaars kunnen niet meer worden toegevoegd.** Wie geen account
  in het fonds heeft, staat niet in de kiezer. Bestaande, vrij ingevoerde
  eigenaars blijven gewoon staan en worden nog steeds getoond. Komt de behoefte
  aan externen terug, dan is een aparte "externe betrokkene" met eigen veld de
  route — niet het vrije tekstveld terugzetten.
- **Twee leden met dezelfde weergavenaam.** `procedure_eigenaars` heeft
  `(procedure_id, gebruiker_naam)` als primaire sleutel. De POST-route
  ontdubbelt daarom op naam; het tweede account raakt dan zijn eigenaarschap
  kwijt. Zichtbaar in de UI en op te lossen met een onderscheidende
  weergavenaam. De sleutel wijzigen naar `(procedure_id, gebruiker_id)` is de
  nettere oplossing maar vergt een migratie met datamigratie voor rijen zonder
  id; bewust buiten deze tranche gehouden.
- **Het bredere patroon is niet uitgeroeid.** `stemmingen`, `inbreng` en de
  overige `actor_naam`-velden gebruiken nog steeds snapshots. Voor auditsporen
  is dat correct; voor de niet-audit-oppervlakken kan `haalFondsleden()` daar op
  dezelfde manier worden toegepast. Nog niet gedaan.
- **`maak_profiel()` is niet gewijzigd.** Een account zonder naam krijgt nog
  steeds het e-mailadres als weergavenaam. Dat is nu minder schadelijk (het
  bevriest niet meer in dossiers), maar het blijft zichtbaar in de zijbalk en in
  auditsporen. De echte oplossing is een weergavenaam invullen op `/profiel`.

## Overwogen alternatieven

- **RLS op `profielen` verruimen naar fondsgenoten.** Verworpen: rij-niveau-RLS
  kan geen kolommen afschermen, dus dit zet het volledige zelfbeheerde profiel
  open en zou een herziening van besluit 0017 vergen.
- **De snapshots backfillen.** Lost het zichtbare symptoom op maar niet de
  oorzaak: de volgende naamswijziging loopt weer uit de pas, en het vrije
  tekstveld blijft e-mailadressen accepteren. Blijft beschikbaar als losse
  opruiming.
- **De weergave cosmetisch repareren** (domein achter de `@` wegstrepen).
  Verworpen: dat toont een verzonnen naam en verbergt dat het profiel niet is
  ingevuld. De `initialen()`-helper negeert de domeinstaart wél, maar uitsluitend
  voor het avatar-bolletje — daar is "M" beter dan "M@".
- **`(procedure_id, gebruiker_id)` als primaire sleutel.** Zie hierboven; vergt
  datamigratie, apart gehouden.

## Referenties

- `supabase/migrations/2026_08_02_fondsleden_view.sql` (+ ROLLBACK)
- `supabase/checks/2026_08_02_fondsleden_cross_tenant.sql`
- `core/lib/fondsleden.ts`
- `supabase/migrations/2026_07_03_profielen_rls_hardening.sql` — de policy die intact blijft
