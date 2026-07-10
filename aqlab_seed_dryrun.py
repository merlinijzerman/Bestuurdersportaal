#!/usr/bin/env python3
"""
AQLAB seed dry-run CLI-spike.

Doel: bewijzen dat de seedset technisch PARSEBAAR, VALIDEERBAAR en HASHBAAR is.
- dry-run is de ENIGE modus. Er wordt NIETS naar een database geschreven.
- Geen Supabase-verbinding, geen seeding, geen productiewijziging.
- `--apply` is bewust UITGESCHAKELD in deze spike (hard error).

Exit codes: 0 = alles groen (seeding zou zijn toegestaan); 2 = geblokkeerd/hard fail.

Gebruik:
    python3 aqlab_seed_dryrun.py
    python3 aqlab_seed_dryrun.py --state AQLAB-VALIDATION-STATE.yaml   # optioneel gate-statusbestand
"""
import os, re, sys, hashlib, argparse
try:
    import yaml
except ImportError:
    sys.exit("PyYAML vereist: pip install pyyaml")

HERE = os.path.dirname(os.path.abspath(__file__))
SEED_YAML = os.path.join(HERE, "AQLAB-SEED-STRUCTUUR-v0.2.yaml")
FIXTURES_MD = os.path.join(HERE, "AQLAB-HORIZON-FIXTURES-v0.2.md")

PLACEHOLDER = "<sha256-placeholder>"
LEGAL_TCS = ["BS-06", "BV-04", "SEC-04"]
AVG_TC = "SEC-06"
ALLOW_MISSING_FIXTURE = {"HORIZON-NIET-BESTAAND-XXX"}  # bewust niet-bestaand (SEC-05)

hard_fails, gate_fails = [], []
def hard(msg): hard_fails.append(msg)
def gate(msg): gate_fails.append(msg)

def line(c="-"): print(c * 72)

# ---------------------------------------------------------------- canonical text
def canonical(qlines):
    out = []
    for ln in qlines:
        ln = ln.rstrip()
        if ln.startswith("> "): ln = ln[2:]
        elif ln == ">": ln = ""
        out.append(ln.rstrip())
    return "\n".join(out).strip("\n") + "\n"

def extract_canonical(md):
    heads = [(m.start(), m.group(1).strip()) for m in re.finditer(r"\n# FIX-\d+ ·[ ]*(.+)", md)]
    texts = {}
    for i, (pos, idline) in enumerate(heads):
        end = heads[i + 1][0] if i + 1 < len(heads) else md.find("\n# Consistentienoot")
        body = md[pos: end if end != -1 else len(md)]
        mm = re.search(r"Volledige synthetische tekst[^\n]*\n+((?:>.*\n?)+)", body)
        if not mm:
            continue
        ctext = canonical(mm.group(1).splitlines())
        if "BRONSET-MEERVOUD" in idline:
            parts = [p for p in re.split(r"(?=\*\*Bron [123] —)", ctext) if p.strip().startswith("**Bron")]
            for j, p in enumerate(parts, 1):
                texts[f"HORIZON-BRONSET-MEERVOUD-00{j}"] = p.strip("\n") + "\n"
        else:
            texts[idline.split()[0]] = ctext
    return texts

def sha(text): return hashlib.sha256(text.encode("utf-8")).hexdigest()

