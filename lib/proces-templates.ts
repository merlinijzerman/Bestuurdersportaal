// Procestemplates — bron-van-waarheid voor de standaard procesflows.
// In iteratie 1 leven templates hier in code; bij het starten van een
// procedure wordt een snapshot in de database opgeslagen, zodat lopende
// procedures niet veranderen als de template later wordt aangepast.

export interface ProcessTemplateChecklistItem {
  volgorde: number;
  label: string;
  bewijs_vereist: boolean;
}

export interface ProcessTemplateStap {
  volgorde: number;
  naam: string;
  beschrijving: string;
  vereist_besluit: boolean;
  geschatte_dagen: number;
  checklist: ProcessTemplateChecklistItem[];
}

export interface ProcessTemplate {
  code: string;
  naam: string;
  korte_omschrijving: string;
  geschat_aantal_dagen: number;
  stappen: ProcessTemplateStap[];
}

export const TEMPLATES: ProcessTemplate[] = [
  {
    code: "beleidswijziging",
    naam: "Beleidswijziging",
    korte_omschrijving:
      "Voorstel → impactanalyse → bestuursoverleg → besluit → implementatie → evaluatie.",
    geschat_aantal_dagen: 90,
    stappen: [
      {
        volgorde: 1,
        naam: "Voorstel opstellen",
        beschrijving:
          "Stel een conceptvoorstel op met aanleiding, alternatieven, gevraagd besluit en verwachte impact.",
        vereist_besluit: false,
        geschatte_dagen: 5,
        checklist: [
          {
            volgorde: 1,
            label: "Aanleiding en context beschreven",
            bewijs_vereist: true,
          },
          { volgorde: 2, label: "Alternatieven gewogen", bewijs_vereist: false },
          {
            volgorde: 3,
            label: "Gevraagd besluit expliciet geformuleerd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 2,
        naam: "Impactanalyse",
        beschrijving:
          "Financiele, juridische en communicatie-impact in kaart, inclusief risicobeoordeling.",
        vereist_besluit: false,
        geschatte_dagen: 10,
        checklist: [
          {
            volgorde: 1,
            label: "Financiele impact gekwantificeerd",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Juridische impact gecheckt",
            bewijs_vereist: false,
          },
          {
            volgorde: 3,
            label: "Communicatieplan opgesteld",
            bewijs_vereist: true,
          },
          {
            volgorde: 4,
            label: "Risicobeoordeling vastgelegd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 3,
        naam: "Bestuursoverleg",
        beschrijving:
          "Bespreek het beleidsvoorstel in een bestuursvergadering, verzamel inbreng commissies, leg overwegingen vast.",
        vereist_besluit: false,
        geschatte_dagen: 14,
        checklist: [
          {
            volgorde: 1,
            label: "Vergadering ingepland waarin voorstel wordt besproken",
            bewijs_vereist: false,
          },
          {
            volgorde: 2,
            label: "Voorstel als agendapunt toegevoegd",
            bewijs_vereist: false,
          },
          {
            volgorde: 3,
            label: "Inbreng commissies ontvangen",
            bewijs_vereist: true,
          },
          {
            volgorde: 4,
            label: "Overwegingen schriftelijk vastgelegd",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 4,
        naam: "Bestuursbesluit",
        beschrijving:
          "Formele besluitvastlegging met motivering en stemverhouding.",
        vereist_besluit: true,
        geschatte_dagen: 7,
        checklist: [
          {
            volgorde: 1,
            label: "Besluit geformuleerd in concrete termen",
            bewijs_vereist: true,
          },
          { volgorde: 2, label: "Stemverhouding genoteerd", bewijs_vereist: false },
          {
            volgorde: 3,
            label: "Motivering opgeslagen voor audittrail",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 5,
        naam: "Implementatie",
        beschrijving:
          "Operationele uitvoering van het besluit door uitvoerder en/of vermogensbeheerder.",
        vereist_besluit: false,
        geschatte_dagen: 28,
        checklist: [
          {
            volgorde: 1,
            label: "Opdracht aan uitvoerder/vermogensbeheerder verstuurd",
            bewijs_vereist: true,
          },
          {
            volgorde: 2,
            label: "Bevestiging implementatie ontvangen",
            bewijs_vereist: true,
          },
        ],
      },
      {
        volgorde: 6,
        naam: "Evaluatie",
        beschrijving:
          "Korte terugblik na zes maanden: heeft de wijziging het beoogde effect gehad?",
        vereist_besluit: false,
        geschatte_dagen: 30,
        checklist: [
          { volgorde: 1, label: "Effect-meting uitgevoerd", bewijs_vereist: true },
          { volgorde: 2, label: "Conclusies vastgelegd", bewijs_vereist: true },
        ],
      },
    ],
  },
];

export function vindTemplate(code: string): ProcessTemplate | undefined {
  return TEMPLATES.find((t) => t.code === code);
}

export function templateLabel(code: string): string {
  return vindTemplate(code)?.naam ?? code;
}

// Status-labels voor procedures
export const PROCEDURE_STATUS_LABEL: Record<string, string> = {
  in_uitvoering: "In uitvoering",
  wacht_op_besluit: "Wacht op besluit",
  afgerond: "Afgerond",
};

export const STAP_STATUS_LABEL: Record<string, string> = {
  open: "Open",
  actief: "Actief",
  afgerond: "Afgerond",
};
