# 0117 — Geen direct DELETE-recht voor gebruikers op chat-, inhoud-, redactie- of flowtabellen

- **Status:** Geaccepteerd
- **Datum:** 2026-08-04
- **Betrokkenen:** IB, ontwikkeling

## Context

De policy `"eigen gesprekken"` was `for all`, dus inclusief DELETE. Zolang verwijderen alleen "archiveren" was, viel dat niet op. Zodra verwijderen echt verwijderen wordt, is een direct DELETE-pad een gat: het zou de chatinhoud kunnen weghalen zónder redactieregel, en daarmee de belofte "elke verwijdering laat een spoor na" onwaar maken.

## Besluit

Geen enkele tenant-rol krijgt DELETE op `gesprekken`, `governance_log_inhoud`, `governance_redacties`, `governance_audit_inzage` of `governance_audit_grants`. De `for all`-policy op `gesprekken` is gesplitst in SELECT, INSERT en UPDATE; `governance_log_inhoud` heeft uitsluitend een SELECT-policy. Verwijderen loopt via [[0116]]. Tabelgrants worden bovendien expliciet ingetrokken in plaats van op de default-ACL te leunen.

## Overwogen alternatieven

- **DELETE-policy met eigenaarspredicaat** — technisch veilig tegen cross-tenant misbruik, maar het omzeilt de redactieregel. Verworpen.
- **Vertrouwen op de default-privileges uit R6** — verworpen: `alter default privileges` werkt per eigenaar, en R6 kon de `supabase_admin`-kant niet dichtzetten. Een tabel die door die rol wordt aangemaakt krijgt opnieuw de volledige grant, inclusief TRUNCATE — en TRUNCATE valt volledig buiten RLS. Expliciete revokes kosten niets en halen de aanname weg.

## Gevolgen

- **RLS:** vier nieuwe deny-by-default tabellen; `governance_audit_grants` heeft géén enkele policy en is alleen leesbaar binnen de definer-helpers.
- **Beheer:** het eenmalige service-role-script `_wipe_gesprekken.mjs` is ingetrokken. Dat was het enige bestaande hard-delete-pad en het schreef geen redactieregel.
- **Verificatie:** de rol-/capabilitysuite toetst dat een directe DELETE via de anon-key op alle drie de tabellen niets raakt (AC-7).

## Referenties

- `supabase/migrations/2026_08_04_a2_audit_least_privilege.sql`
- `supabase/checks/2026_08_04_a_rollen_capabilities.sql`
- [[0116]], [[0118]]
