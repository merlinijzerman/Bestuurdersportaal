"use client";
import { useState, useRef, useEffect, type ReactNode } from "react";
import { createClient } from "@/lib/supabase";
import {
  ZICHTBARE_ANTWOORDMODI,
  bepaalVervolgacties,
  isTransformatieActie,
  type Antwoordmodus,
  type Vervolgactie,
  type InlineMelding,
} from "@/lib/vraagtype";
import { bronkaartLabels, normgewichtLabel, isVeiligeUrl } from "@/lib/bronsoort";
import { DOCUMENT_STATUS_LABEL, BRONSTATUS_LABEL } from "@/lib/document-status-transities";
import OnderbouwingPaneel, { type OnderbouwingMeta } from "./_components/OnderbouwingPaneel";
import { detecteerInstantieInTekst } from "@/lib/assistant-source";

type Modus = "documenten" | "combineren" | "algemeen";

// Antwoordmodusfamilie — Increment I-1 (FO §13): nog maar VIER zichtbare modi.
// Auto (= null) plus de drie hieronder. De overige interne modi (historisch,
// besluitrijpheid, …) blijven onder de motorkap bestaan via auto-detectie en
// vervolgacties, maar krijgen geen knop meer.
const ANTWOORDMODUS_HELP: Record<Antwoordmodus, string> = {
  feitelijk: "Feitelijke beantwoording op documenten/beleid/besluiten",
  duiding: "Bestuurlijke interpretatie, governance, risico's en besluitrijpheid",
  sparring: "Meedenken: opties, scenario's en kritische tegenvragen",
  historisch: "Inclusief oude/vervangen bronnen (met label)",
  besluitrijpheid: "Weegt besluitvorming, neemt de besluitregistratie mee",
  bronoverzicht: "Overzicht van relevante bronnen",
  persoonlijke_voorbereiding: "Persoonlijke voorbereiding",
};
// Korte knoplabels (FO §13: Auto · Feiten · Duiding · Sparren).
const ANTWOORDMODUS_KNOP_LABEL: Record<Antwoordmodus, string> = {
  feitelijk: "Feiten",
  duiding: "Duiding",
  sparring: "Sparren",
  historisch: "Historie",
  besluitrijpheid: "Besluit",
  bronoverzicht: "Bronnen",
  persoonlijke_voorbereiding: "Voorbereiding",
};
const ANTWOORDMODUS_KEUZES: { value: Antwoordmodus; label: string; help: string }[] =
  ZICHTBARE_ANTWOORDMODI.map((value) => ({
    value,
    label: ANTWOORDMODUS_KNOP_LABEL[value],
    help: ANTWOORDMODUS_HELP[value],
  }));

interface Bron {
  document_id: string;
  titel: string;
  bron: string;
  pagina: number | null;
  paragraaf: string | null;
  fragment: string;
  heeft_origineel: boolean;
  // Increment G — bronkaartvelden (status/bronstatus/datum/bronsoort).
  documentstatus?: string | null;
  bronstatus?: string | null;
  documentdatum?: string | null;
  geldig_tot?: string | null;
  bibliotheek?: string | null;
  bronorganisatie?: string | null;
  normgewicht?: string | null;
  extern_url?: string | null;
}

// Increment I-2 (FO §11a) — bij een twijfelgeval vraagt de assistent terug i.p.v.
// te gokken. Dit AI-bericht draagt de verduidelijkingsvraag + de twee chips en
// de originele vraag, zodat een chipkeuze dezelfde vraag opnieuw stuurt met een
// bevestigde bron-intentie (combineren-vloer voor "fonds", niet een harde scope).
interface VerduidelijkingKeuze {
  vraag: string;
  opties: { intent: "fonds" | "algemeen"; label: string }[];
  origineleVraag: string;
}

interface Bericht {
  rol: "gebruiker" | "ai";
  tekst: string;
  bronnen?: Bron[];
  modus?: Modus;
  // Increment I-1 (FO §11c) — rustige weergave: controle-informatie voor het
  // paneel "Onderbouwing en bronnen" + de conditionele inline-meldingen.
  onderbouwing?: OnderbouwingMeta;
  inlineMeldingen?: InlineMelding[];
  // Increment I-2 (FO §11a) — verduidelijkingsvraag met chips (geen antwoord).
  verduidelijking?: VerduidelijkingKeuze;
}

// Actieve documentscope (increment 1). titels op moment van zetten, zodat de
// chip en de gesprekshistorie het stuk herkenbaar tonen.
interface DocumentScope {
  document_ids: string[];
  titels: string[];
  // Opt-in algemene kennis (increment 2). Default uit = strict-document.
  algemene_kennis?: boolean;
}

// Eén suggestie in de @-mention-typeahead.
interface DocSuggestie {
  id: string;
  titel: string;
  bron: string;
  bestandstype: string | null;
  aangemaakt: string | null;
}

// Eén item in het gesprekken-overzicht (Fase B2-volledig).
interface GesprekItem {
  id: string;
  titel: string | null;
  bijgewerkt: string;
  berichten: Bericht[];
  document_scope?: unknown;
  actieve_antwoordmodus?: unknown;
}

// Leest een (mogelijk onbekende) antwoordmodus-waarde terug naar het type of null.
function leesAntwoordmodus(ruw: unknown): Antwoordmodus | null {
  const geldig: Antwoordmodus[] = [
    "feitelijk",
    "bronoverzicht",
    "historisch",
    "duiding",
    "besluitrijpheid",
    "sparring",
    "persoonlijke_voorbereiding",
  ];
  return typeof ruw === "string" && (geldig as string[]).includes(ruw)
    ? (ruw as Antwoordmodus)
    : null;
}

// Leest de jsonb-scope uit een gesprek terug naar de UI-vorm (of null).
function leesScope(ruw: unknown): DocumentScope | null {
  if (!ruw || typeof ruw !== "object") return null;
  const o = ruw as { document_ids?: unknown; titels?: unknown };
  const ids = Array.isArray(o.document_ids)
    ? o.document_ids.filter((x): x is string => typeof x === "string")
    : [];
  if (ids.length === 0) return null;
  const titels = Array.isArray(o.titels)
    ? o.titels.filter((x): x is string => typeof x === "string")
    : [];
  const ak = (ruw as { algemene_kennis?: unknown }).algemene_kennis === true;
  return { document_ids: ids, titels, algemene_kennis: ak };
}

// ADR 0028 — agendapunt-modus: de vraag is geframed door een agendapunt. We
// bewaren id + titel zodat de chip "Agendapunt: «titel»" toont en de toelichting
// per beurt server-side wordt opgehaald (de route trust de client-titel niet).
interface AgendapuntContext {
  id: string;
  titel: string;
}

// Leest het (additieve) agendapunt_context-blok uit een opgeslagen gesprek terug,
// zodat een hervat agendapunt-gesprek de framing behoudt.
function leesAgendapuntContext(ruw: unknown): AgendapuntContext | null {
  if (!ruw || typeof ruw !== "object") return null;
  const o = (ruw as { agendapunt_context?: unknown }).agendapunt_context;
  if (!o || typeof o !== "object") return null;
  const id = (o as { id?: unknown }).id;
  const titel = (o as { titel?: unknown }).titel;
  if (typeof id !== "string" || id.length === 0) return null;
  return { id, titel: typeof titel === "string" && titel ? titel : "dit agendapunt" };
}

const BRONKLEUR: Record<string, string> = {
  DNB: "bg-err-tint border-err/30",
  AFM: "bg-accent-tint border-accent/30",
  Pensioenfederatie: "bg-ok-tint border-ok/30",
  Intern: "bg-warn-tint border-warn/30",
  Extern: "bg-warn-tint border-warn/30",
};

const BRONTEKST: Record<string, string> = {
  DNB: "text-err-ink",
  AFM: "text-accent-ink",
  Pensioenfederatie: "text-ok-ink",
  Intern: "text-warn-ink",
  Extern: "text-warn-ink",
};

const BRON_NUMMER_KLEUR: Record<string, string> = {
  DNB: "bg-err text-white",
  AFM: "bg-accent text-white",
  Pensioenfederatie: "bg-ok text-white",
  Intern: "bg-warn text-white",
  Extern: "bg-warn text-white",
};

// Regex pakt alle inline-markeringen in één keer:
// - [Bron 1], [Bron 12]
// - [Algemene kennis], [algemene kennis]
// - [Volgens wetgeving], [volgens wetgeving]
// - [Toelichting agendapunt] (ADR 0028 — ongevalideerde bestuurs-vrijetekst)
const MARKER_REGEX =
  /(\[Bron \d+\]|\[Algemene kennis\]|\[Volgens wetgeving\]|\[Toelichting agendapunt\])/gi;

const VOORGESTELDE_VRAGEN = [
  "Wat zijn de deskundigheidseisen voor bestuurders?",
  "Hoe wordt een tegenstrijdig belang gemeld?",
  "Wat zijn de hoofdpunten van de Wet toekomst pensioenen?",
  "Wat is het verschil tussen SPR en FPR onder de Wtp?",
];

function dagdeelGroet() {
  const u = new Date().getHours();
  if (u < 6) return "Goedenacht";
  if (u < 12) return "Goedemorgen";
  if (u < 18) return "Goedemiddag";
  return "Goedenavond";
}

