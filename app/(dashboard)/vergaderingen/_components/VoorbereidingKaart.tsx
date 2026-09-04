"use client";
// ============================================================================
//  "Mijn voorbereiding" op de agendapuntkaart (T2, #304 — herziet T1/0204).
// ----------------------------------------------------------------------------
//  DE KAART IS DE UITKOMST, HET PANEEL IS DE WERKPLAATS. Sinds T1 bestond er één
//  gespreksoppervlak, maar deze kaart hield nog wél een eigen `fetch` + SSE-lus
//  naar `/api/agendapunten/[id]/voorbereiding` — de laatste eigen
//  streamverwerking en de laatste eigen payload buiten `useAssistent`. Die is nu
//  weg. Beide knoppen openen het paneel; "Bereid dit punt voor" en "Opnieuw
//  opstellen" laten het paneel de beurt versturen met de vaste openingszin en de
//  antwoordmodus `persoonlijke_voorbereiding`.
//
//  Wat de kaart daarmee wint: de voorbereiding krijgt voortgangsmeldingen,
//  verduidelijking, reflectie en het onderbouwingspaneel, omdat ze door dezelfde
//  weergave loopt — en ze levert een `governance_log`-regel op. Dat laatste was
//  het auditgat dat T1 bewust liet staan.
//
//  WAAROM `voorbereidingen` EN NIET MEER `gesprekken`. De kaart leidde
//  "is dit punt voorbereid?" af uit een query op `gesprekken`, gefilterd op
//  `document_scope->agendapunt_context->>id`. Het product was daarmee een
//  bijproduct van een chatlog: een tweede gesprek over hetzelfde punt maakte
//  "de voorbereiding" troebel. De chat-route schrijft de uitkomst nu server-side
//  weg in `voorbereidingen.ai_output` + `bronnen_meta`; de kaart leest dáárop.
//  "Voorbereid" is zo een feit in plaats van een gevolgtrekking, met een datum
//  en een bronaantal die bij het product horen.
//
//  TWEE KNOPPEN OP EEN VOLTOOID PRODUCT — dit preciseert besluit 0204, het
//  herroept het niet. "Eén knop per toestand" was gericht tegen twee INGANGEN
//  naast elkaar op een onvoorbereid punt. "Opnieuw opstellen" en "Doorvragen"
//  zijn geen twee ingangen maar twee handelingen op een afgerond ding.
//
//  BEWUST NIET (besluit 0205): de stukversie waarop de voorbereiding steunt en
//  de melding "het stuk is gewijzigd ná uw voorbereiding". De mockup toont die
//  regel al; het veld wordt hier niet gevuld, want een kolom vullen die niemand
//  leest is het dode pad dat dit traject opruimt. Beslispunt voor T4.
// ============================================================================

import { useCallback, useEffect, useState } from "react";
import { createClient } from "@/core/lib/supabase";
import AssistentIngang from "@/core/components/assistent/AssistentIngang";
import { useAssistentPaneelOptioneel } from "@/core/components/assistent/AssistentPaneelProvider";
import Icoon from "@/core/components/icons/Icoon";
import {
  renderAntwoord,
  AntwoordKopieerKnop,
  type Bron,
} from "../../ai/_components/AntwoordWeergave";
import {
  leesVoorbereidingProduct,
  type VoorbereidingBron,
} from "@/core/lib/voorbereiding-product";

/** Het gebruikersbericht dat de voorbereiding in het gesprek opent. Ongewijzigd
 *  overgenomen uit `AgendapuntChat`: bestaande rijen zijn eraan te herkennen. */
export const VOORBEREIDING_VRAAG = "Stel mijn voorbereiding op voor dit agendapunt.";

/**
 * Een bronverwijzing in de tekst springt normaal naar de bronnenlijst onder het
 * antwoord. Die lijst staat hier niet: de kaart toont de uitkomst plus een
 * bronaantal, en wie de bronnen wil zien vraagt door in het paneel. Bewust een
 * no-op en geen weggelaten argument, zodat de renderer één signatuur houdt.
 */
