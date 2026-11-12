// Pruebas automaticas de Gimnasio. Abren la app (www/index.html) en Chrome sin ventana y
// recorren los flujos principales. Si alguna falla, la compilacion no publica la version.
//   Uso:  cd tests && npm install && node correr.js [filtro]
// Usa el Chrome instalado en la maquina (CHROME_PATH para indicar otro).
const http = require("http"), fs = require("fs"), path = require("path");
let chromium;
try { ({ chromium } = require("playwright-core")); } catch (e) { ({ chromium } = require("playwright")); }

const WWW = path.join(__dirname, "..", "www"), OUT = path.join(__dirname, "salida");
const TIPOS = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".json": "application/json", ".png": "image/png", ".css": "text/css" };

function servidor() {
  return new Promise((ok) => {
    const s = http.createServer((req, res) => {
      const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "") || "index.html";
      const f = path.join(WWW, rel);
      if (!f.startsWith(WWW) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
      res.writeHead(200, { "content-type": TIPOS[path.extname(f)] || "application/octet-stream", "cache-control": "no-store" });
      fs.createReadStream(f).pipe(res);
    });
    s.listen(0, "127.0.0.1", () => ok(s));
  });
}

// Un PNG de 1x1 para las teselas del mapa
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

async function main() {
  const filtro = process.argv[2] || "";
  const casos = require("./casos.js").filter((c) => !filtro || c.nombre.indexOf(filtro) >= 0);
  const srv = await servidor(), URL = "http://127.0.0.1:" + srv.address().port + "/index.html";
  const opts = { args: ["--no-sandbox", "--autoplay-policy=no-user-gesture-required"] };
  if (process.env.CHROME_PATH) opts.executablePath = process.env.CHROME_PATH;
  else if (fs.existsSync("/usr/bin/google-chrome")) opts.executablePath = "/usr/bin/google-chrome";
  else opts.channel = "chrome";
  const browser = await chromium.launch(opts);
  fs.mkdirSync(OUT, { recursive: true });
  let fallas = 0;
  const t00 = Date.now();

  for (const caso of casos) {
    const t0 = Date.now(), errores = [];
    // Hora de Argentina: varios errores viejos eran de fechas (domingos, despues de las 21 h)
    const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 1, timezoneId: "America/Argentina/Buenos_Aires", locale: "es-AR" });
    ctx.setDefaultTimeout(8000);
    await ctx.route(/tile\.openstreetmap\.org/, (r) => r.fulfill({ status: 200, contentType: "image/png", body: PNG }));
    await ctx.route(/r2\.dev|api\.github\.com|fonts\.g/, (r) => r.abort());
    // Reloj adelantable (window.__off, en ms) y datos iniciales por prueba
    await ctx.addInitScript(() => {
      if (window.__relojPuesto) return; window.__relojPuesto = true; window.__off = window.__off || 0;
      const Real = Date;
      class Reloj extends Real { constructor(...a) { if (a.length === 0) super(Real.now() + window.__off); else super(...a); } static now() { return Real.now() + window.__off; } }
      window.Date = Reloj;
    });
    const page = await ctx.newPage();
    page.on("pageerror", (e) => { if (!/no supported source|play\(\) request|NotSupportedError/.test(e.message)) errores.push(e.message); });
    page.on("dialog", (d) => d.accept());
    const t = {
      page, URL, ctx,
      // Abre la app; "antes" corre antes de que cargue (para sembrar localStorage o simular el APK)
      abrir: async (antes, arg) => {
        if (antes) await page.addInitScript(antes, arg);
        await page.goto(URL); await page.waitForFunction(() => typeof launchInit === "function" && !!document.querySelector(".screen.active"));
        await page.waitForTimeout(150);
        await page.evaluate(() => document.querySelectorAll(".overlay.show,.guideOverlay.show").forEach((o) => o.classList.remove("show")));
      },
      ev: (fn, arg) => page.evaluate(fn, arg),
      pantalla: () => page.evaluate(() => document.querySelector(".screen.active").id),
      adelantar: (ms) => page.evaluate((m) => { window.__off += m; }, ms),
      espera: (ms) => page.waitForTimeout(ms),
      igual: (a, b, que) => { if (JSON.stringify(a) !== JSON.stringify(b)) throw new Error((que || "valor") + ": esperaba " + JSON.stringify(b) + " y hay " + JSON.stringify(a)); },
      cerca: (a, b, tol, que) => { if (!(Math.abs(a - b) <= tol)) throw new Error((que || "valor") + ": esperaba " + b + " ±" + tol + " y hay " + a); },
      ok: (cond, que) => { if (!cond) throw new Error("no se cumple: " + que); },
    };
    let falla = null;
    try {
      await Promise.race([caso.correr(t), new Promise((_, no) => setTimeout(() => no(new Error("tardó más de 90 s")), 90000))]);
      if (errores.length) throw new Error("errores de JavaScript: " + errores.join(" | "));
    } catch (e) { falla = e; }
    if (falla) {
      fallas++;
      try { await page.screenshot({ path: path.join(OUT, caso.nombre.replace(/[^a-z0-9]+/gi, "_") + ".png") }); } catch (e) { /* nada */ }
      console.log("✗ " + caso.nombre + "\n    " + String(falla.message).split("\n").slice(0, 6).join("\n    "));
    } else console.log("✓ " + caso.nombre + "  (" + ((Date.now() - t0) / 1000).toFixed(1) + " s)");
    await ctx.close();
  }
  await browser.close(); srv.close();
  console.log("\n" + (casos.length - fallas) + " de " + casos.length + " pruebas bien, en " + Math.round((Date.now() - t00) / 1000) + " s");
  if (process.env.GITHUB_ACTIONS) console.log("::notice title=Pruebas::" + (casos.length - fallas) + " de " + casos.length + " bien");
  process.exit(fallas ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
