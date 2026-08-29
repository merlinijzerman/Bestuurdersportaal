import { NextRequest, NextResponse } from "next/server";
import { withFondsRoute } from "@/core/lib/route-wrapper";
import { leesVereisteVerwijzing } from "@/core/lib/bewijs-binding";
import {
  resolveVereisteSleutel,
  besluitOpSlot,
  primairBesluitId,
} from "@/core/lib/vereiste-koppeling";
import { REQUIREMENT_BRON } from "@/core/lib/requirement-bron";
import { z } from "zod";

// P2/PR-B (#167) — één koppelroute "vanuit de vereiste": koppelen/ontkoppelen van
// een gebonden feit aan een vereiste, sleutel server-side afgeleid (0189, D10).
// Draait onder withFondsRoute → ctx.supabase is de gebruikers-JWT-client, dus
// auth.uid() vult de audit-actor (audit-bevinding C). De harde invarianten
// (type/I5/versie/exact-één) borgen de DB-triggers; hier: nette fouten, de I1-poort
// (doors a/c) en de dissent-tegenstrijdigheidscheck.

function fout(status: number, error: string) {
  return NextResponse.json({ error }, { status });
}

/** 'geen dissent' mag niet worden vastgelegd zolang er open formele dissent is. */
function duidtOpGeenDissent(uitkomst: string): boolean {
  return /geen\s+dissent/i.test(uitkomst);
}

