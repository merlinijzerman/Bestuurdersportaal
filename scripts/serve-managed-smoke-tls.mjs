#!/usr/bin/env node

// TLS-terminator voor de managed applicatiesmoke.
//
// De app stuurt in productie bewust `Strict-Transport-Security` en een CSP met
// `upgrade-insecure-requests` mee (zie next.config.ts). Serveren we de
// hersteloefening over plain http, dan upgradet Chrome na de eerste response
// elke subresource naar https op dezelfde host: de _next/static-chunks laden
// niet, React hydrateert nooit en zelfs een same-origin fetch mislukt. De smoke
// bewijst dan niets over de herstelde omgeving.
//
// Deze terminator zet daarom een wegwerp-TLS-laag voor `next start`, zodat de
// smoke de app benadert zoals productie hem aanbiedt — zonder ook maar één
// beveiligingsheader te versoepelen. Hij logt bewust geen paden, hosts,
// headers of bodies: alles wat hier langskomt is herstelde productiedata.

import { createServer } from "node:https";
import { request } from "node:http";
import { readFileSync } from "node:fs";

function argument(naam) {
  const index = process.argv.indexOf(naam);
  if (index < 0 || index + 1 >= process.argv.length) {
    process.stderr.write(`MANAGED_SMOKE_TLS_FAILED:ontbrekend_argument\n`);
    process.exit(1);
  }
  return process.argv[index + 1];
}

function poort(waarde, label) {
  if (!/^\d{2,5}$/.test(waarde)) {
    process.stderr.write(`MANAGED_SMOKE_TLS_FAILED:${label}\n`);
    process.exit(1);
  }
  return Number(waarde);
}

const certPath = argument("--cert");
const keyPath = argument("--key");
const listenPort = poort(argument("--listen"), "listen_poort");
const upstreamPort = poort(argument("--upstream"), "upstream_poort");

const server = createServer(
  { cert: readFileSync(certPath), key: readFileSync(keyPath) },
  (inkomend, uitgaand) => {
    // De Host-header blijft ongewijzigd: de tenant-resolutie van de app leidt
    // daar de fondscontext uit af. x-forwarded-proto vertelt de app dat de
    // oorspronkelijke verbinding wél TLS was.
    const headers = { ...inkomend.headers, "x-forwarded-proto": "https" };
    const doorgifte = request(
      {
        host: "127.0.0.1",
        port: upstreamPort,
        method: inkomend.method,
        path: inkomend.url,
        headers,
      },
      (antwoord) => {
        uitgaand.writeHead(antwoord.statusCode ?? 502, antwoord.headers);
        antwoord.pipe(uitgaand);
      }
    );
    doorgifte.on("error", () => {
      if (!uitgaand.headersSent) uitgaand.writeHead(502);
      uitgaand.end();
    });
    inkomend.on("error", () => doorgifte.destroy());
    inkomend.pipe(doorgifte);
  }
);

server.on("error", () => {
  process.stderr.write("MANAGED_SMOKE_TLS_FAILED:listen\n");
  process.exit(1);
});

server.listen(listenPort, "127.0.0.1", () => {
  process.stdout.write("MANAGED_SMOKE_TLS_READY\n");
});