# ---------------------------------------------------------------- main
def main():
    ap = argparse.ArgumentParser(description="AQLAB seed dry-run (spike)")
    ap.add_argument("--state", help="optioneel YAML met gate-status (avg/legal/judge)")
    ap.add_argument("--apply", action="store_true", help="UITGESCHAKELD in deze spike")
    args = ap.parse_args()

    print("AQLAB SEED DRY-RUN (spike) — GEEN Supabase, GEEN mutatie, GEEN seeding")
    line("=")

    if args.apply:
        sys.exit("FOUT: --apply is bewust UITGESCHAKELD in deze spike. Alleen dry-run toegestaan.")

    # ---- gate-status (extern) ----
    state = {"avg_scope_SEC06_confirmed": False,
             "legal_compliance_confirmed": False,
             "judge_json_schemas_present": False}
    if args.state and os.path.exists(args.state):
        state.update(yaml.safe_load(open(args.state)) or {})

    # ---- 1. parse ----
    d = yaml.safe_load(open(SEED_YAML))
    tcs = d["testcases"]
    fixtures = {f["fixture_id"]: f for f in d["fixtures"]}
    facts = d["facts"]
    factkeys = {(fx, f["fact_id"]) for fx, l in facts.items() for f in (l or [])}
    checks = {c["check_key"] for c in d["checks"]}
    md = open(FIXTURES_MD).read()
    ctexts = extract_canonical(md)
    print(f"1. PARSE  ->  testcases: {len(tcs)} | fixtures: {len(fixtures)} | checks: {len(checks)} | "
          f"canonical_texts: {len(ctexts)}")
    line()

    # ---- 2. structurele validatie (fail hard) ----
    print("2. STRUCTURELE VALIDATIE (fail-hard condities)")
    if len(tcs) != 33: hard(f"verwacht 33 testcases, kreeg {len(tcs)}")
    if len(fixtures) != 24: hard(f"verwacht 24 fixture-ID's, kreeg {len(fixtures)}")
    for fid, f in fixtures.items():
        if f.get("synthetic") is not True: hard(f"niet-synthetische fixture: {fid}")
    for t in tcs:
        tid = t["id"]
        for s in (t.get("required_source_ids") or []):
            if s not in fixtures: hard(f"{tid}: ontbrekende required_source_id {s}")
        for s in (t.get("excluded_source_ids") or []):
            if s not in fixtures and s not in ALLOW_MISSING_FIXTURE:
                hard(f"{tid}: ontbrekende excluded_source_id {s}")
        for e in (t.get("expected_facts") or []):
            if (e.get("fixture_id"), e.get("fact_id")) not in factkeys:
                hard(f"{tid}: unresolved expected_fact {e}")
        for c in (t.get("checks") or []):
            if c not in checks: hard(f"{tid}: onbekende check {c}")
        if t.get("review_required") and not (t.get("review_instruction") or "human_review" in (t.get("checks") or [])):
            hard(f"{tid}: review_required zonder review_instruction/human_review")
        if t.get("consistency_required") and not t.get("consistency_iterations"):
            hard(f"{tid}: consistency_required zonder consistency-config (iterations)")
    print(f"   hard-fails structureel: {len([h for h in hard_fails])}")
    for h in hard_fails: print("   ! " + h)
    line()

    # ---- 3. hashing ----
    print("3. HASHING (sha256 over canonical_text; conventie: LF, trailing ws weg, 1 trailing newline)")
    placeholder_ids = [fid for fid, f in fixtures.items() if f.get("content_hash") == PLACEHOLDER]
    computed = {}
    for fid in sorted(fixtures):
        if fid in ctexts:
            computed[fid] = sha(ctexts[fid])
        else:
            hard(f"canonical_text ontbreekt voor fixture {fid}")
    print(f"   hashes berekend: {len(computed)}/{len(fixtures)} | placeholders in seed-YAML: {len(placeholder_ids)}")
    for fid in list(sorted(computed))[:4]:
        print(f"     {fid}: {computed[fid][:16]}…")
    print(f"     … (+{max(0,len(computed)-4)} meer; volledige lijst in AQLAB-FIXTURE-HASHES-v0.1.yaml)")
    line()

    # ---- 4. seeding-gate ----
    print("4. SEEDING-GATE")
    if placeholder_ids:
        gate(f"content_hash placeholders bestaan ({len(placeholder_ids)} fixtures)")
    if not state["avg_scope_SEC06_confirmed"]:
        gate(f"AVG-scope {AVG_TC} niet bevestigd")
    if not state["legal_compliance_confirmed"]:
        gate(f"juridische/compliance-duiding {'/'.join(LEGAL_TCS)} niet gevalideerd")
    if not state["judge_json_schemas_present"]:
        gate("judge JSON-schema's ontbreken")
    for name, ok in [("content_hash gevuld", not placeholder_ids),
                     (f"AVG-scope {AVG_TC}", state["avg_scope_SEC06_confirmed"]),
                     (f"juridisch {'/'.join(LEGAL_TCS)}", state["legal_compliance_confirmed"]),
                     ("judge JSON-schema's", state["judge_json_schemas_present"])]:
        print(f"   [{'PASS' if ok else 'RED '}] {name}")
    seed_allowed = not gate_fails and not hard_fails
    print(f"\n   SEED_ALLOWED = {str(seed_allowed).lower()}")
    line()

    # ---- 5. upsert-plan (dry-run, geen mutatie) ----
    print("5. UPSERT-PLAN (dry-run — er wordt NIETS geschreven)")
    # groepeer naar provider-golden testsets: 3 MVP-features + 1 security/safety-set
    def testset_of(t):
        f = t["feature"]
        if f.startswith("bestuurlijke_samenvatting"): return "samenvatting"
        if f.startswith("brongebonden_vraagbeantwoording"): return "vraagbeantwoording"
        if f.startswith("besluitvoorbereiding"): return "besluitvoorbereiding"
        return "security_safety"
    sets = sorted({testset_of(t) for t in tcs})
    print("   Geraakte tabellen:")
    print(f"     - aqlab_fixture_documents : {len(fixtures)} upsert (op fixture_id + versie)")
    print(f"     - aqlab_test_sets         : {len(sets)} upsert ({', '.join(sets)})")
    print(f"     - aqlab_test_cases        : {len(tcs)} upsert (op code)")
    print(f"     - aqlab_log               : 1 append (seed-actie, alleen bij echte apply)")
    print("   Voorbeeld-records (zouden worden ge-upsert):")
    ex_fx = fixtures["HORIZON-CIJFERS-001"]
    print(f"     fixture  HORIZON-CIJFERS-001 v{ex_fx['versie']} hash={computed.get('HORIZON-CIJFERS-001','')[:12]}… synthetic={ex_fx['synthetic']}")
    ex_tc = [t for t in tcs if t["id"] == "BQ-07"][0]
    print(f"     testcase BQ-07 '{ex_tc.get('testcase_title')}' feature={ex_tc['feature']} "
          f"min_score={ex_tc.get('min_quality_score')} consistency={ex_tc.get('consistency_required')}")
    line()

    # ---- 6. resultaat ----
    print("6. RESULTAAT")
    if hard_fails:
        print(f"   HARD FAILS ({len(hard_fails)}):")
        for h in hard_fails: print("     ! " + h)
    else:
        print("   Hard fails: geen (structureel groen).")
    if gate_fails:
        print(f"   GEBLOKKEERDE GATES ({len(gate_fails)}):")
        for g in gate_fails: print("     x " + g)
    print(f"\n   >>> SEED_ALLOWED = {str(seed_allowed).lower()}  "
          f"({'GO' if seed_allowed else 'NO-GO — seeding geblokkeerd'})")
    line("=")
    sys.exit(0 if seed_allowed else 2)

if __name__ == "__main__":
    main()
