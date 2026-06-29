// Besluitcyclus als knoop→pijl→knoop-lijn (server component). De cyclus loopt
// door tot en met evaluatie (FO REQ-PV-006): de laatste node ("Evaluatie") is
// gemarkeerd (spec) als sluitstuk dat terugvoedt naar een volgend besluit.
const STAPPEN = [
  "Vraagstuk",
  "Bronnen",
  "Analyse",
  "Afweging",
  "Besluit",
  "Verantwoording",
  "Evaluatie",
];

export default function Flow() {
  return (
    <div className="flow">
      {STAPPEN.map((stap, i) => (
        <span key={stap} style={{ display: "contents" }}>
          <span className={`node${i === STAPPEN.length - 1 ? " spec" : ""}`}>
            {stap}
          </span>
          {i < STAPPEN.length - 1 && (
            <span className="arr" aria-hidden="true">
              →
            </span>
          )}
        </span>
      ))}
    </div>
  );
}
