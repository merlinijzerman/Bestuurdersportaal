// Auditdossier — HTML-renderer voor MVP-1E.
//
// Genereert een geprinte, A4-vriendelijke HTML-export van een
// DecisionDossierView. Bewust geen React/Tailwind: dit is een
// server-side rendered string die direct door de browser kan worden
// geprint of opgeslagen, en die niet afhankelijk is van Next.js'
// runtime of CSS-bundling.
//
// Aanroepconventie:
//   const html = renderAuditdossierHtml(view, { versie: 'actueel' });
//   return new Response(html, { headers: { 'Content-Type': 'text/html' }});
//
// Reproduceerbaarheid: bij `versie=besluitmoment` wordt de snapshot
// payload (jsonb uit decision_audit_snapshots) als view aangeleverd.
// De renderer doet géén DB-calls; alle data zit in de view.

import {
  type ActionItem,
  type Assumption,
  type AuditSnapshotMeta,
  type BesluitItem,
  type BewijsItem,
  type DecisionDossierView,
  type DissentItem,
  type GovernanceEvent,
  type ProcedureStep,
  type StemverslagSummary,
  ACTION_STATUS_LABEL,
  ASSUMPTION_STATUS_LABEL,
  ASSUMPTION_TYPE_LABEL,
  COMPLEXITEIT_LABEL,
  CONDITION_STATUS_LABEL,
  DECISION_STATUS_LABEL,
  DISSENT_ZICHTBAARHEID_LABEL,
  RISICONIVEAU_LABEL,
  RISK_CATEGORIE_LABEL,
  RISK_STATUS_LABEL,
} from "./decision-view";

export type AuditdossierVersie = "actueel" | "besluitmoment";

interface RenderOpties {
  versie: AuditdossierVersie;
  /** Opwekkings-tijdstip voor de footer. */
  gegenereerdOp?: Date;
  /** Naam van de aanvragende gebruiker (voor audit-spoor). */
  aanvragerNaam?: string | null;
  /** Hash van de gebruikte snapshot, indien versie=besluitmoment. */
  snapshotHash?: string | null;
  /** Tijdstip van de gebruikte snapshot, indien versie=besluitmoment. */
  snapshotAangemaaktOp?: string | null;
}

// ── Hulpfuncties ────────────────────────────────────────────────────

