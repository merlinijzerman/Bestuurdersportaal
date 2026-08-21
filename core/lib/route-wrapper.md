# Codemod-recept — `withFondsRoute` v1

> Instructie voor de agent in W3/W4. Geschreven voor een lezer die de codebase
> niet kent. Doel: ~100 API-routes onder `app/api/**/route.ts` mechanisch achter
> `withFondsRoute` v1 brengen **zonder één byte respons te veranderen**. Het
> karakteriseringsharnas (`tests/karakterisering/`, issue #88) bewijst dat: elke
> gemigreerde route moet `node tests/karakterisering/run.mjs --verify` groen
> houden. Een verschil is een **bevinding**, geen reden om het snapshot bij te
> werken.

## Wat de wrapper doet (en dus wat je uit de route weghaalt)

`withFondsRoute(spec, handler)` (`core/lib/route-wrapper.ts`) doet vóór de
handler exact vier dingen — v1, geen gedragsverandering:

1. **Auth** — `createServerSupabase()` + `auth.getUser()`; bij geen sessie
   `NextResponse.json({ error: "Niet ingelogd" }, { status: 401 })`.
2. **Profiel** — `haalProfiel(supabase, user.id)` → `ctx` met `gebruikerId`,
   `fondsId`, `rol`, `naam` (vier kolommen).
3. **Host-guard** — alleen als `spec.hostGuard === true`.
4. **Correlation ID** — `ctx.requestId` (nog géén responseheader in v1).

De handler krijgt `(ctx, request, params)` en gebruikt `ctx.supabase` (de RLS-client).

## Het standaardpatroon (de ~93 routes met de identieke preamble)

**Vóór:**
```ts
export async function GET(req: NextRequest) {
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
    // … routelogica met `supabase` en `user.id` …
  } catch (e) {
    console.error("…", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
}
```

**Na:**
```ts
export const GET = withFondsRoute({}, async (ctx, req) => {
  try {
    const supabase = ctx.supabase;
    // … zelfde routelogica; `user.id` → `ctx.gebruikerId` …
  } catch (e) {
    console.error("…", e);
    return NextResponse.json({ error: "Serverfout" }, { status: 500 });
  }
});
```

### Regels die WEG gaan
- `const supabase = await createServerSupabase();` → `const supabase = ctx.supabase;`
- Het volledige auth-blok (`getUser()` + `if (!user) … 401`).
- Een eigen `profielen`-select **met alleen `id, naam, rol, fonds_id`** (of een subset) → gebruik `ctx.fondsId` / `ctx.rol` / `ctx.naam`.
- De `import { createServerSupabase }`-regel (tenzij elders nog gebruikt).

### Regels die BLIJVEN (v1 raakt ze niet)
- De eigen `try/catch` van de route — ongewijzigd. De wrapper heeft alleen een
  laatste vangnet voor wat daaraan ontsnapt; hij vervangt de bestaande catch niet.
- Elke rol-/capabilitycheck in de route (bv. `if (ctx.rol !== "voorzitter" …) 403`).
  Rol komt nu uit `ctx.rol`, maar de check en de 403-body blijven exact staan.
- Alle auditlog-inserts (`*_log`, `governance_events`). Audit is deploy 3.
- Alle overige validatie, 400/404/409/410-paden, en de exacte foutteksten.

### Parametervolgorde en `[id]`-routes
- Statische route: `handler(ctx, req)`.
- `[id]`-route: `handler(ctx, req, params)` waarbij `params` het **al ge-awaite**
  object is (`{ id }`). Dus `const { id } = params as { id: string };` — géén
  `await params` meer.
- `user.id` → `ctx.gebruikerId` overal (ook in `actor_id`, `opgeslagen_door`, etc.).

## Host-guard-routes (de 12)

Routes die vandaag `beoordeelRouteHostToegang(...)` aanroepen: zet
`spec.hostGuard: true` en verwijder de aanroep + de 403-return uit de route.

⚠️ **Handmatig verifiëren:** de wrapper produceert één vaste 403-body
(`{ error: "Dit webadres hoort niet bij uw fonds." }`). Draai `--verify` per
host-guard-route; wijkt de bestaande 403-tekst af, dan is dat een `BESLUIT:` —
niet stilzwijgend de wrapper-tekst overnemen.

## Gevallen die MET DE HAND moeten (niet mechanisch)

| Geval | Waarom | Aanpak |
|---|---|---|
| **`/api/profiel`** | leest 10 profielkolommen | wrapper voor auth; route doet zelf de brede select met `ctx.gebruikerId` |
| Routes met een `profielen`-select met **extra** kolommen (>4) | `haalProfiel` levert er maar 4 | eigen aanvullende query in de handler |
| **2 SSE-routes** (`chat`, `agendapunten/[id]/voorbereiding`) | streamen; niet in het harnas | met de hand, W5 |
| **8 niet-JSON-responders** (bytes-download, 307-redirect, sjablonen) | respons is geen JSON | migreer auth, laat de responsopbouw ongemoeid; `--verify` dekt bytes (sha256) en redirect (`location_pad`) |
| Machine-/cron-routes (`CRON_SECRET`, `cron-auth.ts`, `withPlatformRead`) | geen `getUser`-preamble | **niet** migreren; buiten scope van deze wrapper |
| Publieke route (`contact`) | bewust geen auth | niet migreren |
| Route zonder eigen `try/catch` | de wrapper vangt dan als eerste | check of de bestaande foutrespons identiek blijft; zo niet → `BESLUIT:` |

## Werkwijze per route (checklist)

1. Zit de route in het harnas? Zo niet: voeg eerst een baseline-scenario toe en
   `--record` tegen de **ongemigreerde** code.
2. Migreer volgens het patroon hierboven.
3. `./node_modules/.bin/tsc --noEmit --skipLibCheck` groen.
4. `npm run build` + `node tests/karakterisering/run.mjs --verify` → byte-identiek.
5. Verschil? Onderzoek, log als `BESLUIT:` met reden. Werk het snapshot alleen
   bij als de afwijking aantoonbaar gewenst is.
6. `npm run lint:boundaries` groen (service-role blijft onbereikbaar).

## Wat je NOOIT "er even bij" doet

Capability-checks, schemavalidatie, rate limiting, auditconsolidatie, of het
uitsturen van `x-request-id` — dat is **deploy 3**. Elke control die je hier
toevoegt maakt v1 gedragsveranderend en breekt de byte-identiteit die dit hele
spoor mogelijk maakt.

## Wat in W3 in de praktijk anders bleek (lees vóór W4)

De acht W3-routes leverden vier verfijningen op het recept op. De
diff-classificatie (`tests/karakterisering/classificeer-diff.mjs`) kent ze
inmiddels; W4 kan erop leunen.

1. **Houd body-churn nul met lokale aliassen.** Naast `const supabase =
   ctx.supabase;` ook `const fondsId = ctx.fondsId;` /
   `const bureau = isBureauRol(ctx.rol);` — dus de lokale variabele behouden i.p.v.
   elke body-regel naar `ctx.*` herschrijven. Dat houdt de diff minimaal en de
   classificatie triviaal `conform`. Alleen waar de route de waarde één keer
   gebruikt, mag de substitutie (`user.id → ctx.gebruikerId`, `profiel?.rol →
   ctx.rol`) inline.

2. **Gesplitste signaturen en calls.** `[id]`-routes hebben vaak een handler-
   signatuur over vier regels (`export async function GET(` / `_req: NextRequest,`
   / `{ params }: { params: Promise<{ id: string }> }` / `) {`) en host-guard-/
   403-blokken over meerdere regels. Die collapsen naar één wrapper-regel; de
   classifier herkent de fragmenten. Voor `[id]`-routes: `const { id } = params as
   { id: string };` (géén `await params`), en de handler-arg-volgorde
   `(ctx, _req: NextRequest, params)`.

3. **Laat de `NextRequest`-import staan en annoteer de req-parameter.** Anders
   wordt de import ongebruikt en zou je hem "even" moeten opruimen — dat is een
   niet-mechanische wijziging. `async (ctx, req: NextRequest)` /
   `async (ctx, _req: NextRequest, params)` houdt de import eerlijk gebruikt.

4. **Host-guard-ordening bij een route met een eigen `if (!fondsId)`-403.**
   `aqlab/assurance` en `zoeken` deden vroeger `if (!fondsId) → <eigen 403>` VÓÓR
   de host-guard. De wrapper draait de host-guard juist vóór de handler. Onder
   `TENANT_ENFORCE≠on` (observe — de test-/standaardconfig) is de guard
   transparant, dus byte-identiek. Onder `TENANT_ENFORCE=on` kan een gebruiker
   zónder fonds de host-guard-403 krijgen i.p.v. de eigen 403 (zelfde status,
   andere body). Dat is een **`BESLUIT:`** per route, geen stilzwijgende aanname.
   Laat de eigen `if (!fondsId)`-tak altijd IN de handler staan.

**De classificatie is de poort, niet het harnas alleen.** Het harnas bewijst
gedrag (byte-identiek); de classifier bewijst dat de diff mechanisch is. In W3 is
aangetoond dat een verboden "betere foutmelding" op het 500-pad het harnas groen
liet maar door de classifier als `afwijkend` werd gevangen. Draai in W4 ná elke
route `node tests/karakterisering/classificeer-diff.mjs`; een `afwijkend` is een
regel om te lezen, geen bug in het script.

## De statische guards moeten wrapper-bewust zijn (W3, issue #94)

Het karakteriseringsharnas bewijst **gedrag** (byte-identiek). Daarnaast staan er
in `tests/cross-tenant/*.test.ts` tientallen **statische guards** die de BRON
inspecteren: "roept deze route `createServerSupabase(` aan?", "staat
`beoordeelRouteHostToegang(` erin?", "zie ik `auth.getUser`?". Die guards zijn
geschreven voor een route die haar preambule zélf schrijft. De codemod verplaatst
precies díé regels naar de wrapper — dus gaan ze vals-rood, terwijl er functioneel
niets is verzwakt. In W3 gebeurde dat bij twee verplichte checks tegelijk
(`AFS-1`, `AQL-4`; beide draaien via `npm run test:xtenant`, dus zowel
*Cross-tenant isolatie* als *Security baseline*).

**Los dit nooit op door het patroon uit de guard te schrappen.** Dan is de guard
vals-groen: er bewijst niets meer dat er een RLS-client of een host↔fonds-grens
is. Gebruik `tests/cross-tenant/route-wrapper-bewust.ts`:

```ts
import { redenGeenRlsClient, redenGeenHostGuard, redenGeenGebruikerscontrole }
  from "./route-wrapper-bewust";

const bron = lees("app", "api", "…", "route.ts");
assert.equal(redenGeenRlsClient(bron), null, "route mist anon+RLS-auth");
assert.equal(redenGeenHostGuard(bron), null, "route mist host↔fonds-enforce");
```

Elke helper geeft `null` (in orde) of een leesbare reden, en berust op drie
principes:

1. **Per handler, niet per bestand.** De helper inventariseert de geëxporteerde
   HTTP-handlers en bepaalt per handler waar de belofte hoort te staan: in de
   route (klassiek) of in de wrapper (`export const GET = withFondsRoute(…)`).
   Dat is *strenger* dan voorheen — eerst volstond het dat het patroon érgens in
   het bestand stond.
2. **De delegatie is verankerd.** `toetsWrapperFundament()` (automatisch
   aangeroepen) bewijst dat `core/lib/route-wrapper.ts` de belofte feitelijk
   waarmaakt: `createServerSupabase` + `auth.getUser` + 401-tak, géén
   `createServiceSupabase`/`SUPABASE_SERVICE_ROLE_KEY`, en onder `spec.hostGuard`
   een echte `beoordeelRouteHostToegang`-aanroep met 403 bij afwijzing. Zonder
   dat anker is "de route wijst naar de wrapper" een lege verwijzing.
3. **Alleen de echte wrapper telt.** `withFondsRoute` wordt pas geaccepteerd als
   de route hem uit `@/core/lib/route-wrapper` importeert; een gelijknamige lokale
   functie valt terug op de klassieke eis.

`hostGuard` is expliciet: `withFondsRoute({ hostGuard: true }, …)` telt als
host↔fonds-enforce, `withFondsRoute({}, …)` **niet**. Vergeet je de spec-vlag bij
het migreren van een van de 12 host-guard-routes, dan valt de guard rood uit —
zoals bedoeld.

### Negatieve controle (besluit 0046 §E) — vier lekken die rood móéten worden

Draai deze vier vóór je een guard wrapper-bewust noemt; commit ze nooit:

| Lek | Verwachte melding |
|---|---|
| `hostGuard: true` uit de spec halen | `GET dwingt host↔fonds niet af …` |
| `withFondsRoute` lokaal shadowen i.p.v. importeren | `GET schrijft de preambule zelf maar roept createServerSupabase( niet aan` |
| Service-role in de wrapper introduceren | `wrapper raakt de service-role — dan lekt élke gedelegeerde route eromheen` |
| De `spec.hostGuard`-tak uit de wrapper halen | `wrapper: spec.hostGuard roept beoordeelRouteHostToegang niet aan` |
| Het 403 uit de wrapper-afwijzing halen | `wrapper: een afgewezen host-oordeel leidt niet tot 403` |

Dezelfde vier gelden voor `scripts/g2-evidence.sh` (`bash scripts/g2-evidence.sh`,
verwacht **21 groen, 0 rood**). De derde variant is daar niet theoretisch: een
eerdere versie van die check keek naar het lósse woord `spec.hostGuard` en bleef
groen op een uitgeholde wrapper.

### Guards buiten CI zijn het echte gevaar

AFS-1 en AQL-4 vielen tenminste op — twee rode required checks. `scripts/g2-evidence.sh`
viel **stil** om: de A1-lus grept vijf hoogrisico-routes op
`beoordeelRouteHostToegang`, en `app/api/zoeken/route.ts` is in W3 gemigreerd. Dat
script draait in geen enkele workflow (het is de mechanische aftekening voor de
**G2/B10 go/no-go**, criterium A1, P0), dus er was geen signaal. Zonder deze
controle was de livegang-evidence stilzwijgend één criterium armer geworden.

Het is daarom nu wrapper-bewust — `check_hostguard` + `check_wrapper_fundament`,
met dezelfde twee-wegen-logica en dezelfde verankering als de TS-helper. **Zoek
vóór W4 breder dan CI**: `grep -rn "app/api" scripts/ tests/` vindt wat er nog
meer naar route-bronnen kijkt.

Twee bash-specifieke valkuilen die de negatieve controle blootlegde, allebei
stille vals-signalen:

- **`grep -q` achter een pipe onder `set -o pipefail`.** `grep -q` sluit de pipe
  bij de eerste match → SIGPIPE op de schrijver → de pipeline telt als mislukt.
  Een geslaagde toets werd zo rood. Gebruik een herestring (`<<<"$plat"`).
- **Herhalingstellers boven 255.** BSD grep (macOS) weigert `.{0,300}` met
  *invalid repetition count(s)*; GNU grep (CI) accepteert het. Lokaal rood, in CI
  groen — of andersom. Blijf onder 255.

En let op waar je op toetst: `grep -q "spec.hostGuard"` op de wrapper werd al
bevredigd door de **commentaarkop**. Een commentaar is geen handhaving. Toets op
adjacentie tussen de tak en de daadwerkelijke aanroep, zoals `toetsWrapperFundament()`
dat doet.

### Wat de W4-inventarisatie opleverde (stap 0, issue #94)

**De aanbevolen zoekopdracht is te smal.** `grep -rn "app/api" scripts/ tests/`
vindt 8 van de 14 bestanden die route-bronnen lezen: guards die hun pad met
`lees("app", "api", …)` opbouwen — dus juist de in W3 omgezette — bevatten het
letterlijke fragment `app/api` niet. Zoek daarom óók op `'"api"'` en op
`route\.ts`; dat trio dekt alle 14.

Van die 14 hangen er drie aan de preambule, en die zijn in W4 omgezet:

| Guard | Bestand | Wat eraan hing | Nu |
|---|---|---|---|
| `AFS-3` | `afschrift-toegang.test.ts` | letterlijk `beoordeelRouteHostToegang(` | `redenGeenHostGuard()` |
| `T14` (fonds uit profiel) | `t14-stuurinfo-invoer.test.ts` | `profiel.fonds_id` / `profiel?.fonds_id` | `redenFondsIdNietUitProfiel()` |
| `BB-15` | `bureau-rolgrenzen.test.ts` | `isBureauRol(profiel?.rol)` letterlijk | `rolUitdrukkingVoor()` |

De overige elf toetsen op iets dat de codemod niet aanraakt (rol-gates,
`isBureauRol(` + 403, `weigerAlsModuleUit`, `requireCapability`, RPC-vormen,
`ai-preflight`, migratieteksten). Ze zijn bewust ONGEMOEID gelaten: een guard
"voor de zekerheid" omschrijven vergroot alleen het oppervlak waarop hij stil kan
vervallen. `scripts/g2-evidence.sh` was in W3 al wrapper-bewust en blijft groen
(21/0), óók voor `documents/upload` zodra die met `hostGuard: true` migreert.

#### Twee nieuwe helpers in `route-wrapper-bewust.ts`

- `redenFondsIdNietUitProfiel(bron)` — "het fonds komt server-side uit het
  profiel" geldt klassiek via `profiel?.fonds_id` en na de codemod via
  `ctx.fondsId`. De negatieve helft ("nooit uit de body") blijft bij de aanroeper.
- `rolUitdrukkingVoor(bron)` — geeft `"profiel?.rol"` of `"ctx.rol"`, afhankelijk
  van of ÉLKE handler delegeert. Een guard die op de letterlijke regel toetst
  blijft daarmee even streng: niet "een van beide vormen ergens in het bestand",
  maar de juiste vorm op de juiste regel.

Beide leunen op `toetsWrapperFundament()`, dat in W4 twee ankers erbij kreeg:
`ctx.fondsId` komt aantoonbaar uit `haalProfiel` (`const fondsId = profiel?.fondsId`)
en `ctx.rol` uit `rol: profiel?.rol`. Zonder die ankers zou het accepteren van
`ctx.*` een lege verwijzing zijn — precies het vals-groen dat W3 wilde uitsluiten.

#### De negatieve controle die dit afdekt

Tien lekken, alle tien rood, plus één positieve controle (een gemigreerde route
mag niet vals-rood vallen). Eén valkuil bleek in de praktijk beslissend: de
sabotage-transformaties **stapelen** als je de route er niet tussendoor herstelt.
De shadow-variant liet daardoor de échte wrapper-import staan en mat niets — hij
kwam vals-groen uit. Herstel tussen elke meting.

### Voor W5

Na W4 zijn alle bron-guards die aan de preambule hingen wrapper-bewust; W5 hoeft
er geen meer om te zetten. `AFS-3` dekt ook de downloadroute
(`procedures/[id]/afschriften/[afschriftId]/download`), die in W5 migreert — die
staat dus al klaar. (`portaalcontext-privacy` inspecteert een lib-helper, geen
route — daar speelt de wrapper niet.)

Kom je toch een nieuwe tegen: zet hem met dezelfde helpers om, één regel per
assertie, en draai de negatieve controle. Dat hoort bij de route-migratie, niet
bij een aparte "testfix" — een guard die stil vervalt is het enige echte risico
van dit hele spoor.