export default function AiPage() {
  const [berichten, setBerichten] = useState<Bericht[]>([
    {
      rol: "ai",
      tekst: `Welkom terug. Ik ben uw AI-assistent voor het bestuurdersportaal.\n\nStelt u gerust uw vraag — ik kies automatisch de passende bron: uw fondsdocumenten, algemene kennis, of een combinatie. Twijfel ik of u het voor uw fonds of in algemene zin bedoelt, dan vraag ik het u even.\n\nElke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt.`,
    },
  ]);
  const [invoer, setInvoer] = useState("");
  const [laden, setLaden] = useState(false);
  // True zodra de eerste tokens van een antwoord binnenstromen — gebruikt om de
  // typ-indicator te verbergen zodra de tekst zelf begint te verschijnen.
  const [antwoordGestart, setAntwoordGestart] = useState(false);
  const [fondsId, setFondsId] = useState<string>("");
  // Increment I-2 (FO §11a) — de zichtbare bron-as is vervangen door automatische
  // bronkeuze. De gebruiker kiest geen bron-modus meer; alleen de expliciete
  // restrictie "Alleen fondsdocumenten" (onder "Aanpassen") blijft over.
  const [alleenFondsdocumenten, setAlleenFondsdocumenten] = useState(false);
  // Increment F (FO §14) — "algemeen perspectief": schakelt de profielgestuurde
  // prioritering uit (zelfde bronnen, collectieve weergave). Default uit = het
  // antwoord wordt op het eigen profiel geprioriteerd indien dat is ingevuld.
  const [algemeenPerspectief, setAlgemeenPerspectief] = useState(false);
  const [aanpassenOpen, setAanpassenOpen] = useState(false);
  // Increment G — vastgezette antwoordmodus (null = auto-detectie). De feitelijk
  // gebruikte modus + bronbasis komen per antwoord in het paneel "Onderbouwing
  // en bronnen" (Increment I-1, rustige weergave §11c) — niet meer in een
  // globale balk. De hybride-schakelaar is uit de eindgebruikers-UI gehaald
  // (I-1): de per-fonds instelling (default aan) blijft server-side leidend.
  const [antwoordmodus, setAntwoordmodus] = useState<Antwoordmodus | null>(null);
  // Welke onderbouwingspanelen open staan (per bericht-index). Default dicht.
  const [openPanelen, setOpenPanelen] = useState<Set<number>>(new Set());
  const [highlight, setHighlight] = useState<{
    berichtIdx: number;
    bronIdx: number;
  } | null>(null);
  // Index van het bericht waar na het versturen van een vraag naartoe moet
  // worden gescrold (begin van de vraag bovenaan), i.p.v. mee te schuiven naar
  // de onderkant/bronnen tijdens het streamen.
  const scrollDoel = useRef<number | null>(null);
  const highlightTimer = useRef<number | null>(null);
  // Persistentie (Fase B2): id van het huidige opgeslagen gesprek en de
  // ingelogde gebruiker. Refs i.p.v. state — wijziging hoeft geen re-render.
  const gesprekId = useRef<string | null>(null);
  const userIdRef = useRef<string | null>(null);
  // Gepersonaliseerde welkomstboodschap, zodat "nieuw gesprek" altijd een
  // schone start toont (ook nadat een eerder gesprek is geopend).
  const welkomstRef = useRef<Bericht | null>(null);
  // Gesprekken-overzicht (Fase B2-volledig).
  const [gesprekken, setGesprekken] = useState<GesprekItem[]>([]);
  const [historieOpen, setHistorieOpen] = useState(false);
  // Document-scope (increment 1): beperkt de vraag tot één specifiek stuk.
  const [documentScope, setDocumentScope] = useState<DocumentScope | null>(null);
  // Agendapunt-modus (ADR 0028): de vraag is geframed door een agendapunt; de
  // toelichting wordt per beurt server-side opgehaald aan de hand van dit id.
  const [agendapuntContext, setAgendapuntContext] =
    useState<AgendapuntContext | null>(null);
  // @-mention-typeahead op documenttitels.
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionSuggesties, setMentionSuggesties] = useState<DocSuggestie[]>([]);
  // Voortgang bij map-reduce (increment 2): {batch, totaal} tijdens de analyse-
  // fase; null zodra het antwoord begint te streamen.
  const [analyseVoortgang, setAnalyseVoortgang] = useState<{
    batch: number;
    totaal: number;
  } | null>(null);
  const supabase = createClient();

  // Haalt de eigen, niet-gearchiveerde gesprekken op voor het overzicht.
  // RLS beperkt dit al tot de eigen gesprekken; de gebruiker_id-filter maakt het
  // expliciet. Best-effort.
  async function laadGesprekken() {
    try {
      const uid = userIdRef.current;
      if (!uid) return;
      const { data } = await supabase
        .from("gesprekken")
        .select("id, titel, bijgewerkt, berichten, document_scope, actieve_antwoordmodus")
        .eq("gebruiker_id", uid)
        .eq("gearchiveerd", false)
        .order("bijgewerkt", { ascending: false })
        .limit(50);
      if (Array.isArray(data)) setGesprekken(data as GesprekItem[]);
    } catch (e) {
      console.error("Gesprekken laden mislukt:", e);
    }
  }

  // Opent een bestaand gesprek in de chat — inclusief de opgeslagen scope (§8),
  // zodat een hervat gesprek herkenbaar "over «titel»" blijft.
  function openGesprek(item: GesprekItem) {
    if (laden) return;
    gesprekId.current = item.id;
    setBerichten(
      Array.isArray(item.berichten) && item.berichten.length > 0
        ? item.berichten
        : welkomstRef.current
        ? [welkomstRef.current]
        : []
    );
    setDocumentScope(leesScope(item.document_scope));
    setAgendapuntContext(leesAgendapuntContext(item.document_scope));
    setAntwoordmodus(leesAntwoordmodus(item.actieve_antwoordmodus));
    setHistorieOpen(false);
  }

  // Archiveert een gesprek (soft-delete). governance_log blijft intact. Als het
  // huidige gesprek wordt gearchiveerd, start een schone weergave.
  async function archiveerGesprek(id: string) {
    try {
      await supabase.from("gesprekken").update({ gearchiveerd: true }).eq("id", id);
    } catch (e) {
      console.error("Gesprek archiveren mislukt:", e);
    }
    if (gesprekId.current === id) {
      gesprekId.current = null;
      setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
      setDocumentScope(null);
      setAgendapuntContext(null);
    }
    laadGesprekken();
  }

  // Slaat het gesprek best-effort op. Faalt veilig: een mislukte opslag mag de
  // chat nooit verstoren. governance_log (auditspoor) staat hier los van.
  async function bewaarGesprek(finale: Bericht[]) {
    try {
      const uid = userIdRef.current;
      if (!uid || !fondsId || finale.length === 0) return;
      const eersteVraag =
        finale.find((b) => b.rol === "gebruiker")?.tekst || "Gesprek";
      const titel = eersteVraag.slice(0, 80);

      // Scope meeschrijven als jsonb {type, document_ids, titels, gezet_op}.
      // ADR 0028: in agendapunt-modus bewaren we additief agendapunt_context, ook
      // als er 0 stukken zijn (documentScope null) — zodat de framing terugkomt.
      const scopePayload =
        documentScope || agendapuntContext
          ? {
              type: "single",
              document_ids: documentScope?.document_ids ?? [],
              titels: documentScope?.titels ?? [],
              algemene_kennis: documentScope?.algemene_kennis === true,
              ...(agendapuntContext
                ? {
                    agendapunt_context: {
                      id: agendapuntContext.id,
                      titel: agendapuntContext.titel,
                    },
                  }
                : {}),
              gezet_op: new Date().toISOString(),
            }
          : null;

      if (gesprekId.current) {
        await supabase
          .from("gesprekken")
          .update({
            berichten: finale,
            document_scope: scopePayload,
            actieve_antwoordmodus: antwoordmodus,
            bijgewerkt: new Date().toISOString(),
          })
          .eq("id", gesprekId.current);
      } else {
        const { data } = await supabase
          .from("gesprekken")
          .insert({
            gebruiker_id: uid,
            fonds_id: fondsId,
            titel,
            berichten: finale,
            document_scope: scopePayload,
            actieve_antwoordmodus: antwoordmodus,
          })
          .select("id")
          .single();
        if (data?.id) gesprekId.current = data.id as string;
      }
      // Ververs het overzicht zodat nieuwe/bijgewerkte gesprekken bovenaan komen.
      laadGesprekken();
    } catch (e) {
      console.error("Gesprek opslaan mislukt:", e);
    }
  }

  function scrollNaarBron(berichtIdx: number, bronIdx: number) {
    // Increment I-1 — de bronkaarten leven in het (standaard ingeklapte) paneel
    // "Onderbouwing en bronnen"; open het eerst, scrol daarna na de render.
    setOpenPanelen((s) => new Set(s).add(berichtIdx));
    window.setTimeout(() => {
      const el = document.getElementById(`bron-${berichtIdx}-${bronIdx}`);
      if (!el) return;
      el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setHighlight({ berichtIdx, bronIdx });
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlight(null);
      highlightTimer.current = null;
    }, 2000);
  }

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data: { user } }) => {
      if (user) {
        userIdRef.current = user.id;
        const { data } = await supabase
          .from("profielen")
          .select("fonds_id, naam, rol, standaard_ai_modus, fondsen(naam)")
          .eq("id", user.id)
          .single();
        if (data?.fonds_id) setFondsId(data.fonds_id);

        const voornaam = (data?.naam as string | null)?.split(" ")[0] || "";
        const fondsenRel = data?.fondsen as
          | { naam: string }
          | { naam: string }[]
          | null
          | undefined;
        const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;
        const fondsnaam =
          fondsenObj?.naam || "uw fonds";

        const groet = dagdeelGroet();
        const personalTekst = voornaam
          ? `${groet} ${voornaam}, fijn u te zien.\n\nIk help u graag met vragen rondom ${fondsnaam}. Stelt u gerust uw vraag — ik kies automatisch de passende bron: uw fondsdocumenten, algemene kennis, of een combinatie. Twijfel ik of u het voor uw fonds of in algemene zin bedoelt, dan vraag ik het u even.\n\nElke vraag wordt vastgelegd in de Governance Log, inclusief welke bron is gebruikt.`
          : `${groet}. Ik help u graag met vragen rondom ${fondsnaam}.\n\nStelt u gerust uw vraag — ik kies automatisch de passende bron en vraag het u even als ik twijfel of u het voor uw fonds of in algemene zin bedoelt.\n\nElke vraag wordt vastgelegd in de Governance Log.`;

        welkomstRef.current = { rol: "ai", tekst: personalTekst };

        // Auto-restore (Fase B2): haal het meest recente, niet-gearchiveerde
        // gesprek terug. RLS beperkt dit al tot de eigen gesprekken; de extra
        // gebruiker_id-filter maakt de query expliciet.
        let hersteld = false;
        try {
          const { data: laatste } = await supabase
            .from("gesprekken")
            .select("id, berichten, document_scope, actieve_antwoordmodus")
            .eq("gebruiker_id", user.id)
            .eq("gearchiveerd", false)
            .order("bijgewerkt", { ascending: false })
            .limit(1)
            .maybeSingle();

          const opgeslagen = laatste?.berichten as Bericht[] | undefined;
          if (laatste?.id && Array.isArray(opgeslagen) && opgeslagen.length > 0) {
            gesprekId.current = laatste.id as string;
            setBerichten(opgeslagen);
            setDocumentScope(leesScope(laatste.document_scope));
            setAgendapuntContext(leesAgendapuntContext(laatste.document_scope));
            setAntwoordmodus(leesAntwoordmodus(laatste.actieve_antwoordmodus));
            hersteld = true;
          }
        } catch (e) {
          console.error("Gesprek herstellen mislukt:", e);
        }

        if (!hersteld) {
          setBerichten([{ rol: "ai", tekst: personalTekst }]);
          // Increment F (A4) — profiel-default voorselecteert de antwoordmodus bij
          // een schone start (geen hersteld gesprek met eigen vastgezette modus).
          const profielModus = leesAntwoordmodus(data?.standaard_ai_modus);
          if (profielModus) setAntwoordmodus(profielModus);
        }

        // Instappunt-knop "Vraag de AI over dit stuk": /ai?doc=<id> opent de chat
        // met scope op dat document. We zetten de scope expliciet (validatie volgt
        // server-side bij de eerste vraag). Een nieuw gesprek starten zodat de
        // scope niet over een bestaand gesprek heen valt.
        try {
          const docParam = new URLSearchParams(window.location.search).get("doc");
          if (docParam) {
            const { data: d } = await supabase
              .from("documenten")
              .select("id, titel, actief")
              .eq("id", docParam)
              .maybeSingle();
            if (d?.id && d.actief !== false) {
              gesprekId.current = null;
              setBerichten([{ rol: "ai", tekst: personalTekst }]);
              setDocumentScope({
                document_ids: [d.id as string],
                titels: [(d.titel as string) || "dit document"],
              });
            }
          }
        } catch (e) {
          console.error("Scope uit ?doc= zetten mislukt:", e);
        }

        // Instappunt-knop "Vraag de AI over dit agendapunt": /ai?agendapunt=<id>
        // opent de chat geframed door het agendapunt (ADR 0028). We laden id+titel
        // (RLS) en koppelen de actieve stukken als retrieval-scope. De toelichting
        // zelf wordt server-side per beurt opgehaald — niet hier meegegeven. Een
        // nieuw gesprek starten zodat de framing niet over een bestaand gesprek
        // heen valt.
        try {
          const apParam = new URLSearchParams(window.location.search).get(
            "agendapunt"
          );
          if (apParam) {
            const { data: ap } = await supabase
              .from("agendapunten")
              .select("id, titel")
              .eq("id", apParam)
              .maybeSingle();
            if (ap?.id) {
              const { data: stukken } = await supabase
                .from("documenten")
                .select("id, titel")
                .eq("agendapunt_id", ap.id)
                .eq("actief", true);
              const geldig = Array.isArray(stukken)
                ? stukken.filter(
                    (s): s is { id: string; titel: string } =>
                      typeof s?.id === "string"
                  )
                : [];
              gesprekId.current = null;
              setBerichten([{ rol: "ai", tekst: personalTekst }]);
              setAgendapuntContext({
                id: ap.id as string,
                titel: (ap.titel as string) || "dit agendapunt",
              });
              setDocumentScope(
                geldig.length > 0
                  ? {
                      document_ids: geldig.map((s) => s.id),
                      titels: geldig.map((s) => s.titel || "stuk"),
                    }
                  : null
              );
            }
          }
        } catch (e) {
          console.error("Scope uit ?agendapunt= zetten mislukt:", e);
        }

        // Vul het gesprekken-overzicht.
        laadGesprekken();
      }
    });
  }, []);

  useEffect(() => {
    // Scroll alleen wanneer er een nieuw doel is gezet (na het versturen van een
    // vraag) — niet bij elk gestreamd token. Daardoor blijft de weergave aan het
    // begin van het antwoord staan in plaats van mee te schieten naar onderen.
    if (scrollDoel.current != null) {
      document
        .getElementById(`bericht-${scrollDoel.current}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
      scrollDoel.current = null;
    }
  }, [berichten]);

  // Increment I-1 — vervolgacties kunnen de antwoordmodus en/of de bronselectie
  // voor één turn overrulen zonder de gespreksinstelling te wijzigen.
  interface StuurOpties {
    antwoordmodusOverride?: Antwoordmodus | null;
    scopeOverride?: DocumentScope | null;
    // Increment I-2 (FO §11a) — bevestigde bron-intentie na een verduidelijkingschip.
    bronIntentOverride?: "fonds" | "algemeen";
    // Stuurt dezelfde (al getoonde) vraag opnieuw zonder een nieuwe gebruikersbubbel
    // toe te voegen; `basisBerichten` is dan de geschiedenis die op die vraag eindigt.
    geenNieuweVraag?: boolean;
    basisBerichten?: Bericht[];
    // FO §13 — transformatie-vervolgactie: bewerk het vorige antwoord i.p.v. een
    // nieuwe documentvraag. De route schakelt dan naar herschrijf-intent.
    transformatie?: boolean;
  }

  async function stuurBericht(vraag?: string, opties?: StuurOpties) {
    const tekst = vraag || invoer.trim();
    if (!tekst || laden) return;
    setInvoer("");
    setLaden(true);

    // Eén-turn-overrides (vervolgacties); undefined = gebruik de gespreksstaat.
    const effAntwoordmodus =
      opties?.antwoordmodusOverride !== undefined
        ? opties.antwoordmodusOverride
        : antwoordmodus;
    const effScope =
      opties?.scopeOverride !== undefined ? opties.scopeOverride : documentScope;

    // Voeg de nieuwe vraag toe en stuur de complete geschiedenis mee. Bij een
    // verduidelijkingsvervolg (geenNieuweVraag) eindigt `basisBerichten` al op de
    // oorspronkelijke vraag; we voegen geen tweede gebruikersbubbel toe en wissen
    // tegelijk de verduidelijkingsbubbel uit de weergave.
    const basis = opties?.basisBerichten ?? berichten;
    const nieuw: Bericht = { rol: "gebruiker", tekst };
    const conversatie = opties?.geenNieuweVraag ? basis : [...basis, nieuw];
    setBerichten(conversatie);
    // Scroll het zojuist gestelde bericht naar boven, zodat het antwoord eronder
    // vanaf het begin in beeld komt te staan.
    scrollDoel.current = conversatie.length - 1;

    // Bouw de messages-array voor de API. We slaan het eerste bericht over
    // als dat de welkomst-AI-tekst is (puur UI, geen onderdeel van het gesprek).
    const messages = conversatie
      .filter((b, i) => !(i === 0 && b.rol === "ai"))
      .map((b) => ({
        role: b.rol === "gebruiker" ? ("user" as const) : ("assistant" as const),
        content: b.tekst,
      }));

    setAntwoordGestart(false);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          fonds_id: fondsId,
          // Increment I-2 (FO §11a) — geen zichtbare bron-modus meer; alleen de
          // expliciete restrictie + (na een chip) de bevestigde bron-intentie.
          alleen_fondsdocumenten: alleenFondsdocumenten,
          bron_intent_override: opties?.bronIntentOverride,
          document_scope: effScope
            ? {
                document_ids: effScope.document_ids,
                algemene_kennis: effScope.algemene_kennis === true,
              }
            : undefined,
          // Increment G — vastgezette antwoordmodus (null = auto-detectie).
          actieve_antwoordmodus: effAntwoordmodus,
          // Increment F (FO §14) — "algemeen perspectief": profielsturing overslaan.
          algemeen_perspectief: algemeenPerspectief,
          // FO §13 — transformatie-vervolgactie (herschrijf-intent op vorige antwoord).
          transformatie: opties?.transformatie === true,
          // ADR 0028 — agendapunt-modus: alleen het id (+ titel voor de UI). De
          // route haalt de toelichting zelf op onder RLS; de client-titel wordt
          // niet vertrouwd voor de promptinhoud. Precedentie: stuurt een
          // vervolgactie tegelijk een per-turn scopeOverride mee, dan wint
          // agendapunt-modus server-side (route.ts) — die override-stukken worden
          // dan agendapunt-retrievalscope i.p.v. een strikte document-scope.
          agendapunt_context: agendapuntContext
            ? { id: agendapuntContext.id, titel: agendapuntContext.titel }
            : undefined,
        }),
      });

      // Fouten (400/401/500) komen als JSON terug, niet als stream.
      if (!res.ok || !res.body) {
        const fout = await res.json().catch(() => null);
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: fout?.error || "Er is een fout opgetreden." },
        ]);
        return;
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aiToegevoegd = false;
      let volledig = "";
      let bronnenData: Bron[] | undefined;
      let modusData: Modus = "combineren";
      // Increment I-2 — bij een twijfelgeval stuurt de server één verduidelijkings-
      // event i.p.v. een antwoord; dan slaan we het 'done'-overschrijven over.
      let verduidelijkingActief = false;
      // Increment I-1 — rustige weergave: per-antwoord controle-informatie en
      // conditionele inline-meldingen (FO §11c).
      let onderbouwingData: OnderbouwingMeta | undefined;
      let inlineMeldingenData: InlineMelding[] | undefined;

      // Werkt het laatste (AI-)bericht bij, of voegt het toe als het nog niet
      // bestaat. Bronnen worden meegegeven zodra die binnen zijn.
      const schrijfAi = () => {
        setBerichten((prev) => {
          if (!aiToegevoegd) return prev; // veiligheid
          const kopie = [...prev];
          kopie[kopie.length - 1] = {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            modus: modusData,
            onderbouwing: onderbouwingData,
            inlineMeldingen: inlineMeldingenData,
          };
          return kopie;
        });
      };

      const verwerkEvent = (raw: string) => {
        const regel = raw.replace(/^data: ?/, "").trim();
        if (!regel) return;
        let evt: {
          type: string;
          text?: string;
          bronnen?: Bron[];
          modus?: Modus;
          error?: string;
          fase?: string;
          batch?: number;
          totaal?: number;
          antwoordmodus?: string;
          antwoordmodus_label?: string;
          peildatum?: string | null;
          bronbasis?: string | null;
          retrieval_modus?: string | null;
          inline_meldingen?: InlineMelding[];
          // Increment I-2 — verduidelijkingsevent (vraag + chips).
          vraag?: string;
          opties?: { intent: "fonds" | "algemeen"; label: string }[];
          // Increment I-2 — automatische bronkeuze (meta-event).
          bron_intent?: "fonds" | "algemeen" | "gecombineerd" | null;
          bron_vertrouwen?: "zeker" | "onzeker" | null;
          bron_modus_auto?: "documenten" | "combineren" | "algemeen" | null;
          alleen_fondsdocumenten?: boolean;
          bron_intent_override?: boolean;
          // Increment I-3 — uniforme bronvermelding-transparantie.
          web_retrieval_actief?: boolean;
          model_kennis?: { grond: "algemene_kennis" | "wetgeving"; instantie: string | null }[];
          // Increment F (FO §14) — profielsturing-status (paneel "Onderbouwing en bronnen").
          profielsturing?: "actief" | "uitgeschakeld" | "geen-profiel" | null;
          // B1 / scope-split — documentgericht (meta) + vervolgvragen (done).
          document_gericht?: boolean;
          vervolgvragen?: string[];
        };
        try {
          evt = JSON.parse(regel);
        } catch {
          return;
        }

        if (evt.type === "verduidelijking") {
          // Twijfelgeval: toon de verduidelijkingsvraag met twee chips, géén
          // antwoord. aiToegevoegd voorkomt dat het vangnet "geen antwoord" slaat;
          // verduidelijkingActief voorkomt dat 'done' de bubbel overschrijft.
          verduidelijkingActief = true;
          aiToegevoegd = true;
          setAnalyseVoortgang(null);
          setBerichten((prev) => [
            ...prev,
            {
              rol: "ai",
              tekst:
                evt.vraag ||
                "Wilt u dit weten voor uw fonds specifiek, of in algemene zin?",
              verduidelijking: {
                vraag: evt.vraag || "",
                opties: evt.opties ?? [],
                origineleVraag: tekst,
              },
            },
          ]);
        } else if (evt.type === "meta") {
          bronnenData = evt.bronnen;
          modusData = evt.modus || "combineren";
          // Increment I-1 — controle-informatie naar het paneel "Onderbouwing en
          // bronnen" (per antwoord, standaard ingeklapt) i.p.v. een globale balk.
          const aantal = evt.bronnen?.length ?? 0;
          onderbouwingData = {
            bronbasis: evt.bronbasis ?? null,
            antwoordmodusLabel: evt.antwoordmodus_label ?? evt.antwoordmodus ?? null,
            antwoordmodus: evt.antwoordmodus ?? null,
            retrievalModus: evt.retrieval_modus ?? null,
            peildatum: evt.peildatum ?? null,
            algemeneKennis: evt.bronbasis
              ? /algemene kennis/i.test(evt.bronbasis)
              : undefined,
            aantalBronnen: aantal,
            // Increment I-2 — automatische bronkeuze (alleen in het controlevlak).
            bronIntent: evt.bron_intent ?? null,
            bronVertrouwen: evt.bron_vertrouwen ?? null,
            alleenFondsdocumenten: evt.alleen_fondsdocumenten ?? null,
            bronIntentOverride: evt.bron_intent_override ?? null,
            // Increment I-3 — web-retrieval is (nog) niet actief (Scenario B); de
            // model_knowledge-bronnen volgen in het 'done'-event (content-afhankelijk).
            webRetrievalActief: evt.web_retrieval_actief ?? false,
            modelKennis: [],
            // Increment F (FO §14) — transparantie profielsturing in het controlevlak.
            profielsturing: evt.profielsturing ?? null,
            // B1 / scope-split — documentgericht bepaalt in de render welke
            // vervolgacties (duiding/kritische vragen) blijven staan.
            documentGericht: evt.document_gericht ?? null,
            vervolgvragen: [],
          };
          // Deterministische inline-meldingen (pre-stream); de #4-melding kan in
          // het 'done'-event nog worden aangevuld.
          inlineMeldingenData = evt.inline_meldingen ?? [];
        } else if (evt.type === "progress") {
          // Map-reduce analyse-fase: toon voortgang i.p.v. de tikkende cursor.
          if (typeof evt.batch === "number" && typeof evt.totaal === "number") {
            setAnalyseVoortgang({ batch: evt.batch, totaal: evt.totaal });
          }
        } else if (evt.type === "delta") {
          volledig += evt.text || "";
          if (!aiToegevoegd) {
            aiToegevoegd = true;
            setAnalyseVoortgang(null); // analyse klaar, antwoord begint
            setAntwoordGestart(true);
            setBerichten((prev) => [
              ...prev,
              {
                rol: "ai",
                tekst: volledig,
                bronnen: bronnenData,
                modus: modusData,
                onderbouwing: onderbouwingData,
                inlineMeldingen: inlineMeldingenData,
              },
            ]);
          } else {
            schrijfAi();
          }
        } else if (evt.type === "done") {
          // Bij een verduidelijking is er geen antwoordbubbel om bij te werken.
          if (verduidelijkingActief) return;
          // Definitieve (content-afhankelijke) inline-meldingen, incl. #4.
          if (evt.inline_meldingen) inlineMeldingenData = evt.inline_meldingen;
          // Increment I-3 — de afgeleide model_knowledge-bronnen (algemene kennis
          // met genoemde instantie) komen in het 'done'-event en horen in het paneel.
          if (evt.model_kennis && onderbouwingData) {
            onderbouwingData = { ...onderbouwingData, modelKennis: evt.model_kennis };
          }
          // B1 — inhoudelijke vervolgvragen (kunnen leeg zijn) naar het bericht.
          if (onderbouwingData) {
            onderbouwingData = {
              ...onderbouwingData,
              vervolgvragen: evt.vervolgvragen ?? [],
            };
          }
          schrijfAi();
        } else if (evt.type === "error") {
          if (!aiToegevoegd) {
            setBerichten((prev) => [
              ...prev,
              { rol: "ai", tekst: evt.error || "Er is een fout opgetreden." },
            ]);
            aiToegevoegd = true;
          }
        }
      };

      // Lees de SSE-stream; events zijn gescheiden door een lege regel.
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const delen = buffer.split("\n\n");
        buffer = delen.pop() || "";
        for (const deel of delen) verwerkEvent(deel);
      }
      if (buffer.trim()) verwerkEvent(buffer);

      // Vangnet: stream eindigde zonder enige tekst.
      if (!aiToegevoegd) {
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: "Er is geen antwoord ontvangen. Probeer het opnieuw." },
        ]);
      } else if (volledig.trim()) {
        // Persisteer het gesprek (Fase B2) na een geslaagd antwoord.
        const finale: Bericht[] = [
          ...conversatie,
          {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            modus: modusData,
            onderbouwing: onderbouwingData,
            inlineMeldingen: inlineMeldingenData,
          },
        ];
        await bewaarGesprek(finale);
      }
    } catch {
      setBerichten((prev) => [
        ...prev,
        { rol: "ai", tekst: "Verbindingsfout. Probeer het opnieuw." },
      ]);
    } finally {
      setLaden(false);
      setAntwoordGestart(false);
      setAnalyseVoortgang(null);
    }
  }

  // Increment I-2 (FO §11a) — de bestuurder koos een verduidelijkingschip. We
  // sturen DEZELFDE vraag opnieuw met de bevestigde bron-intentie en wissen de
  // verduidelijkingsbubbel; de oorspronkelijke vraag blijft staan (geen tweede
  // gebruikersbubbel). "Voor mijn fonds" = fonds-intentie (combineren-vloer, geen
  // harde scope); "In algemene zin" = algemeen-intentie.
  function kiesVerduidelijking(
    intent: "fonds" | "algemeen",
    origineleVraag: string,
    idx: number
  ) {
    if (laden) return;
    const basis = berichten.slice(0, idx); // laat de verduidelijkingsbubbel vallen
    stuurBericht(origineleVraag, {
      bronIntentOverride: intent,
      geenNieuweVraag: true,
      basisBerichten: basis,
    });
  }

  // Increment I-1 (FO §11c) — open/sluit het onderbouwingspaneel van één bericht.
  function togglePaneel(idx: number) {
    setOpenPanelen((s) => {
      const kopie = new Set(s);
      if (kopie.has(idx)) kopie.delete(idx);
      else kopie.add(idx);
      return kopie;
    });
  }

  // Increment I-1 (FO §13) — voer een contextbewuste vervolgactie uit. Reformat-
  // acties hergebruiken strikt dezelfde bronselectie als het oorspronkelijke
  // antwoord; verbredende acties (besluitvorming, tijdlijn) niet.
  function stuurVervolgactie(actie: Vervolgactie, bron: Bericht, idx: number) {
    if (actie.type === "toon_bronnen") {
      setOpenPanelen((s) => new Set(s).add(idx));
      return;
    }
    const docIds = [...new Set((bron.bronnen ?? []).map((b) => b.document_id))];
    const scopeOverride: DocumentScope | null =
      actie.hergebruikScope && docIds.length > 0
        ? {
            document_ids: docIds,
            titels: [...new Set((bron.bronnen ?? []).map((b) => b.titel))],
            algemene_kennis: true,
          }
        : null;
    stuurBericht(actie.prompt, {
      antwoordmodusOverride: actie.modus,
      scopeOverride,
      transformatie: isTransformatieActie(actie.type),
    });
  }

  function startNieuwGesprek() {
    if (laden) return;
    // Met het gesprekken-overzicht hoeft "nieuw" niets te wissen: het lopende
    // gesprek blijft gewoon in de lijst staan. We starten enkel een schone chat.
    gesprekId.current = null;
    setBerichten(welkomstRef.current ? [welkomstRef.current] : []);
    setInvoer("");
    setDocumentScope(null);
    setAgendapuntContext(null);
    sluitMention();
    setHistorieOpen(false);
  }

  // ── @-mention-typeahead op documenttitels ──────────────────────────────────
  // Detecteert een `@…`-fragment aan het eind van de invoer en opent een
  // typeahead. RLS beperkt de zoekresultaten tot het eigen fonds (+ generiek).
  function verwerkInvoer(waarde: string) {
    setInvoer(waarde);
    const m = waarde.match(/@([^\s@]*)$/);
    if (m) {
      setMentionOpen(true);
      setMentionQuery(m[1]);
    } else {
      sluitMention();
    }
  }

  function sluitMention() {
    setMentionOpen(false);
    setMentionQuery("");
    setMentionSuggesties([]);
  }

  // Selectie zet de scope (single → vervangt een bestaande scope) en verwijdert
  // het @-fragment uit de invoer. Selectie is altijd expliciet (§4).
  function kiesDocument(s: DocSuggestie) {
    // Een expliciete documentkeuze verlaat de agendapunt-modus (ADR 0028): de
    // gebruiker stuurt nu zelf op één stuk i.p.v. de agendapunt-framing.
    setAgendapuntContext(null);
    setDocumentScope({ document_ids: [s.id], titels: [s.titel] });
    setInvoer((huidig) => huidig.replace(/@([^\s@]*)$/, "").trimEnd());
    sluitMention();
  }

  // Zoek documenten zodra het @-fragment wijzigt (ILIKE op titel, eigen fonds).
  useEffect(() => {
    if (!mentionOpen) return;
    let geannuleerd = false;
    const timer = window.setTimeout(async () => {
      try {
        let q = supabase
          .from("documenten")
          .select("id, titel, bron, bestandstype, aangemaakt")
          .eq("actief", true)
          .order("aangemaakt", { ascending: false })
          .limit(8);
        if (mentionQuery.trim()) q = q.ilike("titel", `%${mentionQuery.trim()}%`);
        const { data } = await q;
        if (!geannuleerd && Array.isArray(data)) {
          setMentionSuggesties(data as DocSuggestie[]);
        }
      } catch (e) {
        console.error("Documenten zoeken (mention) mislukt:", e);
      }
    }, 150);
    return () => {
      geannuleerd = true;
      window.clearTimeout(timer);
    };
  }, [mentionOpen, mentionQuery]);

  return (
    <div className="flex flex-col h-screen">
      {/* Gesprekken-overzicht (drawer) */}
      {historieOpen && (
        <div className="fixed inset-0 z-[60]" role="dialog" aria-modal="true">
          <div
            className="absolute inset-0 bg-black/30"
            onClick={() => setHistorieOpen(false)}
          />
          <div className="absolute top-0 left-0 h-full w-80 max-w-[85vw] bg-white shadow-xl flex flex-col">
            <div className="px-5 h-14 flex items-center justify-between border-b border-line">
              <span className="font-bold text-ink">Gesprekken</span>
              <button
                onClick={() => setHistorieOpen(false)}
                className="text-muted hover:text-ink text-lg leading-none"
                aria-label="Sluiten"
              >
                ✕
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-3 space-y-1">
              {gesprekken.length === 0 ? (
                <p className="text-sm text-muted px-2 py-4">
                  Nog geen opgeslagen gesprekken.
                </p>
              ) : (
                gesprekken.map((g) => (
                  <div
                    key={g.id}
                    className={`group flex items-center gap-2 rounded-lg px-3 py-2 cursor-pointer transition-colors ${
                      g.id === gesprekId.current
                        ? "bg-accent/15"
                        : "hover:bg-app-bg"
                    }`}
                    onClick={() => openGesprek(g)}
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm text-ink truncate">
                        {g.titel || "Gesprek"}
                      </div>
                      <div className="text-xs text-muted">
                        {new Date(g.bijgewerkt).toLocaleString("nl-NL", {
                          day: "numeric",
                          month: "short",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </div>
                    </div>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        if (confirm("Dit gesprek archiveren?")) archiveerGesprek(g.id);
                      }}
                      title="Archiveren"
                      className="opacity-0 group-hover:opacity-100 text-muted hover:text-err-ink text-sm transition-opacity flex-shrink-0"
                      aria-label="Archiveren"
                    >
                      🗑
                    </button>
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-line p-3">
              <button
                onClick={startNieuwGesprek}
                className="w-full text-sm text-ink border border-line rounded-lg px-3 py-2 hover:border-accent transition-colors"
              >
                + Nieuw gesprek
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Topbar */}
      <div className="bg-white border-b border-line px-7 h-14 flex items-center">
        <span className="font-bold text-ink">AI Assistent</span>
        <span className="ml-3 bg-ok-tint text-ok-ink text-xs font-semibold px-2.5 py-1 rounded-full">
          ● Governance logging actief
        </span>
        <button
          onClick={() => setHistorieOpen(true)}
          className="ml-auto text-xs text-muted hover:text-ink border border-line px-3 py-1.5 rounded-lg hover:border-accent transition-colors"
        >
          🕑 Gesprekken{gesprekken.length > 0 ? ` (${gesprekken.length})` : ""}
        </button>
        <button
          onClick={startNieuwGesprek}
          disabled={laden || berichten.length <= 1}
          className="text-xs text-muted hover:text-ink border border-line px-3 py-1.5 rounded-lg hover:border-accent transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
        >
          + Nieuw gesprek
        </button>
      </div>

      {/* Brongebruik — Increment I-2 (FO §11a): de zichtbare bron-as is vervangen
          door automatische bronkeuze. De assistent kiest zelf of de vraag fonds-,
          algemeen- of gecombineerd-gericht is; bij twijfel vraagt hij terug. Onder
          "Aanpassen" blijft alleen de expliciete restrictie "Alleen
          fondsdocumenten" over. */}
      <div className="bg-white border-b border-line px-7 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted font-semibold uppercase tracking-wide">
          Brongebruik
        </span>
        <span className="text-xs text-muted">
          De assistent kiest automatisch de passende bron — uw documenten, algemene
          kennis of een combinatie.
        </span>
        <button
          onClick={() => setAanpassenOpen((o) => !o)}
          className="text-xs text-muted hover:text-ink border border-line px-2.5 py-1 rounded-md hover:border-accent transition-colors"
          aria-expanded={aanpassenOpen}
        >
          Aanpassen {aanpassenOpen ? "▴" : "▾"}
        </button>
        {aanpassenOpen && (
          <label className="text-xs text-muted inline-flex items-center gap-1.5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={alleenFondsdocumenten}
              onChange={(e) => setAlleenFondsdocumenten(e.target.checked)}
              className="accent-accent"
            />
            Alleen fondsdocumenten
          </label>
        )}
        {aanpassenOpen && (
          <label
            className="text-xs text-muted inline-flex items-center gap-1.5 cursor-pointer select-none"
            title="Toon dezelfde feiten en bronnen, maar zonder prioritering op uw persoonlijke profiel (collectieve weergave)."
          >
            <input
              type="checkbox"
              checked={algemeenPerspectief}
              onChange={(e) => setAlgemeenPerspectief(e.target.checked)}
              className="accent-accent"
            />
            Algemeen perspectief
          </label>
        )}
        {alleenFondsdocumenten && (
          <span className="text-xs text-ink inline-flex items-center gap-1">
            <span>🔒</span>
            <span>Beperkt tot interne fondsdocumenten</span>
          </span>
        )}
        {algemeenPerspectief && (
          <span className="text-xs text-ink inline-flex items-center gap-1">
            <span>👥</span>
            <span>Collectieve weergave — niet op uw profiel geprioriteerd</span>
          </span>
        )}
      </div>

      {/* Antwoordmodus-bar — Increment I-1 (FO §13): vier zichtbare modi
          (Auto · Feiten · Duiding · Sparren), Auto default. De gebruikte modus
          wordt niet meer in een globale balk herhaald (rustige weergave §11c);
          die staat per antwoord in "Onderbouwing en bronnen". */}
      <div className="bg-white border-b border-line px-7 py-2.5 flex items-center gap-3 flex-wrap">
        <span className="text-xs text-muted font-semibold uppercase tracking-wide">
          Antwoordmodus
        </span>
        <div className="flex gap-0.5 bg-app-bg rounded-lg p-1 flex-wrap">
          <button
            onClick={() => setAntwoordmodus(null)}
            title="Automatisch de passende antwoordvorm bepalen op basis van uw vraag"
            className={`px-3 py-1.5 text-xs rounded-md transition-all ${
              antwoordmodus === null
                ? "bg-white text-ink font-semibold shadow-sm"
                : "text-muted hover:text-ink"
            }`}
          >
            Auto
          </button>
          {ANTWOORDMODUS_KEUZES.map((m) => (
            <button
              key={m.value}
              onClick={() => setAntwoordmodus(m.value)}
              title={m.help}
              className={`px-3 py-1.5 text-xs rounded-md transition-all ${
                antwoordmodus === m.value
                  ? "bg-white text-ink font-semibold shadow-sm"
                  : "text-muted hover:text-ink"
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Chat */}
      <div className="flex-1 overflow-y-auto p-6 space-y-5">
        {berichten.map((b, i) => (
          <div key={i} id={`bericht-${i}`} className={b.rol === "gebruiker" ? "flex justify-end" : "flex gap-3"}>
            {b.rol === "ai" && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src="/ai-assistent.png" alt="AI" className="w-8 h-8 object-contain flex-shrink-0 mt-0.5" />
            )}
            <div className={b.rol === "gebruiker" ? "max-w-[75%]" : "flex-1"}>
              {/* Inline-meldingen (FO §11c) — alleen bij de zes uitzonderingen,
                  direct boven het antwoord. */}
              {b.rol === "ai" &&
                b.inlineMeldingen &&
                b.inlineMeldingen.length > 0 && (
                  <div className="mb-2 space-y-1">
                    {b.inlineMeldingen.map((m) => (
                      <InlineMeldingBanner key={m.type} melding={m} />
                    ))}
                  </div>
                )}

              <div
                className={
                  b.rol === "gebruiker"
                    ? "bg-accent text-white px-4 py-3 rounded-2xl rounded-tr-sm text-sm leading-relaxed"
                    : "bg-app-bg border border-line px-4 py-3 rounded-2xl rounded-tl-sm text-sm leading-relaxed text-ink"
                }
              >
                {b.rol === "ai"
                  ? renderAntwoord(b.tekst, b.bronnen, i, highlight, scrollNaarBron)
                  : b.tekst.split("\n").map((regel, j) => (
                      <p key={j} className={j > 0 ? "mt-1.5" : ""}>
                        {regel}
                      </p>
                    ))}
              </div>

              {/* Increment I-2 (FO §11a) — verduidelijkingschips bij een twijfelgeval.
                  Eén klik herstuurt dezelfde vraag met de bevestigde bron-intentie. */}
              {b.rol === "ai" && b.verduidelijking && (
                <div className="mt-2 flex gap-2 flex-wrap">
                  {b.verduidelijking.opties.map((o) => (
                    <button
                      key={o.intent}
                      disabled={laden}
                      onClick={() =>
                        kiesVerduidelijking(o.intent, b.verduidelijking!.origineleVraag, i)
                      }
                      className="text-xs text-ink border border-app-line-strong px-3 py-1.5 rounded-full hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                    >
                      {o.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Onderbouwing en bronnen (FO §11c) — standaard ingeklapt.
                  Staat bewust vóór de vervolgacties: het antwoord staat zo
                  direct naast zijn bronnen, en de vervolgvragen sluiten daar
                  daaronder op aan. */}
              {b.rol === "ai" && b.onderbouwing && (
                <OnderbouwingPaneel
                  meta={{ ...b.onderbouwing, aantalBronnen: b.bronnen?.length ?? 0 }}
                  open={openPanelen.has(i)}
                  onToggle={() => togglePaneel(i)}
                  ankerId={`onderbouwing-${i}`}
                >
                  {b.bronnen && b.bronnen.length > 0
                    ? b.bronnen.map((bron, j) => (
                        <Bronkaart
                          key={j}
                          idx={j}
                          bron={bron}
                          idVoorScroll={`bron-${i}-${j}`}
                          gehighlight={
                            highlight?.berichtIdx === i && highlight?.bronIdx === j
                          }
                        />
                      ))
                    : null}
                </OnderbouwingPaneel>
              )}

              {/* B1 — inhoudelijke vervolgvragen (op basis van het antwoord).
                  Ná de onderbouwing, zodat ze duidelijk bij het antwoord horen.
                  Deze starten een NIEUWE vraag (geen transformatie). */}
              {b.rol === "ai" &&
                b.onderbouwing?.vervolgvragen &&
                b.onderbouwing.vervolgvragen.length > 0 &&
                !(laden && i === berichten.length - 1) && (
                  <div className="mt-3">
                    <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-1.5">
                      Vervolgvragen
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {b.onderbouwing.vervolgvragen.map((vraag, vi) => (
                        <button
                          key={vi}
                          onClick={() => stuurBericht(vraag)}
                          disabled={laden}
                          className="text-xs text-ink bg-white border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {vraag}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

              {/* Contextbewuste vervolgacties (FO §13) — ná de onderbouwing.
                  Bij documentgerichte vragen blijven bestuurlijke duiding en
                  kritische vragen behouden; bij algemene vragen niet. */}
              {b.rol === "ai" &&
                b.onderbouwing &&
                !(laden && i === berichten.length - 1) &&
                (() => {
                  const vorigeVraag =
                    i > 0 && berichten[i - 1].rol === "gebruiker"
                      ? berichten[i - 1].tekst
                      : "";
                  const am =
                    leesAntwoordmodus(b.onderbouwing.antwoordmodus) ?? "feitelijk";
                  const acties = bepaalVervolgacties(
                    vorigeVraag,
                    am,
                    !!b.bronnen?.length,
                    b.onderbouwing?.documentGericht === true
                  );
                  if (acties.length === 0) return null;
                  return (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {acties.map((a) => (
                        <button
                          key={a.type}
                          onClick={() => stuurVervolgactie(a, b, i)}
                          disabled={laden}
                          className="text-xs text-ink bg-white border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          {a.label}
                        </button>
                      ))}
                    </div>
                  );
                })()}
            </div>
          </div>
        ))}

        {laden && !antwoordGestart && (
          <div className="flex gap-3">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/ai-assistent.png" alt="AI" className="w-8 h-8 object-contain flex-shrink-0" />
            <div className="bg-app-bg border border-line px-4 py-3 rounded-2xl rounded-tl-sm">
              {analyseVoortgang ? (
                <div className="text-sm text-muted">
                  Document wordt geanalyseerd… (deel {analyseVoortgang.batch} van{" "}
                  {analyseVoortgang.totaal})
                </div>
              ) : (
                <div className="flex gap-1.5 items-center">
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                  <span className="typing-dot"></span>
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Voorgestelde vragen */}
      {berichten.length <= 1 && (
        <div className="px-6 pb-2">
          <div className="text-xs text-muted font-semibold mb-2">Voorgestelde vragen</div>
          <div className="flex flex-wrap gap-2">
            {VOORGESTELDE_VRAGEN.map((v) => (
              <button
                key={v}
                onClick={() => stuurBericht(v)}
                className="bg-app-bg border border-line rounded-full px-3 py-1.5 text-xs text-muted hover:border-accent hover:text-ink hover:bg-warn-tint transition-all"
              >
                {v}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Invoerbalk */}
      <div className="bg-white border-t border-line p-4 relative">
        {/* @-mention-typeahead */}
        {mentionOpen && (
          <div className="absolute bottom-full left-4 right-4 mb-2 max-h-64 overflow-y-auto bg-white border border-line rounded-xl shadow-lg z-20">
            <div className="px-3 py-2 text-xs text-muted border-b border-line">
              Kies een document om uw vraag tot dat stuk te beperken
            </div>
            {mentionSuggesties.length === 0 ? (
              <div className="px-3 py-3 text-sm text-muted">
                Geen document met deze titel gevonden.
              </div>
            ) : (
              mentionSuggesties.map((s) => (
                <button
                  key={s.id}
                  onClick={() => kiesDocument(s)}
                  className="w-full text-left px-3 py-2 hover:bg-warn-tint border-b border-line last:border-0"
                >
                  <div className="text-sm font-medium text-ink truncate">{s.titel}</div>
                  <div className="text-xs text-muted">
                    {s.bron}
                    {s.bestandstype ? ` · ${s.bestandstype.toUpperCase()}` : ""}
                    {s.aangemaakt
                      ? ` · ${new Date(s.aangemaakt).toLocaleDateString("nl-NL")}`
                      : ""}
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* Agendapunt-chip (ADR 0028): de vraag is geframed door een agendapunt.
            Eigen chip met eigen herkomst; geen algemene-kennis-toggle (de modus
            combineert toelichting + eventuele stukken + algemene kennis altijd in
            drie gescheiden delen). Wis verbreedt: agendapunt én stukken weg. */}
        {agendapuntContext && (
          <div className="mb-2 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-2 max-w-full bg-accent-tint border border-accent/30 text-accent-ink text-xs rounded-full pl-3 pr-2 py-1">
              <span className="truncate">
                Agendapunt: «{agendapuntContext.titel}»
                {documentScope && documentScope.document_ids.length > 0
                  ? ` · ${documentScope.document_ids.length} ${
                      documentScope.document_ids.length === 1 ? "stuk" : "stukken"
                    }`
                  : " · geen stukken"}
              </span>
              <button
                onClick={() => {
                  setAgendapuntContext(null);
                  setDocumentScope(null);
                }}
                className="shrink-0 w-4 h-4 rounded-full bg-accent hover:bg-accent text-accent-ink flex items-center justify-center"
                aria-label="Agendapunt-scope wissen"
                title="Scope wissen — niet langer over dit agendapunt vragen"
              >
                ✕
              </button>
            </span>
          </div>
        )}

        {/* Scope-chip: "Je vraagt nu over: «titel»" + wis-knop + algemene-kennis-toggle */}
        {!agendapuntContext && documentScope && (
          <div className="mb-2 flex items-center gap-3 flex-wrap">
            <span className="inline-flex items-center gap-2 max-w-full bg-warn-tint border border-warn/30 text-warn-ink text-xs rounded-full pl-3 pr-2 py-1">
              <span className="truncate">
                Je vraagt nu over: «{documentScope.titels[0] || "dit document"}»
                {documentScope.document_ids.length > 1
                  ? ` +${documentScope.document_ids.length - 1}`
                  : ""}
              </span>
              <button
                onClick={() => setDocumentScope(null)}
                className="shrink-0 w-4 h-4 rounded-full bg-warn hover:bg-warn text-warn-ink flex items-center justify-center"
                aria-label="Documentscope wissen"
                title="Scope wissen — weer de hele bibliotheek bevragen"
              >
                ✕
              </button>
            </span>
            <label
              className="inline-flex items-center gap-1.5 text-xs text-muted cursor-pointer"
              title="Standaard antwoordt de AI strikt uit dit document. Aan: ook algemene kennis, in drie gescheiden delen."
            >
              <input
                type="checkbox"
                checked={documentScope.algemene_kennis === true}
                onChange={(e) =>
                  setDocumentScope(
                    documentScope
                      ? { ...documentScope, algemene_kennis: e.target.checked }
                      : null
                  )
                }
                className="accent-accent"
              />
              Ook algemene kennis gebruiken
            </label>
          </div>
        )}

        <div className="flex gap-3">
          <textarea
            value={invoer}
            onChange={(e) => verwerkInvoer(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape" && mentionOpen) {
                sluitMention();
                return;
              }
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                if (mentionOpen) return; // Enter binnen de typeahead niet versturen
                stuurBericht();
              }
            }}
            placeholder={
              documentScope
                ? "Stel een vraag over dit document... (@ om te wisselen)"
                : "Stel een vraag... (@ om een specifiek document te kiezen)"
            }
            className="flex-1 border border-line rounded-xl px-3 py-2.5 text-sm resize-none outline-none focus:border-accent bg-app-bg"
            rows={2}
            disabled={laden}
          />
          <button
            onClick={() => stuurBericht()}
            disabled={laden || !invoer.trim()}
            className="w-11 h-11 bg-accent rounded-xl flex items-center justify-center text-white hover:bg-accent hover:text-ink disabled:opacity-40 disabled:cursor-not-allowed transition-colors self-end"
          >
            ➤
          </button>
        </div>
      </div>
    </div>
  );
}

// ============================================================
//  Renderen van AI-antwoord met inline pills voor [Bron N],
//  [Algemene kennis] en [Volgens wetgeving]
// ============================================================
// Rendert het AI-antwoord met lichte Markdown-ondersteuning. Blok-niveau:
// koppen (#..), opsommingen (- / *) en genummerde lijsten (1.), en alinea's.
// Inline-opmaak (vet/cursief/code) en de citatiemarkers ([Bron N], [Algemene
// kennis], [Volgens wetgeving]) lopen via parseInline. Bewust een eigen, kleine
// renderer i.p.v. een externe library: geen extra dependency, volledige controle
// over de bron-pills, en bestand tegen half-gestreamde (nog niet gesloten)
// markdown tijdens het streamen.
function renderAntwoord(
  tekst: string,
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
) {
  const regels = tekst.split("\n");
  const blokken: ReactNode[] = [];
  let lijstType: "ul" | "ol" | null = null;
  let lijstItems: string[] = [];
  let sleutel = 0;

  const inline = (s: string) =>
    parseInline(s, bronnen, berichtIdx, highlight, onBronKlik);

  const sluitLijst = () => {
    if (!lijstType) return;
    const items = lijstItems.map((it, k) => (
      <li key={k}>{inline(it)}</li>
    ));
    blokken.push(
      lijstType === "ul" ? (
        <ul key={sleutel++} className="list-disc pl-5 my-1.5 space-y-0.5">
          {items}
        </ul>
      ) : (
        <ol key={sleutel++} className="list-decimal pl-5 my-1.5 space-y-0.5">
          {items}
        </ol>
      )
    );
    lijstType = null;
    lijstItems = [];
  };

  for (const regel of regels) {
    const ul = regel.match(/^\s*[-*]\s+(.*)$/);
    const ol = regel.match(/^\s*\d+\.\s+(.*)$/);
    const kop = regel.match(/^(#{1,6})\s+(.*)$/);

    if (ul) {
      if (lijstType !== "ul") sluitLijst();
      lijstType = "ul";
      lijstItems.push(ul[1]);
      continue;
    }
    if (ol) {
      if (lijstType !== "ol") sluitLijst();
      lijstType = "ol";
      lijstItems.push(ol[1]);
      continue;
    }

    sluitLijst();

    if (kop) {
      blokken.push(
        <p key={sleutel++} className="font-bold text-ink mt-2 mb-1">
          {inline(kop[2])}
        </p>
      );
      continue;
    }
    if (!regel.trim()) continue; // lege regel = alinea-scheiding (spacing via mt)

    blokken.push(
      <p key={sleutel++} className={blokken.length > 0 ? "mt-1.5" : ""}>
        {inline(regel)}
      </p>
    );
  }
  sluitLijst();
  return blokken;
}

function parseInline(
  regel: string,
  bronnen: Bron[] | undefined,
  berichtIdx: number,
  highlight: { berichtIdx: number; bronIdx: number } | null,
  onBronKlik: (berichtIdx: number, bronIdx: number) => void,
) {
  if (!regel) return null;
  // Reset regex state per call (g-flag is stateful op het Regexp-object)
  const regex = new RegExp(MARKER_REGEX.source, "gi");
  const delen = regel.split(regex);
  return delen.map((deel, i) => {
    if (!deel) return null;

    const bronMatch = deel.match(/^\[Bron (\d+)\]$/i);
    if (bronMatch) {
      const bronIdx = parseInt(bronMatch[1], 10) - 1;
      const bron = bronnen?.[bronIdx];
      if (bron) {
        return (
          <BronPill
            key={i}
            nummer={bronIdx + 1}
            bron={bron}
            gehighlight={
              highlight?.berichtIdx === berichtIdx &&
              highlight?.bronIdx === bronIdx
            }
            onClick={() => onBronKlik(berichtIdx, bronIdx)}
          />
        );
      }
      // Bronvermelding-validatie: een citatie die niet aan een aangeleverde
      // bron te koppelen is, wordt zichtbaar gemarkeerd i.p.v. stil getoond.
      return <OngeldigeBronPill key={i} nummer={bronIdx + 1} />;
    }
    if (/^\[algemene kennis\]$/i.test(deel)) {
      return <KennisPill key={i} label="Algemene kennis" instantie={detecteerInstantieInTekst(regel)} />;
    }
    if (/^\[volgens wetgeving\]$/i.test(deel)) {
      return <KennisPill key={i} label="Volgens wetgeving" instantie={detecteerInstantieInTekst(regel)} />;
    }
    // ADR 0028 — herkomst uit de agendapunt-toelichting: ongevalideerde
    // bestuurs-vrijetekst, géén vastgestelde fondsbron. Eigen waarschuwende
    // styling zodat de niet-vastgestelde herkomst visueel onderscheiden blijft.
    if (/^\[toelichting agendapunt\]$/i.test(deel)) {
      return <ToelichtingPill key={i} />;
    }
    // Geen marker → verwerk inline-markdown (vet/cursief/code).
    return <span key={i}>{parseMarkdownInline(deel)}</span>;
  });
}

// Inline-markdown voor een tekstsegment zonder citatiemarkers. Subset: **vet**,
// *cursief* / _cursief_, `code`. Vet wordt vóór cursief gematcht zodat ** niet
// per ongeluk als twee losse * wordt gelezen.
function parseMarkdownInline(tekst: string): ReactNode[] {
  const regex = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*\s][^*]*\*|_[^_\s][^_]*_)/g;
  return tekst.split(regex).map((stuk, i) => {
    if (!stuk) return null;
    if (/^\*\*[^*]+\*\*$/.test(stuk)) {
      return <strong key={i}>{stuk.slice(2, -2)}</strong>;
    }
    if (/^`[^`]+`$/.test(stuk)) {
      return (
        <code key={i} className="bg-app-bg rounded px-1 py-0.5 text-[0.85em]">
          {stuk.slice(1, -1)}
        </code>
      );
    }
    if (/^\*[^*]+\*$/.test(stuk) || /^_[^_]+_$/.test(stuk)) {
      return <em key={i}>{stuk.slice(1, -1)}</em>;
    }
    return stuk;
  });
}

function BronPill({
  nummer,
  bron,
  gehighlight,
  onClick,
}: {
  nummer: number;
  bron: Bron;
  gehighlight: boolean;
  onClick: () => void;
}) {
  const locatie = [bron.paragraaf, bron.pagina && `pag. ${bron.pagina}`]
    .filter(Boolean)
    .join(", ");
  const tooltip =
    `${bron.bron} — ${bron.titel}` +
    (locatie ? ` (${locatie})` : "") +
    `\n\n„${bron.fragment}"` +
    `\n\nKlik om de bronvermelding hieronder te openen.`;
  return (
    <button
      type="button"
      onClick={onClick}
      title={tooltip}
      className={`relative -top-[1px] inline-flex items-center justify-center align-baseline mx-0.5 min-w-[20px] h-[18px] px-1.5 rounded-md text-[10px] font-bold leading-none transition-colors cursor-pointer ${
        gehighlight
          ? "bg-accent text-white"
          : "bg-accent/20 text-ink hover:bg-accent/45 hover:shadow-sm"
      }`}
    >
      {nummer}
    </button>
  );
}

// Increment I-3 — de grijze pill draagt nu, indien het antwoord die noemt, de
// bron-instantie (DNB/AFM/…). Zo is inline al zichtbaar waaraan de algemene
// kennis wordt toegeschreven, zonder de kennis te begrenzen of een verzonnen
// documentverwijzing te suggereren.
function KennisPill({ label, instantie }: { label: string; instantie?: string | null }) {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-app-line text-muted"
      title={
        instantie
          ? `Niet uit een intern document — algemene kennis, toegeschreven aan ${instantie}`
          : "Niet uit een intern document — algemene kennis of wetgeving"
      }
    >
      {instantie ? `${label} · ${instantie}` : label}
    </span>
  );
}

// ADR 0028 — claim die steunt op de agendapunt-toelichting (door het bestuur
// opgestelde vrije tekst, géén vastgestelde fondsbron). Eigen indigo-styling
// onderscheidt deze herkomst visueel van de gouden [Bron N] (vastgestelde bron)
// en de grijze [Algemene kennis], zodat de niet-vastgestelde status zichtbaar is.
function ToelichtingPill() {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-accent-tint text-accent-ink border border-accent/30"
      title="Steunt op de toelichting bij het agendapunt — door het bestuur opgestelde vrije tekst, geen bestuurlijk vastgestelde fondsbron. Verifieer voordat u hierop besluit."
    >
      Toelichting agendapunt
    </span>
  );
}

// Bronvermelding-validatie: een [Bron N] die niet aan een aangeleverde bron kan
// worden gekoppeld. Zichtbaar gemarkeerd zodat de bestuurder een mogelijk
// onjuiste/gehallucineerde verwijzing herkent en kan verifiëren.
function OngeldigeBronPill({ nummer }: { nummer: number }) {
  return (
    <span
      className="relative -top-[1px] inline-flex items-center gap-0.5 align-baseline mx-0.5 px-1.5 h-[18px] rounded-md text-[10px] font-semibold leading-none bg-warn-tint text-warn-ink border border-warn/30"
      title="Deze bronverwijzing kon niet aan een aangeleverde bron worden gekoppeld. Controleer dit; mogelijk een onjuiste of niet-onderbouwde verwijzing."
    >
      ⚠ Bron {nummer}?
    </span>
  );
}

function Bronkaart({
  idx,
  bron,
  idVoorScroll,
  gehighlight,
}: {
  idx: number;
  bron: Bron;
  idVoorScroll: string;
  gehighlight: boolean;
}) {
  const locatie = [bron.paragraaf, bron.pagina && `pag. ${bron.pagina}`]
    .filter(Boolean)
    .join(", ");

  const inhoud = (
    <>
      <span
        className={`flex-shrink-0 w-7 h-7 rounded-md text-[11px] font-bold flex items-center justify-center ${
          BRON_NUMMER_KLEUR[bron.bron] || "bg-app-line text-white"
        }`}
      >
        {idx + 1}
      </span>
      <div className="flex-1 min-w-0">
        <div
          className={`font-bold ${BRONTEKST[bron.bron] || "text-ink"}`}
        >
          {bron.bron} — {bron.titel}
        </div>
        {locatie && (
          <div className="text-muted mt-0.5 italic">📍 {locatie}</div>
        )}
        <div className="text-muted mt-1 leading-relaxed">
          „{bron.fragment}"
        </div>
        <BronkaartMeta bron={bron} />
        {!bron.heeft_origineel && (
          <div className="text-muted mt-1 text-[11px] italic">
            Origineel niet beschikbaar — alleen tekst voor de AI-assistent
          </div>
        )}
      </div>
      {bron.heeft_origineel && (
        <span className="flex-shrink-0 text-muted group-hover:text-ink transition-colors text-sm leading-none mt-1">
          ↗
        </span>
      )}
    </>
  );

  const baseKlasse = `flex items-start gap-2.5 p-2.5 rounded-lg border text-xs transition-all ${
    BRONKLEUR[bron.bron] || "bg-app-bg border-line"
  } ${
    gehighlight
      ? "ring-2 ring-accent ring-offset-1 shadow-md scale-[1.01]"
      : ""
  }`;

  if (bron.heeft_origineel) {
    // Spring direct naar de pagina als we die weten. De #page=N-fragment wordt
    // gehonoreerd door de ingebouwde PDF-viewers van Chrome/Edge/Firefox; voor
    // Word/Excel (download) wordt de fragment genegeerd — geen kwaad.
    const href = bron.pagina
      ? `/api/documents/${bron.document_id}/bestand#page=${bron.pagina}`
      : `/api/documents/${bron.document_id}/bestand`;
    return (
      <a
        id={idVoorScroll}
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        className={`group ${baseKlasse} hover:border-accent hover:shadow-sm cursor-pointer scroll-mt-24`}
        title={
          bron.pagina
            ? `Origineel openen op pagina ${bron.pagina} (nieuw tabblad)`
            : "Origineel openen in nieuw tabblad"
        }
      >
        {inhoud}
      </a>
    );
  }
  return (
    <div id={idVoorScroll} className={`${baseKlasse} scroll-mt-24`}>
      {inhoud}
    </div>
  );
}

// Increment G — bronkaart-metadatastrip: status/bronstatus/datum + (bij generiek)
// bronsoort/normgewicht/externe URL/"Vervallen per". Alles optioneel: ontbrekende
// velden (bv. uit het fallback-pad) worden simpelweg niet getoond.
function BronkaartMeta({ bron }: { bron: Bron }) {
  const statusLabel = bron.documentstatus
    ? (DOCUMENT_STATUS_LABEL as Record<string, string>)[bron.documentstatus] ??
      bron.documentstatus
    : null;
  const bronstatusLabel =
    bron.bronstatus && bron.bronstatus !== "actief"
      ? (BRONSTATUS_LABEL as Record<string, string>)[bron.bronstatus] ?? bron.bronstatus
      : null;
  const labels = bronkaartLabels(
    {
      bibliotheek: bron.bibliotheek,
      normgewicht: bron.normgewicht,
      geldig_tot: bron.geldig_tot,
    }
  );
  const heeftIets =
    statusLabel ||
    bronstatusLabel ||
    bron.documentdatum ||
    labels.isGeneriek ||
    labels.vervallen;
  if (!heeftIets) return null;

  const chip =
    "text-[10px] px-1.5 py-0.5 rounded border bg-white/70 border-line text-muted";
  return (
    <div className="flex flex-wrap items-center gap-1.5 mt-1.5">
      {labels.isGeneriek && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-accent-tint border-accent/30 text-accent-ink">
          {labels.bronsoortLabel}
        </span>
      )}
      {statusLabel && <span className={chip}>{statusLabel}</span>}
      {bronstatusLabel && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-warn-tint border-warn/30 text-warn-ink">
          {bronstatusLabel}
        </span>
      )}
      {bron.documentdatum && <span className={chip}>📅 {bron.documentdatum}</span>}
      {labels.isGeneriek && bron.normgewicht && (
        <span className={chip}>{normgewichtLabel(bron.normgewicht)}</span>
      )}
      {labels.isGeneriek && bron.bronorganisatie && (
        <span className={chip}>{bron.bronorganisatie}</span>
      )}
      {labels.vervallen && labels.vervallenLabel && (
        <span className="text-[10px] px-1.5 py-0.5 rounded border bg-err-tint border-err/30 text-err-ink">
          {labels.vervallenLabel}
        </span>
      )}
      {labels.isGeneriek && isVeiligeUrl(bron.extern_url) && (
        <a
          href={bron.extern_url ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] px-1.5 py-0.5 rounded border bg-white/70 border-line text-accent-ink hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          Externe bron ↗
        </a>
      )}
    </div>
  );
}

// Increment I-1 (FO §11c) — conditionele inline-melding direct in het antwoord.
// Caution-meldingen (geen/onvoldoende fondsbasis) krijgen amber; informatieve
// meldingen (bronbasis/duiding/besluit) een rustigere blauwe stijl. Bewust géén
// schijnzekerheid: de teksten suggereren nooit een actuele fondsbron die er niet is.
function InlineMeldingBanner({ melding }: { melding: InlineMelding }) {
  const caution =
    melding.type === "geen_fondstreffer" || melding.type === "onvoldoende_basis";
  const stijl = caution
    ? "bg-warn-tint border-warn/30 text-warn-ink"
    : "bg-accent-tint border-accent/30 text-accent-ink";
  return (
    <div
      className={`inline-flex items-start gap-1.5 text-[11px] border px-2 py-1 rounded-md ${stijl}`}
    >
      <span aria-hidden>{caution ? "⚠️" : "ℹ️"}</span>
      <span>{melding.tekst}</span>
    </div>
  );
}
