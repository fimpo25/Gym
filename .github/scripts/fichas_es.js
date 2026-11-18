// Para cada ficha en ingles: busca la version en espanol de la misma pagina de origen y toma sus textos.
const fs = require("fs");
const list = JSON.parse(fs.readFileSync("lista_en.json", "utf8"));
const nd = (h) => { const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/); return m ? JSON.parse(m[1]) : null; };
const get = async (u) => { for (let k = 0; k < 3; k++) { try { const r = await fetch(u); if (r.status === 404) return { status: 404 }; if (r.ok) return { status: 200, html: await r.text() }; } catch (e) {} await new Promise((z) => setTimeout(z, 1500)); } return { status: 0 }; };
const out = {}, fallas = [];
let i = 0;
async function worker() {
  while (i < list.length) {
    const it = list[i++];
    try {
      const a = await get(it.url); if (a.status !== 200) { fallas.push([it.file, "en " + a.status]); continue; }
      const d = nd(a.html), esUrl = d && d.props.pageProps.alternates && d.props.pageProps.alternates.es;
      let ex = d && d.props.pageProps.exercise;
      if (!ex || !ex.instructions || !ex.instructions.es) {
        if (!esUrl) { fallas.push([it.file, "sin es"]); continue; }
        const b = await get(esUrl); if (b.status !== 200) { fallas.push([it.file, "es " + b.status]); continue; }
        ex = nd(b.html).props.pageProps.exercise;
      }
      const pick = (o) => (o && (o.es || o.ES)) || null;
      const r = { descripcion: pick(ex.descriptions), como_realizar: pick(ex.instructions), consejos: pick(ex.tips), errores_comunes: pick(ex.commonMistakes), es: esUrl || "" };
      if (!r.descripcion || !r.como_realizar) { fallas.push([it.file, "incompleta"]); continue; }
      out[it.file] = r;
    } catch (e) { fallas.push([it.file, "error " + e.message]); }
  }
}
Promise.all(Array.from({ length: 6 }, worker)).then(() => {
  fs.mkdirSync("traducidas", { recursive: true });
  fs.writeFileSync("traducidas/fichas_es.json", JSON.stringify(out, null, 1));
  fs.writeFileSync("traducidas/fallas.json", JSON.stringify(fallas, null, 1));
  console.log(Object.keys(out).length + " en español, " + fallas.length + " fallas");
});
