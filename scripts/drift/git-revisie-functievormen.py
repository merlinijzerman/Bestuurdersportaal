#!/usr/bin/env python3
"""#445: replay elke Git-revisie van de drie afwijkende publieke functies.

Alle DDL draait uitsluitend op een expliciet opgegeven wegwerpdatabase in een
lokale Docker-container. Elke variant wordt binnen dezelfde transactie gemeten
en teruggedraaid. Het script leest nooit een doel-DB; --target neemt uitsluitend
een eerder read-only gemeten md5 van pg_get_functiondef aan.
"""

from __future__ import annotations

import argparse
import csv
import re
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
FILES = {
    "fn_access_token_hook": [
        "supabase/migrations/2026_09_06_microsoft_login_fase1b.sql",
        "supabase/migrations/2026_09_07_microsoft_login_beleidsmodus.sql",
    ],
    "fn_profiel_fondslock": [
        "supabase/migrations/2026_09_07_microsoft_login_beleidsmodus.sql",
    ],
    "fn_afschrift_bevries_kolommen": [
        "supabase/migrations/2026_08_09_procedure_afschriften_hardening.sql",
        "supabase/migrations/2026_08_09_afschrift_ai_tekst.sql",
        "supabase/migrations/2026_08_22_secdef_search_path_pg_temp.sql",
    ],
}
SIGNATURES = {
    "fn_access_token_hook": "public.fn_access_token_hook(jsonb)",
    "fn_profiel_fondslock": "public.fn_profiel_fondslock()",
    "fn_afschrift_bevries_kolommen": "public.fn_afschrift_bevries_kolommen()",
}
OVERLAY = "supabase/migrations/2026_08_22_secdef_search_path_pg_temp.sql"
AFSCHRIFT_BASIS = "supabase/migrations/2026_08_09_afschrift_ai_tekst.sql"
BASELINE = "supabase/baseline/2026_08_14_preview_public.sql"
OVERLAY_PRECURSORS = [
    "supabase/migrations/2026_08_09_procedure_afschriften_hardening.sql",
    AFSCHRIFT_BASIS,
    BASELINE,
]


def command(*args: str, input_text: str | None = None) -> str:
    p = subprocess.run(args, input=input_text, text=True, capture_output=True,
                       cwd=ROOT, check=False)
    if p.returncode:
        raise RuntimeError(f"{args[0]} faalde ({p.returncode}): {p.stderr[:500]}")
    return p.stdout


def git_versions(path: str) -> list[tuple[str, str]]:
    rows = command("git", "log", "--all", "--format=%H%x09%cI", "--", path)
    return [tuple(line.split("\t", 1)) for line in rows.splitlines() if line]


def extract_function(sql: str, name: str) -> str | None:
    # Beide repo-vormen: public.fn_x en "public"."fn_x".
    schema = r'(?:"public"|public)\s*\.\s*'
    function = rf'(?:"{re.escape(name)}"|{re.escape(name)})'
    start = re.search(rf'(?im)^\s*create\s+or\s+replace\s+function\s+'
                      rf'{schema}{function}\s*\(', sql)
    if start is None:
        return None
    marker = re.search(r'(?is)\bas\s+(\$[A-Za-z_0-9]*\$)', sql[start.start():])
    if marker is None:
        raise ValueError(f"{name}: geen dollar-gequote functiebody")
    absolute_open_end = start.start() + marker.end()
    closing = sql.find(marker.group(1), absolute_open_end)
    if closing < 0:
        raise ValueError(f"{name}: functiebody heeft geen slotmarker")
    end = closing + len(marker.group(1))
    tail = re.match(r'\s*;', sql[end:])
    if tail is None:
        raise ValueError(f"{name}: functiebody heeft geen afsluitende puntkomma")
    return sql[start.start():end + tail.end()].strip()


def psql(container: str, database: str, sql: str) -> str:
    return command("docker", "exec", "-i", container, "psql", "-X", "-q", "-tA",
                   "-v", "ON_ERROR_STOP=1", "-U", "postgres", "-d", database,
                   input_text=sql)