export const POST = withFondsRoute({ hostGuard: "geen", rateLimit: "nog-niet-beoordeeld", audit: { handeling: "procedures.vereisten.koppeling-wijzigen" }, capability: "procedures.manage",
    schema: z
      .object({
        vereiste: z.unknown().optional(),
        actie: z.unknown().optional(),
        bron_id: z.unknown().optional(),
        uitkomst: z.unknown().optional(),
        toelichting: z.unknown().optional(),
      })
      .passthrough(),
  },
  async (ctx, req: NextRequest, params) => {
    try {
      const { id } = params as { id: string };
      const supabase = ctx.supabase;
      const body = (await req.json()) as {
        vereiste?: unknown;
        actie?: unknown;
        bron_id?: string | null;
        uitkomst?: string;
        toelichting?: string;
      };

      const actie = body.actie;
      if (actie !== "koppel" && actie !== "ontkoppel") {
        return fout(400, "actie moet 'koppel' of 'ontkoppel' zijn");
      }

      const verwijzing = leesVereisteVerwijzing(body.vereiste);
      if (verwijzing === "ongeldig" || verwijzing === null) {
        return fout(400, "Ongeldige vereiste-verwijzing");
      }

      const res = await resolveVereisteSleutel(supabase, id, verwijzing);
      if (!res.ok) return fout(res.serverfout ? 500 : 400, res.fout);
      const { sleutel, type } = res;
      const bronDef = REQUIREMENT_BRON[type];
      if (!bronDef) return fout(400, "Dit vereiste-type kan niet worden gekoppeld");

      // ── Vaststellingstypen (mandate_check/dissent_review): het feit ONTSTAAT bij
      //    koppelen (atomaire insert mét sleutel); ontkoppelen = de rij verwijderen.
      if (bronDef.brontabel === "procedure_vaststelling") {
        if (actie === "koppel") {
          const soort = type === "mandate_check" ? "mandaatcheck" : "dissentronde";
          const uitkomst = (body.uitkomst ?? "").trim();
          const toelichting = (body.toelichting ?? "").trim();
          if (!uitkomst) return fout(400, "Uitkomst is verplicht");
          if (!toelichting) return fout(400, "Toelichting is verplicht");

          // Dissent-tegenstrijdigheid (0189): 'geen dissent' mag niet zolang er
          // openstaande formele dissent / minderheidsnotities zijn.
          if (type === "dissent_review" && duidtOpGeenDissent(uitkomst)) {
            const decId = await primairBesluitId(supabase, id);
            if (decId) {
              const { count } = await supabase
                .from("decision_dissent")
                .select("id", { count: "exact", head: true })
                .eq("decision_id", decId)
                .in("zichtbaarheid", ["formele_dissent", "minderheidsnotitie"])
                .eq("formeel_vastgesteld", false);
              if ((count ?? 0) > 0) {
                return fout(
                  409,
                  "Er staan nog openstaande formele dissent-notities; 'geen dissent' kan niet worden vastgelegd."
                );
              }
            }
          }

          // stap_id afleiden uit de stap_volgorde (mag null zijn — de sleutel pint
          // de stap al; stap_id is enkel navigatie).
          const { data: stap } = await supabase
            .from("procedure_stappen")
            .select("id")
            .eq("procedure_id", id)
            .eq("volgorde", verwijzing.stap_volgorde)
            .maybeSingle();

          const { data, error } = await supabase
            .from("procedure_vaststelling")
            .insert({
              fonds_id: ctx.fondsId,
              procedure_id: id,
              stap_id: stap ? (stap as { id: string }).id : null,
              requirement_sleutel: sleutel,
              soort,
              uitkomst,
              toelichting,
              actor: ctx.gebruikerId,
            })
            .select("id")
            .single();
          if (error?.code === "23514") {
            return fout(400, "Ongeldige of niet-eenduidige vereiste-binding");
          }
          if (error || !data) {
            console.error("Vaststelling koppelen fout:", error);
            return fout(500, "Koppelen mislukt");
          }
          return NextResponse.json({ vaststelling: data });
        }

        // ontkoppel = de vaststelling verwijderen. I1-poort vóór de DB-trigger.
        if (!body.bron_id) return fout(400, "bron_id is verplicht voor ontkoppelen");
        const decId = await primairBesluitId(supabase, id);
        if (await besluitOpSlot(supabase, decId)) {
          return fout(409, "Het besluit staat op slot; ontkoppelen is geweigerd (I1).");
        }
        const { error } = await supabase
          .from("procedure_vaststelling")
          .delete()
          .eq("id", body.bron_id)
          .eq("procedure_id", id);
        if (error?.code === "23514") {
          return fout(409, "Het besluit staat op slot; ontkoppelen is geweigerd (I1).");
        }
        if (error) {
          console.error("Vaststelling ontkoppelen fout:", error);
          return fout(500, "Ontkoppelen mislukt");
        }
        return NextResponse.json({ ok: true });
      }

      // ── Overige typen: het artefact bestaat al; koppelen/ontkoppelen zet de sleutel.
      if (!body.bron_id) return fout(400, "bron_id is verplicht");
      const bronId = body.bron_id;

      // Eigenaar-besluit voor de I1-poort: decision-scoped → de eigen decision_id;
      // procedure-scoped → het primaire Decision Object van de procedure.
      const selectKolommen =
        bronDef.scope === "decision"
          ? "decision_id, requirement_sleutel"
          : "requirement_sleutel";
      const { data: feit } = await supabase
        .from(bronDef.brontabel)
        .select(selectKolommen)
        .eq("id", bronId)
        .maybeSingle();
      if (!feit) return fout(404, "Bronrij niet gevonden");
      const feitRij = feit as unknown as {
        decision_id?: string;
        requirement_sleutel: string | null;
      };
      const huidigeSleutel = feitRij.requirement_sleutel;
      const eigenaarBesluit =
        bronDef.scope === "decision"
          ? feitRij.decision_id ?? null
          : await primairBesluitId(supabase, id);

      if (actie === "ontkoppel") {
        // Deur (a): een vervulling weghalen. Altijd I1-bewaakt.
        if (await besluitOpSlot(supabase, eigenaarBesluit)) {
          return fout(409, "Het besluit staat op slot; ontkoppelen is geweigerd (I1).");
        }
        let q = supabase
          .from(bronDef.brontabel)
          .update({ requirement_sleutel: null })
          .eq("id", bronId);
        // Defense-in-depth (procesgebonden): bind de mutatie aan déze procedure,
        // gespiegeld op de vaststelling-delete. Decision-scoped leunt op RLS + de
        // fn_assert-trigger (sleutel↔eigen procedure).
        if (bronDef.scope === "procedure") q = q.eq("procedure_id", id);
        const { error } = await q;
        // Een 23514 op een unbind kan alleen de I1-DB-backstop zijn (een null-
        // sleutel triggert fn_assert_gebonden_feit niet). Dus: 409, geen 500.
        if (error?.code === "23514") {
          return fout(409, "Het besluit staat op slot; ontkoppelen is geweigerd (I1).");
        }
        if (error) {
          console.error("Ontkoppelen fout:", error);
          return fout(500, "Ontkoppelen mislukt");
        }
        return NextResponse.json({ ok: true });
      }

      // actie === "koppel". Idempotent als de sleutel al gelijk is.
      if (huidigeSleutel === sleutel) return NextResponse.json({ ok: true });
      // Deur (c): een bestaande (andere) binding vervangen = herbinden. I1-bewaakt.
      // Een EERSTE koppeling (null → sleutel) voegt een vervulling toe en valt niet
      // onder I1 (er verdwijnt niets).
      if (huidigeSleutel !== null && (await besluitOpSlot(supabase, eigenaarBesluit))) {
        return fout(409, "Het besluit staat op slot; herbinden is geweigerd (I1).");
      }
      let uq = supabase
        .from(bronDef.brontabel)
        .update({ requirement_sleutel: sleutel })
        .eq("id", bronId);
      if (bronDef.scope === "procedure") uq = uq.eq("procedure_id", id);
      const { error } = await uq;
      if (error?.code === "23514") {
        // Na de I1-voorpoort is een 23514 hier de fn_assert-trigger: de sleutel
        // hoort niet bij de procedure/het besluit van deze bronrij (of een race
        // waarbij het besluit net op slot ging). Niet-eenduidig → 400.
        return fout(400, "Ongeldige of niet-eenduidige vereiste-binding");
      }
      if (error) {
        console.error("Koppelen fout:", error);
        return fout(500, "Koppelen mislukt");
      }
      return NextResponse.json({ ok: true });
    } catch (e) {
      console.error("Fout in POST /api/procedures/[id]/vereisten/koppel:", e);
      return fout(500, "Serverfout");
    }
  }
);
