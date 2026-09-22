// ============================================================================
//  #426 T4-E — de Copilot-adapter: een DUNNE wrapper, geen tweede implementatie.
// ----------------------------------------------------------------------------
//  Alles wat beveiliging raakt staat al ergens anders en wordt hier uitsluitend
//  AANGEROEPEN:
//    • T4-C (`keten.ts`) doet de rootgrens, de registeropzoeking, de verse
//      DriveItem-bevestiging, de begrensde download, de eigen extractie, de
//      tweede scope- en versiecontrole en de unieke lokalisatie;
//    • T4-D (`copilot-tokenbron.ts`) doet readiness, tokenbewijs en de
//      herlezing daarvan, in die vaste volgorde.
//  Deze module dupliceert daar niets van. Wat zij toevoegt is de VERTALING naar
//  het providerneutrale contract, en dat is precies waar de fout gemaakt kan
//  worden: een toegangsbewijs dat hier zou worden VERZONNEN in plaats van
//  afgeleid, zou de centrale poort een venster laten toetsen dat nooit is
//  gecontroleerd. Daarom komt elk veld van `Toegangsbewijs` uit
//  `KetenTreffer.grondslag` — vastgesteld bij de laatste geslaagde
//  grondslagcontrole in de keten zelf.
//
//  INERT. Deze adapter doet geen enkele aanroep zolang de rolloutpoorten dicht
//  staan: `beoordeelToelating()` beslist dat, en bij `uit` wordt er geen token
//  gevraagd en geen Retrieval-call gedaan.
// ============================================================================
import type {
  AdapterCapabilities,
  AdapterUitkomst,
  Bronregistratiestand,
  Bronresultaat,
  RetrievalAdapter,
  RetrievalContext,
  RetrievalQuery,
} from "../retrieval/contract";
import { maakDocumentIdentiteit, maakPassageIdentiteit } from "../retrieval/identiteit";
import { beoordeelToelating, type CopilotToelatingDeps } from "./copilot-tokenbron";
import { voerKetenUit, type KetenOpdracht, type KetenTreffer } from "./keten";
import type { BronSnapshot } from "./driveitem";

/**
 * Wat de adapter van buiten krijgt. Niets hiervan wordt hier gelezen uit env of
 * database: de route stelt het samen, zodat er geen tokenbron of service-role in
 * een fonds- of tenantroute belandt.
 */
export interface CopilotAdapterDeps {
  /** T4-D: readiness, tokenbewijs en de herlezing daarvan. */
  toelating: CopilotToelatingDeps;
  /** De bronregistratie zoals die bij aanvang van de beurt geldt. */
  bron: BronSnapshot;
  /** T4-C-injecties: Graph-lezer, register, kandidatenbron, bronherlezing. */
  keten: Pick<KetenOpdracht, "leesItem" | "zoekRegister" | "haalKandidaten" | "herleesBron" | "grenzen">;
  /** Hoeveel van het beurtbudget de keten mag gebruiken; uit `grendel.resterendMs()`. */
  resterendMs?: () => number;
  /** Uitsluitend voor tests; productie gebruikt `voerKetenUit` uit T4-C. */
  ketenImpl?: typeof voerKetenUit;
}

export const COPILOT_CAPABILITIES: AdapterCapabilities = {
  bronsoorten: ["sharepoint"],
  strategieen: ["gericht", "volledig"],
  // Filters die deze arm WERKELIJK kan honoreren. Een filter dat hier niet in
  // staat is een fout en nooit een stille no-op — anders zoekt de arm breder
  // dan gevraagd en ziet niemand het.
  ondersteundeFilters: ["modus"],
  versiebewijs: true,
  // Fail-closed: geen gedegradeerde soorten. De keten levert eTag of cTag, of
  // zij levert de treffer niet.
  versiebeleid: { sterk: ["etag", "ctag"], gedegradeerd: [] },
  permissionProof: true,
  preview: false,
  cancellation: true,
  timeout: true,
};

/** Inhoudsvrije vertaling van een gesloten weigergrond naar een contractfout. */
function foutVoorReden(reden: string): AdapterUitkomst["fout"] {
  switch (reden) {
    case "uit":
      // Bewust uit is GEEN fout: er is niets gevraagd. De orkestratielaag hoort
      // dit spoor dan niet eens aan te maken; komt het er toch, dan is de
      // uitkomst leeg en stil.
      return undefined;
    case "tokenbewijs_ongeldig":
    case "readiness_gewijzigd":
      return "toestemming_geweigerd";
    case "tokenbron_onbereikbaar":
      return "providerfout";
    default:
      return "configuratiefout";
  }
}

/**
 * Vertaalt één treffer naar het providerneutrale contract.
 *
 * ELK BEWIJSVELD KOMT UIT `grondslag`. Zou `gecontroleerdOp` hier op
 * `new Date()` worden gezet, dan beschrijft V4 het moment waarop deze functie
 * draaide in plaats van het moment waarop de grondslag is vastgesteld — en dan
 * bewaakt dat venster niets.
 */
