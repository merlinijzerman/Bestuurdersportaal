import "server-only";
import { randomUUID } from "node:crypto";
import { MicrosoftConnectorError, microsoftTestFoutcategorie } from "@/core/lib/microsoft-connector-error-core";
import { outlookAccessToken, type ConnectorContext } from "@/core/lib/microsoft-connector";
import * as vault from "@/core/lib/microsoft-vault";

type GraphCalendar = { id?: string; name?: string; canEdit?: boolean; canShare?: boolean; owner?: unknown };
type GraphEvent = {
  id?: string; iCalUId?: string; changeKey?: string; seriesMasterId?: string; subject?: string;
  start?: { dateTime?: string; timeZone?: string }; end?: { dateTime?: string; timeZone?: string };
  location?: { displayName?: string | null }; onlineMeeting?: { joinUrl?: string | null } | null;
  onlineMeetingUrl?: string | null; sensitivity?: string; isCancelled?: boolean;
  attendees?: Array<{ emailAddress?: { address?: string | null } | null }>;
  "@removed"?: unknown;
};
type GraphDelta = { value?: GraphEvent[]; "@odata.nextLink"?: string; "@odata.deltaLink"?: string };

export class OutlookGraphError extends Error {
  constructor(readonly categorie: string, cause?: unknown) { super(categorie, { cause }); this.name = "OutlookGraphError"; }
}
const GRAPH = "https://graph.microsoft.com/v1.0";
const MAX_RETRIES = 2;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

function veiligeGraphUrl(url: string): URL {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || parsed.hostname !== "graph.microsoft.com" || !parsed.pathname.startsWith("/v1.0/")) throw new OutlookGraphError("graph_url");
  return parsed;
}
function retryNa(response: Response): number {
  const raw = response.headers.get("Retry-After");
  if (!raw) return 1000;
  const seconden = Number.parseInt(raw, 10);
  return Number.isSafeInteger(seconden) && seconden >= 0 ? Math.min(seconden * 1000, 30_000) : 1000;
}
async function graphGet(accessToken: string, url: string): Promise<Response> {
  const veilig = veiligeGraphUrl(url).toString();
  for (let poging = 0; ; poging += 1) {
    const response = await fetch(veilig, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        // Event-ID's zijn hoofdlettergevoelig; de header staat op ELKE delta-pagina.
        Prefer: 'IdType="ImmutableId", outlook.timezone="UTC", odata.maxpagesize=50',
      }, cache: "no-store",
    });
    if ((response.status === 429 || response.status === 503 || response.status === 504) && poging < MAX_RETRIES) {
      await sleep(retryNa(response));
      continue;
    }
    if (!response.ok) {
      if (response.status === 401 || response.status === 403) throw new OutlookGraphError("toestemming_of_token");
      if (response.status === 429) throw new OutlookGraphError("graph_ratelimit");
      if (response.status === 410) throw new OutlookGraphError("delta_verlopen");
      throw new OutlookGraphError("graph_response");
    }
    return response;
  }
}
function isoUtc(value: GraphEvent["start"]): { iso: string; tijdzone: string } | undefined {
  if (!value?.dateTime) return undefined;
  // De request-header vraagt UTC. Daardoor zijn zomer-/wintertijd-overgangen in
  // de bron eenduidig voordat de portaalweergave naar lokale tijd formatteert.
  const raw = value.dateTime.endsWith("Z") ? value.dateTime : `${value.dateTime}Z`;
  const datum = new Date(raw);
  if (Number.isNaN(datum.getTime())) return undefined;
  return { iso: datum.toISOString(), tijdzone: "Etc/UTC" };
}
function sensitivity(value: string | undefined): "normal" | "personal" | "private" | "confidential" {
  return value === "personal" || value === "private" || value === "confidential" ? value : "normal";
}
function telDeelnemers(event: GraphEvent, userPrincipalName: string | null): { lokaal: string[]; onbekend: number } {
  const adressen = event.attendees?.map((x) => x.emailAddress?.address?.trim().toLowerCase()).filter((x): x is string => !!x) ?? [];
  // Fase 1 bewaart bewust geen volledige UPN. Tijdens deze run kunnen we alleen
  // de ingelogde, al gekoppelde fondsgebruiker veilig aan zijn profiel koppelen.
  const eigen = userPrincipalName?.trim().toLowerCase();
  return { lokaal: eigen && adressen.includes(eigen) ? ["__CURRENT_USER__"] : [], onbekend: adressen.filter((x) => x !== eigen).length };
}

export async function outlookAgendaLijst(ctx: ConnectorContext) {
  const { accessToken, tenantId, mailboxId } = await outlookAccessToken(ctx);
  const response = await graphGet(accessToken, `${GRAPH}/me/calendars?$select=id,name,canEdit,canShare`);
  const body = await response.json() as { value?: GraphCalendar[] };
  return {
    tenantId, mailboxId,
    agendas: (body.value ?? []).flatMap((agenda) => agenda.id && agenda.name ? [{ id: agenda.id, naam: agenda.name.slice(0, 160) }] : []),
  };
}

