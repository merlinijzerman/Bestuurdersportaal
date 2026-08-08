# 0135 — Host per fonds: de app-host is Horizon's eigen host, en echte fondsnamen mogen in de repo

- **Status:** Geaccepteerd
- **Datum:** 2026-08-06
- **Betrokkenen:** Merlin (opdrachtgever/bestuurder), Claude (uitvoering/advies)
- **Relatie:** herziet de reikwijdte van [`0043`](./0043-tenant-domains-bridge-app-host.md) (transitionele app-host-bridge) en van de guardrail in `supabase/migrations/2026_07_09_t8_demo_fonds_seed.sql`. Bouwt voort op [`0040`](./0040-tenant-model-bridge-ready-pool.md) (tenant-model), [`0041`](./0041-tenant-resolver-observe.md)/[`0042`](./0042-tenant-enforce-fail-closed.md) (resolver + enforce) en [`0029`](./0029-drie-host-classes.md)/[`0030`](./0030-login-op-app-host.md) (drie surfaces).

## Context

Voor de demo-omgeving krijgen drie fondsen een eigen subdomein: `pgb.`, `phenc.` en `huisartsenpensioen.bestuurdersportaal.com`. Twee eerder vastgelegde uitgangspunten staan die inrichting in de weg — niet omdat ze fout waren, maar omdat de situatie waarvoor ze zijn geschreven niet meer de onze is.

**1. De app-host-bridge.** Migratie `2026_07_08_tenant_domains_bridge_app_host.sql` mapt `app.bestuurdersportaal.com` naar Horizon en draagt de instructie: *"VERWIJDER deze rij vóór het onboarden van een tweede fonds"*, met als grond dat *"een gedeelde app-host niet naar één fonds kan resolven zodra er een tweede fonds bestaat"*. Dat argument is geldig zolang de app-host **gedeeld** is — de host waar iedereen binnenkomt. In de inrichting die we nu kiezen is hij dat niet: elk nieuw fonds krijgt een eigen subdomein en `app.bestuurdersportaal.com` blijft uitsluitend in gebruik bij Horizon.

Dit is niet louter cosmetisch. De huidige gebruikers hebben die URL; hem intrekken betekent een gecommuniceerde wijziging bij de enige partij die het portaal vandaag echt gebruikt, zonder functionele winst.

**2. De hardcode-guardrail.** De T8-demo-seed legt vast: *"Bewust FICTIEF: geen echte fondsnaam/host/fonds-id gehardcode (guardrail)"*. Die guardrail hoort bij wat die migratie is — een **fictieve** seed die aantoont dat twee fondsen op dezelfde codebase zichtbaar verschillen. Voor het aanmaken van echte tenants is hij niet houdbaar: zonder fondscreatie-UI (P3 slice A is niet gebouwd) is een migratie het enige pad, en een fonds zonder naam is geen fonds.

## Besluit

1. **`app.bestuurdersportaal.com` is vanaf nu de vaste tenant-host van Horizon**, geen transitionele bridge. De rij in `tenant_domains` blijft staan; de ROLLBACK-migratie van `0043` wordt **niet** gedraaid. Elk volgend fonds krijgt een eigen subdomein `<slug>.bestuurdersportaal.com`.
2. **Echte fondsnamen en hosts mogen in migraties in de repo staan** voor het aanmaken van tenants. De hardcode-guardrail blijft van kracht voor *demonstratieve* seeds (zoals Meridiaan), waar een fictieve naam het punt juist scherper maakt.
3. **De demo-fondsen draaien op het basispalet.** Herkenning loopt via het **logo** en de fondsnaam, niet via merkkleuren. Merkkleuren van een fonds overnemen vraagt toestemming en is voor een demo een onnodig risico; bovendien is de bruikbare kleurruimte smal (zie hieronder). De drie getoetste paletten blijven in dit besluit staan voor als differentiatie op kleur later alsnog gewenst is.
4. **Statutaire namen zijn leidend** als `fondsen.naam`, conform het DNB-register: *Stichting Pensioenfonds PGB*, *Stichting Pensioenfonds Horeca & Catering*, *Stichting Pensioenfonds voor Huisartsen*. Een bestuurdersportaal spreekt de taal van statuten en jaarverslagen, niet van publiekscampagnes.

