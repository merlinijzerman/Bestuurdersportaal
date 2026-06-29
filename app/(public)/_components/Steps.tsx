// De zes stappen van de besluitcyclus (server component). Stap 06 (Evalueren)
// sluit de cyclus en voedt het volgende besluit (FO REQ-PV-006).
const STAPPEN = [
  {
    num: "01",
    titel: "Verzamelen",
    tekst:
      "Bronnen, documenten en eerdere besluiten bijeen in één beheerde context.",
  },
  {
    num: "02",
    titel: "Analyseren",
    tekst:
      "Brongebonden AI ordent en ontsluit, met verwijzing naar de bron en de historie.",
  },
  {
    num: "03",
    titel: "Wegen",
    tekst: "Risico's, alternatieven en aannames expliciet en zichtbaar gemaakt.",
  },
  {
    num: "04",
    titel: "Besluiten",
    tekst:
      "Het besluit met onderbouwing en overwegingen vastgelegd op het moment zelf.",
  },
  {
    num: "05",
    titel: "Verantwoorden",
    tekst: "Reconstrueerbare audittrail voor toezicht en verantwoording.",
  },
  {
    num: "06",
    titel: "Evalueren",
    tekst:
      "Opvolging zichtbaar, aannames getoetst, effecten beoordeeld en leerpunten vastgelegd — input voor het volgende besluit.",
  },
];

export default function Steps() {
  return (
    <div className="steps">
      {STAPPEN.map((s) => (
        <div className="step" key={s.num}>
          <span className="num">{s.num}</span>
          <h3>{s.titel}</h3>
          <p>{s.tekst}</p>
        </div>
      ))}
    </div>
  );
}
