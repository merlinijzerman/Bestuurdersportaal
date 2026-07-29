"use client";

// ============================================================================
//  AI-startpunt — startscherm (P1, besluit 0085).
// ----------------------------------------------------------------------------
//  Vervangt de oude lege staat op /ai (de VOORGESTELDE_VRAGEN-chips). Toont
//  server-afgeleide context ("Speelt nu voor u") en drie taakknoppen ("Wat wilt
//  u doen"). GEEN nieuwe AI-logica: de knoppen routeren (via <Link>) of zetten
//  een bestaande document_scope. Kaarten zonder inhoud worden weggelaten.
//
//  Privacy: de context komt uitsluitend uit getPortaalContext (eigen fondsdata,
//  eigen inbreng). Dit scherm toont nooit inbreng/voorbereiding van een ander.
// ============================================================================

import Link from "next/link";
import type {
  PortaalContext,
  DocumentCtx,
} from "@/core/lib/portaalcontext-afleiding";
import { heeftEnigeContext } from "@/core/lib/portaalcontext-afleiding";

function formatDatum(d: string) {
  return new Date(d).toLocaleString("nl-NL", {
    weekday: "short",
    day: "numeric",
    month: "long",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatDatumKort(d: string) {
  return new Date(d).toLocaleDateString("nl-NL", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

function dagenTot(datum: string) {
  return Math.ceil((new Date(datum).getTime() - Date.now()) / 86400000);
}

// Kop boven een blok — zelfde stijl als de homepage-blokken.
function BlokKop({ tekst }: { tekst: string }) {
  return (
    <div className="text-[11px] font-semibold text-muted uppercase tracking-wide mb-2">
      {tekst}
    </div>
  );
}

export default function Startpunt({
  context,
  voornaam,
  onVrijeVraag,
  onDocumentVraag,
}: {
  context: PortaalContext;
  voornaam: string;
  onVrijeVraag: () => void;
  onDocumentVraag: (doc: DocumentCtx) => void;
}) {
  const { volgendeVergadering, agendapunten, openStappen, recentDocument } =
    context;
  const eersteStap = openStappen[0] ?? null;
  const heeftContext = heeftEnigeContext(context);

  // Deeplink-doel voor "Een agendapunt voorbereiden": het eerste agendapunt
  // zonder eigen inbreng, met het bestaande anker (AgendapuntKaart id).
  const voorbereidHref = volgendeVergadering
    ? agendapunten.eersteZonderInbreng
      ? `/vergaderingen/${volgendeVergadering.id}#agendapunt-${agendapunten.eersteZonderInbreng.id}`
      : `/vergaderingen/${volgendeVergadering.id}`
    : "/vergaderingen";

  return (
    <div className="pb-3 pt-1 space-y-5">
      {/* ── Aanhef ── editoriale kop i.p.v. een AI-begroetingsbubbel (iteratie
          28-07-2026). Vervangt de begroeting op de lege staat; de bubbel wordt in
          AssistentClient onderdrukt zolang het startpunt zichtbaar is. */}
      <div>
        <h1 className="font-serif text-2xl md:text-3xl font-semibold text-ink">
          {voornaam ? `Waar werkt u nu aan, ${voornaam}?` : "Waar werkt u nu aan?"}
        </h1>
        <p className="text-sm text-muted mt-2 max-w-xl leading-relaxed">
          Ik zie wat er op uw agenda staat. Kies een startpunt — dan help ik de juiste
          stukken en de juiste context klaar te zetten.
        </p>
      </div>

      {/* ── Speelt nu voor u ── (alleen bij context; lege kaarten weggelaten) */}
      {heeftContext && (
        <div>
          <BlokKop tekst="Speelt nu voor u" />
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
            {volgendeVergadering && (
              <Link
                href={`/vergaderingen/${volgendeVergadering.id}`}
                className="block border border-line rounded-xl p-3 bg-card hover:border-accent hover:shadow-card-hover motion-safe:hover:-translate-y-px transition-all"
              >
                <div className="text-[11px] text-muted mb-1">
                  Komende vergadering · over {dagenTot(volgendeVergadering.datum)} dgn
                </div>
                <div className="text-sm font-medium text-ink truncate">
                  {volgendeVergadering.titel}
                </div>
                <div className="text-xs text-muted mt-1">
                  {formatDatum(volgendeVergadering.datum)}
                </div>
                {agendapunten.totaal > 0 && (
                  <div className="text-xs mt-2 flex items-center gap-1.5">
                    <span
                      className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                        agendapunten.zonderEigenInbreng > 0 ? "bg-warn" : "bg-ok"
                      }`}
                    />
                    <span className="text-ink">
                      {agendapunten.zonderEigenInbreng > 0
                        ? `Op ${agendapunten.zonderEigenInbreng} van ${agendapunten.totaal} punten nog geen inbreng`
                        : "U heeft op alle punten inbreng geplaatst"}
                    </span>
                  </div>
                )}
              </Link>
            )}

            {eersteStap && (
              <Link
                href={`/procedures/${eersteStap.procedure_id}`}
                className="block border border-line rounded-xl p-3 bg-card hover:border-accent hover:shadow-card-hover motion-safe:hover:-translate-y-px transition-all"
              >
                <div className="text-[11px] text-muted mb-1">
                  Uw eerstvolgende processtap
                  {eersteStap.deadline
                    ? ` · nog ${dagenTot(eersteStap.deadline)} dgn`
                    : ""}
                </div>
                <div className="text-sm font-medium text-ink truncate">
                  {eersteStap.naam}
                </div>
                <div className="text-xs text-muted mt-1 truncate">
                  {eersteStap.procedure_titel}
                </div>
              </Link>
            )}

            {recentDocument && (
              <Link
                href="/bibliotheek"
                className="block border border-line rounded-xl p-3 bg-card hover:border-accent hover:shadow-card-hover motion-safe:hover:-translate-y-px transition-all"
              >
                <div className="text-[11px] text-muted mb-1">
                  Recent toegevoegd aan de bibliotheek
                </div>
                <div className="text-sm font-medium text-ink truncate">
                  {recentDocument.titel}
                </div>
                <div className="text-xs text-muted mt-1">
                  {formatDatumKort(recentDocument.aangemaakt)}
                </div>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* ── Wat wilt u doen ── (altijd zichtbaar; taakgericht startpunt) */}
      <div>
        <BlokKop tekst="Wat wilt u doen" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {/* 1. Agendapunt voorbereiden — routeert naar de vergaderpagina. */}
          <TaakLink
            href={voorbereidHref}
            icoon="▦"
            titel="Een agendapunt voorbereiden"
            subtitel={
              volgendeVergadering
                ? agendapunten.eersteZonderInbreng
                  ? `«${agendapunten.eersteZonderInbreng.titel}»`
                  : "Naar de komende vergadering"
                : "Bekijk de vergaderingen"
            }
          />

          {/* 2. Vraag over een document — zet document_scope (bestaand mechanisme). */}
          {recentDocument ? (
            <TaakKnop
              icoon="▤"
              titel="Een vraag over een document"
              subtitel={`«${recentDocument.titel}»`}
              onClick={() => onDocumentVraag(recentDocument)}
            />
          ) : (
            <TaakLink
              href="/bibliotheek"
              icoon="▤"
              titel="Een vraag over een document"
              subtitel="Kies een document in de bibliotheek"
            />
          )}

          {/* 3. Vrije vraag — zet de cursor in het invoerveld (ongewijzigde chat). */}
          <TaakKnop
            icoon="✦"
            titel="Een vrije vraag stellen"
            subtitel="Typ direct uw vraag hieronder"
            onClick={onVrijeVraag}
          />
        </div>
      </div>
    </div>
  );
}

// ── Taakkaart-bouwstenen ─────────────────────────────────────────────────────

function TaakInhoud({
  icoon,
  titel,
  subtitel,
}: {
  icoon: string;
  titel: string;
  subtitel: string;
}) {
  return (
    <>
      <div className="text-lg text-accent leading-none mb-2" aria-hidden>
        {icoon}
      </div>
      <div className="text-sm font-medium text-ink">{titel}</div>
      <div className="text-xs text-muted mt-1 truncate">{subtitel}</div>
    </>
  );
}

function TaakLink({
  href,
  icoon,
  titel,
  subtitel,
}: {
  href: string;
  icoon: string;
  titel: string;
  subtitel: string;
}) {
  return (
    <Link
      href={href}
      className="block text-left border border-line rounded-xl p-3 bg-card hover:border-accent hover:shadow-card-hover motion-safe:hover:-translate-y-px transition-all"
    >
      <TaakInhoud icoon={icoon} titel={titel} subtitel={subtitel} />
    </Link>
  );
}

function TaakKnop({
  icoon,
  titel,
  subtitel,
  onClick,
}: {
  icoon: string;
  titel: string;
  subtitel: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="block text-left w-full border border-line rounded-xl p-3 bg-card hover:border-accent hover:shadow-card-hover motion-safe:hover:-translate-y-px transition-all"
    >
      <TaakInhoud icoon={icoon} titel={titel} subtitel={subtitel} />
    </button>
  );
}