export async function kiesOutlookAgenda(ctx: ConnectorContext, calendarId: string) {
  const lijst = await outlookAgendaLijst(ctx);
  const agenda = lijst.agendas.find((x) => x.id === calendarId);
  if (!agenda) throw new OutlookGraphError("agenda_niet_toegankelijk");
  const nu = new Date();
  const start = new Date(Date.UTC(nu.getUTCFullYear(), nu.getUTCMonth() - 3, nu.getUTCDate())).toISOString().slice(0, 10);
  const eind = new Date(Date.UTC(nu.getUTCFullYear() + 1, nu.getUTCMonth(), nu.getUTCDate())).toISOString().slice(0, 10);
  await vault.configureerOutlookAgenda({ fondsId: ctx.fondsId, gebruikerId: ctx.gebruikerId, tenantId: lijst.tenantId, mailboxId: lijst.mailboxId, calendarId: agenda.id, naam: agenda.naam, vensterStart: start, vensterEind: eind });
}

export async function outlookStatus(ctx: ConnectorContext) {
  const [verbinding, configuratie] = await Promise.all([vault.leesVerbinding(ctx.fondsId, ctx.gebruikerId), vault.leesOutlookConfiguratie(ctx.fondsId, ctx.gebruikerId)]);
  return {
    toestemmingVereist: !verbinding?.scopes.includes("Calendars.Read.Shared"),
    configuratie: configuratie ? { agenda: configuratie.calendar_naam, status: configuratie.status, laatstGeluktOp: configuratie.laatst_gelukt_op, foutcategorie: configuratie.laatst_foutcategorie } : null,
  };
}

export async function synchroniseerOutlookAgenda(ctx: ConnectorContext) {
  const { accessToken } = await outlookAccessToken(ctx);
  const run = await vault.startOutlookRun(ctx.fondsId, ctx.gebruikerId, randomUUID());
  if (!run) throw new OutlookGraphError("agenda_niet_geconfigureerd");
  let gelezen = 0, aangemaakt = 0, bijgewerkt = 0, overgeslagen = 0;
  try {
    const me = await graphGet(accessToken, `${GRAPH}/me?$select=userPrincipalName`);
    const userPrincipalName = ((await me.json()) as { userPrincipalName?: string }).userPrincipalName ?? null;
    let volgende = run.delta_link ?? `${GRAPH}/me/calendars/${encodeURIComponent(run.calendar_id)}/calendarView/delta?startDateTime=${encodeURIComponent(`${run.venster_start}T00:00:00Z`)}&endDateTime=${encodeURIComponent(`${run.venster_eind}T00:00:00Z`)}`;
    let definitieveDeltaLink: string | undefined;
    while (volgende) {
      const response = await graphGet(accessToken, volgende);
      const pagina = await response.json() as GraphDelta;
      for (const event of pagina.value ?? []) {
        gelezen += 1;
        // @removed is géén bewijs dat een afspraak uit het vaste venster is
        // verdwenen: Graph kan hem buiten het venster hebben verplaatst.
        if (event["@removed"] || !event.id) { overgeslagen += 1; continue; }
        const start = isoUtc(event.start), eind = isoUtc(event.end);
        if (!start || !eind) { overgeslagen += 1; continue; }
        const deelnemers = telDeelnemers(event, userPrincipalName);
        const resultaat = await vault.verwerkOutlookEvent({
          runId: run.run_id, eventId: event.id, iCalUId: event.iCalUId ?? null, changeKey: event.changeKey ?? null, serieMasterId: event.seriesMasterId ?? null,
          titel: event.subject?.slice(0, 240) ?? "", start: start.iso, eind: eind.iso, tijdzone: start.tijdzone,
          locatie: event.location?.displayName?.slice(0, 240) ?? "", teamsLink: event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl ?? "",
          sensitivity: sensitivity(event.sensitivity), geannuleerd: event.isCancelled === true,
          lokaleDeelnemers: deelnemers.lokaal.map(() => ctx.gebruikerId), onbekendeDeelnemers: deelnemers.onbekend,
        });
        if (resultaat === "aangemaakt") aangemaakt += 1;
        else if (resultaat === "bijgewerkt" || resultaat === "afgeschermd") bijgewerkt += 1;
        else overgeslagen += 1;
      }
      if (pagina["@odata.deltaLink"]) definitieveDeltaLink = pagina["@odata.deltaLink"];
      volgende = pagina["@odata.nextLink"] ?? "";
    }
    if (!definitieveDeltaLink) throw new OutlookGraphError("delta_onvolledig");
    await vault.voltooiOutlookRun(run.run_id, definitieveDeltaLink, { gelezen, aangemaakt, bijgewerkt, overgeslagen });
    return { gelezen, aangemaakt, bijgewerkt, overgeslagen };
  } catch (fout) {
    const categorie = fout instanceof OutlookGraphError ? fout.categorie : microsoftTestFoutcategorie(fout);
    await vault.mislukOutlookRun(run.run_id, categorie).catch(() => undefined);
    throw fout;
  }
}
