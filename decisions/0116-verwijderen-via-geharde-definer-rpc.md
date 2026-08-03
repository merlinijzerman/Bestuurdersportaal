# 0116 — Verwijderen uitsluitend via een geharde `security definer`-RPC, idempotent op `request_id`

- **Status:** Geaccepteerd
- **Datum:** 2026-08-04
- **Betrokkenen:** IB, ontwikkeling

## Context

Een gesprek verwijderen raakt drie tabellen in een vaste volgorde: de chatinhoud bij de gekoppelde auditregels, het gesprek zelf, en een redactieregel als tegenhanger. Gebeurt dat in losse client-aanroepen, dan kan een netwerkfout halverwege een toestand achterlaten waarin de inhoud weg is maar de redactieregel ontbreekt — of andersom. Bovendien mag de client nooit bepalen wíé de eigenaar is.

## Besluit

Verwijderen loopt uitsluitend via `public.verwijder_gesprek(p_gesprek_id, p_request_id)`: `security definer`, vaste `search_path`, `EXECUTE` ingetrokken van `public` én `anon`, gericht toegekend aan `authenticated`. De functie bepaalt `auth.uid()` intern, leest het eigenaarschap uit de rij met `for update`, en is idempotent op een uniek `request_id` — met een advisory lock zodat een gelijktijdige tweede aanroep geen werk doet.

## Overwogen alternatieven

- **Verwijderen vanuit de client met RLS-policies** — verworpen: geen transactiegarantie over drie tabellen, en de redactieregel zou een aparte insert zijn die kan mislukken.
- **Service-role in een API-route** — verworpen: strijdig met de guardrail dat tenant-code nooit de service-role gebruikt. De route roept de RPC aan met de anon-key mét sessie.
- **Alleen een unieke constraint zonder advisory lock** — de constraint vangt de dubbele redactieregel wel, maar pas nadat de tweede aanroep de inhoud al heeft proberen te verwijderen. De lock voorkomt dat werk.

## Gevolgen

- **Audit:** elke verwijdering levert precies één regel in `governance_redacties`. Het auditspoor zelf wordt niet aangeraakt — nergens een UPDATE op `governance_log`, dus de append-only trigger komt niet in beeld en `gesprek_audit_id` blijft staan ([[0120]]).
- **Foutafhandeling:** functionele foutcodes (`geen_eigenaar`, `gesprek_niet_gevonden`), nooit inhoud in een foutmelding. De API-route vertaalt naar HTTP zonder details van andermans gesprek prijs te geven.
- **Bewust geaccepteerd:** interacties van vóór plateau A hebben `gesprek_audit_id = null` en zijn dus niet door de gebruiker te verwijderen. Benoemd in de verwijderdialoog en als restrisico.
- **Afhankelijkheid:** de functie passeert RLS doordat eigenaar en tabeleigenaar samenvallen en `force row level security` nergens aanstaat. Bewaakt door de rol-/capabilitysuite.

## Referenties

- `supabase/migrations/2026_08_04_a2_audit_least_privilege.sql`
- `app/api/gesprekken/[id]/route.ts`, `core/lib/gesprek-verwijderen.ts`
- `supabase/checks/2026_08_04_a_rollen_capabilities.sql` (AC-8, AC-10)
- [[0117]], [[0118]], [[0120]]