def assert_wegwerp(container: str, database: str) -> None:
    if not re.fullmatch(r"codex-445-[a-z0-9-]+", container):
        raise ValueError("#445 weigert een container zonder codex-445--prefix")
    if not re.fullmatch(r"codex_445_[a-z0-9_]+", database):
        raise ValueError("#445 weigert een database zonder codex_445_-prefix")
    guard = """
DO $guard$
DECLARE v_aantal integer := 0;
BEGIN
  IF current_database() !~ '^codex_445_[a-z0-9_]+$' THEN
    RAISE EXCEPTION 'geen wegwerpdatabase';
  END IF;
  IF to_regclass('public.tenant_domains') IS NOT NULL THEN
    EXECUTE 'SELECT count(*) FROM public.tenant_domains '
         || 'WHERE host LIKE ''%bestuurdersportaal.com'''
      INTO v_aantal;
  END IF;
  IF v_aantal <> 0 THEN
    RAISE EXCEPTION 'database draagt tenant-host; replay geweigerd';
  END IF;
END $guard$;
"""
    psql(container, database, guard)


def fingerprint(container: str, database: str, definition: str,
                signature: str, overlay: bool = False) -> tuple[str, str, str, str, str, str]:
    extra = """
ALTER FUNCTION public.fn_afschrift_bevries_kolommen()
  SET search_path = public, pg_temp;
""" if overlay else ""
    sql = ("BEGIN;\nCREATE SCHEMA IF NOT EXISTS login_private;\n"
           + definition + "\n" + extra
           + "SELECT md5(pg_get_functiondef(p.oid)), md5(p.prosrc), "
           + "md5((SELECT string_agg(btrim(line), E'\\n' ORDER BY ord) "
           + "FROM regexp_split_to_table(p.prosrc, E'\\n') WITH ORDINALITY AS t(line,ord) "
           + "WHERE btrim(line) <> '' AND btrim(line) NOT LIKE '--%')), "
           + "coalesce(array_to_string(p.proconfig, '|'), ''), p.prosecdef, p.provolatile "
           + "FROM pg_proc p WHERE p.oid = '" + signature
           + "'::regprocedure;\nROLLBACK;\n")
    output = psql(container, database, sql)
    found = re.findall(r"(?m)^([0-9a-f]{32})\|([0-9a-f]{32})\|([0-9a-f]{32})"
                       r"\|([^\n]*)\|(t|f)\|([a-z])$", output)
    if len(found) != 1:
        raise RuntimeError(f"{signature}: verwacht één vingerafdruk, kreeg {output!r}")
    return found[0]


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--container", required=True)
    parser.add_argument("--database", required=True)
    parser.add_argument("--output", type=Path, required=True)
    parser.add_argument("--target", action="append", default=[],
                        help="fn_naam=32-tekens-md5 uit een read-only doelmeting")
    parser.add_argument("--target-body", action="append", default=[],
                        help="fn_naam=32-tekens-md5 van pg_proc.prosrc")
    parser.add_argument("--target-code", action="append", default=[],
                        help="fn_naam=md5 na verwijderen van alleen lege/commentaarregels")
    args = parser.parse_args()
    targets: dict[str, str] = {}
    for value in args.target:
        name, sep, digest = value.partition("=")
        if not sep or name not in FILES or not re.fullmatch(r"[0-9a-f]{32}", digest):
            parser.error(f"ongeldige --target: {value}")
        targets[name] = digest
    target_bodies: dict[str, str] = {}
    for value in args.target_body:
        name, sep, digest = value.partition("=")
        if not sep or name not in FILES or not re.fullmatch(r"[0-9a-f]{32}", digest):
            parser.error(f"ongeldige --target-body: {value}")
        target_bodies[name] = digest
    target_codes: dict[str, str] = {}
    for value in args.target_code:
        name, sep, digest = value.partition("=")
        if not sep or name not in FILES or not re.fullmatch(r"[0-9a-f]{32}", digest):
            parser.error(f"ongeldige --target-code: {value}")
        target_codes[name] = digest
    if command("git", "rev-parse", "--is-shallow-repository").strip() != "false":
        raise RuntimeError("ondiepe Git-clone; volledige revisiehistorie vereist")
    assert_wegwerp(args.container, args.database)

    output: list[dict[str, str]] = []
    for name, files in FILES.items():
        for path in files + ([BASELINE] if name == "fn_afschrift_bevries_kolommen" else []):
            versions = git_versions(path)
            if not versions:
                raise RuntimeError(f"geen Git-revisies: {path}")
            for commit, timestamp in versions:
                source = command("git", "show", f"{commit}:{path}")
                if path == OVERLAY:
                    # #08_22 wijzigt proconfig dynamisch, niet de functiebody.
                    # De exacte transformatie moet nog in die revisie staan.
                    if "v_huidig || ', pg_temp'" not in source or "alter function %s set search_path = %s" not in source:
                        raise ValueError(f"onbekende pg_temp-transformatie: {path}@{commit}")
                    # De #08_22-migratie verandert de aanwezige body niet.
                    # Welke body vóór die stap aanwezig was, valt NIET uit het
                    # migratiebestand af te leiden. Meet daarom elke in Git
                    # aanwezige voorganger, inclusief de gepinde baseline.
                    precursors = []
                    for base_path in OVERLAY_PRECURSORS:
                        for base_commit, _ in git_versions(base_path):
                            base = command("git", "show", f"{base_commit}:{base_path}")
                            definition = extract_function(base, name)
                            if definition is not None:
                                precursors.append((definition, base_path, base_commit))
                else:
                    definition = extract_function(source, name)
                    precursors = [(definition, "", "")] if definition is not None else []
                for definition, base_path, base_commit in precursors:
                    digest, body_digest, code_digest, options, security, volatility = fingerprint(
                        args.container, args.database, definition,
                        SIGNATURES[name], path == OVERLAY)
                    output.append({"functie": name, "vingerafdruk": digest,
                                   "body_md5": body_digest, "code_md5": code_digest,
                                   "opties": options, "security_definer": security,
                                   "volatility": volatility,
                                   "bestand": path, "commit": commit,
                                   "commit_tijd": timestamp,
                                   "vorm": "search_path-overlay" if path == OVERLAY else "functiedefinitie",
                                   "basis_bestand": base_path, "basis_commit": base_commit,
                                   "doel_match": "ja" if targets.get(name) == digest else "nee",
                                   "body_match": "ja" if target_bodies.get(name) == body_digest else "nee",
                                   "code_match": "ja" if target_codes.get(name) == code_digest else "nee"})

    if not output:
        raise RuntimeError("geen functievormen gevonden")
    for name in FILES:
        if not any(row["functie"] == name for row in output):
            raise RuntimeError(f"geen functievorm voor {name}; historie onvolledig")
    args.output.parent.mkdir(parents=True, exist_ok=True)
    with args.output.open("w", encoding="utf-8", newline="") as handle:
        writer = csv.DictWriter(handle, fieldnames=list(output[0]), delimiter="\t",
                                lineterminator="\n")
        writer.writeheader()
        writer.writerows(output)
    for name in FILES:
        rows = [r for r in output if r["functie"] == name]
        matches = [r for r in rows if r["doel_match"] == "ja"]
        code_matches = [r for r in rows if r["code_match"] == "ja"]
        print(f"{name}: {len(rows)} vormvarianten; {len(matches)} exacte match(es); "
              f"{len(code_matches)} code-match(es) zonder commentaar/lege regels")
        for row in matches:
            suffix = (f" op {row['basis_bestand']} @ {row['basis_commit']}"
                      if row['basis_bestand'] else "")
            print(f"  {row['bestand']} @ {row['commit']}{suffix}")
    print(f"Historie: {args.output}")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (RuntimeError, ValueError) as exc:
        sys.exit(f"FOUT: {exc}")