## Overwogen alternatieven

- **De bridge-rij wél verwijderen en Horizon naar `horizon.bestuurdersportaal.com` verhuizen.** Architectonisch het schoonst: elk fonds een eigen subdomein, geen uitzondering. De rij `horizon.bestuurdersportaal.com` staat zelfs al in `tenant_domains` (seed 08-07), alleen niet in DNS. Afgevallen op kosten/baten: het vraagt een URL-wijziging bij de bestaande gebruikers plus het bijwerken van `APP_HOST` en de apex-loginredirect, en levert geen functioneel verschil op. Blijft beschikbaar als latere opruimactie.
- **Hosts registreren in `APP_HOST` in plaats van op de fail-safe fallback leunen.** `hostSet()` splitst op komma's, dus de surface-bepaling zou werken — maar `middleware.ts` doet bij de marketing-`/login`-redirect letterlijk `url.host = process.env.APP_HOST`. Met een kommalijst wordt dat een ongeldige host en breekt de loginlink vanaf de marketingsite. Afgevallen tot die regel is gefixt; vastgelegd als openstaand punt.
- **Fondsnamen buiten git houden** en alleen als losse SQL uit het runbook draaien. Houdt klantnamen uit de versiegeschiedenis, maar de subdomeinen staan straks toch in publieke DNS, dus de vertrouwelijkheidswinst is klein — en je verliest de reproduceerbare bootstrapset die juist het doel is van het omgevingsspoor. Afgevallen.
- **Merknamen als weergavenaam** (*Pensioenfonds PGB*, *Huisarts & Pensioen*). Herkenbaarder, maar wijkt af van de naam op de stukken waarover het portaal gaat. Afgevallen; kan later per fonds via een content-override in de T8-configlaag.

## Gevolgen

- **Datamodel/migraties:** geen schemawijziging. Twee dataseeds: `2026_08_06_demo_fondsen_bootstrap.sql` (fondsen + theming + manifest + flags) en `2026_08_06_tenant_domains_demo_fondsen.sql` (host→fonds), beide idempotent met ROLLBACK.
- **RLS/tenant-isolatie:** ongewijzigd. `tenant_domains` blijft deny-by-default (alleen leesbaar via de service-role/RPC); de fondsisolatie loopt onverkort via RLS op `profielen.fonds_id`.
- **Beveiliging — expliciet te kennen:** zolang `TENANT_ENFORCE` uit staat is een subdomein **routing, geen grens**. Een gebruiker van fonds A die op de host van fonds B inlogt, ziet nog steeds zijn eigen data (RLS), maar op de verkeerde vlag. Pas met enforce aan moeten host en fonds overeenkomen. Noem een subdomein daarom in commerciële context geen "eigen omgeving".
- **Gebruikerservaring:** Horizon-gebruikers merken niets; hun URL blijft `app.bestuurdersportaal.com/login`. Nieuwe fondsen krijgen hun eigen login-URL met een **neutrale** loginpagina (TO §2.5) — fondsbranding verschijnt pas ná inloggen. Branding op de loginpagina is besloten als apart increment ná de eerste demoronde.
- **Toegankelijkheid.** Het basispalet blijft ongewijzigd, dus er is op dit punt geen risico geïntroduceerd. De drie alternatieve paletten zijn wél getoetst met `scripts/toets-fondsthema.mjs` (0 overtredingen, 0 waarschuwingen) en bewaard — zie hieronder.
- **Opruiming uitgevoerd (07-08-2026).** De in dit besluit als "latere opruimactie" benoemde dode host `horizon.bestuurdersportaal.com` is verwijderd: de `tenant_domains`-rij (migratie `2026_08_07_tenant_domains_horizon_verwijderen.sql`), de Vercel-DNS A-records, en `APP_HOST` van het beheer-project → `app.bestuurdersportaal.com`. Aanleiding: die host resolvete naar Vercel **zonder cert** (afgebroken TLS-handshake) en zette daardoor de P5-uptimemeting op "Verstoord". De bridge-rij `app.bestuurdersportaal.com → Horizon` blijft. Zie HANDOVER-release 07-08-2026.
- **Bewust geaccepteerd / open:**
  - *`APP_HOST` mag geen kommalijst worden* tot de middleware het eerste item pakt. Nu onzichtbaar omdat er één host is. (De P5-uptimeprobe verwerkt sinds 07-08 wél een kommalijst — dat is de monitor, niet de app-middleware; deze caveat blijft dus staan voor de app zelf.)
  - *De apex-`/login` redirect naar `APP_HOST`*, dus naar Horizon. Gebruikers van andere fondsen moeten hun directe URL krijgen. Een fondskeuze of neutrale pagina op de apex is een apart besluit.
  - *De demo-seed van Meridiaan faalt de themetoets*: `nav` is overschreven zonder `nav-text`/`nav-text-active`, wat 2,28:1 en 1,28:1 contrast oplevert (eis 4,5:1). Onleesbare navigatie. Los op of verwijder de seed — zie het openstaande punt.
  - *De guardrail-herziening geldt alleen voor tenant-aanmaak.* Fictieve namen blijven de norm voor demonstratieve seeds.

