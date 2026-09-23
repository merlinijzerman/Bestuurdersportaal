#!/usr/bin/env python3
"""#440 — knipt de prep-SQL uit scripts/testdb-apply-migrations.sh.

Die prep maakt extensies en fixture-rollen (microsoft_vault, copilot_operator,
ai_gateway). Zonder die rollen weigeren migraties als 423a fail-closed — terecht.
Overtypen zou een tweede waarheid zijn die stil uit de pas gaat lopen; daarom
knippen we exact dezelfde heredocs eruit.
"""
import io, re, sys

sh = io.open("scripts/testdb-apply-migrations.sh", encoding="utf-8").read()
blokken = re.findall(r"<<'SQL'\n([\s\S]*?)\nSQL\n", sh)
if not blokken:
    sys.exit("FOUT: geen prep-heredocs gevonden in testdb-apply-migrations.sh — "
             "de vorm van dat script is veranderd; pas deze knipper aan.")
io.open(sys.argv[1], "w", encoding="utf-8").write("\n".join(blokken) + "\n")
print(f"   prep: {len(blokken)} blok(ken) hergebruikt", file=sys.stderr)
