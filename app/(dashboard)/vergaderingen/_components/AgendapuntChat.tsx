"use client";
// ============================================================
//  AgendapuntChat — inline AI-assistent per agendapunt
// ============================================================
// Bestuurders hoeven niet meer naar /ai te schakelen: de assistent is direct
// beschikbaar binnen "Mijn voorbereiding" (sinds 05-07 geïntegreerd in
// VoorbereidingsBlok, zodat de agendapuntkaart één AI-plek kent).
// - Hergebruikt de bestaande chat-backend (/api/chat) in agendapunt-modus
//   (ADR 0028): agendapunt_context + gekoppelde stukken als retrieval-scope.
// - Gesprekken worden per agendapunt opgeslagen in `gesprekken` met hetzelfde
//   document_scope-payload als de AI-pagina, zodat een gesprek dat hier start
//   ook in de historie van /ai terugkomt (en andersom hervat kan worden).
// - Weergave identiek aan de volledige assistent (/ai): inline [Bron N]-pills
//   die naar de bronkaart scrollen en die kort oplichten, plus het rijke,
//   standaard ingeklapte paneel "Onderbouwing en bronnen" met DOORKLIKBARE
//   bronkaarten (link naar het origineel). Vervolg op ADR 0036: naast de
//   marker-rendering delen /ai en dit component nu ook de bronkaart en het
//   onderbouwingspaneel via AntwoordWeergave.tsx + OnderbouwingPaneel.tsx, zodat
//   de eerdere divergentie (agenda kon niet doorklikken op bronnen) is opgeheven.
// - Sinds 06-07 (herziening FO duiding, na toetsing externe bestuurder): de
//   chat is HET enige instappunt. De losse knop "Genereer voorbereiding" is
//   vervallen; de rijke voorbereiding (route met risicomatrix, procedures,
//   profielsturing) zit als eerste startchip "Stel mijn voorbereiding op" in
//   dit gesprek. De route levert { tekst, bronnen } in dezelfde vorm als de
//   chat, zodat pills en onderbouwing identiek renderen. Het gebruikersbericht
//   gaat vóór het AI-antwoord het gesprek in, zodat de init-logica
//   (welkomstbericht-slice) het antwoord niet wegsnijdt.

import { useState, useRef, useEffect } from "react";
import { createClient } from "@/core/lib/supabase";
import {
  bepaalVervolgacties,
  bepaalAntwoordmodus,
  isTransformatieActie,
  type InlineMelding,
  type Vervolgactie,
  type Antwoordmodus,
} from "@/core/lib/vraagtype";
// Gedeelde weergave met de volledige assistent (/ai): identieke antwoord-render
// (pills → scroll+highlight), rijk "Onderbouwing en bronnen"-paneel en
// doorklikbare bronkaarten (naar het origineel). Zie AntwoordWeergave.tsx.
import OnderbouwingPaneel, { type OnderbouwingMeta } from "../../ai/_components/OnderbouwingPaneel";
import {
  renderAntwoord,
  Bronkaart,
  AntwoordKopieerKnop,
  Documentenlijst,
  leesAntwoordmodus,
  type Bron,
} from "../../ai/_components/AntwoordWeergave";
import { isDocumentbron } from "@/core/lib/documentlijst";
import { verwijderDialoogTekst, verwijderGesprekViaApi } from "@/core/lib/gesprek-verwijderen";
// Plateau B — de reflectiedialoog. Zelfde componenten en dezelfde
// server-controlled status als /ai; besluit 0079-lijn (één weergave, twee
// ingangen) geldt hier onverkort.
import {
  reflectieUitnodigingGetoond,
  markeerReflectieUitnodiging,
} from "@/core/lib/ai-sessie";
import {
  INGANG_LABEL,
  isActief as isReflectieActief,
  type ReflectieStatus,
  type ReflectieIngang,
} from "@/core/lib/reflectie-flow";
import ReflectieKaart, {
  REFLECTIE_VRAAG_BESLUITMOMENT,
} from "@/core/components/ReflectieKaart";
import ReflectieInvoer from "@/core/components/ReflectieInvoer";
// Gedeelde gefaseerde statusweergave (besluit 0087), gelijk aan /ai.
import {
  pasVoortgangToe,
  VoortgangWeergave,
  type VoortgangUI,
} from "../../ai/_components/Voortgang";

interface Verduidelijking {
  vraag: string;
  opties: { intent: "fonds" | "algemeen"; label: string }[];
  origineleVraag: string;
}

interface Bericht {
  rol: "gebruiker" | "ai";
  tekst: string;
  bronnen?: Bron[];
  // Increment I-1 (FO §11c) — controle-informatie voor het paneel "Onderbouwing
  // en bronnen", identiek aan /ai. Bij de chat-route rijk gevuld; bij de
  // voorbereiding-route minimaal (alleen aantalBronnen) — het paneel toont dan
  // enkel de doorklikbare documentbronnen.
  onderbouwing?: OnderbouwingMeta;
  inlineMeldingen?: InlineMelding[];
  verduidelijking?: Verduidelijking;
  // Inhoudelijke vervolgvragen (klikbaar), identiek aan de assistent (/ai): de
  // chat-backend levert ze als aparte array (uit de ###VERVOLGVRAGEN###-marker).
  vervolgvragen?: string[];
  // Besluit 0098 — alleen een NETJES afgeronde generatie ('done' ontvangen) is
  // kopieerbaar. Foutmeldingen en afgebroken streams krijgen dus geen
  // kopieerknop: een herkomstregel onder iets dat geen antwoord is, ondermijnt
  // precies de geloofwaardigheid van diezelfde regel.
  voltooid?: boolean;
  // Plateau B — het id van de auditregel van dít antwoord, nodig om de bronset
  // te bevriezen bij een reflectie. Staat op elk antwoord en is dus géén
  // markering dat er gereflecteerd is (besluit 0112).
  logId?: string;
}

// Startvragen die het stuk bestuurlijke betekenis geven. De voorbereiding-chip
// (hieronder apart) gaat via de rijke voorbereiding-route; deze drie via /api/chat.
const STARTVRAGEN = [
  "Welke risico's en aandachtspunten zitten er voor het fonds in dit voorstel?",
  "Welk besluit wordt gevraagd en is dit stuk daarvoor besluitrijp?",
  "Wat betekent dit voorstel voor de deelnemers?",
];

// Het gebruikersbericht dat de voorbereiding in het gesprek opent. Bewust een
// gewone gebruiker-beurt: zo overleeft het AI-antwoord de welkomst-slice bij
// init en leest het gesprek terug als een natuurlijke dialoog.
const VOORBEREIDING_VRAAG = "Stel mijn voorbereiding op voor dit agendapunt.";

