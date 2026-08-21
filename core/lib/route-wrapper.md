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
