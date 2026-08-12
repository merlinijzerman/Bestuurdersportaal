// ============================================================================
//  /api/reflectie/transitie — de reflectieflowstatus lezen en laten wisselen
//  (plateau B, B-1).
// ----------------------------------------------------------------------------
//  GET  ?gesprek_id=<uuid>  → de huidige status, mét fail-safe toegepast.
//  POST                     → één transitie aanvragen.
//
//  DEZE ROUTE DOET ZELF NIETS AAN AUTORISATIE OF VALIDATIE. Zij roept
//  uitsluitend `reflectie_transitie()` aan; die functie bepaalt `auth.uid()`
//  intern, leest de actuele status opnieuw uit en valideert de gevraagde ACTIE
//  daartegen (FR-67). De client geeft nooit een gewenste einddstatus door — dat
//  is het hele punt van besluit 0110 en van acceptatiecriterium AC-18.
//
//  GEEN SERVICE-ROLE. Anon-key mét de sessie van de gebruiker.
//
//  ⚠ GEEN AUDITREGEL (besluit 0112). Een reflectietransitie schrijft niets in
//  `governance_log`, `platform_event_log` of welk ander spoor dan ook. Dat is
//  geen vergeten logging maar de kern van het ontwerp: wie weet dat zijn
//  aarzeling wordt geregistreerd, aarzelt niet meer hardop. De chatberichten
//  die uit de reflectie voortkomen worden wél gewoon gelogd — als gewone
//  chatbeurten, zonder enige markering dat het reflectie betrof (FR-18).
//
//  Ook GEEN app_errors-schrijfpad met inhoud: de foutafhandeling hieronder
//  gebruikt uitsluitend functionele foutcodes uit de RPC, nooit de tekst van de
//  gebruiker.
// ============================================================================

import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/core/lib/supabase-server";
import {
  effectieveStatus,
  isReflectieActie,
  isReflectieIngang,
  type ReflectieStatus,
} from "@/core/lib/reflectie-flow";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** De vorm die beide handlers teruggeven. Bewust smal — geen interne kolommen. */
interface StatusAntwoord {
  status: ReflectieStatus;
  ingang: string | null;
  beurt: number;
  /** Of er een bevroren bronset is. De hash zelf verlaat de server niet (FR-69). */
  heeft_bronset: boolean;
}

interface StateRij {
  status?: unknown;
  ingang?: unknown;
  beurt?: unknown;
  reflectie_bronset_versie?: unknown;
  bijgewerkt_op?: unknown;
}

/**
 * Vertaalt een statusrij naar het antwoord, met de fail-safe erop toegepast.
 *
 * `reflectie_bronset_versie` wordt bewust NIET teruggegeven: FR-69 zegt dat die
 * waarde de privéchat nooit verlaat. De client heeft alleen nodig te weten dát
 * er een bronset is, zodat de interface kan tonen waarop wordt gereflecteerd.
 */
function naarAntwoord(rij: StateRij | null): StatusAntwoord {
  if (!rij) {
    return { status: "niet_actief", ingang: null, beurt: 0, heeft_bronset: false };
  }
  const bijgewerkt =
    typeof rij.bijgewerkt_op === "string" ? Date.parse(rij.bijgewerkt_op) : null;
  // B-opt tranche 1d — `laatsteBerichtIsReflectie` wordt hier BEWUST niet
  // meegegeven en valt terug op de default `true`. De tweede FR-57-voorwaarde
  // ("het laatste bericht is geen reflectiebericht") is namelijk al upstream
  // afgedwongen: elke gewone beurt via de normale invoerbalk laat de chatroute
  // `afbreken` sturen, wat de flow op `niet_actief` zet. Deze statusroute leest
  // dus nooit een status die door een tussentijds niet-reflectiebericht ongeldig
  // zou moeten zijn — alleen de tijdgebonden fail-safe is hier nog relevant. De
  // parameter blijft bestaan voor toekomstige aanroepers die dat signaal wél
  // hebben; hij is niet dood, alleen op dit pad niet nodig.
  const status = effectieveStatus(
    rij.status as ReflectieStatus | null,
    Number.isNaN(bijgewerkt) ? null : bijgewerkt,
    Date.now()
  );
  if (status === "niet_actief") {
    return { status, ingang: null, beurt: 0, heeft_bronset: false };
  }
  return {
    status,
    ingang: typeof rij.ingang === "string" ? rij.ingang : null,
    beurt: typeof rij.beurt === "number" ? rij.beurt : 0,
    heeft_bronset: typeof rij.reflectie_bronset_versie === "string",
  };
}

