# Werkopdracht: rust en compositie in het AI-scherm

> Plansessie Cowork, 28-07-2026. Plak deze werkopdracht als eerste bericht in een
> Claude Code-sessie in de repo-root. Zie `decisions/0004` en het
> `WERKOPDRACHT-TEMPLATE.md`.

---

**Doel & context** — het AI-scherm is het belangrijkste onderdeel van het portaal,
maar oogt na de tranches huisstijl-T1 (besluit 0084) en AI-startpunt-P1 (besluit 0085)
onrustig: twee verschillende contentbreedtes boven elkaar, ruim 200px kopbalk vóór de
eerste inhoud, en twee kaartsoorten in één blok. Deze werkopdracht brengt de
compositie op één lijn met de goedgekeurde referentiemockup, zonder één kleurwaarde
te wijzigen.

**Goedgekeurd ontwerp/plan** — `03 Functioneel ontwerp/Designrichtingen portaal/startpunt-flow.html`
is **normatief** voor maatvoering en kaartbehandeling. Per scope-item hieronder staat
de betreffende mockup-regel erbij, zodat er bij de bouw niets te interpreteren valt.

**Kleuren zijn expliciet géén onderdeel van deze opdracht.** De `:root` van de mockup
is regel voor regel vergeleken met `app/globals.css`: alle 24 kleurtokens zijn
identiek (`--ink` #171A28 = `23 26 40`, `--app-bg` #F4F5FA = `244 245 250`,
`--accent` #5B4FE0 = `91 79 224`, `--phase` #0E7C9B = `14 124 155`, enzovoort).
Het verschil dat de opdrachtgever waarnam is compositie, niet kleur. **Wijzig geen
enkele tokenwaarde.** De enige toevoeging is één nieuw schaduwtoken (scope-item 4).

---

## Vertrekpunt — wat er nu staat

Geverifieerd tegen de werkelijke code op 28-07-2026. Claude Code verifieert opnieuw;
regelnummers kunnen zijn opgeschoven.

| Plek | Nu |
|---|---|
| `AssistentClient.tsx:1314` | `<div className="flex-1 overflow-y-auto p-6 space-y-5">` — scrollcontainer, **geen max-width** |
| `AssistentClient.tsx:1321` | AI-bubbel `flex-1` → loopt tot de rechterrand van het scherm (~180 tekens per regel) |
| `Startpunt.tsx:76` | `max-w-3xl` (768px), **links uitgelijnd** → rafelige rechterrand onder de bubbel |
| `AssistentClient.tsx:1196` | Topbar `h-14` |
| `AssistentClient.tsx:1221` | Brongebruik-balk `py-2.5` |
| `AssistentClient.tsx:1280` | Antwoordmodus-balk `py-2.5` |
| `Startpunt.tsx:85,116,136` | contextkaarten `rounded-lg bg-white hover:border-accent` |
| `Startpunt.tsx:237,259` | taakkaarten `rounded-xl bg-app-bg hover:border-accent hover:bg-white` |

Twee waarnemingen die de scope verklaren:

1. **De rechterrand is rafelig.** De begroetingsbubbel loopt tot de schermrand, de
   kaarten eronder stoppen op 768px. Twee contentbreedtes recht boven elkaar.
2. **Twee kaarttalen in één blok.** Radius verschilt (`lg` vs `xl`), vulling verschilt
   (wit vs `app-bg`), en de hover loopt tegengesteld: de grijze kaarten worden bij
   hover *lichter*, de witte veranderen alleen hun rand.

---

## Scope

**Wel**

### 1. Eén contentkolom

Mockup: `.wrap{max-width:1020px;margin:0 auto;padding:28px 24px 60px}` (regel 67).

Voeg binnen de scrollcontainer (`AssistentClient.tsx:1314`) één centrerende wrapper
toe die zowel de berichten als `<Startpunt>` (regel 1520) omvat:

```
<div className="mx-auto w-full max-w-[1020px] space-y-5">
```

De scrollcontainer zelf blijft `flex-1 overflow-y-auto` (de scrollbar hoort aan de
schermrand, niet aan de kolom). Verwijder daarna `max-w-3xl` uit `Startpunt.tsx:76`,
zodat het startpunt de gedeelde kolombreedte erft in plaats van een eigen breedte te
zetten. De gebruikersbubbel houdt zijn `max-w-[75%]`; die is nu relatief aan de kolom
in plaats van aan het scherm, wat het gewenste effect is.

### 2. Kaartbehandeling gelijktrekken

Mockup: `.card{background:var(--card);border:1px solid var(--line);border-radius:14px;box-shadow:var(--sh)}` (regel 89).

Alle vijf kaarten in `Startpunt.tsx` krijgen dezelfde behandeling:

- `bg-white` (regels 85, 116, 136) → `bg-card`. Vandaag visueel identiek
  (`--card-rgb` is `255 255 255`), maar `bg-white` staat buiten de tokenlaag — precies
  wat tranche 1 in dit scherm opruimde. `AssistentClient.tsx` heeft nu 0× `bg-white`
  en 10× `bg-card`; `Startpunt.tsx` viel buiten die pass.
- `bg-app-bg` (regels 237, 259) → `bg-card`. Dit is de zichtbare wijziging: de
  taakkaarten worden wit, zoals de contextkaarten erboven.
- `hover:bg-white` (regels 237, 259) → **verwijderen**. De hover loopt daarmee voor
  alle kaarten dezelfde kant op (rand + elevatie, zie scope-item 3).
- Eén radius. Kies `rounded-xl` voor alle vijf; dat ligt het dichtst bij de 14px van
  de mockup.

Let op: `bg-white` staat 292× in de codebase. Dit is **geen** repo-brede opschoning —
alleen `Startpunt.tsx`, omdat dat bestand binnen de scope van de AI-schermpass viel en
er niet in zat.

### 3. Hover-elevatie

Mockup: `--sh-lg` (regel 19) en `.hov:hover{border-color:var(--accent);transform:translateY(-1px);box-shadow:var(--sh-lg)}` (regels 93-94).

Het portaal heeft alleen `--shadow-card`. Voeg één token toe in `app/globals.css`,
in dezelfde vorm en met dezelfde ink-basis als het bestaande token:

```css
--shadow-card-hover: 0 4px 14px rgb(var(--ink-rgb) / 0.07), 0 30px 60px -30px rgb(var(--ink-rgb) / 0.45);
```

En de mapping in `tailwind.config.ts`, naast de bestaande `card`-entry:

```ts
boxShadow: { card: "var(--shadow-card)", "card-hover": "var(--shadow-card-hover)" }
```

Toepassen op de vijf kaarten in `Startpunt.tsx`: `hover:border-accent hover:shadow-card-hover hover:-translate-y-px`.

**Verplicht:** respecteer `prefers-reduced-motion`. De `transform` mag niet draaien
voor gebruikers die beweging hebben uitgezet — gebruik `motion-safe:hover:-translate-y-px`
(Tailwind-variant, geen nieuwe CSS nodig).

### 4. Dubbele zin weghalen

De brongebruik-balk zegt: "De assistent kiest automatisch de passende bron — uw
documenten, algemene kennis of een combinatie." De begroetingstekst eronder zegt
woordelijk hetzelfde: "ik kies automatisch de passende bron: uw fondsdocumenten,
algemene kennis, of een combinatie." Twee keer dezelfde mededeling, 200 pixels uit
elkaar.

Kort de **begroetingstekst** in tot de eerste en de laatste alinea (aanhef +
governance-logging). De balk blijft ongewijzigd: die is de functionele, altijd
zichtbare drager van die informatie, de begroeting is dat niet.

> **Let op** — deze tekst valt mogelijk onder de AI-toon-systeemprompt. `CLAUDE.md`:
> "De AI-toon-systeemprompt in `app/api/chat/route.ts` is kostbaar, fijn afgesteld
> werk — wijzig met beleid en alleen op verzoek." Zit de begroeting daarin en niet in
> de component, **stop dan en leg de voorgestelde tekst eerst voor**. Wijzig de prompt
> niet op eigen initiatief.

**Niet**

- Geen enkele kleurtokenwaarde (zie boven).
- Geen dark mode (buiten scope sinds besluit 0084).
- Geen wijziging aan `THEMABARE_TOKENS` of de theming-keten.
- Geen repo-brede `bg-white`-opschoning.
- Geen functionele wijziging aan retrieval, antwoordmodi, gesprekpersistentie of het
  startpunt zelf.
- Het samenvoegen van de drie kopbalken — zie besluitpunt 1.

---

## Besluitpunten

**1. Drie kopbalken samenvoegen tot één — ja of nee?**

De mockup heeft één `.top{padding:11px 22px}` (regel 60), circa 44px. Het portaal
heeft er drie: topbar `h-14` (1196), brongebruik `py-2.5` (1221) en antwoordmodus
`py-2.5` (1280). Samen ruim 200px witte chrome vóór de eerste inhoud. **Dit is de
grootste knop voor rust** — en tegelijk de reden dat het grijze canvas eronder als
een apart paneel leest in plaats van als de pagina.

Deze wijziging is eerder in het traject al eens voorgesteld en door de opdrachtgever
teruggedraaid ("structuur behouden, alleen de kleurstellingen aanpassen"). Toen terecht:
dat was een kleurtranche. Nu is rust wél het doel, dus hij ligt opnieuw voor — maar
bewust als besluitpunt en niet als stille scope.

Afweging: brongebruik en antwoordmodus zijn geen neutrale UI. Ze maken zichtbaar
waaróp een antwoord steunt — dezelfde transparantielijn als besluit 0071, en besluit
0068 ging expliciet over het terugbrengen van de antwoordmodi tot Auto + Sparren.
Wegstoppen achter een popover wint hoogte maar kost afleesbaarheid, en dat is bij een
bestuurdersportaal een governance-keuze, geen smaakkwestie.

Voorstel als het doorgaat: brongebruik wordt een compacte chip **met de gekozen stand
zichtbaar** ("Bron: automatisch ▾") in plaats van een volzin, en de antwoordmodus
blijft als segmented control zichtbaar in dezelfde balk. Dan wint u circa 160px zonder
informatieverlies. Leg het resultaat vóór merge voor.

**2. Kolombreedte 1020px — bevestigen op een breed scherm.**

1020px komt uit de mockup en is voor lopende tekst juist. Maar AI-antwoorden bevatten
tabellen en bronblokken, en op een 27"-scherm kan de kolom als weggegooide ruimte
voelen. Toon vóór merge een antwoord mét tabel op een breed scherm. Valt dat tegen:
laat tabellen binnen het antwoord tot de volle containerbreedte uitbreken, of ga naar
1180px (de mockup heeft daar `.wrap.wide` voor, regel 68). Beslis dit op basis van wat
u ziet, niet vooraf.

---

## Acceptatiecriteria

1. Begroetingsbubbel, alle vervolgbubbels en het startpuntblok delen **één** rechter-
   en linkerrand; op een scherm van 2560px is er geen zichtbaar breedteverschil meer
   tussen de bubbel en de kaarten eronder.
2. `Startpunt.tsx` bevat geen `max-w-*` meer; de breedte komt uitsluitend uit de
   gedeelde wrapper.
3. `Startpunt.tsx` bevat 0× `bg-white` en 0× `bg-app-bg` als kaartvulling; alle vijf
   kaarten staan op `bg-card` met dezelfde radius.
4. Alle vijf kaarten reageren identiek op hover: accentrand + `shadow-card-hover` +
   1px lift. Geen kaart wordt bij hover van vulling.
5. Met `prefers-reduced-motion: reduce` treedt géén `transform` op; rand en schaduw
   veranderen wel.
6. `--shadow-card-hover` is gedefinieerd in `app/globals.css` met `rgb(var(--ink-rgb) / …)`
   en gemapt in `tailwind.config.ts`. Geen hardcoded rgba in componenten.
7. `npm run lint:colors` groen — de gate mag niet omzeild of aangepast worden.
8. Geen enkele bestaande tokenwaarde in `app/globals.css` is gewijzigd (diff-controle:
   alleen de toevoeging van `--shadow-card-hover`).
9. De begroeting bevat de bron-uitleg niet langer dubbel; de brongebruik-balk is
   ongewijzigd.
10. `tsc --noEmit --skipLibCheck` groen.
11. Visuele controle in beide toestanden van het startpunt: mét context (alle drie de
    kaarten gevuld) en zónder context (blok wordt weggelaten — `heeftContext`).
12. Controle op Meridiaan én Horizon: de gedeelde kolom en de kaartbehandeling zijn
    fondsonafhankelijk en mogen niet uit theming-tokens komen.

---

## Relevante bestanden

- `app/(dashboard)/ai/_components/AssistentClient.tsx` — scrollcontainer (1314),
  bubbelbreedte (1321), plaatsing `<Startpunt>` (1520), kopbalken (1196 / 1221 / 1280)
- `app/(dashboard)/ai/_components/Startpunt.tsx` — kolombreedte (76), kaarten
  (85, 116, 136, 237, 259)
- `app/globals.css` — uitsluitend toevoeging `--shadow-card-hover`
- `tailwind.config.ts` — uitsluitend toevoeging `boxShadow["card-hover"]`
- Referentie: `03 Functioneel ontwerp/Designrichtingen portaal/startpunt-flow.html`

**Guardrails (zie `CLAUDE.md`)** — deze opdracht raakt geen data, geen RLS, geen
audit en geen AI-logica. Bevestig niettemin: geen service-role-key, RLS per `fonds_id`
ongemoeid, append-only audit ongemoeid, geen migratie nodig, human-in-the-loop
ongewijzigd. Wijkt de implementatie hiervan af, dan is dat een signaal dat de scope
verkeerd begrepen is — stop en leg voor.

**In te zetten subagents** — `code-reviewer` (verplicht) en `ontwerp-sync-reviewer`
vóór merge. `supabase-rls-reviewer` en `audit-evidence-reviewer` zijn niet van
toepassing; motiveer dat kort in de terugkoppeling in plaats van ze stil over te slaan.

**Werkmodus** — begin in **Plan-modus**. Lever eerst een implementatieplan met de
werkelijke regelnummers, een voorstel voor besluitpunt 1, en screenshots-vooraf van de
twee startpunttoestanden. **Wijzig pas na expliciet akkoord.**

**Definition of Done (zie `CLAUDE.md`)** — acceptatiecriteria 1-12 aantoonbaar;
`tsc` groen; `lint:colors` groen; `HANDOVER.md` release-historie bijgewerkt; een
`decisions/`-entry **alleen** als besluitpunt 1 doorgaat (het samenvoegen van de
kopbalken raakt de zichtbaarheid van brongebruik en antwoordmodus en is daarmee een
besluit; de compositiewijzigingen op zichzelf zijn dat niet).

**Documentatiehaak** — dit is een **kleine release** zonder architectuur-, data-,
security- of tenant-impact. Volgens `CLAUDE.md` volstaat daarmee `HANDOVER.md`
(+ de decision-entry indien besluitpunt 1 doorgaat). Een volledige actualisatie van de
`00-09`-set en de as-built Word-doc is **niet** aan de orde; werk de marker in
`00 Overzicht en status/doc-actualisatie-log.md` dus niet bij. Gaat besluitpunt 1 door,
dan verandert die weging — leg dat dan expliciet voor.

**Terugkoppeling** — rapporteer in het antwoordformat uit `CLAUDE.md`: samenvatting,
aangepaste bestanden, RLS/security-impact, audit-impact, datamodel/migratie-impact,
test/verificatie, openstaande risico's.
