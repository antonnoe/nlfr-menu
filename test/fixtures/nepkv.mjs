// Nep-Upstash: reageert op POST JSON-array zoals de REST-API.
export function maakNepKV() {
  const data = new Map(); // key -> {v, exp}
  const z = new Map(); // key -> Map(member->score)
  const st = { faalZ: false, faalAlles: false, log: [], nu: () => Date.now() };
  const leeft = (k) => { const e = data.get(k); if (!e) return null; if (e.exp && e.exp <= st.nu()) { data.delete(k); return null; } return e; };
  const glob = (p) => new RegExp("^" + p.replace(/[.+^${}()|\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$");
  function run(a) {
    const c = String(a[0]).toUpperCase(); st.log.push(c);
    if (st.faalAlles) return { error: "ERR down" };
    if (st.faalZ && c.startsWith("Z")) return { error: "ERR unknown command" };
    switch (c) {
      case "GET": { const e = leeft(a[1]); return { result: e ? e.v : null }; }
      case "SET": { let exp = null, nx = false; for (let i = 3; i < a.length; i++) { if (String(a[i]).toUpperCase() === "EX") exp = st.nu() + Number(a[++i]) * 1000; else if (String(a[i]).toUpperCase() === "NX") nx = true; }
        if (nx && leeft(a[1])) return { result: null }; data.set(a[1], { v: a[2], exp }); return { result: "OK" }; }
      case "DEL": { let n = 0; for (const k of a.slice(1)) { if (leeft(k)) n++; data.delete(k); z.delete(k); } return { result: n }; }
      case "MGET": return { result: a.slice(1).map((k) => { const e = leeft(k); return e ? e.v : null; }) };
      case "SCAN": { const cur = Number(a[1]); let m = "*", cnt = 10; for (let i = 2; i < a.length; i++) { if (String(a[i]).toUpperCase() === "MATCH") m = a[++i]; else if (String(a[i]).toUpperCase() === "COUNT") cnt = Number(a[++i]); }
        const alle = [...new Set([...data.keys(), ...z.keys()])].filter((k) => z.has(k) || leeft(k)); const sl = alle.slice(cur, cur + cnt); const re = glob(m); const nxt = cur + cnt >= alle.length ? "0" : String(cur + cnt); return { result: [nxt, sl.filter((k) => re.test(k))] }; }
      case "ZADD": { const key = a[1]; let i = 2, nx = false; if (String(a[2]).toUpperCase() === "NX") { nx = true; i = 3; } if (!z.has(key)) z.set(key, new Map()); const s = z.get(key); let n = 0; for (; i < a.length; i += 2) { const sc = Number(a[i]), m = a[i + 1]; if (Number.isNaN(sc)) return { error: "ERR value is not a valid float" }; if (nx && s.has(m)) continue; if (!s.has(m)) n++; s.set(m, sc); } return { result: n }; }
      case "ZRANGEBYSCORE": { const s = z.get(a[1]); if (!s) return { result: [] }; const p = (x) => x === "-inf" ? -Infinity : x === "+inf" ? Infinity : Number(x); const lo = p(a[2]), hi = p(a[3]); return { result: [...s].filter(([, sc]) => sc >= lo && sc <= hi).sort((x, y) => x[1] - y[1]).map(([m]) => m) }; }
      case "ZREM": { const s = z.get(a[1]); let n = 0; if (s) for (const m of a.slice(2)) if (s.delete(m)) n++; return { result: n }; }
      default: return { error: "ERR unknown " + c };
    }
  }
  const fetchNep = async (url, opt) => { const r = run(JSON.parse(opt.body)); return { ok: true, status: 200, json: async () => r, text: async () => JSON.stringify(r) }; };
  return { data, z, st, fetchNep, run };
}