function alsBronresultaat(
  treffer: KetenTreffer,
  ctx: RetrievalContext,
  bron: BronSnapshot
): Bronresultaat {
  const namespace = `fonds:${ctx.fondsId}:sharepoint`;
  const documentId = maakDocumentIdentiteit(namespace, treffer.ref);
  const passageId = maakPassageIdentiteit(
    documentId,
    `pagina:${treffer.pagina ?? "-"}|paragraaf:${treffer.paragraaf ?? "-"}|volgorde:${treffer.volgorde}`
  );
  const gebruikerId = ctx.actor.soort === "gebruiker" ? ctx.actor.id : "";
  return {
    ref: passageId,
    bronsoort: "sharepoint",
    titel: treffer.naam,
    documentIdentiteit: {
      id: documentId,
      bibliotheek: "sharepoint",
      bron: "SharePoint",
      fondsId: ctx.fondsId,
    },
    passageIdentiteit: { id: passageId },
    versie: {
      soort: treffer.versie.soort,
      waarde: treffer.versie.waarde,
      // De versie is bevestigd in hetzelfde venster waarin de grondslag is
      // vastgesteld: de tweede DriveItem-lezing gaat er direct aan vooraf.
      gecontroleerdOp: treffer.grondslag.vastgesteldOp,
    },
    bronregistratieRef: treffer.grondslag.bronregistratieRef,
    toegangscontrole: {
      toegestaan: true,
      // Gebonden aan DEZE kandidaat; de poort eist gelijkheid met `ref`.
      resultaatRef: passageId,
      bronregistratieRef: treffer.grondslag.bronregistratieRef,
      gebruikerId,
      correlationId: ctx.correlationId,
      gecontroleerdOp: treffer.grondslag.vastgesteldOp,
      basis: "delegated_user",
      bronconfiguratieVersie: treffer.grondslag.configuratieversie,
    },
    locator: { pagina: treffer.pagina, paragraaf: treffer.paragraaf, mappad: treffer.mappad },
    // UIT DE EIGEN EXTRACTIE. Het Microsoft-extract is in T4-C een aanwijzer
    // geweest en komt hier niet voor.
    passage: treffer.passage,
    status: { bronstatus: bron.status, actueel: true },
    rang: { positie: treffer.volgorde },
    weergave: { bestandstype: treffer.bestandstype, opslagPad: treffer.mappad },
  };
}

export function maakCopilotAdapter(deps: CopilotAdapterDeps): RetrievalAdapter {
  return {
    naam: "microsoft-sharepoint",
    capabilities: () => COPILOT_CAPABILITIES,

    async zoek(ctx: RetrievalContext, _query: RetrievalQuery): Promise<AdapterUitkomst> {
      const t0 = Date.now();
      const gebruikerId = ctx.actor.soort === "gebruiker" ? ctx.actor.id : "";
      const toelating = await beoordeelToelating(deps.toelating, {
        fondsId: ctx.fondsId,
        gebruikerId,
      });
      if (!toelating.toegelaten) {
        // GEEN Retrieval-call, geen tokenaanvraag voorbij dit punt.
        return {
          kandidaten: [],
          methode: "geen",
          provider: "geen",
          latencyMs: Date.now() - t0,
          opgehaald: 0,
          ...(foutVoorReden(toelating.reden) ? { fout: foutVoorReden(toelating.reden) } : {}),
        };
      }

      const resterend = deps.resterendMs?.();
      const draaiKeten = deps.ketenImpl ?? voerKetenUit;
      const uitkomst = await draaiKeten({
        bron: deps.bron,
        tokenTenantId: toelating.token.bevestigd.tenantId,
        accessToken: toelating.token.accessToken,
        leesItem: deps.keten.leesItem,
        zoekRegister: deps.keten.zoekRegister,
        haalKandidaten: deps.keten.haalKandidaten,
        herleesBron: deps.keten.herleesBron,
        signal: ctx.signal,
        grenzen: {
          ...(deps.keten.grenzen ?? {}),
          // Het budget van de BEURT wint van de eigen default van de keten.
          ...(resterend !== undefined && resterend > 0 ? { deadlineMs: resterend } : {}),
        },
      });

      if (!uitkomst.ok) {
        return {
          kandidaten: [],
          methode: "geen",
          provider: "microsoft",
          latencyMs: Date.now() - t0,
          opgehaald: 0,
          fout: "configuratiefout",
        };
      }

      const kandidaten = uitkomst.treffers.map((t) => alsBronresultaat(t, ctx, deps.bron));

      return {
        kandidaten,
        methode: "sharepoint_live",
        provider: "microsoft",
        latencyMs: Date.now() - t0,
        opgehaald: uitkomst.telling.documenten,
        // Een afgekapte beurt is geen volledige uitslag; dat mag niet stil zijn.
        ...(uitkomst.telling.deadlineVerlopen ? { truncatie: { reden: "tijd" as const } } : {}),
      };
    },

    /**
     * V5 — de ACTUELE stand van de bronregistratie, herlezen binnen dit verzoek.
     *
     * De keten heeft haar eigen grondslagcontrole al gedaan, maar die lag vóór
     * de centrale poort. Tussen die twee momenten kan een intrekking vallen, en
     * juist dat is wat V5 moet vangen — dus opnieuw lezen, niet vergelijken met
     * wat de keten onthield.
     */
    async verifieerBronregistratie(_ctx, refs): Promise<Map<string, Bronregistratiestand>> {
      const nu = await deps.keten.herleesBron();
      const stand: Bronregistratiestand = nu && nu.status === "actief"
        ? { verbonden: true, versie: nu.configuratieversie }
        : { verbonden: false, versie: -1 };
      return new Map(refs.map((ref) => [ref, stand]));
    },
  };
}
