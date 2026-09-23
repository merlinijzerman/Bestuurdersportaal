#!/usr/bin/env python3
"""#440 — genereert de VERWACHTE stand uit de repo-migratieketen.

Twee bronnen, bewust gescheiden:
  1. de DEFINITIEVINGERAFDRUKKEN, gemeten op een referentie-DB die is opgebouwd
     met scripts/testdb-apply-migrations.sh. De migratiebestanden zijn leidend;
     de referentie-DB is alleen de meetbank.
  2. de TOEWIJZING object -> migratie, geparsed uit de migratiebestanden zelf.

Wat niet toewijsbaar is, wordt als zodanig gemeld. Een generator die gokt welke
migratie bij een object hoort, levert een inventarisatie op die
betrouwbaarder oogt dan zij is - en dat is precies het probleem dat #440 moet
oplossen, niet herhalen.
"""
import re, sys, io, os, json

MIGRATIES = "supabase/migrations"

# Patronen per objectklasse. Bewust conservatief: liever niet toewijzen dan
# verkeerd toewijzen.
PAT = [
    ("FUNC", re.compile(r"create\s+(?:or\s+replace\s+)?function\s+(?:(\w+)\.)?(\w+)\s*\(", re.I)),
    ("REL",  re.compile(r"create\s+(?:unlogged\s+)?(?:table|view|materialized\s+view|foreign\s+table)\s+(?:if\s+not\s+exists\s+)?(?:(\w+)\.)?\"?(\w+)\"?", re.I)),
    ("REL",  re.compile(r"alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:(\w+)\.)?\"?(\w+)\"?", re.I)),
    ("POL",  re.compile(r"create\s+policy\s+\"?([^\"\n]+?)\"?\s+on\s+(?:(\w+)\.)?\"?(\w+)\"?", re.I)),
    ("TRG",  re.compile(r"create\s+(?:or\s+replace\s+)?(?:constraint\s+)?trigger\s+\"?(\w+)\"?[\s\S]{0,200}?\son\s+(?:(\w+)\.)?\"?(\w+)\"?", re.I)),
    ("IDX",  re.compile(r"create\s+(?:unique\s+)?index\s+(?:concurrently\s+)?(?:if\s+not\s+exists\s+)?\"?(\w+)\"?", re.I)),
]

def zonder_commentaar(sql: str) -> str:
    """`-- ...` en `/* ... */` eruit. Een migratiekop die een objectnaam NOEMT
    is geen migratie die hem maakt; dat onderscheid is eerder in deze tranche
    tweemaal misgegaan met een regex die op proza matchte."""
    sql = re.sub(r"/\*[\s\S]*?\*/", " ", sql)
    sql = re.sub(r"^\s*--.*$", "", sql, flags=re.M)
    return sql

def cutoff() -> str:
    """De baseline-cutoff uit scripts/testdb-apply-migrations.sh. Migraties tot en
    met dat bestand zitten al IN de schemabaseline en worden nooit los
    toegepast; ze meetellen zou de inventarisatie vervuilen met 139 bestanden
    waarover drift niet eens kan bestaan."""
    sh = io.open("scripts/testdb-apply-migrations.sh", encoding="utf-8").read()
    m = re.search(r'^BASELINE_CUTOFF="([^"]+)"', sh, re.M)
    assert m, "BASELINE_CUTOFF niet gevonden — de vorm van het script is veranderd"
    return m.group(1)


def lees_migraties():
    grens = cutoff()
    alle = sorted(f for f in os.listdir(MIGRATIES) if f.endswith(".sql"))
    bestanden = [f for f in alle if f > grens]
    # object-sleutel -> lijst migraties (op volgorde). De LAATSTE bepaalt de
    # huidige definitie; eerdere blijven zichtbaar als herkomst.
    toewijzing = {}
    per_migratie = {f: set() for f in bestanden}
    for f in bestanden:
        sql = zonder_commentaar(io.open(os.path.join(MIGRATIES, f), encoding="utf-8").read())
        for soort, pat in PAT:
            for m in pat.finditer(sql):
                g = [x for x in m.groups() if x]
                if soort == "POL":
                    naam = f"{g[-1]}.{g[0]}"
                elif soort == "TRG":
                    naam = f"{g[-1]}.{g[0]}"
                else:
                    naam = g[-1]
                sleutel = f"{soort}:{naam.lower()}"
                toewijzing.setdefault(sleutel, []).append(f)
                per_migratie[f].add(sleutel)
    return bestanden, toewijzing, per_migratie

def sleutel_van(sectie, obj):
    """Catalogusrij -> toewijzingssleutel. Functies verliezen hun argumenten:
    overloads horen bij dezelfde migratie(s), en de identiteit uit de catalogus
    is niet betrouwbaar uit migratietekst te reconstrueren."""
    o = obj.lower()
    if sectie == "FUNC":
        return "FUNC:" + o.split("(")[0]
    if sectie in ("REL", "RLS", "VIEWDEF"):
        return "REL:" + o
    if sectie in ("POL", "TRG"):
        return sectie + ":" + o
    if sectie == "IDX":
        return "IDX:" + o
    if sectie == "CON":
        return "REL:" + o.split(".")[0]   # constraint volgt zijn tabel
    return sectie + ":" + o

