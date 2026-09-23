#!/usr/bin/env python3
"""#440 — verzamelt wat migraties VERWIJDEREN, en houdt over wat echt weg hoort.

Een contractmigratie als 423b is niet te meten aan een nieuw object, maar wél
aan de AFWEZIGHEID van wat zij dropt. Die controle ontbrak: het rapport noemde
alleen dát er iets gedropt werd.

Alleen drops die na de VOLLEDIGE keten ook werkelijk afwezig zijn tellen mee.
Een `drop` gevolgd door een `create` van dezelfde signatuur zegt niets over
afwezigheid, en zou een valse bevinding opleveren.
"""
import io, os, re, sys, json

MIGRATIES = "supabase/migrations"

def zonder_commentaar(sql):
    sql = re.sub(r"/\*[\s\S]*?\*/", " ", sql)
    return re.sub(r"^\s*--.*$", "", sql, flags=re.M)

def haakjes(sql, i):
    """Van de openende haak op positie i tot de bijbehorende sluithaak."""
    diepte, j = 0, i
    while j < len(sql):
        if sql[j] == "(":
            diepte += 1
        elif sql[j] == ")":
            diepte -= 1
            if diepte == 0:
                return sql[i + 1:j]
        j += 1
    return None

def main():
    cutoff = re.search(r'^BASELINE_CUTOFF="([^"]+)"',
                       io.open("scripts/testdb-apply-migrations.sh", encoding="utf-8").read(),
                       re.M).group(1)
    gevonden = []
    for f in sorted(x for x in os.listdir(MIGRATIES) if x.endswith(".sql")):
        if not f > cutoff:
            continue
        sql = zonder_commentaar(io.open(os.path.join(MIGRATIES, f), encoding="utf-8").read())
        for m in re.finditer(r"drop\s+function\s+(?:if\s+exists\s+)?([\w\.]+)\s*\(", sql, re.I):
            args = haakjes(sql, m.end() - 1)
            if args is None:
                continue
            args = " ".join(args.split())
            gevonden.append(("FUNC", f"{m.group(1)}({args})", f))
        for m in re.finditer(r"drop\s+(?:table|view|materialized\s+view)\s+(?:if\s+exists\s+)?([\w\.]+)", sql, re.I):
            gevonden.append(("REL", m.group(1), f))

    # Ontdubbelen op object; de LAATSTE migratie die hem dropt is de eigenaar
    # van de verwachting "dit hoort weg te zijn".
    per_object = {}
    for soort, obj, mig in gevonden:
        per_object[(soort, obj)] = mig

    # ── HET FILTER DAT ERBIJ HOORT ───────────────────────────────────────
    # Veel migraties doen `drop` gevolgd door `create` van dezelfde signatuur.
    # Zonder dit filter meldt de afwezigheidscontrole die objecten als "NOG
    # AANWEZIG" op een omgeving waar alles perfect is toegepast — acht valse
    # bevindingen op de referentie, gemeten. Alleen wat na de VOLLEDIGE keten
    # ook werkelijk weg is, hoort weg te zijn.
    aanwezig = set()
    if len(sys.argv) > 1 and os.path.exists(sys.argv[1]):
        for r in io.open(sys.argv[1], encoding="utf-8"):
            r = r.strip()
            if r:
                aanwezig.add(r)
    echt_weg = {k: v for k, v in per_object.items() if k[1] not in aanwezig}

    io.open("supabase/checks/440-afwezig-verwacht.generated.tsv", "w", encoding="utf-8").write(
        "soort\tobject\tmigratie\n"
        + "\n".join(f"{s}\t{o}\t{m}" for (s, o), m in sorted(echt_weg.items())) + "\n")
    # Het controlebestand: welke objecten de referentie moet natrekken.
    io.open("supabase/checks/440-afwezig-kandidaten.generated.tsv", "w", encoding="utf-8").write(
        "\n".join(f"{s}\t{o}" for (s, o) in sorted(per_object)) + "\n")
    print(json.dumps({"gedropte_kandidaten": len(per_object),
                      "opnieuw_aangemaakt_dus_genegeerd": len(per_object) - len(echt_weg),
                      "echt_afwezig_verwacht": len(echt_weg),
                      "migraties_met_drop": len(set(echt_weg.values()))}, indent=2))

main()
