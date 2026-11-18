const fs = require("fs");
const urls = ["https://smartworkout.app/en/exercise-library/back/gorilla-row", "https://smartworkout.app/en/exercise-library/back/seal-row", "https://smartworkout.app/en/exercise-library/legs/bulgarian-split-squat"];
(async () => {
  fs.mkdirSync("sondeo", { recursive: true });
  for (const [i, u] of urls.entries()) {
    try { const r = await fetch(u); const h = await r.text(); fs.writeFileSync("sondeo/en" + i + ".html", h);
      const alt = [...h.matchAll(/<link[^>]+hreflang="?([a-z-]+)"?[^>]*>/gi)].map((m) => m[0]);
      console.log(u, r.status, h.length, alt.join("\n"));
      const es = (h.match(/href="(https:\/\/smartworkout\.app\/es\/[^"]+)"/) || [])[1];
      if (es) { const r2 = await fetch(es); fs.writeFileSync("sondeo/es" + i + ".html", await r2.text()); console.log("ES", es, r2.status); }
    } catch (e) { console.log(u, "error", e.message); }
  }
})();
