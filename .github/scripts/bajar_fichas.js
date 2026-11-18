// Baja todas las fichas (descripciones JSON) de la biblioteca desde R2 para revisar el idioma.
const fs = require("fs");
const s = fs.readFileSync("www/index.html", "utf8");
const grab = (re) => { const m = s.match(re); if (!m) throw new Error("no encontre " + re); return eval("(" + m[1] + ")"); };
const LIBRARY = grab(/var LIBRARY\s*=\s*(\{[\s\S]*?\n\});/);
const MEDIA_ALIAS = grab(/var MEDIA_ALIAS\s*=\s*(\{[\s\S]*?\n\});/);
const DESC_ALIAS = grab(/var DESC_ALIAS\s*=\s*(\{[\s\S]*?\n\});/);
const BASE = s.match(/var VIDEO_BASE\s*=\s*'([^']+)'/)[1];
const names = [];
for (const g in LIBRARY) (LIBRARY[g].exercises || []).forEach((n) => { if (!names.includes(n)) names.push(n); });
fs.mkdirSync("fichas", { recursive: true });
const out = [];
let i = 0;
async function worker() {
  while (i < names.length) {
    const n = names[i++], file = DESC_ALIAS[n] || MEDIA_ALIAS[n] || n, url = BASE + encodeURIComponent(file) + ".json";
    let status = 0, body = null;
    for (let k = 0; k < 3 && !status; k++) { try { const r = await fetch(url); status = r.status; if (r.ok) body = await r.text(); } catch (e) { await new Promise((z) => setTimeout(z, 1000)); } }
    out.push({ name: n, file, status, ok: !!body });
    if (body) fs.writeFileSync("fichas/" + file.replace(/[\/\\]/g, "_") + ".json", body);
  }
}
Promise.all(Array.from({ length: 8 }, worker)).then(() => {
  fs.writeFileSync("fichas/_indice.json", JSON.stringify(out, null, 1));
  console.log(names.length + " ejercicios, " + out.filter((x) => x.ok).length + " fichas bajadas");
});
