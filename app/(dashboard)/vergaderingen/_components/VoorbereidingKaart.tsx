"use client";
// ============================================================================
//  "Mijn voorbereiding" op de agendapuntkaart (T1 PR 2, besluit 0204).
// ----------------------------------------------------------------------------
//  Vervangt `AgendapuntChat.tsx` (1.459 regels): een tweede, meegegroeide-noch-
//  gelijkgetrokken gespreksimplementatie met een eigen payloadlichaam van 13 van
//  de 24 velden. Dezelfde vraag gaf daar een ánder antwoord dan in de assistent,
//  zonder dat iets in de interface dat uitlegde. Sinds T1 bestaat er één
//  gespreksoppervlak — het paneel — en houdt deze kaart alleen de UITKOMST.
//
//  ÉÉN KNOP PER TOESTAND:
//   • niet voorbereid → "Bereid dit punt voor" (de rijke voorbereidingsroute);
//   • voorbereid      → alleen "Doorvragen", dat het paneel opent met dit
//                       agendapunt als context.
//  Er komt bewust geen "opnieuw opstellen" naast: doorvragen ís de weg om verder
//  te komen, en twee knoppen zijn precies de dubbeling die dit ticket opheft.
//
//  GEEN SERVERWIJZIGING. De knop roept tot T2 dezelfde route aan
//  (`/api/agendapunten/[id]/voorbereiding`, SSE: meta → delta → done/error).
//  Bekend en geregistreerd auditgat: die route schrijft géén regel in de
//  governance log, terwijl elke gewone chatvraag dat wél doet. T2 dicht dat door
//  de voorbereiding door `/api/chat` te laten lopen.
//
//  WAAROM DE UITKOMST IN `gesprekken` LANDT en niet in `voorbereidingen`:
//  `voorbereidingen.ai_output` wordt vandaag door niets geschreven (alleen de
//  notities-route raakt die tabel), en daar iets aan veranderen is een
//  serverwijziging — dus T2. Tot dan bewaart deze kaart de uitkomst zoals de
//  chat dat deed: als een gesprek met `agendapunt_context`. Dat houdt twee
//  dingen intact die anders stilletjes zouden sneuvelen: de voorbereiding
//  overleeft een herlaadbeurt, en ze is in de gesprekkenlade van het paneel
//  terug te vinden.
// ============================================================================

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/core/lib/supabase";
import { maakIdempotentVerzoek } from "@/core/lib/idempotency-key";
import AssistentIngang from "@/core/components/assistent/AssistentIngang";
import {
  renderAntwoord,
  AntwoordKopieerKnop,
  type Bron,
} from "../../ai/_components/AntwoordWeergave";
import type { Bericht } from "@/core/lib/assistent-types";
import type { InlineMelding } from "@/core/lib/vraagtype";

/** Het gebruikersbericht dat de voorbereiding in het gesprek opent. Ongewijzigd
 *  overgenomen uit `AgendapuntChat`: bestaande rijen zijn eraan te herkennen. */
const VOORBEREIDING_VRAAG = "Stel mijn voorbereiding op voor dit agendapunt.";

/**
 * Een bronverwijzing in de tekst springt normaal naar de bronnenlijst onder het
 * antwoord. Die lijst staat hier niet: de kaart toont de uitkomst plus een
 * bronaantal, en wie de bronnen wil zien vraagt door in het paneel. Bewust een
 * no-op en geen weggelaten argument, zodat de renderer één signatuur houdt.
 */
const geenBronSprong = () => {};

/**
 * Zoekt de voorbereiding in een opgeslagen gesprek: het AI-antwoord dat direct
 * op de voorbereidingsvraag volgt.
 *
 * Bewust niet "het laatste AI-bericht". Rijen van vóór T1 kunnen een heel
 * chatgesprek bevatten; daarvan is de laatste beurt een willekeurig antwoord op
 * een willekeurige vraag, en dat als "Mijn voorbereiding" tonen zou een
 * bestuurder iets anders voorspiegelen dan hij leest.
 */
export function leesVoorbereiding(berichten: Bericht[]): Bericht | null {
  for (let i = berichten.length - 1; i >= 1; i--) {
    const b = berichten[i];
    if (b.rol === "ai" && berichten[i - 1]?.tekst === VOORBEREIDING_VRAAG) return b;
  }
  return null;
}