const geenBronSprong = () => {};

/** De datumregel onder het product. Kort, Nederlands, zonder tijd. */
function opgesteldOpLabel(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

interface Product {
  tekst: string;
  aantalBronnen: number;
  bronnen: VoorbereidingBron[];
  opgesteldOp: string | null;
}

export default function VoorbereidingKaart({
  agendapuntId,
  titel,
}: {
  agendapuntId: string;
  titel: string;
}) {
  const [product, setProduct] = useState<Product | null>(null);
  const [geladen, setGeladen] = useState(false);
  const [fondsNaam, setFondsNaam] = useState<string | null>(null);

  // Eén client per gemounte kaart; een lazy initializer voorkomt dat een gewone
  // rerender er een nieuwe maakt (en daarmee een nieuw initialisatie-effect).
  const [supabase] = useState(createClient);

  // De kaart kan buiten een paneelschil staan (het platformdeel heeft een eigen
  // schil); dan is er geen signaal en herlaadt de bestuurder zelf.
  const paneel = useAssistentPaneelOptioneel();
  const signaal =
    paneel?.productSignaal?.agendapuntId === agendapuntId
      ? paneel.productSignaal.teller
      : 0;

  const laad = useCallback(async () => {
    // RLS beperkt `voorbereidingen` tot de eigen rij ("eigen voorbereiding",
    // `gebruiker_id = auth.uid()`); de kaart hoeft daar niets bovenop te
    // filteren en kan het ook niet omzeilen.
    const { data } = await supabase
      .from("voorbereidingen")
      .select("ai_output, bronnen_meta, gegenereerd_op, bijgewerkt_op")
      .eq("agendapunt_id", agendapuntId)
      .maybeSingle();
    return leesVoorbereidingProduct(data ?? null);
  }, [supabase, agendapuntId]);

  // ── Init: profielnaam (voor de herkomstregel bij kopiëren) + het product ──
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

        const { data: profiel } = await supabase
          .from("profielen")
          .select("fondsen(naam)")
          .eq("id", user.id)
          .single();
        const rel = profiel?.fondsen as { naam: string } | { naam: string }[] | null;
        const fonds = Array.isArray(rel) ? rel[0] : rel;
        if (fonds?.naam && !afgebroken) setFondsNaam(fonds.naam);

        const gevonden = await laad();
        if (gevonden && !afgebroken) setProduct(gevonden);
      } catch (e) {
        console.error("Voorbereiding laden mislukt:", e);
      } finally {
        if (!afgebroken) setGeladen(true);
      }
    })();
    return () => {
      afgebroken = true;
    };
  }, [supabase, laad]);

  // Het paneel heeft zojuist een voorbereiding voor DIT punt opgesteld → opnieuw
  // inlezen. `signaal === 0` betekent "nog niets gebeurd"; dan doet dit niets.
  useEffect(() => {
    if (signaal === 0) return;
    let afgebroken = false;
    void (async () => {
      try {
        const gevonden = await laad();
        if (gevonden && !afgebroken) setProduct(gevonden);
      } catch (e) {
        console.error("Voorbereiding herladen mislukt:", e);
      }
    })();
    return () => {
      afgebroken = true;
    };
  }, [signaal, laad]);

  // De bewaarde bronnen dragen alles wat de pill nodig heeft behalve het
  // citaat; `fragment` blijft leeg (zie core/lib/voorbereiding-product.ts). De
  // pill toont dan "geen fragment beschikbaar" en verwijst impliciet naar het
  // paneel, waar het antwoord mét onderbouwing staat. Zou de kaart hier
  // `undefined` doorgeven, dan zou renderAntwoord élke [Bron N] als ONGELDIG
  // markeren — een hallucinatiesignaal op bronnen die wél bestonden.
  const bronnenVoorWeergave: Bron[] | undefined =
    product && product.bronnen.length > 0
      ? product.bronnen.map((b) => ({
          document_id: b.document_id,
          titel: b.titel,
          bron: b.bron,
          pagina: b.pagina,
          paragraaf: b.paragraaf,
          fragment: "",
          heeft_origineel: b.heeft_origineel,
          documentstatus: b.documentstatus ?? null,
          documentdatum: b.documentdatum ?? null,
          documenttype: b.documenttype ?? null,
        }))
      : undefined;

  const startbeurt = {
    vraag: VOORBEREIDING_VRAAG,
    antwoordmodus: "persoonlijke_voorbereiding" as const,
    productVoorAgendapunt: agendapuntId,
  };
  const ingangen = [{ soort: "agendapunt" as const, agendapuntId }];
  const datum = opgesteldOpLabel(product?.opgesteldOp ?? null);
  const aantalBronnen = product?.aantalBronnen ?? 0;

  return (
    <div className="assistent-resultaatkaart">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="assistent-resultaatkop">
          <Icoon sleutel="sprankel" grootte={13} streek={1.9} />
          Mijn voorbereiding
        </h4>
        <span className="text-[10px] font-normal text-muted">
          privé · niet zichtbaar voor anderen
        </span>
      </div>

      {product && (
        <div>
          <div className="assistent-antwoord">
            {renderAntwoord(product.tekst, bronnenVoorWeergave, 0, null, geenBronSprong, {
              fondsnaam: fondsNaam,
              surface: "agendapunt",
            })}
          </div>
          <div className="assistent-resultaatvoet flex flex-wrap items-center gap-3">
            <AntwoordKopieerKnop
              tekst={product.tekst}
              bronnen={bronnenVoorWeergave}
              herkomst={{ fondsnaam: fondsNaam, surface: "agendapunt" }}
            />
            <span className="text-[11px] text-muted">
              {datum ? `Opgesteld ${datum} · ` : ""}
              {aantalBronnen === 0
                ? "geen bronnen uit de bibliotheek"
                : `${aantalBronnen} ${aantalBronnen === 1 ? "bron" : "bronnen"} uit de bibliotheek`}
            </span>
            {/* Twee HANDELINGEN op een afgerond product, geen twee ingangen —
                zie de toelichting bovenaan. Beide openen hetzelfde paneel. */}
            <AssistentIngang
              ingangen={ingangen}
              module="vergaderingen"
              startbeurt={startbeurt}
              className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:bg-ai-tint hover:text-ai"
              title="Stel de voorbereiding opnieuw op; de vorige versie blijft in het gesprek staan"
            >
              Opnieuw opstellen
            </AssistentIngang>
            <AssistentIngang
              ingangen={ingangen}
              module="vergaderingen"
              className="inline-flex items-center gap-1.5 rounded-lg border border-ai-line bg-ai-tint px-3 py-1.5 text-xs font-medium text-ai transition-colors hover:bg-ai/10"
              title="Stel een vervolgvraag over dit agendapunt in de assistent"
            >
              <span aria-hidden>✦</span>
              Doorvragen
            </AssistentIngang>
          </div>
        </div>
      )}

      {!product && (
        <div>
          <p className="mb-2 text-xs leading-relaxed text-muted">
            Laat de assistent dit punt voor u voorbereiden: wat het stuk betekent,
            welk besluit wordt gevraagd, waar de aandachtspunten zitten en welke
            vragen u mee de vergadering in kunt nemen.
          </p>
          <AssistentIngang
            ingangen={ingangen}
            module="vergaderingen"
            startbeurt={startbeurt}
            className={`inline-flex items-center gap-1.5 rounded-lg bg-ai px-3 py-1.5 text-xs font-medium text-white transition-[filter] hover:brightness-90 ${
              geladen ? "" : "pointer-events-none opacity-50"
            }`}
            title="Stel de voorbereiding op in de assistent"
          >
            <span aria-hidden>✦</span>
            Bereid dit punt voor
          </AssistentIngang>
        </div>
      )}
    </div>
  );
}