def main():
    rijen = []
    for regel in sys.stdin.read().splitlines():
        if not regel.strip():
            continue
        deel = regel.split("\t")
        if len(deel) != 4:
            continue
        rijen.append(deel)  # sectie, sch, obj, vingerafdruk

    bestanden, toewijzing, per_migratie = lees_migraties()

    uit = []
    niet_toewijsbaar = 0
    gedekt = set()
    for sectie, sch, obj, vp in rijen:
        s = sleutel_van(sectie, obj)
        migs = toewijzing.get(s, [])
        mig = migs[-1] if migs else ""
        if not mig:
            niet_toewijsbaar += 1
        else:
            gedekt.add(mig)
        uit.append((sectie, sch, obj, vp, mig))

    io.open("supabase/checks/440-verwachte-stand.generated.tsv", "w", encoding="utf-8").write(
        "sectie\tsch\tobj\tvingerafdruk\tmigratie\n"
        + "\n".join("\t".join(r) for r in uit) + "\n")

    # ── Waaróm is een migratie niet meetbaar? ─────────────────────────────
    # "Niet vast te stellen" zonder reden is een vrijbrief. Met reden is het een
    # bevinding: het zegt precies wat er nog nodig is om hem wél te kunnen meten.
    IN_SCOPE = ("public", "storage")

    def reden(f):
        sql = zonder_commentaar(io.open(os.path.join(MIGRATIES, f), encoding="utf-8").read())
        laag = sql.lower()
        # (a) alle objecten die hij maakt, zijn later herdefinieerd.
        eigen = per_migratie.get(f, set())
        if eigen and all(toewijzing.get(k, [""])[-1] != f for k in eigen):
            latere = sorted({toewijzing[k][-1] for k in eigen if k in toewijzing})
            return "later-herdefinieerd", "objecten later overschreven door: " + ", ".join(latere[:3])
        # (b) maakt objecten buiten de gemeten schema's.
        vreemd = sorted({m for m in re.findall(r"create[\s\S]{0,40}?\s(\w+)\.\w+", laag)
                         if m not in IN_SCOPE and m not in ("if", "or", "not")})
        if vreemd:
            return "buiten-scope-schema", "creëert in schema: " + ", ".join(vreemd[:3])
        # (c) VERWIJDERT objecten. Dat is wel degelijk catalogus-DDL: een
        #     contractmigratie als 423b dropt een oude functiesignatuur. Zo'n
        #     migratie eerder als "alleen data of commentaar" wegzetten was
        #     onjuist — zij is juist te meten, namelijk aan de AFWEZIGHEID van
        #     wat zij heeft verwijderd.
        drops = sorted({m for m in re.findall(
            r"drop\s+(?:function|table|view|materialized\s+view|policy|trigger|index|type|sequence)"
            r"\s+(?:if\s+exists\s+)?(?:concurrently\s+)?\"?([\w\.]+)\"?", laag)})
        if drops:
            return "verwijdert-objecten", (
                "dropt: " + ", ".join(drops[:4])
                + " — meetbaar aan de afwezigheid daarvan, niet aan een nieuw object")
        # (d) raakt alleen rechten, commentaar of data.
        if not re.search(r"create\s+(or\s+replace\s+)?(function|table|view|policy|trigger|index)", laag) \
           and not re.search(r"alter\s+table[\s\S]{0,120}?(add|alter)\s+column", laag):
            if re.search(r"\b(grant|revoke)\b", laag):
                return "alleen-rechten", "wijzigt uitsluitend rechten; de V3-grants-gate dekt dit"
            return "alleen-data-of-commentaar", "geen DDL die de catalogus verandert"
        return "geen-kenmerk-gevonden", "de parser vond geen toewijsbaar object — handmatig kenmerk nodig"

    zonder_object = [f for f in bestanden if f not in gedekt]
    geclassificeerd = [(f,) + reden(f) for f in zonder_object]
    io.open("supabase/checks/440-migraties-zonder-kenmerk.generated.tsv", "w", encoding="utf-8").write(
        "migratie\tcategorie\ttoelichting\n"
        + "\n".join("\t".join(r) for r in geclassificeerd) + "\n")

    print(json.dumps({
        "baseline_cutoff": cutoff(),
        "catalogusrijen": len(uit),
        "niet_toewijsbaar_aan_migratie": niet_toewijsbaar,
        "migraties_na_cutoff": len(bestanden),
        "migraties_met_kenmerk": len(gedekt),
        "migraties_zonder_kenmerk": len(zonder_object),
        "zonder_kenmerk_per_reden": {c: sum(1 for x in geclassificeerd if x[1] == c)
                                     for c in sorted({x[1] for x in geclassificeerd})},
    }, indent=2))

main()