export default function VoorbereidingKaart({
  agendapuntId,
  titel,
}: {
  agendapuntId: string;
  titel: string;
}) {
  const [voorbereiding, setVoorbereiding] = useState<Bericht | null>(null);
  const [tekstTijdensGeneratie, setTekstTijdensGeneratie] = useState("");
  const [bezig, setBezig] = useState(false);
  const [fout, setFout] = useState<string | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [fondsNaam, setFondsNaam] = useState<string | null>(null);

  // Eén client per gemounte kaart; een lazy initializer voorkomt dat een gewone
  // rerender er een nieuwe maakt (en daarmee een nieuw initialisatie-effect).
  const [supabase] = useState(createClient);
  const fondsIdRef = useRef<string>("");
  const userIdRef = useRef<string | null>(null);
  const gesprekId = useRef<string | null>(null);
  const gesprekBestaatInDb = useRef(false);

  // ── Init: profiel + een eerder opgestelde voorbereiding ───────────────────
  // Eén query per GEOPENDE kaart: `AgendapuntKaart` rendert dit blok pas als de
  // bestuurder de kaart uitklapt, dus dit is geen N+1 over de vergadering.
  useEffect(() => {
    let afgebroken = false;
    void (async () => {
      try {
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!user || afgebroken) return;
        userIdRef.current = user.id;

        const { data: profiel } = await supabase
          .from("profielen")
          .select("fonds_id, fondsen(naam)")
          .eq("id", user.id)
          .single();
        if (profiel?.fonds_id) fondsIdRef.current = profiel.fonds_id as string;
        const rel = profiel?.fondsen as { naam: string } | { naam: string }[] | null;
        const fonds = Array.isArray(rel) ? rel[0] : rel;
        if (fonds?.naam && !afgebroken) setFondsNaam(fonds.naam);

        const { data: bestaand } = await supabase
          .from("gesprekken")
          .select("id, berichten")
          .eq("gebruiker_id", user.id)
          .eq("gearchiveerd", false)
          .eq("document_scope->agendapunt_context->>id", agendapuntId)
          .order("bijgewerkt", { ascending: false })
          .limit(1);
        const rij = bestaand?.[0];
        if (rij && Array.isArray(rij.berichten)) {
          gesprekId.current = rij.id as string;
          gesprekBestaatInDb.current = true;
          const gevonden = leesVoorbereiding(rij.berichten as Bericht[]);
          if (gevonden && !afgebroken) setVoorbereiding(gevonden);
        }
      } catch (e) {
        console.error("Voorbereiding laden mislukt:", e);
      } finally {
        if (!afgebroken) setGeladen(true);
      }
    })();
    return () => {
      afgebroken = true;
    };
  }, [supabase, agendapuntId]);

  const bewaar = useCallback(
    async (antwoord: Bericht) => {
      const uid = userIdRef.current;
      if (!uid || !fondsIdRef.current) return;
      const berichten: Bericht[] = [
        { rol: "gebruiker", tekst: VOORBEREIDING_VRAAG },
        antwoord,
      ];
      // Zelfde vorm als de assistent bewaart (Fase B2 + ADR 0028), zodat een
      // voorbereiding gewoon in de gesprekkenlade van het paneel verschijnt.
      const scopePayload = {
        type: "single",
        document_ids: [],
        titels: [],
        algemene_kennis: false,
        agendapunt_context: { id: agendapuntId, titel },
        gezet_op: new Date().toISOString(),
      };
      try {
        if (gesprekBestaatInDb.current && gesprekId.current) {
          await supabase
            .from("gesprekken")
            .update({
              berichten,
              document_scope: scopePayload,
              bijgewerkt: new Date().toISOString(),
            })
            .eq("id", gesprekId.current);
        } else {
          const id = gesprekId.current ?? crypto.randomUUID();
          gesprekId.current = id;
          const { error } = await supabase.from("gesprekken").insert({
            id,
            gebruiker_id: uid,
            fonds_id: fondsIdRef.current,
            titel: `Voorbereiding: ${titel}`.slice(0, 80),
            berichten,
            document_scope: scopePayload,
          });
          if (!error) gesprekBestaatInDb.current = true;
        }
      } catch (e) {
        // Best-effort, net als op /ai: het opslaan mag de weergave niet breken.
        console.error("Voorbereiding opslaan mislukt:", e);
      }
    },
    [supabase, agendapuntId, titel]
  );

  async function stelVoorbereidingOp() {
    if (bezig) return;
    setBezig(true);
    setFout(null);
    setTekstTijdensGeneratie("");

    // Kostendragende beurt; de route weigert zonder sleutel (400). Eén context
    // per gebruikersactie, zodat een transportretry dezelfde sleutel hergebruikt.
    const idempotentVerzoek = maakIdempotentVerzoek();
    let volledig = "";
    let bronnen: Bron[] | undefined;
    let meldingen: InlineMelding[] = [];
    let aantalBronnen = 0;

    try {
      const res = await fetch(`/api/agendapunten/${agendapuntId}/voorbereiding`, {
        method: "POST",
        headers: idempotentVerzoek.headers(),
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => null);
        setFout(
          body?.error ||
            "De voorbereiding kon niet worden opgesteld. Probeer het opnieuw."
        );
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      const verwerkEvent = (blok: string) => {
        const regel = blok.startsWith("data: ") ? blok.slice(6) : blok;
        if (!regel.trim()) return;
        let evt: {
          type: string;
          text?: string;
          bronnen?: Bron[];
          error?: string;
          inline_meldingen?: InlineMelding[];
        };
        try {
          evt = JSON.parse(regel);
        } catch {
          return;
        }
        if (evt.type === "meta") {
          bronnen = evt.bronnen;
          meldingen = evt.inline_meldingen ?? [];
          aantalBronnen = evt.bronnen?.length ?? 0;
        } else if (evt.type === "delta") {
          volledig += evt.text || "";
          setTekstTijdensGeneratie(volledig);
        } else if (evt.type === "done") {
          if (evt.inline_meldingen) meldingen = evt.inline_meldingen;
        } else if (evt.type === "error") {
          setFout(evt.error || "Er is een fout opgetreden.");
        }
      };

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const delen = buffer.split("\n\n");
        buffer = delen.pop() || "";
        for (const deel of delen) verwerkEvent(deel);
      }
      if (buffer.trim()) verwerkEvent(buffer);

      if (!volledig.trim()) {
        setFout((h) => h || "Er is geen antwoord ontvangen. Probeer het opnieuw.");
        return;
      }
      const antwoord: Bericht = {
        rol: "ai",
        tekst: volledig,
        bronnen,
        inlineMeldingen: meldingen,
        onderbouwing: { aantalBronnen },
        voltooid: true,
      };
      setVoorbereiding(antwoord);
      void bewaar(antwoord);
    } catch {
      setFout("Verbindingsfout. Probeer het opnieuw.");
    } finally {
      setBezig(false);
      setTekstTijdensGeneratie("");
    }
  }

  const aantalBronnen = voorbereiding?.onderbouwing?.aantalBronnen ?? 0;

  return (
    <div className="rounded-lg border border-line bg-card p-3">
      <div className="mb-2 flex items-baseline justify-between gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-ink">
          Mijn voorbereiding
        </h4>
        <span className="text-[10px] font-normal text-muted">
          privé · niet zichtbaar voor anderen
        </span>
      </div>

      {/* Tijdens het opstellen: het antwoord bouwt zich zichtbaar op, met een
          aankondiging voor wie het scherm niet ziet. */}
      {bezig && (
        <div>
          <p role="status" aria-live="polite" className="sr-only">
            De voorbereiding wordt opgesteld.
          </p>
          <div className="text-sm leading-relaxed text-ink">
            {tekstTijdensGeneratie ? (
              renderAntwoord(tekstTijdensGeneratie, undefined, 0, null, geenBronSprong, null)
            ) : (
              <span className="text-muted">Bezig met opstellen…</span>
            )}
          </div>
        </div>
      )}

      {fout && !bezig && (
        <p className="rounded border border-warn/30 bg-warn-tint px-2 py-1 text-[11px] text-warn-ink">
          {fout}
        </p>
      )}

      {!bezig && voorbereiding && (
        <div>
          {voorbereiding.inlineMeldingen && voorbereiding.inlineMeldingen.length > 0 && (
            <div className="mb-1.5 space-y-1">
              {voorbereiding.inlineMeldingen.map((m, i) => (
                <div
                  key={i}
                  className="rounded border border-warn/30 bg-warn-tint px-2 py-1 text-[11px] text-warn-ink"
                >
                  {m.tekst}
                </div>
              ))}
            </div>
          )}
          <div className="text-sm leading-relaxed text-ink">
            {renderAntwoord(voorbereiding.tekst, voorbereiding.bronnen, 0, null, geenBronSprong, {
              fondsnaam: fondsNaam,
              surface: "agendapunt",
            })}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-3">
            <AntwoordKopieerKnop
              tekst={voorbereiding.tekst}
              bronnen={voorbereiding.bronnen}
              herkomst={{ fondsnaam: fondsNaam, surface: "agendapunt" }}
            />
            <span className="text-[11px] text-muted">
              {aantalBronnen === 0
                ? "geen bronnen uit de bibliotheek"
                : `${aantalBronnen} ${aantalBronnen === 1 ? "bron" : "bronnen"} uit de bibliotheek`}
            </span>
            {/* De enige knop in deze toestand. Opent het paneel met dit
                agendapunt als context — één gespreksoppervlak in het portaal. */}
            <AssistentIngang
              ingangen={[{ soort: "agendapunt", agendapuntId }]}
              module="vergaderingen"
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-ai-line bg-ai-tint px-3 py-1.5 text-xs font-medium text-ai transition-colors hover:bg-ai/10"
              title="Stel een vervolgvraag over dit agendapunt in de assistent"
            >
              <span aria-hidden>✦</span>
              Doorvragen
            </AssistentIngang>
          </div>
        </div>
      )}

      {!bezig && !voorbereiding && (
        <div>
          <p className="mb-2 text-xs leading-relaxed text-muted">
            Laat de assistent dit punt voor u voorbereiden: wat het stuk betekent,
            welk besluit wordt gevraagd, waar de aandachtspunten zitten en welke
            vragen u mee de vergadering in kunt nemen.
          </p>
          <button
            type="button"
            onClick={stelVoorbereidingOp}
            disabled={!geladen}
            className="inline-flex items-center gap-1.5 rounded-lg bg-ai px-3 py-1.5 text-xs font-medium text-white transition-[filter] hover:brightness-90 disabled:opacity-50"
          >
            <span aria-hidden>✦</span>
            Bereid dit punt voor
          </button>
        </div>
      )}
    </div>
  );
}
