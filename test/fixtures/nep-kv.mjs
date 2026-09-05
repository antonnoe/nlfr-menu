// Een namaak-KV voor tests: dezelfde REST-vorm als Upstash, in het geheugen.
// ---------------------------------------------------------------------------
// Waarom een HTTP-server en niet een gemockte lib/store.js: zo draait de ECHTE
// store, de echte route en de echte sleutelnamen mee. Een mock op module-niveau
// zou precies de laag overslaan waar de fouten in zitten (een verkeerde sleutel,
// een vergeten del). De server luistert op 127.0.0.1 en gaat door NO_PROXY heen.
//
// Ondersteunt de vijf commando's die lib/store.js stuurt: GET, SET, DEL, MGET,
// SCAN. TTL's worden geaccepteerd en genegeerd — geen enkele test hangt van het
// verlopen van een sleutel af, en een tijdgevoelige test zou willekeurig falen.

import http from "node:http";

export async function startNepKv() {
  const db = new Map();
  const server = http.createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      const a = JSON.parse(body || "[]");
      const cmd = String(a[0]).toUpperCase();
      let result = null;
      if (cmd === "GET") result = db.has(a[1]) ? db.get(a[1]) : null;
      else if (cmd === "SET") { db.set(a[1], a[2]); result = "OK"; }
      else if (cmd === "DEL") result = db.delete(a[1]) ? 1 : 0;
      else if (cmd === "MGET") result = a.slice(1).map((k) => (db.has(k) ? db.get(k) : null));
      else if (cmd === "SCAN") {
        const i = a.indexOf("MATCH");
        const patroon = i > -1 ? a[i + 1] : "*";
        const re = new RegExp(
          "^" +
            patroon
              .split("*")
              .map((x) => x.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
              .join(".*") +
            "$"
        );
        result = ["0", [...db.keys()].filter((k) => re.test(k))];
      }
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify({ result }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));

  // De env moet staan vóór het importeren van lib/store.js: die leest hem bij
  // het laden van de module.
  process.env.KV_REST_API_URL = `http://127.0.0.1:${server.address().port}`;
  process.env.KV_REST_API_TOKEN = "test";
  process.env.NO_PROXY = "127.0.0.1,localhost";
  process.env.no_proxy = "127.0.0.1,localhost";

  return { db, sluit: () => server.close() };
}

// Roept een route-handler aan met een minimale req/res, en geeft de uitkomst.
export function roeper(handler, token) {
  return async function roep(method, body) {
    const res = { code: 0, body: null, headers: {} };
    res.setHeader = (k, v) => { res.headers[k] = v; };
    res.status = (c) => { res.code = c; return res; };
    res.json = (j) => { res.body = j; return res; };
    res.end = () => res;
    await handler(
      { method, url: `/api/review?token=${token}`, headers: { "x-review-token": token }, body },
      res
    );
    return res;
  };
}
