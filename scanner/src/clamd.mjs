// ============================================================================
//  scanner/src/clamd.mjs — INSTREAM-cliënt voor de lokale clamd-daemon.
// ----------------------------------------------------------------------------
//  Bewuste afwijking van "schrijf naar een tijdelijk bestand en scan dat":
//  met INSTREAM gaan de bytes rechtstreeks van de HTTPS-stream naar de
//  scannersocket en raken ze de schijf nooit. Dat schrapt een hele risicoklasse
//  — geen achtergebleven besmet bestand na een crash, geen padmanipulatie, geen
//  cleanup die kan falen — en dient hetzelfde doel als de oorspronkelijke eis.
//
//  Protocol (clamd docs, "zINSTREAM"):
//    → "zINSTREAM\0"
//    → per brok: uint32be lengte + bytes
//    → afsluiten met uint32be 0
//    ← "stream: OK\0"
//    ← "stream: <detectie> FOUND\0"
//    ← "stream: <reden> ERROR\0"  /  "INSTREAM size limit exceeded. ERROR\0"
//
//  Alle uitkomsten zijn gesloten: onbekende of onvolledige antwoorden worden
//  een fout, nooit "schoon".
// ============================================================================

import net from "node:net";

/** Maximale grootte van het antwoord van clamd. Een antwoord is normaal enkele
 *  tientallen bytes; alles daarboven duidt op een defect of vijandig proces. */
const MAX_ANTWOORD_BYTES = 4096;

/**
 * @typedef {{ soort: "schoon" }
 *          | { soort: "gevonden", detectie: string }
 *          | { soort: "limiet", ruw: string }
 *          | { soort: "fout", ruw: string }} ClamdUitkomst
 */

/**
 * Opent één INSTREAM-sessie. De aanroeper schuift brokken door en roept
 * `afronden()` aan; de socket wordt in alle gevallen gesloten.
 *
 * @param {string} socketPad pad naar de clamd unix-socket
 * @param {{ verbindTimeoutMs: number, totaalTimeoutMs: number }} opties
 */
export async function openInstream(socketPad, opties) {
  const socket = await new Promise((resolve, reject) => {
    const s = net.createConnection(socketPad);
    const opTijd = setTimeout(() => {
      s.destroy();
      reject(new Error("clamd_verbind_timeout"));
    }, opties.verbindTimeoutMs);
    s.once("connect", () => {
      clearTimeout(opTijd);
      resolve(s);
    });
    s.once("error", (e) => {
      clearTimeout(opTijd);
      reject(e);
    });
  });

  // Harde bovengrens op de hele sessie: een hangende scan mag het enige
  // scanslot van deze instance niet gijzelen.
  const sessieTimer = setTimeout(() => socket.destroy(new Error("clamd_sessie_timeout")), opties.totaalTimeoutMs);

  let antwoord = Buffer.alloc(0);
  let teGroot = false;
  socket.on("data", (brok) => {
    if (antwoord.length + brok.length > MAX_ANTWOORD_BYTES) {
      teGroot = true;
      socket.destroy();
      return;
    }
    antwoord = Buffer.concat([antwoord, brok]);
  });

  await schrijfAsync(socket, Buffer.from("zINSTREAM\0", "ascii"));

  return {
    /**
     * @param {Buffer} brok
     * @returns {Promise<void>}
     */
    async schrijf(brok) {
      if (brok.length === 0) return; // een nul-lengte brok is het EOF-signaal
      const kop = Buffer.alloc(4);
      kop.writeUInt32BE(brok.length, 0);
      await schrijfAsync(socket, kop);
      await schrijfAsync(socket, brok);
    },

    /** @returns {Promise<ClamdUitkomst>} */
    async afronden() {
      try {
        const eind = Buffer.alloc(4);
        eind.writeUInt32BE(0, 0);
        await schrijfAsync(socket, eind);
        await new Promise((resolve) => {
          if (socket.destroyed) return resolve(undefined);
          socket.once("close", resolve);
          socket.once("end", resolve);
        });
        if (teGroot) return { soort: "fout", ruw: "antwoord_te_groot" };
        return ontleedAntwoord(antwoord.toString("ascii"));
      } finally {
        clearTimeout(sessieTimer);
        socket.destroy();
      }
    },

    /** Breekt de sessie af zonder een verdict te vragen (bv. bij een
     *  downloadfout). De socket sluiten is genoeg — clamd ruimt zelf op. */
    afbreken() {
      clearTimeout(sessieTimer);
      socket.destroy();
    },
  };
}

/**
 * @param {net.Socket} socket
 * @param {Buffer} data
 * @returns {Promise<void>}
 */
function schrijfAsync(socket, data) {
  return new Promise((resolve, reject) => {
    socket.write(data, (fout) => (fout ? reject(fout) : resolve(undefined)));
  });
}

/**
 * Vertaalt het ruwe clamd-antwoord naar een gesloten uitkomst.
 * Fail-closed: alles wat niet exact als "schoon" leesbaar is, is dat niet.
 *
 * @param {string} ruw
 * @returns {ClamdUitkomst}
 */
export function ontleedAntwoord(ruw) {
  const regel = ruw.replace(/\0+$/, "").trim();
  if (regel.length === 0) return { soort: "fout", ruw: "leeg_antwoord" };

  // clamd meldt een overschreden INSTREAM-limiet als ERROR. Dat is een
  // beleidsuitkomst (te groot om te beoordelen), geen infrastructuurfout —
  // en zeker geen "schoon".
  if (/size limit exceeded/i.test(regel)) {
    return { soort: "limiet", ruw: regel };
  }
  if (/\bERROR$/.test(regel)) {
    return { soort: "fout", ruw: regel };
  }
  if (/\bFOUND$/.test(regel)) {
    // "stream: Eicar-Test-Signature FOUND" → detectienaam ertussenuit.
    const m = /^stream:\s*(.+?)\s+FOUND$/.exec(regel);
    return { soort: "gevonden", detectie: m ? m[1] : "onbekend" };
  }
  if (/^stream:\s*OK$/.test(regel)) {
    return { soort: "schoon" };
  }
  // Onbekende vorm: nooit als schoon behandelen.
  return { soort: "fout", ruw: "onbekend_antwoord" };
}