## Bijvangst: de bruikbare kleurruimte is smal

Bij het kiezen van drie onderscheidende accentkleuren bleek `scripts/toets-fondsthema.mjs` strenger dan verwacht, en terecht. De semantische tokens bezetten groen (`--ok`), rood (`--err`), amber (`--warn`) en cyaan (`--phase`). De toets eist niet alleen WCAG-contrast maar ook een perceptuele afstand van ΔE ≥ 25 tot elk van die vier — **óók onder gesimuleerde protanopie en deuteranopie**.

Dat sluit vrijwel de hele warme helft van het spectrum uit: elk rood, bordeaux, magenta of olijf accent valt onder rood-groenblindheid samen met `--ok` of `--err` (gemeten ΔE tot 8). Een bordeaux accent voor Horeca & Catering — inhoudelijk voor de hand liggend — haalde 9,3. Wat overblijft is blauwviolet tot aubergine, plus een smalle marge richting donkerblauw. De gekozen drie zitten daar bewust ver genoeg uit elkaar en houden marge tot `--phase`, wat de krapste grens is.

Waarde van deze constatering los van dit besluit: **een fonds mag niet zelf vrij een accentkleur kiezen zonder deze toets te draaien.** Zodra fondsconfiguratie zelfservice wordt, hoort de toets in de schrijfweg te zitten, niet in een script dat je moet onthouden.

**Drie getoetste paletten, bewaard voor later.** Deze haalden 0 harde overtredingen en 0 verwarringswaarschuwingen. Ze worden nu niet toegepast (zie besluitpunt 3), maar zijn direct bruikbaar als differentiatie op kleur alsnog gewenst is:

| Fonds | accent | accent-ink | accent-tint | nav | nav-text | nav-text-active | nav-accent |
|---|---|---|---|---|---|---|---|
| PGB (blauwpaars) | `58 44 140` | `44 34 106` | `233 231 247` | `22 17 54` | `174 170 212` | `255 255 255` | `130 122 212` |
| PH&C (aubergine) | `88 30 84` | `68 22 64` | `242 231 241` | `34 12 32` | `198 172 196` | `255 255 255` | `172 112 168` |
| Huisartsen (diep blauw) | `24 46 92` | `18 34 70` | `229 233 242` | `10 18 38` | `160 172 196` | `255 255 255` | `104 128 190` |

Wie een palet toepast, zet **altijd ook `nav-text` en `nav-text-active`** mee. Doe je dat niet bij een donkere nav, dan valt de navtekst terug op de basiswaarde en wordt het menu onleesbaar — precies wat de Meridiaan-seed doet (gemeten 2,28:1 en 1,28:1 bij een eis van 4,5:1).

## Randvoorwaarden voor het logo

Bij het plaatsen van de eerste drie echte logo's bleek de oorspronkelijke aanname niet te kloppen, en dat heeft geleid tot een aanpassing van de renderlaag.