function esc(s: string | null | undefined): string {
  if (s === null || s === undefined) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function fmtDatum(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function fmtDatumTijd(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleString("nl-NL", {
      day: "numeric",
      month: "long",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function jaCheckbox(b: boolean): string {
  return b ? "✓ Ja" : "— Nee";
}

// ── Sectie-renderers ────────────────────────────────────────────────

function renderHeader(view: DecisionDossierView, opties: RenderOpties): string {
  const d = view.decision;
  const versieLabel =
    opties.versie === "besluitmoment"
      ? "Besluitmoment-snapshot"
      : "Live actuele toestand";
  const snapshotMeta =
    opties.versie === "besluitmoment" && opties.snapshotAangemaaktOp
      ? `<div class="meta-item"><span class="label">Snapshot van</span> ${esc(fmtDatumTijd(opties.snapshotAangemaaktOp))}</div>${
          opties.snapshotHash
            ? `<div class="meta-item"><span class="label">Snapshot-hash</span> <code>${esc(opties.snapshotHash.slice(0, 16))}…</code></div>`
            : ""
        }`
      : "";

  return `
<header>
  <div class="versie-badge">${esc(versieLabel)}</div>
  <h1>Auditdossier</h1>
  <div class="besluit-code">${esc(d.besluit_code)}</div>
  <h2>${esc(d.titel)}</h2>
  <div class="meta-grid">
    <div class="meta-item"><span class="label">Status</span> ${esc(DECISION_STATUS_LABEL[d.status])}</div>
    <div class="meta-item"><span class="label">Vertrouwelijkheid</span> ${esc(d.vertrouwelijkheid)}</div>
    <div class="meta-item"><span class="label">Eigenaar</span> ${esc(d.eigenaar_naam ?? "—")}</div>
    <div class="meta-item"><span class="label">Gewenste besluitdatum</span> ${esc(fmtDatum(d.gewenste_besluitdatum))}</div>
    <div class="meta-item"><span class="label">Aangemaakt</span> ${esc(fmtDatumTijd(d.aangemaakt_op))}</div>
    <div class="meta-item"><span class="label">Laatst gewijzigd</span> ${esc(fmtDatumTijd(d.laatst_gewijzigd))}</div>
    ${snapshotMeta}
  </div>
</header>`;
}

function renderBesluitvraagScope(view: DecisionDossierView): string {
  const d = view.decision;
  const aanleiding = d.aanleiding ?? "";
  const scope = d.scope ?? "";
  return `
<section>
  <h3>Besluitvraag &amp; scope</h3>
  <div class="kv">
    <div class="k">Besluitvraag</div>
    <div class="v"><pre>${esc(d.besluitvraag)}</pre></div>
  </div>
  ${aanleiding ? `<div class="kv"><div class="k">Aanleiding</div><div class="v"><pre>${esc(aanleiding)}</pre></div></div>` : ""}
  ${scope ? `<div class="kv"><div class="k">Scope</div><div class="v"><pre>${esc(scope)}</pre></div></div>` : ""}
</section>`;
}

function renderClassificatie(view: DecisionDossierView): string {
  const d = view.decision;
  return `
<section>
  <h3>Classificatie</h3>
  <table class="classificatie">
    <tr><th>Complexiteit</th><td>${esc(COMPLEXITEIT_LABEL[d.complexiteit])}</td></tr>
    <tr><th>Risiconiveau</th><td>${esc(RISICONIVEAU_LABEL[d.risiconiveau])}</td></tr>
    <tr><th>AI-risicoklasse</th><td>${esc(RISICONIVEAU_LABEL[d.ai_risicoklasse])}</td></tr>
    <tr><th>Mandaatgevoelig</th><td>${jaCheckbox(d.mandaatgevoelig)}</td></tr>
    <tr><th>Toezichtgevoelig</th><td>${jaCheckbox(d.toezichtgevoelig)}</td></tr>
    <tr><th>Beleidsafwijking</th><td>${jaCheckbox(d.beleidsafwijking)}</td></tr>
  </table>
</section>`;
}

function renderProcedure(view: DecisionDossierView): string {
  const p = view.procedure;
  const stappenRijen = view.steps
    .map(
      (s) => `
      <tr>
        <td>${s.volgorde}</td>
        <td>${esc(s.naam)}</td>
        <td>${esc(s.status)}</td>
        <td>${jaCheckbox(s.vereist_besluit)}</td>
      </tr>`
    )
    .join("");
  return `
<section>
  <h3>Procedure</h3>
  <div class="kv"><div class="k">Template</div><div class="v">${esc(p.template_code)}</div></div>
  <div class="kv"><div class="k">Procedure-titel</div><div class="v">${esc(p.titel)}</div></div>
  <div class="kv"><div class="k">Status (legacy)</div><div class="v">${esc(p.status)}</div></div>
  <div class="kv"><div class="k">Gestart op</div><div class="v">${esc(fmtDatumTijd(p.gestart_op))}</div></div>
  ${p.deadline ? `<div class="kv"><div class="k">Deadline</div><div class="v">${esc(fmtDatum(p.deadline))}</div></div>` : ""}
  ${p.afgerond_op ? `<div class="kv"><div class="k">Afgerond op</div><div class="v">${esc(fmtDatumTijd(p.afgerond_op))}</div></div>` : ""}
  <table class="stappen">
    <thead><tr><th>Volgorde</th><th>Naam</th><th>Status</th><th>Vereist besluit</th></tr></thead>
    <tbody>${stappenRijen}</tbody>
  </table>
</section>`;
}

function renderBewijs(items: BewijsItem[], steps: ProcedureStep[]): string {
  if (items.length === 0) {
    return `<section><h3>Bewijsstukken</h3><p class="leeg">Geen bewijsstukken vastgelegd.</p></section>`;
  }
  // Groeperen per stap voor leesbaarheid; binnen een stap nieuwste boven.
  const groepen = new Map<string, BewijsItem[]>();
  for (const b of items) {
    const lijst = groepen.get(b.stap_id) ?? [];
    lijst.push(b);
    groepen.set(b.stap_id, lijst);
  }
  const stappenGesorteerd = steps.slice().sort((a, b) => a.volgorde - b.volgorde);
  const blokken = stappenGesorteerd
    .map((s) => {
      const lijst = groepen.get(s.id) ?? [];
      if (lijst.length === 0) return "";
      const rijen = lijst
        .map(
          (b) => `
          <tr>
            <td><pre>${esc(b.titel)}</pre></td>
            <td>${b.documenttype ? esc(b.documenttype) : "—"}</td>
            <td><pre>${esc(b.beschrijving ?? "—")}</pre></td>
            <td>${esc(b.toegevoegd_door_naam ?? "—")}</td>
            <td>${esc(fmtDatumTijd(b.toegevoegd_op))}</td>
            <td>${b.document_id ? `<code>${esc(b.document_id.slice(0, 8))}…</code>` : "—"}</td>
          </tr>`
        )
        .join("");
      return `
      <div class="bewijs-blok">
        <h4 class="bewijs-stap-titel">Stap ${s.volgorde} — ${esc(s.naam)}</h4>
        <table class="lijst">
          <thead>
            <tr>
              <th>Titel</th>
              <th>Documenttype</th>
              <th>Beschrijving</th>
              <th>Toegevoegd door</th>
              <th>Toegevoegd op</th>
              <th>Document-ref</th>
            </tr>
          </thead>
          <tbody>${rijen}</tbody>
        </table>
      </div>`;
    })
    .filter(Boolean)
    .join("");
  // Eventueel bewijs zonder bekende stap (zou niet mogen, maar defensief).
  const bekendeStapIds = new Set(steps.map((s) => s.id));
  const wezen = items.filter((b) => !bekendeStapIds.has(b.stap_id));
  const wezenBlok =
    wezen.length > 0
      ? `<div class="bewijs-blok"><h4 class="bewijs-stap-titel">Bewijs zonder bekende stap-koppeling</h4><table class="lijst"><thead><tr><th>Titel</th><th>Documenttype</th><th>Beschrijving</th><th>Toegevoegd door</th><th>Toegevoegd op</th></tr></thead><tbody>${wezen
          .map(
            (b) => `<tr><td><pre>${esc(b.titel)}</pre></td><td>${b.documenttype ? esc(b.documenttype) : "—"}</td><td><pre>${esc(b.beschrijving ?? "—")}</pre></td><td>${esc(b.toegevoegd_door_naam ?? "—")}</td><td>${esc(fmtDatumTijd(b.toegevoegd_op))}</td></tr>`
          )
          .join("")}</tbody></table></div>`
      : "";
  return `
<section>
  <h3>Bewijsstukken</h3>
  <p class="hint">${items.length} bewijsstuk${items.length === 1 ? "" : "ken"} totaal, gegroepeerd per procedure-stap. Document-ref verwijst naar de FK in <code>documenten</code> en is via de bibliotheek inzichtbaar voor wie toegang heeft.</p>
  ${blokken}
  ${wezenBlok}
</section>`;
}

function renderAannames(items: Assumption[]): string {
  if (items.length === 0) {
    return `<section><h3>Aannames</h3><p class="leeg">Geen aannames vastgelegd.</p></section>`;
  }
  const rijen = items
    .filter((a) => a.status !== "verwijderd")
    .map(
      (a) => `
      <tr class="status-${esc(a.status)}">
        <td><pre>${esc(a.tekst)}</pre></td>
        <td>${esc(ASSUMPTION_TYPE_LABEL[a.type])}</td>
        <td>${esc(ASSUMPTION_STATUS_LABEL[a.status])}</td>
        <td>${a.onzekerheid ? esc(RISICONIVEAU_LABEL[a.onzekerheid]) : "—"}</td>
        <td>${esc(a.evaluatiecriterium ?? "—")}</td>
      </tr>`
    )
    .join("");
  return `
<section>
  <h3>Aannames</h3>
  <table class="lijst">
    <thead><tr><th>Tekst</th><th>Type</th><th>Status</th><th>Onzekerheid</th><th>Evaluatiecriterium</th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</section>`;
}

function renderRisicos(items: DecisionDossierView["risks"]): string {
  if (items.length === 0) {
    return `<section><h3>Risico's</h3><p class="leeg">Geen risico's geregistreerd.</p></section>`;
  }
  const rijen = items
    .map(
      (r) => `
      <tr class="status-${esc(r.status)}">
        <td><pre>${esc(r.beschrijving)}</pre></td>
        <td>${r.categorie ? esc(RISK_CATEGORIE_LABEL[r.categorie]) : "—"}</td>
        <td>${r.impact ?? "—"} × ${r.kans ?? "—"}</td>
        <td>${esc(r.eigenaar_naam ?? "—")}</td>
        <td>${esc(RISK_STATUS_LABEL[r.status])}</td>
        <td><pre>${esc(r.mitigatie ?? "—")}</pre></td>
        <td><pre>${esc(r.residual_risk ?? "—")}</pre></td>
      </tr>`
    )
    .join("");
  return `
<section>
  <h3>Risico's</h3>
  <table class="lijst">
    <thead><tr><th>Beschrijving</th><th>Categorie</th><th>I × K</th><th>Eigenaar</th><th>Status</th><th>Mitigatie</th><th>Restrisico</th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</section>`;
}

function renderVoorwaarden(items: DecisionDossierView["conditions"]): string {
  if (items.length === 0) {
    return `<section><h3>Voorwaarden</h3><p class="leeg">Geen voorwaarden vastgelegd.</p></section>`;
  }
  const rijen = items
    .map(
      (c) => `
      <tr class="status-${esc(c.status)}">
        <td><pre>${esc(c.voorwaarde)}</pre></td>
        <td>${esc(c.kpi ?? "—")}</td>
        <td>${esc(c.drempelwaarde ?? "—")}</td>
        <td>${esc(c.monitorfrequentie ?? "—")}</td>
        <td>${esc(fmtDatum(c.deadline))}</td>
        <td>${esc(CONDITION_STATUS_LABEL[c.status])}</td>
        <td><pre>${esc(c.heroverwegingstrigger ?? "—")}</pre></td>
      </tr>`
    )
    .join("");
  return `
<section>
  <h3>Voorwaarden</h3>
  <table class="lijst">
    <thead><tr><th>Voorwaarde</th><th>KPI</th><th>Drempel</th><th>Monitor</th><th>Deadline</th><th>Status</th><th>Heroverweging</th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</section>`;
}

function renderActies(items: ActionItem[]): string {
  if (items.length === 0) {
    return `<section><h3>Acties</h3><p class="leeg">Geen acties vastgelegd.</p></section>`;
  }
  const rijen = items
    .map(
      (a) => `
      <tr class="status-${esc(a.status)}">
        <td><pre>${esc(a.actie)}</pre></td>
        <td>${esc(a.eigenaar_naam ?? "—")}</td>
        <td>${esc(fmtDatum(a.deadline))}</td>
        <td>${esc(ACTION_STATUS_LABEL[a.status])}</td>
      </tr>`
    )
    .join("");
  return `
<section>
  <h3>Acties</h3>
  <table class="lijst">
    <thead><tr><th>Actie</th><th>Eigenaar</th><th>Deadline</th><th>Status</th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</section>`;
}

function renderDissent(items: DissentItem[]): string {
  if (items.length === 0) {
    return `<section><h3>Dissent</h3><p class="leeg">Geen dissent vastgelegd. Privé-notities van anderen worden hier niet getoond — de RLS heeft die al gefilterd.</p></section>`;
  }
  const rijen = items
    .map(
      (d) => `
      <div class="dissent-blok zichtbaarheid-${esc(d.zichtbaarheid)}">
        <div class="dissent-header">
          <span class="badge">${esc(DISSENT_ZICHTBAARHEID_LABEL[d.zichtbaarheid])}</span>
          ${d.formeel_vastgesteld ? '<span class="badge formeel">Formeel vastgesteld</span>' : ""}
          <span class="auteur">${esc(d.bestuurder_naam)}</span>
          <span class="datum">${esc(fmtDatumTijd(d.aangemaakt_op))}</span>
        </div>
        <div class="standpunt"><pre>${esc(d.standpunt)}</pre></div>
        ${d.argument ? `<div class="argument"><pre>${esc(d.argument)}</pre></div>` : ""}
      </div>`
    )
    .join("");
  return `
<section>
  <h3>Dissent</h3>
  ${rijen}
</section>`;
}

function renderAIInteracties(items: DecisionDossierView["aiOutputs"]): string {
  if (items.length === 0) {
    return `<section><h3>AI-interacties</h3><p class="leeg">Geen AI-interacties vastgelegd voor dit dossier.</p></section>`;
  }
  const rijen = items
    .map((ai) => {
      const bronnenLijst = ai.bronnen
        .map(
          (b) =>
            `<li>${esc(b.titel ?? "Onbekende bron")}${b.paragraaf ? ` · ${esc(b.paragraaf)}` : ""}</li>`
        )
        .join("");
      return `
      <div class="ai-blok status-${esc(ai.validatiestatus)}">
        <div class="ai-header">
          <span class="badge">${esc(ai.type)}</span>
          <span class="badge">Domein: ${esc(ai.validatie_domein)}</span>
          <span class="badge">Status: ${esc(ai.validatiestatus)}</span>
          ${ai.gebruikt_in_dossier ? '<span class="badge gebruikt">Gebruikt in dossier</span>' : ""}
          <span class="datum">${esc(fmtDatumTijd(ai.aangemaakt_op))}</span>
        </div>
        <div class="prompt"><strong>Prompt:</strong> <pre>${esc(ai.prompt)}</pre></div>
        <div class="output"><strong>Output:</strong> <pre>${esc(ai.aangepaste_output ?? ai.output)}</pre></div>
        ${ai.gebruik_context ? `<div class="kv"><div class="k">Gebruikscontext</div><div class="v"><pre>${esc(ai.gebruik_context)}</pre></div></div>` : ""}
        ${ai.verworpen_reden ? `<div class="kv"><div class="k">Verworpen reden</div><div class="v"><pre>${esc(ai.verworpen_reden)}</pre></div></div>` : ""}
        ${bronnenLijst ? `<div class="bronnen"><strong>Bronnen:</strong><ul>${bronnenLijst}</ul></div>` : ""}
      </div>`;
    })
    .join("");
  return `
<section>
  <h3>AI-interacties</h3>
  ${rijen}
</section>`;
}

function renderBesluiten(
  items: BesluitItem[],
  steps: ProcedureStep[]
): string {
  if (items.length === 0) {
    return `<section><h3>Vastgelegde besluiten</h3><p class="leeg">Nog geen besluiten vastgelegd.</p></section>`;
  }
  const stapNaam = new Map<string, string>();
  for (const s of steps) stapNaam.set(s.id, `Stap ${s.volgorde} — ${s.naam}`);
  const blokken = items
    .map((b) => {
      const alternatievenLijst =
        b.verworpen_alternatieven && b.verworpen_alternatieven.length > 0
          ? `<div class="alternatieven"><strong>Verworpen alternatieven:</strong><ul>${b.verworpen_alternatieven.map((a) => `<li><pre>${esc(a)}</pre></li>`).join("")}</ul></div>`
          : "";
      const stapInfo = b.stap_id
        ? stapNaam.get(b.stap_id) ?? `Stap-id ${b.stap_id.slice(0, 8)}`
        : "Niet aan stap gekoppeld";
      return `
      <div class="besluit-blok">
        <div class="besluit-header">
          <span class="badge">${esc(stapInfo)}</span>
          <span class="datum">${esc(fmtDatum(b.datum))}</span>
          ${b.vastgelegd_door_naam ? `<span class="auteur">${esc(b.vastgelegd_door_naam)}</span>` : ""}
        </div>
        <div class="besluit-formulering"><pre>${esc(b.formulering)}</pre></div>
        ${b.motivering ? `<div class="kv"><div class="k">Motivering</div><div class="v"><pre>${esc(b.motivering)}</pre></div></div>` : ""}
        ${alternatievenLijst}
      </div>`;
    })
    .join("");
  return `
<section>
  <h3>Vastgelegde besluiten</h3>
  <p class="hint">${items.length} besluit${items.length === 1 ? "" : "en"}, met motivering en expliciet verworpen alternatieven. Volgorde: nieuwste boven.</p>
  ${blokken}
</section>`;
}

interface UitslagShape {
  totalen?: Record<string, number>;
  totaal_stemmen?: number;
  totaal_bestuursleden?: number;
  quorum_status?: string;
  meerderheid_status?: string;
  winnend_alternatief?: string | null;
  per_stemgerechtigde?: {
    naam: string | null;
    keuze: string;
    motivering: string | null;
    is_volmacht: boolean;
    uitgebracht_door_naam: string | null;
  }[];
}

function renderStemverslagen(items: StemverslagSummary[]): string {
  if (items.length === 0) {
    return "";
  }
  const blokken = items
    .map((s) => {
      const alt = (s.alternatieven ?? []) as { code: string; label: string }[];
      const labelVan = (code: string) =>
        alt.find((a) => a.code === code)?.label ?? code;

      if (s.status === "ingetrokken") {
        return `
        <div class="besluit-blok">
          <div class="besluit-header">
            <span class="badge">Ingetrokken</span>
            <span class="datum">${esc(fmtDatumTijd(s.gesloten_op))}</span>
          </div>
          <div class="besluit-formulering"><pre>${esc(s.vraag)}</pre></div>
          ${s.ingetrokken_reden ? `<div class="kv"><div class="k">Reden</div><div class="v"><pre>${esc(s.ingetrokken_reden)}</pre></div></div>` : ""}
        </div>`;
      }

      const u = (s.uitslag ?? {}) as UitslagShape;
      const winnaar = u.winnend_alternatief
        ? labelVan(u.winnend_alternatief)
        : "geen eenduidige uitslag";
      const totalenRijen = Object.entries(u.totalen ?? {})
        .map(([code, n]) => `<li>${esc(labelVan(code))}: ${n}</li>`)
        .join("");
      const perPersoon = (u.per_stemgerechtigde ?? [])
        .map(
          (p) =>
            `<tr>
              <td>${esc(p.naam ?? "Onbekend")}${p.is_volmacht ? ` <em>(volmacht via ${esc(p.uitgebracht_door_naam ?? "?")})</em>` : ""}</td>
              <td>${esc(labelVan(p.keuze))}</td>
              <td><pre>${esc(p.motivering ?? "—")}</pre></td>
            </tr>`
        )
        .join("");

      return `
      <div class="besluit-blok">
        <div class="besluit-header">
          <span class="badge">Gesloten</span>
          <span class="datum">${esc(fmtDatumTijd(s.gesloten_op))}</span>
        </div>
        <div class="besluit-formulering"><pre>${esc(s.vraag)}</pre></div>
        <div class="kv"><div class="k">Uitslag</div><div class="v"><strong>${esc(winnaar)}</strong></div></div>
        <div class="alternatieven"><strong>Totalen:</strong><ul>${totalenRijen}</ul></div>
        <div class="kv"><div class="k">Quorum</div><div class="v">${esc(u.quorum_status ?? "niet ingesteld")}</div></div>
        <div class="kv"><div class="k">Meerderheid</div><div class="v">${esc(u.meerderheid_status ?? "niet ingesteld")}</div></div>
        ${
          perPersoon
            ? `<table><thead><tr><th>Bestuurslid</th><th>Keuze</th><th>Motivering</th></tr></thead><tbody>${perPersoon}</tbody></table>`
            : ""
        }
      </div>`;
    })
    .join("");

  return `
<section>
  <h3>Stemverslagen</h3>
  <p class="hint">${items.length} stemverslag${items.length === 1 ? "" : "en"} (gesloten of ingetrokken). Het systeem rapporteert de ingevoerde quorum- en meerderheidstoets; formele rechtsgeldigheid wordt niet zelfstandig vastgesteld.</p>
  ${blokken}
</section>`;
}

function renderEvaluaties(items: DecisionDossierView["evaluations"]): string {
  if (items.length === 0) {
    return "";
  }
  const rijen = items
    .map(
      (e) => `
      <tr>
        <td>${esc(fmtDatum(e.geplande_datum))}</td>
        <td>${esc(fmtDatumTijd(e.uitgevoerd_op))}</td>
        <td><pre>${esc(e.verwachte_effecten ?? "—")}</pre></td>
        <td><pre>${esc(e.realisatie ?? "—")}</pre></td>
        <td><pre>${esc(e.conclusie ?? "—")}</pre></td>
      </tr>`
    )
    .join("");
  return `
<section>
  <h3>Evaluaties</h3>
  <table class="lijst">
    <thead><tr><th>Geplande datum</th><th>Uitgevoerd op</th><th>Verwachte effecten</th><th>Realisatie</th><th>Conclusie</th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</section>`;
}

function renderSnapshots(items: AuditSnapshotMeta[]): string {
  if (items.length === 0) return "";
  const rijen = items
    .map(
      (s) => `
      <tr>
        <td>${esc(fmtDatumTijd(s.aangemaakt_op))}</td>
        <td>${esc(s.trigger_status)}</td>
        <td><code>${esc(s.hash.slice(0, 16))}…</code></td>
      </tr>`
    )
    .join("");
  return `
<section>
  <h3>Audit-snapshots</h3>
  <p class="hint">Onveranderlijke kopieën van het dossier op kritische statusovergangen. Hash voor integriteitscontrole.</p>
  <table class="lijst">
    <thead><tr><th>Tijdstip</th><th>Trigger-status</th><th>Hash (sha256, eerste 16 chars)</th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</section>`;
}

function renderEvents(items: GovernanceEvent[]): string {
  if (items.length === 0) {
    return `<section><h3>Audit-trail</h3><p class="leeg">Geen events vastgelegd.</p></section>`;
  }
  const rijen = items
    .map(
      (e) => `
      <tr>
        <td>${esc(fmtDatumTijd(e.tijdstip))}</td>
        <td>${esc(e.event_type)}</td>
        <td>${esc(e.actor_naam ?? "—")}</td>
        <td>${esc(e.object_type ?? "—")}</td>
        <td>${esc(e.reden ?? "—")}</td>
        <td><code>${esc(e.hash.slice(0, 12))}…</code></td>
      </tr>`
    )
    .join("");
  return `
<section>
  <h3>Audit-trail</h3>
  <p class="hint">Append-only governance-events. Hash per event voor integriteit.</p>
  <table class="lijst">
    <thead><tr><th>Tijdstip</th><th>Event-type</th><th>Actor</th><th>Object</th><th>Reden</th><th>Hash</th></tr></thead>
    <tbody>${rijen}</tbody>
  </table>
</section>`;
}

// ── Hoofdfunctie ────────────────────────────────────────────────────

export function renderAuditdossierHtml(
  view: DecisionDossierView,
  opties: RenderOpties
): string {
  const gegen = opties.gegenereerdOp ?? new Date();
  const aanvrager = opties.aanvragerNaam ? esc(opties.aanvragerNaam) : "—";

  return `<!DOCTYPE html>
<html lang="nl">
<head>
  <meta charset="UTF-8" />
  <title>Auditdossier — ${esc(view.decision.besluit_code)} — ${esc(view.decision.titel)}</title>
  <style>
    /* Print-vriendelijk: A4-staand, voldoende contrast, geen kleurvulling
       achter koppen om printer-toner te sparen. */
    @page { size: A4; margin: 18mm 16mm; }
    * { box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      font-size: 11pt;
      line-height: 1.45;
      color: #1f2937;
      max-width: 210mm;
      margin: 0 auto;
      padding: 12mm;
    }
    header {
      border-bottom: 2px solid #0F2744;
      padding-bottom: 8mm;
      margin-bottom: 8mm;
    }
    header .versie-badge {
      display: inline-block;
      font-size: 9pt;
      letter-spacing: 0.06em;
      text-transform: uppercase;
      color: #0F2744;
      background: #f3e8a4;
      padding: 2pt 6pt;
      border-radius: 3pt;
      margin-bottom: 4pt;
    }
    h1 { font-size: 18pt; margin: 0 0 2pt 0; color: #0F2744; }
    .besluit-code { font-family: "Menlo", "Courier New", monospace; font-size: 10pt; color: #6b7280; margin-bottom: 4pt; }
    h2 { font-size: 14pt; margin: 0 0 8pt 0; color: #0F2744; font-weight: 600; }
    h3 { font-size: 12pt; margin: 6mm 0 3mm 0; color: #0F2744; border-bottom: 1px solid #d1d5db; padding-bottom: 2pt; }
    section { page-break-inside: avoid; margin-bottom: 6mm; }
    .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4pt 12pt; font-size: 10pt; }
    .meta-item .label { display: block; font-size: 8.5pt; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; font-weight: 600; }
    .kv { display: grid; grid-template-columns: 30mm 1fr; gap: 6pt; margin-bottom: 3pt; align-items: start; }
    .k { font-size: 9pt; text-transform: uppercase; letter-spacing: 0.05em; color: #6b7280; font-weight: 600; padding-top: 1pt; }
    .v pre { font-family: inherit; white-space: pre-wrap; margin: 0; }
    pre { font-family: inherit; white-space: pre-wrap; margin: 0; }
    table { width: 100%; border-collapse: collapse; font-size: 10pt; margin-top: 2pt; }
    th, td { text-align: left; vertical-align: top; padding: 4pt 6pt; border-bottom: 1px solid #e5e7eb; }
    th { background: #f9fafb; color: #0F2744; font-weight: 600; font-size: 9.5pt; text-transform: uppercase; letter-spacing: 0.04em; }
    td pre { margin: 0; }
    table.classificatie th { width: 40mm; }
    table.classificatie td { font-weight: 500; }
    .leeg { color: #9ca3af; font-style: italic; font-size: 10pt; }
    .hint { font-size: 9.5pt; color: #6b7280; font-style: italic; margin-bottom: 3pt; }
    .dissent-blok { border-left: 3pt solid #f59e0b; padding: 4pt 8pt; margin-bottom: 4pt; background: #fffbeb; page-break-inside: avoid; }
    .dissent-blok.zichtbaarheid-formele_dissent { border-left-color: #ef4444; background: #fef2f2; }
    .dissent-blok.zichtbaarheid-minderheidsnotitie { border-left-color: #7c3aed; background: #faf5ff; }
    .dissent-header { font-size: 9pt; color: #4b5563; margin-bottom: 2pt; }
    .dissent-header .badge { display: inline-block; padding: 1pt 4pt; background: #fff; border: 1px solid #d1d5db; border-radius: 2pt; margin-right: 4pt; font-size: 8.5pt; font-weight: 500; }
    .dissent-header .badge.formeel { background: #ede9fe; border-color: #c4b5fd; color: #5b21b6; }
    .dissent-header .auteur { font-weight: 600; margin-right: 6pt; }
    .dissent-header .datum { color: #6b7280; }
    .standpunt { font-weight: 500; margin: 2pt 0; }
    .argument { font-size: 10pt; color: #374151; margin-top: 2pt; }
    .ai-blok { border: 1px solid #e5e7eb; border-radius: 3pt; padding: 6pt 8pt; margin-bottom: 4pt; page-break-inside: avoid; }
    .ai-blok.status-gevalideerd { border-left: 3pt solid #10b981; }
    .ai-blok.status-aangepast { border-left: 3pt solid #3b82f6; }
    .ai-blok.status-afgekeurd { border-left: 3pt solid #ef4444; }
    .ai-header { font-size: 9pt; color: #4b5563; margin-bottom: 3pt; }
    .ai-header .badge { display: inline-block; padding: 1pt 4pt; background: #f3f4f6; border: 1px solid #d1d5db; border-radius: 2pt; margin-right: 4pt; font-size: 8.5pt; }
    .ai-header .badge.gebruikt { background: #d1fae5; border-color: #6ee7b7; color: #065f46; }
    .prompt, .output { font-size: 10pt; margin: 3pt 0; }
    .bronnen { font-size: 9.5pt; margin-top: 3pt; }
    .bronnen ul { margin: 1pt 0; padding-left: 16pt; }
    .besluit-blok { border-left: 3pt solid #0F2744; padding: 4pt 10pt; margin-bottom: 6pt; background: #f8fafc; page-break-inside: avoid; }
    .besluit-header { font-size: 9pt; color: #4b5563; margin-bottom: 3pt; }
    .besluit-header .badge { display: inline-block; padding: 1pt 4pt; background: #fff; border: 1px solid #d1d5db; border-radius: 2pt; margin-right: 4pt; font-size: 8.5pt; }
    .besluit-header .datum { color: #6b7280; margin-right: 6pt; }
    .besluit-header .auteur { font-weight: 600; color: #374151; }
    .besluit-formulering { font-weight: 600; font-size: 11pt; color: #0F2744; margin: 3pt 0; }
    .besluit-formulering pre { font-weight: 600; }
    .bewijs-blok { margin-bottom: 4mm; page-break-inside: avoid; }
    .bewijs-stap-titel { font-size: 10.5pt; margin: 3pt 0 2pt 0; color: #0F2744; font-weight: 600; }
    .bewijs-blok .lijst { font-size: 9.5pt; }
    .alternatieven { font-size: 9.5pt; color: #4b5563; margin-top: 4pt; }
    .alternatieven ul { margin: 1pt 0; padding-left: 16pt; }
    code { font-family: "Menlo", "Courier New", monospace; font-size: 9pt; background: #f3f4f6; padding: 0 2pt; border-radius: 1pt; }
    footer { margin-top: 10mm; padding-top: 4mm; border-top: 1px solid #d1d5db; font-size: 9pt; color: #6b7280; }
    /* Status-tinten in tabellen, subtiel */
    tr.status-gevalideerd td, tr.status-vervuld td, tr.status-afgerond td, tr.status-gemitigeerd td { background: #f0fdf4; }
    tr.status-overschreden td, tr.status-escalatie td { background: #fef2f2; }
  </style>
</head>
<body>
  ${renderHeader(view, opties)}
  ${renderBesluitvraagScope(view)}
  ${renderClassificatie(view)}
  ${renderProcedure(view)}
  ${renderBewijs(view.bewijs ?? [], view.steps)}
  ${renderAannames(view.assumptions)}
  ${renderRisicos(view.risks)}
  ${renderVoorwaarden(view.conditions)}
  ${renderActies(view.actions)}
  ${renderDissent(view.dissent)}
  ${renderAIInteracties(view.aiOutputs)}
  ${renderBesluiten(view.besluiten ?? [], view.steps)}
  ${renderStemverslagen(view.stemverslagen ?? [])}
  ${renderEvaluaties(view.evaluations)}
  ${renderSnapshots(view.snapshots)}
  ${renderEvents(view.events)}
  <footer>
    <div>Gegenereerd op ${esc(fmtDatumTijd(gegen.toISOString()))} · Aangevraagd door ${aanvrager}</div>
    <div>Bestuurdersportaal — Decision Object MVP-1 · ${esc(view.decision.besluit_code)}</div>
  </footer>
</body>
</html>`;
}