/** Vertaalt de functionele foutcodes uit de RPC naar HTTP. Nooit details. */
function rpcFout(error: { message?: string }): NextResponse {
  const code = error.message ?? "";
  if (code.includes("niet_geauthenticeerd")) {
    return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });
  }
  if (code.includes("geen_eigenaar") || code.includes("bronset_niet_van_dit_gesprek")) {
    return NextResponse.json({ error: "Geen rechten" }, { status: 403 });
  }
  if (code.includes("gesprek_niet_gevonden")) {
    return NextResponse.json({ error: "Gesprek niet gevonden" }, { status: 404 });
  }
  if (
    code.includes("ongeldige_transitie") ||
    code.includes("ongeldige_actie") ||
    code.includes("ongeldige_ingang") ||
    code.includes("beurtplafond_bereikt")
  ) {
    // 409: de aangevraagde overgang past niet bij de actuele status. Dat is geen
    // clientfout in de zin van "verkeerd geformuleerd" maar een conflict met de
    // serverwaarheid — de client hoort de status opnieuw op te halen.
    return NextResponse.json({ error: "Ongeldige overgang" }, { status: 409 });
  }
  console.error("reflectie_transitie (RPC) mislukt:", error);
  return NextResponse.json({ error: "Overgang mislukt" }, { status: 500 });
}

/**
 * GET — herstel na refresh of heropenen (FR-57, AC-23).
 *
 * Leest rechtstreeks uit `gesprek_reflectie_state` onder RLS: de SELECT-policy
 * dekt uitsluitend de eigen rij binnen het eigen fonds. Er wordt bewust NOOIT
 * automatisch een bericht verstuurd — deze route geeft alleen status terug.
 */
export async function GET(req: NextRequest) {
  try {
    const gesprekId = req.nextUrl.searchParams.get("gesprek_id");
    if (!gesprekId || !UUID.test(gesprekId)) {
      return NextResponse.json({ error: "Ongeldig gesprek-id" }, { status: 400 });
    }

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data, error } = await supabase
      .from("gesprek_reflectie_state")
      .select("status, ingang, beurt, reflectie_bronset_versie, bijgewerkt_op")
      .eq("gesprek_id", gesprekId)
      .maybeSingle();

    if (error) {
      console.error("Lezen reflectiestatus mislukt:", error);
      // Fail-safe: bij twijfel niet_actief. Een leesfout mag nooit tot gevolg
      // hebben dat de chat in reflectiemodus blijft hangen.
      return NextResponse.json(naarAntwoord(null));
    }

    return NextResponse.json(naarAntwoord((data as StateRij | null) ?? null));
  } catch (e) {
    console.error("Fout in GET /api/reflectie/transitie:", e);
    return NextResponse.json(naarAntwoord(null));
  }
}

/** POST — één transitie aanvragen. De actie is het enige wat de client stuurt. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as {
      gesprek_id?: unknown;
      actie?: unknown;
      ingang?: unknown;
      bronset_log_id?: unknown;
    };

    if (typeof body.gesprek_id !== "string" || !UUID.test(body.gesprek_id)) {
      return NextResponse.json({ error: "Ongeldig gesprek-id" }, { status: 400 });
    }
    if (!isReflectieActie(body.actie)) {
      return NextResponse.json({ error: "Ongeldige actie" }, { status: 400 });
    }
    // Ingang en bronset gelden alleen bij `start`; de RPC negeert ze verder.
    const ingang = isReflectieIngang(body.ingang) ? body.ingang : null;
    const bronsetLogId =
      typeof body.bronset_log_id === "string" && UUID.test(body.bronset_log_id)
        ? body.bronset_log_id
        : null;

    const supabase = await createServerSupabase();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Niet ingelogd" }, { status: 401 });

    const { data, error } = await supabase.rpc("reflectie_transitie", {
      p_gesprek_id: body.gesprek_id,
      p_actie: body.actie,
      p_ingang: ingang,
      p_bronset_log_id: bronsetLogId,
    });

    if (error) return rpcFout(error);

    return NextResponse.json(naarAntwoord((data as StateRij | null) ?? null));
  } catch (e) {
    console.error("Fout in POST /api/reflectie/transitie:", e);
    return NextResponse.json({ error: "Interne fout" }, { status: 500 });
  }
}
