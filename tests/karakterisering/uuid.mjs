// Pure vormgrens voor UUID-filters in het karakteriseringsharnas. PostgREST
// accepteert UUID-kolommen pas ná deze controle, zodat foutresponsen zonder een
// geldige resource-id als karakteriseringsdiff zichtbaar blijven.
export function geldigeUuidVoorQuery(waarde) {
  return typeof waarde === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(waarde);
}