**Wat er misging.** De zijbalk toonde het logo in een tegel van 40×40 px met achtergrond `--nav-accent` (donkerblauw). De drie aangeleverde bestanden zijn echter **woordmerken** met verhoudingen van 1,8:1 (PGB) tot 3,8:1 (Huisartsen), en overwegend donker: PH&C gebruikt `#193C6C`, vrijwel gelijk aan de navy van de tegel zelf. Resultaat: één logo onleesbaar klein, één vrijwel volledig weggevallen. Dat is geen eigenschap van deze drie bestanden maar van fondslogo's in het algemeen — een woordmerk is bij pensioenfondsen de norm, niet de uitzondering.

**Wat er is gewijzigd** (`core/components/Sidebar.tsx`): is er een `logo-url`, dan rendert de zijbalk uitgeklapt een **brede, transparante strook** waarin het logo op maximaal 28 px hoogte staat, links uitgelijnd met de fondsnaam eronder. Geen eigen achtergrond en geen rand — dat leverde op de lichte nav van het basispalet een zichtbaar kader in een kader op. Zonder `logo-url` blijft alles exact zoals het was (vierkante tegel met de letter), dus Horizon is ongemoeid. In de **ingeklapte** zijbalk valt het terug op de vierkante tegel met de letter: een woordmerk van 14 px breed is zinloos.

Daarmee vervalt de eerdere eis van een wit of monochroom beeldmerk: **een gewoon woordmerk in de huisstijlkleuren volstaat.**

**Wat wél blijft gelden:**

- **De CSP staat `img-src 'self' data: blob:`** (`next.config.ts`). Een logo dat vanaf de site van het fonds wordt geladen, wordt geblokkeerd. De bestanden horen in `public/logos/`; `logo-url` verwijst dan naar een intern pad (`/logos/<slug>.svg`), wat ook de enige vorm is die het URL-patroon in `fonds-config-core.ts` zonder meer accepteert.
- **De transparante strook veronderstelt een licht nav-vlak.** Dat is in het basispalet zo. Overschrijft een fonds ooit `nav-rgb` naar een donkere waarde, dan valt een donker woordmerk weg; lever dan een lichte logovariant aan of zet in de strook een ondergrond terug. Staat als waarschuwing in de code.

Hotlinken zou overigens ook los van de CSP onwenselijk zijn: elke paginaweergave zet dan een request naar de server van het fonds, met de demo-host in de referrer.

**Toestemming.** Het logo van een fonds gebruiken in een demo die voor dat fonds is gebouwd is gebruikelijk, maar vraag het even. En toon een demo-omgeving nooit aan een andere partij — met drie concurrenten tegelijk in dezelfde omgeving is dat geen theoretisch punt.

## Referenties

- `supabase/migrations/2026_08_06_demo_fondsen_bootstrap.sql` (+ ROLLBACK)
- `supabase/migrations/2026_08_06_tenant_domains_demo_fondsen.sql` (+ ROLLBACK)
- `supabase/migrations/2026_07_08_tenant_domains_bridge_app_host.sql` (rij blijft staan)
- `supabase/migrations/2026_07_09_t8_demo_fonds_seed.sql` (guardrail-tekst; faalt de themetoets)
- `core/lib/platform-host.ts` (`bepaalSurface`, `hostSet`), `middleware.ts` (redirect-bug)
- `scripts/toets-fondsthema.mjs` (themetoets)
- `04 Technische inrichting/Bestuurdersportaal - DNS-runbook subdomeinbeheer (variant B) v0.2.md`
- DNB openbaar register (statutaire namen): [PGB](https://www.dnb.nl/openbaar-register/registerdetailpagina/?registerCode=PWPNF&relationNumber=14089), [Horeca & Catering](https://www.dnb.nl/openbaar-register/registerdetailpagina/?registerCode=PWPNF&relationNumber=32868), [Huisartsen](https://www.dnb.nl/openbaar-register/registerdetailpagina/?registerCode=PWPNF&relationNumber=00001)
