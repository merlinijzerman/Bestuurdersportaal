// ============================================================================
//  /governance — het AI-auditspoor, na plateau A
// ----------------------------------------------------------------------------
//  WAT ER IS VERANDERD EN WAAROM. Deze pagina las `governance_log` rechtstreeks
//  met `select("*")`, gefilterd op fonds. Dat werkte omdat de policy "fonds log"
//  fondsbreed was: elke beheerder zag de vragen van elke collega, mét de
//  volledige vraagtekst. Dat is geen rolmodel maar de afwezigheid ervan.
//
//  Sinds plateau A:
//   • De pagina leest via `lees_governance_audit()`. Die RPC schermt af op
//     capability, projecteert de metadata op basis- of bronniveau, en schrijft
//     een inzageregel zodra iemand ANDERMANS metadata opvraagt.
//   • Rol `beheerder` geeft géén toegang meer tot het spoor van collega's. Dat
//     vraagt een expliciete, tijdelijke capability (`governance_audit_read`),
//     toegekend door de databank-eigenaar. Zonder die grant toont deze pagina
//     uitsluitend de eigen regels — dat is het beoogde gedrag, geen storing.
//   • De vraagtekst is er niet meer. Die leeft in `governance_log_inhoud` en is
//     door de gebruiker verwijderbaar; `inhoud_aanwezig` maakt zichtbaar DÁT er
//     is verwijderd (FR-12) zonder de inhoud te ontsluiten.
//   • Bronnen komen uit de geprojecteerde metadata, niet uit een `bronnen`-
//     kolom, en alleen met `governance_audit_read_sources`.
// ============================================================================

import { createServerSupabase } from "@/core/lib/supabase-server";

interface AuditRegel {
  id: string;
  gebruiker_id: string;
  gebruiker_naam: string | null;
  fonds_id: string;
  modus: string | null;
  model: string | null;
  aangemaakt: string;
  inhoud_hmac: string | null;
  inhoud_aanwezig: boolean;
  retrieval_meta: RetrievalMetaProjectie | null;
}

/** Alleen de velden die deze pagina toont; de projectie levert er meer. */
interface RetrievalMetaProjectie {
  antwoordmodus?: string;
  methode?: string;
  geselecteerd?: number;
  zwakke_bronbasis?: boolean;
  verduidelijking?: boolean;
  duur_model_ms?: number;
  /** Alleen aanwezig met governance_audit_read_sources. */
  bronversie_audit?: Array<{
    document_id: string;
    bron: string | null;
    bibliotheek: string | null;
    documentstatus: string | null;
  }>;
}

const BRONKLEUR: Record<string, string> = {
  DNB: "bg-err-tint text-err-ink",
  AFM: "bg-accent-tint text-accent-ink",
  Pensioenfederatie: "bg-ok-tint text-ok-ink",
  Intern: "bg-warn-tint text-warn-ink",
  Extern: "bg-warn-tint text-warn-ink",
};