// Herstelde gesprekken zijn opgeslagen ná een geslaagde generatie, dus de
// AI-beurten daarin zijn per definitie voltooid. Gesprekken van vóór besluit
// 0098 dragen de vlag nog niet; die leiden we af uit de aanwezigheid van
// `onderbouwing` — die zetten alleen echte antwoorden, geen foutmelding.
// Identiek aan `herstelVoltooidVlag` in AssistentClient: dezelfde renderer,
// dus ook hetzelfde kopieergedrag op een hervat gesprek (besluit 0079).
function herstelVoltooidVlag(lijst: Bericht[]): Bericht[] {
  return lijst.map((b) =>
    b.rol === "ai" && b.voltooid === undefined
      ? { ...b, voltooid: Boolean(b.onderbouwing) }
      : b
  );
}

// Besluit 0099 — één conditie voor "de documentlijst staat in het antwoord",
// gedeeld door de lijst en de anti-dubbelingsvlag. Identiek aan /ai.
function documentlijstZichtbaar(b: Bericht): boolean {
  if (!b.voltooid) return false;
  if (leesAntwoordmodus(b.onderbouwing?.antwoordmodus) !== "bronoverzicht") return false;
  return (b.bronnen ?? []).some(isDocumentbron);
}

export default function AgendapuntChat({
  agendapuntId,
  titel,
  stukken,
}: {
  agendapuntId: string;
  titel: string;
  stukken: { id: string; titel: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [berichten, setBerichten] = useState<Bericht[]>([]);
  const [invoer, setInvoer] = useState("");
  const [laden, setLaden] = useState(false);
  const [antwoordGestart, setAntwoordGestart] = useState(false);
  // Gefaseerde voortgang tijdens het wachten (besluit 0087), gedeeld met /ai.
  const [voortgang, setVoortgang] = useState<VoortgangUI | null>(null);
  const [openBronnen, setOpenBronnen] = useState<Set<number>>(new Set());
  // Increment I-1 — pill → scroll+highlight (identiek aan /ai): welke bronkaart
  // kort oplicht na een klik op een [Bron N]-pill.
  const [highlight, setHighlight] = useState<{
    berichtIdx: number;
    bronIdx: number;
  } | null>(null);
  const highlightTimer = useRef<number | null>(null);
  const [initGedaan, setInitGedaan] = useState(false);
  // Fondsnaam voor de herkomstregel onder een kopie (besluit 0098). Juist een
  // kopie uit de agendapuntchat belandt in een vergaderverslag; dat is de plek
  // waar "van welk fonds" het hardst telt. Leeg tot het profiel geladen is; de
  // herkomstregel laat de vermelding dan weg.
  const [fondsNaam, setFondsNaam] = useState<string>("");
  // ── Plateau B — de reflectiedialoog ───────────────────────────────────────
  // Identiek aan /ai: de status komt van de SERVER (gesprek_reflectie_state) en
  // wordt hier alleen weergegeven. De uitnodiging is een tijdelijke UI-kaart en
  // géén chatbericht (FR-50, besluit 0109).
  const [reflectieStatus, setReflectieStatus] =
    useState<ReflectieStatus>("niet_actief");
  const [uitnodigingZichtbaar, setUitnodigingZichtbaar] = useState(false);
  // B-opt tranche 1c — besluitmoment-variant van de openingsvraag bij een
  // proactieve trigger; de permanent beschikbare actie blijft de standaardvraag.
  const [uitnodigingBesluitmoment, setUitnodigingBesluitmoment] = useState(false);
  // B-opt tranche 1a — eigen laatste reflectieantwoord, voor de Aanpassen-flow.
  const [laatsteReflectieAntwoord, setLaatsteReflectieAntwoord] = useState("");
  const [uitnodigingToegestaan, setUitnodigingToegestaan] = useState(false);

  const fondsIdRef = useRef<string>("");
  const userIdRef = useRef<string | null>(null);
  const gesprekId = useRef<string | null>(null);
  // Plateau A — bestaat de rij in `gesprekken` al? Het id wordt sinds plateau A
  // vóór de eerste beurt gegenereerd, dus een gezet id betekent niet langer
  // "staat al in de database".
  const gesprekBestaatInDb = useRef(false);

  // Plateau A — zie de toelichting in AssistentClient: de chat-route moet elke
  // auditregel aan een gesprek kunnen koppelen, en de rij in `gesprekken`
  // ontstaat pas ná de stream. Daarom maakt de client het id vooraf.
  //
  // Deze component gebruikt bewust GEEN sessionStorage-markering (besluit 0086):
  // de agendapuntchat herstelt zichzelf via document_scope->agendapunt_context,
  // niet via de actief-gesprek-sleutel.
  function zorgVoorGesprekId(): string {
    if (!gesprekId.current) {
      gesprekBestaatInDb.current = false;
      gesprekId.current = crypto.randomUUID();
    }
    return gesprekId.current;
  }

  // Plateau A (A-8) — verwijderen was hier helemaal niet mogelijk, ook niet als
  // archiveren. Zelfde pad, zelfde dialoogtekst en dezelfde belofte als op /ai:
  // de chatinhoud gaat weg, het auditspoor blijft, met één redactieregel.
  async function verwijderDitGesprek() {
    const id = gesprekId.current;
    if (!id || !gesprekBestaatInDb.current) return;
    if (!confirm(verwijderDialoogTekst(titel))) return;

    const uitkomst = await verwijderGesprekViaApi(id);
    if (!uitkomst.ok) {
      alert(uitkomst.melding);
      return;
    }
    gesprekId.current = null;
    gesprekBestaatInDb.current = false;
    berichtenRef.current = [];
    setBerichten([]);
  }
  const eindRef = useRef<HTMLDivElement>(null);
  // Scroll-container + "sticky bottom": tijdens het streamen scrollt de weergave
  // alleen automatisch mee als de gebruiker al (bijna) onderaan staat. Scrollt de
  // gebruiker omhoog om terug te lezen, dan stopt het meescrollen tot hij weer
  // onderaan komt. Zo houdt de lezer de controle tijdens het streamen.
  const scrollRef = useRef<HTMLDivElement>(null);
  const volgtBodemRef = useRef(true);
  // Spiegel van `berichten` voor imperatieve callers (genereerVoorbereiding):
  // die lopen buiten de render-cyclus en mogen niet op een verouderde state-
  // closure bouwen.
  const berichtenRef = useRef<Bericht[]>([]);
  const initPromise = useRef<Promise<void> | null>(null);
  const supabase = createClient();

  useEffect(() => {
    berichtenRef.current = berichten;
  }, [berichten]);

  // Init: profiel (fonds_id) + eventueel eerder gesprek over dit agendapunt
  // (meest recente, niet gearchiveerd). Best-effort; als promise zodat ook
  // genereerVoorbereiding() erop kan wachten vóór hij berichten toevoegt.
  function zorgInit(): Promise<void> {
    if (!initPromise.current) {
      initPromise.current = (async () => {
        try {
          const {
            data: { user },
          } = await supabase.auth.getUser();
          if (!user) return;
          userIdRef.current = user.id;
          const { data: profiel } = await supabase
            .from("profielen")
            .select("fonds_id, reflectie_uitnodiging, fondsen(naam)")
            .eq("id", user.id)
            .single();
          if (profiel?.fonds_id) fondsIdRef.current = profiel.fonds_id as string;
          // Plateau B / B-6 — de permanente opt-out (FR-15). Ontbreekt de kolom
          // of de waarde, dan blijft de uitnodiging uit.
          setUitnodigingToegestaan(profiel?.reflectie_uitnodiging === true);
          const fondsenRel = profiel?.fondsen as
            | { naam: string }
            | { naam: string }[]
            | null
            | undefined;
          const fondsenObj = Array.isArray(fondsenRel) ? fondsenRel[0] : fondsenRel;
          if (fondsenObj?.naam) setFondsNaam(fondsenObj.naam);

          const { data: bestaand } = await supabase
            .from("gesprekken")
            .select("id, berichten")
            .eq("gebruiker_id", user.id)
            .eq("gearchiveerd", false)
            .eq("document_scope->agendapunt_context->>id", agendapuntId)
            .order("bijgewerkt", { ascending: false })
            .limit(1);
          const item = bestaand?.[0];
          if (item && Array.isArray(item.berichten) && item.berichten.length > 0) {
            gesprekId.current = item.id as string;
            gesprekBestaatInDb.current = true;   // net uit de DB gelezen
            // Plateau B / AC-23 — de flowstatus hoort bij dít gesprek. De server
            // past de fail-safe (24 uur) toe; bij twijfel komt niet_actief terug
            // en wordt er nooit automatisch een bericht verstuurd.
            void herstelReflectieStatus(item.id as string);
            // Welkomstbericht van de AI-pagina (index 0, rol ai) is puur UI.
            const b = item.berichten as Bericht[];
            const zonderWelkomst = herstelVoltooidVlag(
              b.length > 0 && b[0].rol === "ai" ? b.slice(1) : b
            );
            berichtenRef.current = zonderWelkomst;
            setBerichten(zonderWelkomst);
          }
        } catch (e) {
          console.error("AgendapuntChat init mislukt:", e);
        } finally {
          setInitGedaan(true);
        }
      })();
    }
    return initPromise.current;
  }

  useEffect(() => {
    if (!open || initGedaan) return;
    zorgInit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initGedaan, agendapuntId]);

  // Voorbereiding als gespreksopener: de startchip "Stel mijn voorbereiding op"
  // gaat via de rijke voorbereiding-route (risicomatrix, procedures,
  // profielsturing) en plaatst vraag + antwoord (bronnen in chat-vorm) als
  // beurten in dit gesprek.
  async function genereerVoorbereiding() {
    if (laden) return;
    setOpen(true);
    await zorgInit();
    const conversatie: Bericht[] = [
      ...berichtenRef.current,
      { rol: "gebruiker", tekst: VOORBEREIDING_VRAAG },
    ];
    berichtenRef.current = conversatie;
    setBerichten(conversatie);
    setLaden(true);
    setAntwoordGestart(false);
    // Vers antwoord volgt vanaf de start mee, tot de gebruiker omhoog scrollt.
    volgtBodemRef.current = true;
    try {
      const res = await fetch(`/api/agendapunten/${agendapuntId}/voorbereiding`, {
        method: "POST",
      });
      if (!res.ok || !res.body) {
        const fout = await res.json().catch(() => null);
        const finale: Bericht[] = [
          ...conversatie,
          {
            rol: "ai",
            tekst:
              fout?.error ||
              "De voorbereiding kon niet worden opgesteld. Probeer het opnieuw.",
          },
        ];
        berichtenRef.current = finale;
        setBerichten(finale);
        return;
      }

      // SSE-consumer — zelfde event-vorm (meta → delta → done) als de chat-route,
      // zodat het antwoord token voor token wordt opgebouwd i.p.v. in één keer.
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let aiToegevoegd = false;
      // Zie besluit 0098 §4: `!laden` is niet genoeg — bij een verbindingsfout
      // zet het finally-blok dat ook op false en zou een afgebroken antwoord een
      // kopieerknop met volledige herkomstregel krijgen.
      let voltooid = false;
      let volledig = "";
      let bronnenData: Bron[] | undefined;
      let inlineMeldingenData: InlineMelding[] | undefined;
      let onderbouwingData: OnderbouwingMeta | undefined;

      const schrijfAi = () => {
        setBerichten((prev) => {
          if (!aiToegevoegd) return prev;
          const kopie = [...prev];
          kopie[kopie.length - 1] = {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            inlineMeldingen: inlineMeldingenData,
            onderbouwing: onderbouwingData,
            voltooid,
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
          error?: string;
          inline_meldingen?: InlineMelding[];
        };
        try {
          evt = JSON.parse(regel);
        } catch {
          return;
        }
        if (evt.type === "meta") {
          bronnenData = evt.bronnen;
          inlineMeldingenData = evt.inline_meldingen ?? [];
          // De voorbereiding-route levert alleen bronnen + meldingen; het paneel
          // "Onderbouwing en bronnen" toont dan de doorklikbare documentbronnen.
          onderbouwingData = { aantalBronnen: evt.bronnen?.length ?? 0 };
        } else if (evt.type === "delta") {
          volledig += evt.text || "";
          if (!aiToegevoegd) {
            aiToegevoegd = true;
            setAntwoordGestart(true);
            setBerichten((prev) => [
              ...prev,
              {
                rol: "ai",
                tekst: volledig,
                bronnen: bronnenData,
                inlineMeldingen: inlineMeldingenData,
                onderbouwing: onderbouwingData,
              },
            ]);
          } else {
            schrijfAi();
          }
        } else if (evt.type === "done") {
          voltooid = true;
          if (evt.inline_meldingen) inlineMeldingenData = evt.inline_meldingen;
          schrijfAi();
        } else if (evt.type === "error") {
          if (!aiToegevoegd) {
            aiToegevoegd = true;
            setBerichten((prev) => [
              ...prev,
              { rol: "ai", tekst: evt.error || "Er is een fout opgetreden." },
            ]);
          }
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

      if (!aiToegevoegd) {
        const finale: Bericht[] = [
          ...conversatie,
          { rol: "ai", tekst: "Er is geen antwoord ontvangen. Probeer het opnieuw." },
        ];
        berichtenRef.current = finale;
        setBerichten(finale);
      } else if (volledig.trim()) {
        const finale: Bericht[] = [
          ...conversatie,
          {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            inlineMeldingen: inlineMeldingenData,
            onderbouwing: onderbouwingData,
          },
        ];
        berichtenRef.current = finale;
        setBerichten(finale);
        bewaarGesprek(finale);
      }
    } catch {
      const finale: Bericht[] = [
        ...conversatie,
        { rol: "ai", tekst: "Verbindingsfout. Probeer het opnieuw." },
      ];
      berichtenRef.current = finale;
      setBerichten(finale);
    } finally {
      setLaden(false);
    }
  }

  // Houd bij of de gebruiker (bijna) onderaan staat. Bij handmatig omhoogscrollen
  // zetten we het meescrollen uit; komt hij weer binnen de drempel, dan weer aan.
  function bijScroll() {
    const el = scrollRef.current;
    if (!el) return;
    volgtBodemRef.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  useEffect(() => {
    if (!laden) return;
    const el = scrollRef.current;
    // Alleen meescrollen als de lezer al onderaan volgt (sticky bottom); anders
    // laten we de scrollpositie met rust zodat hij rustig kan teruglezen.
    if (el && volgtBodemRef.current) el.scrollTop = el.scrollHeight;
  }, [berichten, laden]);

  // T5 C2 — bij het openen van een bestaande vergaderingchat start de weergave
  // onderaan bij het laatste bericht. Het meescroll-effect hierboven staat achter
  // `if (!laden) return` en vuurt dus niet op de init-load; deze eenmalige scroll
  // ná de init zet de lezer direct onderaan (berichtenRef vermijdt een her-run
  // tijdens het streamen).
  useEffect(() => {
    if (!initGedaan) return;
    const el = scrollRef.current;
    if (el && berichtenRef.current.length > 0) {
      el.scrollTop = el.scrollHeight;
      volgtBodemRef.current = true;
    }
  }, [initGedaan]);

  // Opslag — zelfde payload-vorm als de AI-pagina (Fase B2 + ADR 0028), zodat
  // gesprekken uitwisselbaar blijven tussen beide instappunten.
  async function bewaarGesprek(finale: Bericht[]) {
    try {
      const uid = userIdRef.current;
      if (!uid || !fondsIdRef.current || finale.length === 0) return;
      const eersteVraag = finale.find((b) => b.rol === "gebruiker")?.tekst || "Gesprek";
      const scopePayload = {
        type: "single",
        document_ids: stukken.map((s) => s.id),
        titels: stukken.map((s) => s.titel),
        algemene_kennis: false,
        agendapunt_context: { id: agendapuntId, titel },
        gezet_op: new Date().toISOString(),
      };
      // Plateau A — het id is al bepaald vóór de beurt (zorgVoorGesprekId), zodat
      // de chat-route elke auditregel eraan kon koppelen. Of we inserten of
      // updaten hangt daarom af van `gesprekBestaatInDb`, niet meer van het id.
      if (gesprekBestaatInDb.current && gesprekId.current) {
        await supabase
          .from("gesprekken")
          .update({
            berichten: finale,
            document_scope: scopePayload,
            bijgewerkt: new Date().toISOString(),
          })
          .eq("id", gesprekId.current);
      } else {
        const { data, error } = await supabase
          .from("gesprekken")
          .insert({
            // Expliciet id: hetzelfde dat als gesprek_audit_id is meegestuurd.
            id: zorgVoorGesprekId(),
            gebruiker_id: uid,
            fonds_id: fondsIdRef.current,
            titel: eersteVraag.slice(0, 80),
            berichten: finale,
            document_scope: scopePayload,
          })
          .select("id")
          .single();
        if (!error && data?.id) {
          gesprekId.current = data.id as string;
          gesprekBestaatInDb.current = true;
        }
      }
    } catch (e) {
      console.error("Gesprek opslaan mislukt:", e);
    }
  }

  interface StuurOpties {
    bronIntentOverride?: "fonds" | "algemeen";
    geenNieuweVraag?: boolean;
    basisBerichten?: Bericht[];
    // Contextbewuste vervolgacties (gelijk aan de assistent): een vastgezette
    // antwoordmodus en/of een transformatie van het vorige antwoord.
    antwoordmodusOverride?: Antwoordmodus | null;
    transformatie?: boolean;
    // Plateau B — deze beurt komt uit het GELABELDE reflectie-invoerveld, niet
    // uit de normale invoerbalk (FR-56). Nooit een classificatie op inhoud.
    reflectieAntwoord?: boolean;
    // B-opt tranche 1a — herformuleren vanuit de conceptweergave (knop
    // "Aanpassen"): blijft in conceptweergave, beurt onveranderd.
    reflectieHerformuleren?: boolean;
    reflectieStart?: { ingang: ReflectieIngang; bronsetLogId: string | null };
  }

  async function stuurBericht(vraag?: string, opties?: StuurOpties) {
    const tekst = (vraag ?? invoer).trim();
    if (!tekst || laden) return;
    setInvoer("");
    setLaden(true);
    setAntwoordGestart(false);
    // Vers antwoord volgt vanaf de start mee, tot de gebruiker omhoog scrollt.
    volgtBodemRef.current = true;

    const basis = opties?.basisBerichten ?? berichten;
    const conversatie = opties?.geenNieuweVraag
      ? basis
      : [...basis, { rol: "gebruiker", tekst } as Bericht];
    setBerichten(conversatie);

    const messages = conversatie
      .filter((b) => !b.verduidelijking)
      .map((b) => ({
        role: b.rol === "gebruiker" ? ("user" as const) : ("assistant" as const),
        content: b.tekst,
      }));

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages,
          fonds_id: fondsIdRef.current,
          bron_intent_override: opties?.bronIntentOverride,
          // Gekoppelde stukken als retrieval-scope; in agendapunt-modus behandelt
          // de route dit als agendapunt-scope (niet strikt), zie route.ts.
          document_scope:
            stukken.length > 0
              ? { document_ids: stukken.map((s) => s.id), algemene_kennis: false }
              : undefined,
          actieve_antwoordmodus: opties?.antwoordmodusOverride ?? null,
          transformatie: opties?.transformatie,
          // ADR 0028 — de route haalt de toelichting zelf op onder RLS.
          agendapunt_context: { id: agendapuntId, titel },
          // Plateau A — koppelt de auditregel van deze beurt aan dit gesprek,
          // zodat de gebruiker hem later kan verwijderen.
          gesprek_id: zorgVoorGesprekId(),
          // Plateau B — signalen over het invoerkanaal; de server valideert ze
          // tegen de opnieuw uitgelezen flowstatus (FR-67). Past de gevraagde
          // overgang niet, dan is dit gewoon een normale chatbeurt.
          reflectie_antwoord: opties?.reflectieAntwoord === true,
          reflectie_herformuleren: opties?.reflectieHerformuleren === true,
          reflectie_start: opties?.reflectieStart
            ? {
                ingang: opties.reflectieStart.ingang,
                bronset_log_id: opties.reflectieStart.bronsetLogId ?? undefined,
              }
            : undefined,
        }),
      });

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
      // Zie besluit 0098 §4: `!laden` is niet genoeg — bij een verbindingsfout
      // zet het finally-blok dat ook op false en zou een afgebroken antwoord een
      // kopieerknop met volledige herkomstregel krijgen.
      let voltooid = false;
      let volledig = "";
      let bronnenData: Bron[] | undefined;
      let inlineMeldingenData: InlineMelding[] | undefined;
      let onderbouwingData: OnderbouwingMeta | undefined;
      let vervolgvragenData: string[] | undefined;
      let verduidelijkingActief = false;
      // Plateau B — het id van de auditregel van dit antwoord (uit 'done').
      let logIdData: string | undefined;

      const schrijfAi = () => {
        setBerichten((prev) => {
          if (!aiToegevoegd) return prev;
          const kopie = [...prev];
          kopie[kopie.length - 1] = {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            inlineMeldingen: inlineMeldingenData,
            onderbouwing: onderbouwingData,
            voltooid,
            logId: logIdData,
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
          error?: string;
          batch?: number;
          totaal?: number;
          inline_meldingen?: InlineMelding[];
          vervolgvragen?: string[];
          vraag?: string;
          opties?: { intent: "fonds" | "algemeen"; label: string }[];
          // Increment I-1/I-2/I-3 — controle-informatie voor het paneel
          // "Onderbouwing en bronnen" (identiek aan /ai).
          antwoordmodus?: string;
          antwoordmodus_label?: string;
          peildatum?: string | null;
          bronbasis?: string | null;
          retrieval_modus?: string | null;
          bron_intent?: "fonds" | "algemeen" | "gecombineerd" | null;
          bron_vertrouwen?: "zeker" | "onzeker" | null;
          alleen_fondsdocumenten?: boolean;
          bron_intent_override?: boolean;
          web_retrieval_actief?: boolean;
          model_kennis?: { grond: "algemene_kennis" | "wetgeving"; instantie: string | null }[];
          web_bronnen?: {
            url: string;
            titel: string;
            domein: string;
            datum?: string | null;
            normgewicht?: string | null;
            ophaaldatum?: string | null;
          }[];
          profielsturing?: "actief" | "uitgeschakeld" | "geen-profiel" | null;
          organisatieprofiel?: "actief" | "geen-profiel" | null;
          organisatieprofiel_aspecten?: {
            organisatietype: boolean;
            uitvoerende_partijen: boolean;
            omvang: boolean;
            kernfeiten: boolean;
            missie: boolean;
            visie: boolean;
            strategische_speerpunten: boolean;
            risicohouding: boolean;
            peildatum: string | null;
          } | null;
          document_gericht?: boolean;
          // Plateau B — auditregel-id en de server-controlled reflectiestatus.
          log_id?: string | null;
          reflectie?: { status?: string; beurt?: number; heeft_bronset?: boolean };
        };
        try {
          evt = JSON.parse(regel);
        } catch {
          return;
        }

        if (evt.type === "verduidelijking") {
          verduidelijkingActief = true;
          aiToegevoegd = true;
          setVoortgang(null);
          setBerichten((prev) => [
            ...prev,
            {
              rol: "ai",
              tekst:
                evt.vraag || "Wilt u dit weten voor uw fonds specifiek, of in algemene zin?",
              verduidelijking: {
                vraag: evt.vraag || "",
                opties: evt.opties ?? [],
                origineleVraag: tekst,
              },
            },
          ]);
        } else if (evt.type === "meta") {
          bronnenData = evt.bronnen;
          inlineMeldingenData = evt.inline_meldingen ?? [];
          // Rijke controle-informatie naar het paneel "Onderbouwing en bronnen"
          // (identiek aan /ai). De model_knowledge/webbronnen volgen in 'done'.
          onderbouwingData = {
            bronbasis: evt.bronbasis ?? null,
            antwoordmodusLabel: evt.antwoordmodus_label ?? evt.antwoordmodus ?? null,
            antwoordmodus: evt.antwoordmodus ?? null,
            retrievalModus: evt.retrieval_modus ?? null,
            peildatum: evt.peildatum ?? null,
            algemeneKennis: evt.bronbasis
              ? /algemene kennis/i.test(evt.bronbasis)
              : undefined,
            aantalBronnen: evt.bronnen?.length ?? 0,
            bronIntent: evt.bron_intent ?? null,
            bronVertrouwen: evt.bron_vertrouwen ?? null,
            alleenFondsdocumenten: evt.alleen_fondsdocumenten ?? null,
            bronIntentOverride: evt.bron_intent_override ?? null,
            webRetrievalActief: evt.web_retrieval_actief ?? false,
            modelKennis: [],
            profielsturing: evt.profielsturing ?? null,
            organisatieprofiel: evt.organisatieprofiel ?? null,
            organisatieprofielAspecten: evt.organisatieprofiel_aspecten ?? null,
            documentGericht: evt.document_gericht ?? null,
            vervolgvragen: [],
          };
        } else if (evt.type === "progress") {
          // Gefaseerde voortgang (besluit 0087) — gedeelde reducer, gelijk aan /ai.
          setVoortgang((v) => pasVoortgangToe(v, evt));
        } else if (evt.type === "delta") {
          volledig += evt.text || "";
          if (!aiToegevoegd) {
            aiToegevoegd = true;
            setVoortgang(null);
            setAntwoordGestart(true);
            setBerichten((prev) => [
              ...prev,
              { rol: "ai", tekst: volledig, bronnen: bronnenData, inlineMeldingen: inlineMeldingenData, onderbouwing: onderbouwingData },
            ]);
          } else {
            schrijfAi();
          }
        } else if (evt.type === "done") {
          if (verduidelijkingActief) return;
          voltooid = true;
          if (evt.inline_meldingen) inlineMeldingenData = evt.inline_meldingen;
          if (evt.vervolgvragen) vervolgvragenData = evt.vervolgvragen;
          // Increment I-3 — afgeleide algemene-kennisbronnen + geverifieerde
          // webbronnen komen in het 'done'-event en horen in het paneel (als /ai).
          if (onderbouwingData) {
            onderbouwingData = {
              ...onderbouwingData,
              modelKennis: evt.model_kennis ?? onderbouwingData.modelKennis ?? [],
              webRetrievalActief:
                evt.web_retrieval_actief ?? onderbouwingData.webRetrievalActief ?? false,
              webBronnen: evt.web_bronnen ?? onderbouwingData.webBronnen ?? [],
            };
          }
          // Plateau B — het auditregel-id (voor de bronsetbevriezing) en de
          // server-controlled flowstatus.
          if (typeof evt.log_id === "string") logIdData = evt.log_id;
          if (evt.reflectie?.status) {
            const nieuweStatus = evt.reflectie.status as ReflectieStatus;
            setReflectieStatus(nieuweStatus);
            if (nieuweStatus !== "niet_actief") setUitnodigingZichtbaar(false);
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

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const delen = buffer.split("\n\n");
        buffer = delen.pop() || "";
        for (const deel of delen) verwerkEvent(deel);
      }
      if (buffer.trim()) verwerkEvent(buffer);

      if (!aiToegevoegd) {
        setBerichten((prev) => [
          ...prev,
          { rol: "ai", tekst: "Er is geen antwoord ontvangen. Probeer het opnieuw." },
        ]);
      } else if (volledig.trim()) {
        const finale: Bericht[] = [
          ...conversatie,
          {
            rol: "ai",
            tekst: volledig,
            bronnen: bronnenData,
            inlineMeldingen: inlineMeldingenData,
            onderbouwing: onderbouwingData,
            vervolgvragen: vervolgvragenData,
            logId: logIdData,
          },
        ];
        setBerichten(finale);
        bewaarGesprek(finale);

        // ── Plateau B / B-2 — de proactieve uitnodiging (T4) ───────────────
        // In de agendapuntchat is T4 het relevante moment: een risico- of
        // evenwichtigheidsanalyse bij een agendapunt. T1 (na een afgeronde
        // voorbereiding) en T5 (vlak vóór het aanmaken van inbreng) horen bij de
        // omliggende schermen en vallen buiten deze component.
        overweegUitnodiging(onderbouwingData, opties);
      }
    } catch {
      setBerichten((prev) => [
        ...prev,
        { rol: "ai", tekst: "Verbindingsfout. Probeer het opnieuw." },
      ]);
    } finally {
      setLaden(false);
      setVoortgang(null);
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  Plateau B — de reflectiedialoog (identiek gedrag aan /ai)
  // ══════════════════════════════════════════════════════════════════════════

  /** De flowstatus opnieuw ophalen bij het openen van een gesprek (AC-23). */
  async function herstelReflectieStatus(id: string) {
    setUitnodigingZichtbaar(false);
    setUitnodigingBesluitmoment(false);
    // B-opt 1a — voorvultekst van "Aanpassen" is niet persistent en hoort bij het
    // gesprek waarin hij is getypt; bij herstel niet meenemen (code-review).
    setLaatsteReflectieAntwoord("");
    try {
      const res = await fetch(
        `/api/reflectie/transitie?gesprek_id=${encodeURIComponent(id)}`
      );
      const data = await res.json().catch(() => null);
      setReflectieStatus(res.ok && data?.status ? data.status : "niet_actief");
    } catch {
      setReflectieStatus("niet_actief");
    }
  }

  /**
   * Mag er nú een proactieve uitnodiging verschijnen? Zie de uitgebreide
   * toelichting in AssistentClient.tsx.
   *
   * ⚠ B-opt tranche 1b — de `sparring`-proxy is vervallen (H-3); alleen
   * `besluitrijpheid` blijft over. In de agendapuntchat is dat een zeldzamer
   * signaal dan in /ai, dus de proactieve uitnodiging verschijnt hier minder
   * vaak; de permanent beschikbare actie "Reflecteer op dit antwoord" blijft
   * altijd bereikbaar. Dat `besluitrijpheid` het triggersignaal is, blijft een
   * aanname (geen takenregister) — te bevestigen in de gebruikerstoets (0122).
   */
  function overweegUitnodiging(
    onderbouwing: OnderbouwingMeta | undefined,
    opties?: StuurOpties
  ) {
    if (!uitnodigingToegestaan) return;
    if (reflectieStatus !== "niet_actief") return;
    if (
      opties?.reflectieAntwoord ||
      opties?.reflectieStart ||
      opties?.reflectieHerformuleren
    )
      return;
    const modus = leesAntwoordmodus(onderbouwing?.antwoordmodus);
    if (modus !== "besluitrijpheid") return;

    const context = gesprekId.current;
    if (!context) return;
    if (reflectieUitnodigingGetoond(context)) return;
    markeerReflectieUitnodiging(context);
    // B-opt tranche 1c — de overgebleven trigger is een besluitrijpheidsmoment.
    setUitnodigingBesluitmoment(true);
    setUitnodigingZichtbaar(true);
  }

  /** Eén transitie die niet aan een chatbeurt hangt (afronden, afbreken). */
  async function vraagTransitie(actie: "afronden" | "afbreken") {
    const id = gesprekId.current;
    if (!id) return;
    try {
      const res = await fetch("/api/reflectie/transitie", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gesprek_id: id, actie }),
      });
      const data = await res.json().catch(() => null);
      setReflectieStatus(res.ok && data?.status ? data.status : "niet_actief");
    } catch {
      setReflectieStatus("niet_actief");
    }
  }

  /**
   * De bestuurder koos een reflectie-ingang. Vanaf hier is alles gewone chat:
   * de keuze wordt een gebruikersbericht, de bronset van het laatste antwoord
   * bevriest (besluit 0108/0111, FR-REF-1).
   */
  function startReflectie(ingang: ReflectieIngang) {
    if (laden) return;
    setUitnodigingZichtbaar(false);
    const laatsteAntwoord = [...berichten].reverse().find((b) => b.rol === "ai");
    void stuurBericht(INGANG_LABEL[ingang], {
      reflectieStart: { ingang, bronsetLogId: laatsteAntwoord?.logId ?? null },
    });
  }

  // Chipkeuze na een verduidelijkingsvraag: verwijder de verduidelijkingsbubbel
  // en stuur de originele vraag opnieuw met bevestigde bron-intentie.
  function kiesVerduidelijking(b: Bericht, intent: "fonds" | "algemeen") {
    const zonder = berichten.filter((x) => x !== b);
    stuurBericht(b.verduidelijking!.origineleVraag, {
      bronIntentOverride: intent,
      geenNieuweVraag: true,
      basisBerichten: zonder,
    });
  }

  function toggleBronnen(idx: number) {
    setOpenBronnen((s) => {
      const n = new Set(s);
      if (n.has(idx)) n.delete(idx);
      else n.add(idx);
      return n;
    });
  }

  // Increment I-1 — klik op een [Bron N]-pill: open het (standaard ingeklapte)
  // paneel "Onderbouwing en bronnen", scrol naar de betreffende kaart en licht
  // die kort op. Zelfde gedrag als de volledige assistent (/ai).
  function scrollNaarBron(berichtIdx: number, bronIdx: number) {
    setOpenBronnen((s) => new Set(s).add(berichtIdx));
    window.setTimeout(() => {
      const el = document.getElementById(`bron-${agendapuntId}-${berichtIdx}-${bronIdx}`);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 60);
    setHighlight({ berichtIdx, bronIdx });
    if (highlightTimer.current) window.clearTimeout(highlightTimer.current);
    highlightTimer.current = window.setTimeout(() => {
      setHighlight(null);
      highlightTimer.current = null;
    }, 2000);
  }

  // Contextbewuste vervolgactie (FO §13), identiek aan de assistent: een
  // transformatie herschrijft het vorige antwoord, een lens/retrieval-actie stuurt
  // de prompt met een vastgezette antwoordmodus. De agendapunt-scope blijft leidend
  // (geen aparte scope-override — de gekoppelde stukken zijn al de context).
  function stuurVervolgactie(actie: Vervolgactie) {
    stuurBericht(actie.prompt, {
      antwoordmodusOverride: actie.modus,
      transformatie: isTransformatieActie(actie.type),
    });
  }

  const heeftGesprek = berichten.length > 0;

  return (
    // Dicht = amber trigger (nodigt uit als AI-affordance); open = wit blok in de
    // stijl van de AI-assistent (bg-card + neutrale rand), zodat het uitgeklapte
    // paneel dezelfde rustige kleurstelling krijgt als /ai.
    <div
      className={`border rounded-lg ${
        open ? "border-line bg-card" : "border-warn/30 bg-warn-tint"
      }`}
    >
      <button
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 text-left"
      >
        <span className="flex items-center justify-between">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink">
            ✨ Vraag door over dit agendapunt
            {heeftGesprek && !open && (
              <span className="text-[10px] font-normal text-muted">
                — eerder gesprek beschikbaar
              </span>
            )}
          </span>
          <span className="text-muted text-xs">{open ? "▾" : "▸"}</span>
        </span>
        <span className="block text-xs text-muted mt-1 leading-relaxed font-normal">
          Laat de AI helpen scherper na te denken over dit punt — wat het stuk
          betekent, welk besluit wordt gevraagd, blinde vlekken en vragen voor
          de vergadering. Persoonlijk en alleen voor u zichtbaar.
        </span>
      </button>

      {open && (
        <div className="px-3 pb-3 space-y-3">
          {/* Contextregel: waarop is de assistent hier gescoped? */}
          <div className="text-[11px] text-muted">
            Context: dit agendapunt
            {stukken.length > 0
              ? ` en ${stukken.length} gekoppeld${stukken.length === 1 ? " stuk" : "e stukken"}`
              : " (geen stukken gekoppeld)"}
            .{" "}
            <a
              href={`/ai?agendapunt=${agendapuntId}`}
              className="underline hover:text-ink"
              title="Zelfde gesprek met alle opties in de volledige assistent"
            >
              Openen in volledige assistent
            </a>
            {/* Plateau A (A-8) — dezelfde verwijderfunctie als op /ai. Die
                ontbrak hier volledig: een gesprek dat via een agendapunt was
                begonnen, was voor de gebruiker onbereikbaar om op te ruimen. */}
            {heeftGesprek && gesprekBestaatInDb.current && gesprekId.current && (
              <>
                {" · "}
                <button
                  onClick={verwijderDitGesprek}
                  className="underline hover:text-err-ink"
                  title="Definitief verwijderen"
                >
                  Gesprek verwijderen
                </button>
              </>
            )}
          </div>

          {/* Berichten. `relative` is functioneel, geen opmaak: zie de toelichting
              in AssistentClient — de absoluut gepositioneerde aria-live-melding van
              "Antwoord kopiëren" staat buiten `.ai-blok` en moet door déze container
              worden geclipt, anders rekt ze de paginahoogte op. */}
          {heeftGesprek && (
            <div ref={scrollRef} onScroll={bijScroll} className="relative space-y-2 max-h-96 overflow-y-auto pr-1">
              {berichten.map((b, idx) =>
                b.rol === "gebruiker" ? (
                  <div key={idx} className="flex justify-end">
                    {/* Zelfde rustige vraagbubbel als /ai (gedeelde weergave, 0079). */}
                    <div className="bg-app-zebra text-ink border border-app-line text-sm rounded-lg px-3 py-2 max-w-[85%] whitespace-pre-wrap">
                      {b.tekst}
                    </div>
                  </div>
                ) : (
                  // AI-antwoord zonder wit kaartje — gelijk aan /ai (ontblokt,
                  // platte tekst op het paneel). Gebruikersbubbel en chips houden
                  // hun eigen stijl.
                  <div key={idx}>
                    {b.inlineMeldingen && b.inlineMeldingen.length > 0 && (
                      <div className="mb-1.5 space-y-1">
                        {b.inlineMeldingen.map((m, i) => (
                          <div key={i} className="text-[11px] text-warn-ink bg-warn-tint border border-warn/30 rounded px-2 py-1">
                            {m.tekst}
                          </div>
                        ))}
                      </div>
                    )}
                    <div className="text-sm text-ink leading-relaxed">
                      {renderAntwoord(
                        b.tekst,
                        b.bronnen,
                        idx,
                        highlight,
                        scrollNaarBron,
                        // Kopieerknoppen alleen op een netjes afgeronde
                        // generatie (besluit 0098 §4).
                        b.voltooid
                          ? { fondsnaam: fondsNaam || null, surface: "agendapunt" }
                          : null,
                      )}
                    </div>
                    {/* Documentlijst bij antwoordmodus `bronoverzicht` (besluit
                        0099) — zelfde component als /ai. Bewust ZONDER de
                        scope-vervolgacties: hier ís de scope al vast (de aan het
                        agendapunt gekoppelde stukken), dus "vraag hierover" zou
                        die juist versmallen zonder dat de bestuurder dat vraagt. */}
                    {documentlijstZichtbaar(b) && (
                      <Documentenlijst
                        bronnen={b.bronnen}
                        ankerIdVoorBron={(i) => `bron-${agendapuntId}-${idx}-${i}`}
                        gehighlightBronIdx={
                          highlight?.berichtIdx === idx ? highlight.bronIdx : null
                        }
                      />
                    )}

                    {/* Actiebalk onder het antwoord — dezelfde helper als /ai,
                        dus dezelfde verplichte bronnenlijst en herkomstregel. */}
                    {b.voltooid && b.tekst.trim().length > 0 && (
                      <div className="mt-2">
                        <AntwoordKopieerKnop
                          tekst={b.tekst}
                          bronnen={b.bronnen}
                          herkomst={{
                            fondsnaam: fondsNaam || null,
                            surface: "agendapunt",
                          }}
                        />
                      </div>
                    )}
                    {b.verduidelijking && b.verduidelijking.opties.length > 0 && (
                      <div className="flex gap-2 mt-2">
                        {b.verduidelijking.opties.map((o) => (
                          <button
                            key={o.intent}
                            onClick={() => kiesVerduidelijking(b, o.intent)}
                            disabled={laden}
                            className="text-xs border border-app-line-strong rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-50"
                          >
                            {o.label}
                          </button>
                        ))}
                      </div>
                    )}
                    {(b.onderbouwing || (b.bronnen && b.bronnen.length > 0)) && (
                      <OnderbouwingPaneel
                        meta={{
                          ...(b.onderbouwing ?? {}),
                          aantalBronnen: b.bronnen?.length ?? 0,
                          bronTitels: (b.bronnen ?? []).map((bron) => bron.titel),
                        }}
                        bronnenInAntwoord={documentlijstZichtbaar(b)}
                        open={openBronnen.has(idx)}
                        onToggle={() => toggleBronnen(idx)}
                        ankerId={`onderbouwing-${agendapuntId}-${idx}`}
                      >
                        {(() => {
                          const lijstAan = documentlijstZichtbaar(b);
                          const zichtbaar = (b.bronnen ?? [])
                            .map((bron, i) => ({ bron, i }))
                            .filter(({ bron }) => !lijstAan || !isDocumentbron(bron));
                          if (zichtbaar.length === 0) return null;
                          return zichtbaar.map(({ bron, i }) => (
                            <Bronkaart
                              key={i}
                              idx={i}
                              bron={bron}
                              idVoorScroll={`bron-${agendapuntId}-${idx}-${i}`}
                              gehighlight={
                                highlight?.berichtIdx === idx && highlight?.bronIdx === i
                              }
                            />
                          ));
                        })()}
                      </OnderbouwingPaneel>
                    )}
                    {b.vervolgvragen && b.vervolgvragen.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {b.vervolgvragen.map((v, vi) => (
                          <button
                            key={vi}
                            onClick={() => stuurBericht(v)}
                            disabled={laden}
                            className="text-xs text-left border border-app-line-strong bg-white rounded-full px-3 py-1.5 hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-50"
                          >
                            {v}
                          </button>
                        ))}
                      </div>
                    )}
                    {b.rol === "ai" &&
                      !(laden && idx === berichten.length - 1) &&
                      (() => {
                        const vorigeVraag =
                          idx > 0 && berichten[idx - 1].rol === "gebruiker"
                            ? berichten[idx - 1].tekst
                            : "";
                        const acties = bepaalVervolgacties(
                          vorigeVraag,
                          bepaalAntwoordmodus(vorigeVraag),
                          !!b.bronnen?.length,
                          true, // de agenda is altijd stukgericht
                          // G1 (plateau B) — geen vervolgacties tijdens een
                          // actieve reflectieflow; de status komt van de server.
                          isReflectieActief(reflectieStatus)
                        );
                        if (acties.length === 0) return null;
                        return (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {acties.map((a) => (
                              <button
                                key={a.type}
                                onClick={() => stuurVervolgactie(a)}
                                disabled={laden}
                                className="text-xs text-ink bg-white border border-line rounded-full px-3 py-1 hover:border-accent hover:bg-warn-tint disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                              >
                                {a.label}
                              </button>
                            ))}
                          </div>
                        );
                      })()}

                    {/* ── Plateau B — reflectie onder het LAATSTE antwoord ──
                        De uitnodiging is componentstate, geen chatbericht
                        (FR-50): wegklikken raakt `gesprekken.berichten` niet en
                        schrijft geen auditregel. */}
                    {b.rol === "ai" &&
                      idx === berichten.length - 1 &&
                      !laden && (
                        <>
                          {!isReflectieActief(reflectieStatus) &&
                            (uitnodigingZichtbaar ? (
                              <ReflectieKaart
                                vraag={
                                  uitnodigingBesluitmoment
                                    ? REFLECTIE_VRAAG_BESLUITMOMENT
                                    : undefined
                                }
                                onKies={startReflectie}
                                onSluit={() => setUitnodigingZichtbaar(false)}
                                bezig={laden}
                              />
                            ) : (
                              /* De permanent beschikbare actie (v1.0 §9.1 A):
                                 rustig, altijd bereikbaar, telt niet mee in de
                                 frequentiebegrenzing. Zelf gekozen ⇒
                                 standaardvraag, geen besluitmoment-variant. */
                              <button
                                type="button"
                                onClick={() => {
                                  setUitnodigingBesluitmoment(false);
                                  setUitnodigingZichtbaar(true);
                                }}
                                className="mt-2 text-xs text-muted hover:text-ink transition-colors"
                              >
                                Reflecteer op dit antwoord
                              </button>
                            ))}

                          {isReflectieActief(reflectieStatus) && (
                            <ReflectieInvoer
                              status={reflectieStatus}
                              bezig={laden}
                              laatsteAntwoord={laatsteReflectieAntwoord}
                              onAntwoord={(t) => {
                                setLaatsteReflectieAntwoord(t);
                                void stuurBericht(t, { reflectieAntwoord: true });
                              }}
                              onAfronden={() => vraagTransitie("afronden")}
                              onHerformuleren={(t) => {
                                // B-opt tranche 1a — herformuleren blijft in
                                // conceptweergave; het concept wordt opnieuw
                                // opgebouwd met deze eigen inbreng.
                                setLaatsteReflectieAntwoord(t);
                                void stuurBericht(t, {
                                  reflectieHerformuleren: true,
                                });
                              }}
                              onAfbreken={() => vraagTransitie("afbreken")}
                            />
                          )}
                        </>
                      )}
                  </div>
                )
              )}
              {laden && !antwoordGestart && (
                <div className="text-sm leading-relaxed text-ink px-1">
                  <VoortgangWeergave voortgang={voortgang} />
                </div>
              )}
              <div ref={eindRef} />
            </div>
          )}

          {/* De voorbereiding-chip is er altijd (rijke voorbereiding-route,
              ook midden in een gesprek opnieuw op te stellen); de start-
              vragen alleen zolang er nog geen gesprek is (gewone chat-route). */}
          {initGedaan && (
            <div className="flex flex-wrap gap-1.5">
              <button
                onClick={() => genereerVoorbereiding()}
                disabled={laden}
                className="text-xs text-left bg-accent text-white rounded-full px-3 py-1.5 hover:bg-accent-ink transition-colors disabled:opacity-50 font-medium"
              >
                {heeftGesprek
                  ? "Help mij (opnieuw) met de voorbereiding"
                  : "Help mij met de voorbereiding"}
              </button>
              {!heeftGesprek &&
                STARTVRAGEN.map((v) => (
                  <button
                    key={v}
                    onClick={() => stuurBericht(v)}
                    disabled={laden}
                    className="text-xs text-left border border-app-line-strong bg-white rounded-full px-3 py-1.5 hover:border-accent hover:bg-warn-tint transition-colors disabled:opacity-50"
                  >
                    {v}
                  </button>
                ))}
            </div>
          )}

          {/* Invoer */}
          <div className="flex gap-2 items-end">
            <textarea
              value={invoer}
              onChange={(e) => setInvoer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  stuurBericht();
                }
              }}
              placeholder={`Stel een vraag over "${titel}"…`}
              rows={2}
              className="flex-1 border border-line rounded-lg px-3 py-2 text-sm bg-white outline-none focus:border-accent resize-none"
            />
            <button
              onClick={() => stuurBericht()}
              disabled={laden || !invoer.trim()}
              className="bg-accent text-white text-sm font-medium px-3 py-2 rounded-lg hover:bg-accent hover:text-ink transition-colors disabled:opacity-40 disabled:cursor-not-allowed self-stretch"
            >
              {laden ? "…" : "Vraag"}
            </button>
          </div>

          <div className="text-[10px] text-muted">
            AI-hulpmiddel ter voorbereiding — geen bestuurlijk advies. Vragen en
            bronkeuze worden vastgelegd in de governance log.
          </div>
        </div>
      )}
    </div>
  );
}