export default async function GovernancePage() {
  const supabase = await createServerSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // L-05 (review 2026-07-30): `user!` was de enige plek waar de sessie-aanname
  // niet lokaal werd herbevestigd. De layout redirect al bij een lege sessie,
  // maar bij een race (token verloopt tussen layout- en pagina-render) werd dit
  // een TypeError → foutscherm in plaats van een redirect naar de login.
  if (!user) return null;

  const { data: profiel } = await supabase
    .from("profielen")
    .select("fonds_id, rol")
    .eq("id", user.id)
    .single();

  const fondsId = profiel?.fonds_id ?? null;
  if (!fondsId) return null;

  // De RPC bepaalt zelf wat de aanroeper mag zien: eigen regels altijd, die van
  // anderen alleen met `governance_audit_read`. De rolcheck die hier stond is
  // vervallen — rol `beheerder` is geen autorisatie meer voor het auditspoor.
  //
  // `p_bronniveau: false` is een bewuste keuze. Bronniveau (document-ID's,
  // herkomst, objectreferenties) vraagt een motivering, en die hoort van een
  // mens te komen. Zou deze pagina er automatisch om vragen, dan zou de
  // applicatie een vaste zin moeten invullen en was de motiveringsplicht een
  // formaliteit. Bronniveau-inzage loopt daarom via een expliciete aanroep met
  // een echte reden; een schermontwerp daarvoor valt buiten plateau A.
  const { data: regels, error } = await supabase.rpc("lees_governance_audit", {
    p_fonds: fondsId,
    p_filters: { weergave: "governance-pagina", limiet: 50 },
    p_motivering: null,
    p_limiet: 50,
    p_bronniveau: false,
  });

  const auditRegels = (regels ?? []) as AuditRegel[];
  const eigenRegels = auditRegels.filter((r) => r.gebruiker_id === user.id);
  // Geen enkele regel van een ander → deze gebruiker heeft geen auditcapability.
  const heeftAuditToegang = auditRegels.length > eigenRegels.length;

  return (
    <div className="p-4 sm:p-6 lg:p-7">
      <div className="mb-6">
        <h1 className="font-serif text-xl font-black text-ink">Governance Log</h1>
        <p className="text-sm text-muted mt-1">
          Elke AI-interactie laat een spoor na: wie, wanneer, in welke modus en
          met welk model
        </p>
      </div>

      {/* Maak de eigen positie expliciet vóór de lijst, niet als foutmelding
          erna (UX-principe "toon vereisten en blokkers vooraf"). */}
      {!heeftAuditToegang && (
        <div className="rounded-xl border border-warn/30 bg-warn-tint px-4 py-3 mb-6 text-sm text-warn-ink">
          U ziet hieronder <strong>uitsluitend uw eigen</strong> AI-interacties.
          Het auditspoor van collega&apos;s inzien vraagt een expliciete,
          tijdelijke auditbevoegdheid — die is niet aan een rol gekoppeld, maar
          wordt per persoon en per periode toegekend en vastgelegd.
        </div>
      )}

      <div className="flex items-start gap-3 bg-accent-tint border border-accent/30 rounded-xl px-4 py-3 mb-6 text-sm text-accent-ink">
        <span>🛡️</span>
        <div>
          Dit log registreert <strong>dát</strong> er een vraag is gesteld: wie,
          wanneer, in welke modus en met welk model. De vraag- en antwoordtekst
          zelf hoort bij de bestuurder en staat hier niet — die kan hij of zij
          verwijderen zonder dit spoor te breken. Het spoor zelf is
          onveranderbaar.
          {heeftAuditToegang && (
            <>
              {" "}
              Uw inzage in het spoor van anderen is vastgelegd.
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="rounded-xl border border-err/30 bg-err-tint px-4 py-3 mb-6 text-sm text-err-ink">
          Het auditspoor kon niet worden geladen.
        </div>
      )}

      {auditRegels.length === 0 ? (
        <div className="text-center py-12">
          <div className="text-4xl mb-3">📋</div>
          <h3 className="font-semibold text-ink mb-1">Nog geen AI-interacties</h3>
          <p className="text-sm text-muted">
            Zodra u vragen stelt aan de AI, verschijnen die hier.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {auditRegels.map((log) => {
            const initials =
              log.gebruiker_naam
                ?.split(" ")
                .map((n: string) => n[0])
                .join("")
                .substring(0, 2)
                .toUpperCase() || "??";
            const meta = log.retrieval_meta;
            const bronnen = meta?.bronversie_audit ?? [];

            return (
              <div key={log.id} className="bg-white border border-line rounded-xl p-4">
                {/* Header */}
                <div className="flex items-center gap-2.5 mb-3">
                  <div className="w-7 h-7 bg-accent rounded-full flex items-center justify-center text-xs font-bold text-ink flex-shrink-0">
                    {initials}
                  </div>
                  <span className="font-semibold text-sm text-ink">
                    {log.gebruiker_naam ?? "Onbekend"}
                  </span>
                  <span className="ml-auto text-xs text-muted">
                    {new Date(log.aangemaakt).toLocaleString("nl-NL", {
                      day: "numeric",
                      month: "short",
                      year: "numeric",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>

                {/* Kenmerken van de interactie — het spoor, niet de inhoud. */}
                <div className="flex flex-wrap gap-2 text-xs mb-3">
                  {log.modus && (
                    <span className="bg-app-bg text-muted px-2 py-1 rounded-full">
                      bron: {log.modus}
                    </span>
                  )}
                  {meta?.antwoordmodus && (
                    <span className="bg-app-bg text-muted px-2 py-1 rounded-full">
                      modus: {meta.antwoordmodus}
                    </span>
                  )}
                  <span className="bg-app-bg text-muted px-2 py-1 rounded-full">
                    model: {log.model ?? "geen (terugvraag)"}
                  </span>
                  {typeof meta?.geselecteerd === "number" && (
                    <span className="bg-app-bg text-muted px-2 py-1 rounded-full">
                      {meta.geselecteerd} bron
                      {meta.geselecteerd === 1 ? "" : "nen"} gebruikt
                    </span>
                  )}
                  {meta?.verduidelijking && (
                    <span className="bg-warn-tint text-warn-ink px-2 py-1 rounded-full">
                      terugvraag — geen antwoord gegenereerd
                    </span>
                  )}
                  {meta?.zwakke_bronbasis && (
                    <span className="bg-warn-tint text-warn-ink px-2 py-1 rounded-full">
                      zwakke bronbasis
                    </span>
                  )}
                </div>

                {/* FR-12 — zichtbaar DAT de inhoud is verwijderd, zonder haar te
                    ontsluiten. Het zegel blijft staan, zodat een voorgelegde
                    tekst achteraf nog toetsbaar is. */}
                <div className="text-xs mb-2">
                  {log.inhoud_aanwezig ? (
                    <span className="text-muted">
                      Vraag en antwoord zijn bewaard bij de bestuurder
                      {log.gebruiker_id === user.id ? " (u)" : ""}.
                    </span>
                  ) : (
                    <span className="text-muted italic">
                      De inhoud van deze interactie is door de bestuurder
                      verwijderd. Het spoor blijft
                      {log.inhoud_hmac ? ", inclusief het integriteitszegel" : ""}.
                    </span>
                  )}
                </div>

                {/* Bronnen — alleen met governance_audit_read_sources, en zonder
                    documenttekst: identiteit en status, geen fragmenten. */}
                {bronnen.length > 0 && (
                  <div className="flex flex-wrap gap-2">
                    {bronnen.map((b, j) => (
                      <span
                        key={`${b.document_id}-${j}`}
                        className={`text-xs font-semibold px-2 py-1 rounded-full ${
                          BRONKLEUR[b.bron ?? ""] || "bg-app-bg text-muted"
                        }`}
                      >
                        {b.bron ?? "bron"} — {b.bibliotheek ?? "onbekend"}
                        {b.documentstatus ? ` · ${b.documentstatus}` : ""}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {auditRegels.length > 0 && (
        <div className="mt-5 flex gap-3">
          <div className="text-xs text-muted self-center">
            {auditRegels.length} interactie
            {auditRegels.length === 1 ? "" : "s"} weergegeven
            {heeftAuditToegang && (
              // Deze pagina vraagt bewust géén bronniveau aan: dat vergt een
              // motivering, en die hoort van een mens te komen in plaats van
              // door de applicatie te worden ingevuld (besluit 0119).
              <> · bronverwijzingen bij regels van collega&apos;s vragen een
                {" "}gemotiveerd, apart verzoek</>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
