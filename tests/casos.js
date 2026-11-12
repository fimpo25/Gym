// Casos de prueba. Cada uno arranca con la app vacia (salvo lo que siembre) y en hora de Argentina.
// t.abrir(antes) abre la app; t.ev(fn) corre codigo dentro de la pagina; t.igual / t.cerca / t.ok comprueban.

// --- datos de ejemplo que se siembran antes de abrir la app ---
function sembrarRutina() {
  if (localStorage.getItem("__sembrado")) return; localStorage.setItem("__sembrado", "1");
  localStorage.setItem("gymStretchSug", "0");
  localStorage.setItem("gymRoutines", JSON.stringify({ folders: [{ id: "f1", name: "Mis rutinas", open: true, routines: [
    { id: "rA", name: "Empuje", exercises: ["Press de Banca", "Encogimientos de Hombros con Mancuernas"] },
    { id: "rB", name: "Piernas", exercises: ["Sentadilla"] }] }] }));
}
// Simula estar dentro del APK: window.Capacitor con las respuestas de cada plugin nativo
function apkSimulado(cfg) {
  window.__nat = { llamadas: [], cfg: cfg, archivos: {} };
  window.Capacitor = { isNativePlatform: () => true, nativePromise: (plugin, metodo, o) => {
    const N = window.__nat; N.llamadas.push(plugin + "." + metodo);
    if (plugin === "Updater") {
      if (metodo === "info") return Promise.resolve({ versionCode: cfg.code, versionName: cfg.name, canInstall: true });
      if (metodo === "fetchText") return Promise.resolve({ text: JSON.stringify(cfg.release) });
      if (metodo === "progress") return Promise.resolve({ done: 50, total: 100, running: true });
      if (metodo === "downloadAndInstall") { N.instalado = o; return Promise.resolve({}); }
    }
    if (plugin === "Backup") {
      if (metodo === "save") { const id = String(Object.keys(N.archivos).length + 1); N.archivos[id] = { id, name: o.name, text: o.text, date: Date.now() }; return Promise.resolve({ id, name: o.name, size: o.text.length, where: "Documentos/Gimnasio" }); }
      if (metodo === "list") return Promise.resolve({ items: Object.values(N.archivos).map((a) => ({ id: a.id, name: a.name, size: a.text.length, date: a.date })), where: "Documentos/Gimnasio" });
      if (metodo === "read") return N.archivos[o.id] ? Promise.resolve({ text: N.archivos[o.id].text }) : Promise.reject(new Error("no existe"));
      if (metodo === "remove") { delete N.archivos[o.id]; return Promise.resolve({}); }
    }
    if (plugin === "Share") { N.compartido = o; return Promise.resolve({}); }
    if (plugin === "Route" && metodo === "status") return Promise.resolve(cfg.ruta || { state: "idle", gps: true, granted: true, count: 0 });
    if (plugin === "Route" && metodo === "points") return Promise.resolve({ points: [], from: 0, total: 0 });
    return Promise.resolve({});
  } };
}
// GPS simulado del navegador: window.__fix(lat, lon, precision, altura) entrega una posicion
function gpsSimulado() {
  let cb = null;
  navigator.geolocation.getCurrentPosition = (ok) => ok({ coords: { latitude: -32.9442, longitude: -60.6505, accuracy: 10 }, timestamp: Date.now() });
  navigator.geolocation.watchPosition = (ok) => { cb = ok; return 1; };
  navigator.geolocation.clearWatch = () => { cb = null; };
  window.__fix = (lat, lon, acc, alt) => { if (cb) cb({ coords: { latitude: lat, longitude: lon, accuracy: acc || 8, altitude: alt == null ? null : alt }, timestamp: Date.now() }); };
}

// Adelanta el reloj hasta el proximo dia de la semana indicado (0 = domingo) a esa hora de Argentina
async function irA(t, diaSemana, hora) {
  await t.ev(([dw, h]) => { const real = new Date(), d = new Date(real.getTime()); d.setDate(d.getDate() + ((dw - d.getDay() + 7) % 7)); d.setHours(h, 0, 0, 0); if (d.getTime() <= real.getTime()) d.setDate(d.getDate() + 7); window.__off += d.getTime() - real.getTime(); }, [diaSemana, hora]);
}
// Dentro de la pagina: carga "semanas" semanas de historial. plan(i) devuelve, para la semana de hace i semanas
// (0 = la actual), una lista de [ejercicio, diaDeLaSemana(0 = lunes), series, peso, reps, rir]
function sembrarHistorial(semanas, planTxt) {
  const plan = new Function("i", "return (" + planTxt + ")(i)"), cur = getWeekKey(new Date());
  for (let i = semanas - 1; i >= 0; i--) {
    const wk = wkAdd(cur, -i), dias = weekDays(wk); gymData[wk] = gymData[wk] || {};
    (plan(i) || []).forEach(([ej, dia, n, peso, reps, rir]) => {
      const base = wkDate(wk).getTime() + dia * 864e5;
      for (let k = 0; k < n; k++) (gymData[wk][ej] = gymData[wk][ej] || []).push({ reps: String(reps), weight: String(peso), d: dias[dia], t: base + k, rir: rir === undefined ? 2 : rir });
      gymData.trainingDays = gymData.trainingDays || {}; gymData.trainingDays[dias[dia]] = 1;
    });
  }
  persist();
}

// Registra una serie en el primer ejercicio de la rutina abierta: escribe peso y reps y toca el tilde
async function registrarSerie(t, peso, reps) {
  const ej = t.page.locator(".trEx").first();
  if (!(await ej.locator(".trRow:not(.done):not(.trHead)").count())) { await ej.locator(".trAdd").first().click(); await t.espera(150); }
  const fila = ej.locator(".trRow:not(.done):not(.trHead)").first();
  await fila.locator(".trIn").nth(0).fill(String(peso));
  await fila.locator(".trIn").nth(1).fill(String(reps));
  await fila.locator(".trOk").click();
  await t.espera(150);
}

module.exports = [
  {
    nombre: "arranque: abre en la entrada, sin errores, y se llega a las tres secciones",
    correr: async (t) => {
      await t.abrir();
      t.igual(await t.pantalla(), "launchScreen", "pantalla inicial");
      t.igual(await t.page.locator(".lnCard").count(), 3, "tarjetas de la entrada");
      for (const [tarjeta, pantalla] of [["gym", "homeScreen"], ["stretch", "stretchScreen"], ["route", "routeScreen"]]) {
        await t.page.click(".lnCard." + tarjeta); await t.espera(250);
        t.igual(await t.pantalla(), pantalla, "tarjeta " + tarjeta);
        await t.ev(() => history.back()); await t.espera(300);      // boton atras de Android
        t.igual(await t.pantalla(), "launchScreen", "atras desde " + pantalla);
      }
    },
  },
  {
    nombre: "semana: va de lunes a domingo, tambien el domingo y de noche",
    correr: async (t) => {
      await t.abrir();
      const r = await t.ev(() => ({
        domingo: getWeekKey(new Date(2026, 9, 25, 10, 0)), domingoNoche: getWeekKey(new Date(2026, 9, 25, 23, 59)),
        lunes0: getWeekKey(new Date(2026, 9, 26, 0, 1)), sabado: getWeekKey(new Date(2026, 9, 24, 22, 30)),
        texto: getWeekKey("2026-10-25"), utc: getWeekKey(new Date("2026-10-19")),
        antes: wkAdd("2026-10-19", -1), despues: wkAdd("2026-10-19", 1),
        diaLocal: localDay(new Date(2026, 9, 25, 23, 30).getTime()),
      }));
      t.igual(r, { domingo: "2026-10-19", domingoNoche: "2026-10-19", lunes0: "2026-10-26", sabado: "2026-10-19", texto: "2026-10-19", utc: "2026-10-19", antes: "2026-10-12", despues: "2026-10-26", diaLocal: "2026-10-25" }, "claves de semana");
    },
  },
  {
    nombre: "rutina: escribir no registra, el tilde si, tocarlo de nuevo la da de baja, y se guarda al terminar",
    correr: async (t) => {
      await t.abrir(sembrarRutina);
      await t.ev(() => { showScreen("homeScreen"); openRoutine("rA"); }); await t.espera(300);
      t.igual(await t.pantalla(), "trainScreen", "pantalla de rutina");
      const series = () => t.ev(() => { const w = gymData[getWeekKey(new Date())] || {}; return (w["Press de Banca"] || []).filter((x) => !x.warmup).map((x) => x.weight + "x" + x.reps + "@" + x.d); });
      const hoy = await t.ev(() => localDay());
      const fila = t.page.locator(".trEx").first().locator(".trRow:not(.done):not(.trHead)").first();
      await fila.locator(".trIn").nth(0).fill("80"); await fila.locator(".trIn").nth(1).fill("8"); await t.espera(200);
      t.igual(await series(), [], "solo con escribir no se registra");
      await fila.locator(".trOk").click(); await t.espera(200);
      t.igual(await series(), ["80x8@" + hoy], "serie registrada con el tilde y con el dia de hoy");
      await t.page.locator(".trEx").first().locator(".trRow.done .trOk").first().click(); await t.espera(200);
      t.igual(await series(), [], "tocar el tilde azul la da de baja");
      await registrarSerie(t, 80, 8); await registrarSerie(t, 80, 7);
      t.igual((await series()).length, 2, "dos series registradas");
      // navegar no corta la rutina
      await t.ev(() => showScreen("homeScreen")); await t.espera(200);
      t.ok(await t.ev(() => !!trainGetSession() && document.getElementById("liveBar").style.display !== "none"), "la rutina sigue en curso al salir de la pantalla");
      await t.ev(() => { openRoutine("rA", true); trainFinish(); }); await t.espera(250);
      await t.page.locator("#trSheetBody .trSheetPrimary").click(); await t.espera(400);
      const fin = await t.ev(() => ({ ses: loadSessions().map((s) => s.routine + ":" + s.totalSets), enCurso: !!trainGetSession(), dia: !!(gymData.trainingDays || {})[localDay()], guardado: JSON.parse(localStorage.getItem("gymData"))[getWeekKey(new Date())]["Press de Banca"].length }));
      t.igual(fin, { ses: ["Empuje:2"], enCurso: false, dia: true, guardado: 2 }, "sesión guardada");
    },
  },
  {
    nombre: "rutina: el tilde toma el peso y las reps sugeridas; calentamiento al 45 % y 65 %",
    correr: async (t) => {
      await t.abrir(() => {
        localStorage.setItem("gymStretchSug", "0");
        localStorage.setItem("gymRoutines", JSON.stringify({ folders: [{ id: "f1", name: "R", open: true, routines: [{ id: "rA", name: "Empuje", exercises: ["Press de Banca"] }] }] }));
        const d = new Date(); d.setDate(d.getDate() - 7); const p = (n) => (n < 10 ? "0" : "") + n;
        const dia = d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate());
        const lunes = new Date(d); lunes.setDate(d.getDate() - ((d.getDay() + 6) % 7));
        const wk = lunes.getFullYear() + "-" + p(lunes.getMonth() + 1) + "-" + p(lunes.getDate());
        const g = {}; g[wk] = { "Press de Banca": [1, 2, 3].map((i) => ({ reps: "8", weight: "100", d: dia, t: d.getTime() + i, rir: 2 })) };
        localStorage.setItem("gymData", JSON.stringify(g));
      });
      const sug = await t.ev(() => { const s = progSuggest("Press de Banca"); return { modo: s.mode, sets: s.sets.map((x) => x.weight + "x" + x.reps) }; });
      t.igual(sug, { modo: "reps", sets: ["100x9", "100x9", "100x9"] }, "doble progresión: mismo peso y una rep más");
      await t.ev(() => { showScreen("homeScreen"); openRoutine("rA"); }); await t.espera(300);
      await t.page.locator(".trEx").first().locator(".trRow:not(.done):not(.trHead) .trOk").first().click(); await t.espera(200);
      const s = await t.ev(() => (gymData[getWeekKey(new Date())]["Press de Banca"] || []).map((x) => x.weight + "x" + x.reps));
      t.igual(s, ["100x9"], "el tilde sin escribir toma lo sugerido");
      t.igual(await t.ev(() => WARM_PCTS.slice(0, 2)), [0.45, 0.65], "porcentajes de calentamiento");
    },
  },
  {
    nombre: "progresión: sube el peso al tope del rango y pide calibrar sin historial",
    correr: async (t) => {
      await t.abrir();
      const r = await t.ev(() => {
        const wk = wkAdd(getWeekKey(new Date()), -1); gymData[wk] = {};
        gymData[wk]["Press de Banca"] = [1, 2, 3].map((i) => ({ reps: "10", weight: "100", d: wk, t: i, rir: 2 }));
        const R = repRange("Press de Banca"), a = progSuggest("Press de Banca"), b = progSuggest("Sentadilla");
        return { rango: R, modo: a.mode, peso: a.sets[0].weight, reps: a.sets[0].reps, sinHistorial: b.mode };
      });
      t.igual(r, { rango: [6, 10], modo: "up", peso: "102.5", reps: 6, sinHistorial: "calib" }, "sugerencia");
    },
  },
  {
    nombre: "músculos y balance: tabla revisada, principal suma 1 y secundarios 0,5",
    correr: async (t) => {
      await t.abrir();
      const r = await t.ev(() => {
        const m = exMuscles("Encogimientos de Hombros con Mancuernas"), b = exMuscles("Press de Banca");
        let total = 0, revisados = 0;
        Object.keys(LIBRARY).forEach((g) => (LIBRARY[g].exercises || []).forEach((n) => { total++; if (exMuscles(n, g).src === "revisado") revisados++; }));
        const wk = getWeekKey(new Date()), hoy = localDay(); gymData[wk] = {};
        gymData[wk]["Press de Banca"] = [1, 2, 3].map((i) => ({ reps: "8", weight: "80", d: hoy, t: i, rir: 2 }));
        gymData[wk]["Sentadilla"] = [{ reps: "8", weight: "100", d: hoy, t: 9, rir: 6 }, { reps: "5", weight: "60", d: hoy, t: 8, warmup: true }];
        const v = computeWeeklyVolume(wk);
        return { encogimiento: m.p, banca: b.p + "|" + b.s.join(","), todos: revisados === total && total > 700, pecho: v.Pecho, triceps: v.Triceps, piernas: v.Piernas || 0 };
      });
      t.igual(r, { encogimiento: "trapecio", banca: "pecho|delt_ant,triceps", todos: true, pecho: 3, triceps: 1.5, piernas: 0 }, "músculos y series efectivas (lejos del fallo y calentamiento no cuentan)");
    },
  },
  {
    nombre: "entrenamiento continuo: el Día 1 es la rutina que sigue a la última de la semana anterior",
    correr: async (t) => {
      await t.abrir();
      const r = await t.ev(() => {
        const f = { id: "fc", name: "Continuo", open: true, cont: true, routines: ["A", "B", "C", "D", "E"].map((L) => ({ id: "r" + L, name: "Rutina " + L, exercises: ["Sentadilla"] })) };
        routinesData().folders.push(f); persistRoutines();
        const vacio = contState(f), w0 = contWeekStart(), dia = 864e5;
        const ses = ["A", "B", "C"].map((L, i) => ({ id: "s" + i, start: w0 - 7 * dia + i * dia, end: w0 - 7 * dia + i * dia + 36e5, routineId: "r" + L, routine: L }));
        localStorage.setItem("gymSessions", JSON.stringify(ses));
        const st = contState(f), titulo = routineTitle("rD");
        ses.push({ id: "s9", start: Date.now() - 1000, end: Date.now(), routineId: "rD", routine: "D" }); localStorage.setItem("gymSessions", JSON.stringify(ses));
        const st2 = contState(f);
        return { sinHistorial: vacio.label.rA + "/" + vacio.next, dias: ["A", "B", "C", "D", "E"].map((L) => st.label["r" + L]), sigue: st.next, titulo, despues: st2.next, hechas: st2.weekCount, diasIgual: st2.label.rD };
      });
      t.igual(r, { sinHistorial: "1/rA", dias: [3, 4, 5, 1, 2], sigue: "rD", titulo: "Día 1 · Rutina D", despues: "rE", hechas: 1, diasIgual: 1 }, "rotación");
    },
  },
  {
    nombre: "recorrido: suma la distancia, ignora saltos del GPS y señal mala, pausa y guarda parciales",
    correr: async (t) => {
      await t.abrir(gpsSimulado);
      await t.ev(() => localStorage.setItem("gymStretchSug", "0"));
      await t.page.click(".lnCard.route"); await t.espera(300);
      await t.page.locator(".rtModes button", { hasText: "Correr" }).click();
      await t.page.click("#rtStartBtn"); await t.espera(500);
      // 400 s a 5 m/s hacia el norte: un salto de 550 m y una señal de 80 m de precision no cuentan
      await t.ev(() => { let lat = -32.9442, lon = -60.6505; for (let i = 0; i < 400; i++) { window.__off += 1000; lat += 5 / 110540; if (i === 100) window.__fix(lat + 0.005, lon, 8, 30); else if (i === 200) window.__fix(lat, lon, 80, 30); else window.__fix(lat, lon, 8, 20 + i * 0.1); } });
      await t.espera(1300);
      let st = await t.ev(() => RouteGps.status());
      t.cerca(st.dist, 2000, 40, "distancia tras 400 s"); t.cerca(st.elapsed / 1000, 400, 4, "tiempo");
      t.ok(await t.ev(() => RT.pts.length > 300 && document.getElementById("rtDist").textContent.indexOf("2,0") === 0), "la pantalla muestra los puntos y los km");
      await t.page.click("#rtPause"); await t.espera(300);
      await t.ev(() => { window.__off += 120000; window.__fix(-32.90, -60.65, 8, 20); });   // en pausa no suma tiempo ni distancia
      await t.page.click("#rtPause"); await t.espera(300);
      await t.ev(() => { let lat = -32.9442 + 400 * 5 / 110540 + 0.0003; for (let i = 0; i < 200; i++) { window.__off += 1000; lat += 3 / 110540; window.__fix(lat, -60.6497, 8, 60 - i * 0.2); } });
      await t.espera(1300);
      st = await t.ev(() => RouteGps.status());
      t.cerca(st.dist, 2600, 60, "distancia con la pausa"); t.cerca(st.elapsed / 1000, 600, 6, "tiempo sin contar la pausa");
      await t.page.click("#rtStop"); await t.espera(250);
      await t.page.locator("#trSheetBody button", { hasText: "Guardar recorrido" }).click(); await t.espera(600);
      const g = await t.ev(() => { const r = routes[routes.length - 1]; return { n: routes.length, modo: r.mode, dist: r.dist, dur: r.dur, parciales: r.splits.length, km1: r.splits[0][0], tramos: r.poly.length, vmax: r.vmax, balance: Object.values(computeWeeklyVolume(getWeekKey(new Date()))).reduce((a, b) => a + b, 0), vista: RT.view }; });
      t.igual([g.n, g.modo, g.parciales, g.km1, g.tramos, g.balance, g.vista], [1, "correr", 3, 1000, 2, 0, "detail"], "recorrido guardado (no suma al Balance)");
      t.cerca(g.dist, 2600, 60, "distancia guardada"); t.cerca(g.dur, 600, 6, "duración guardada"); t.cerca(g.vmax, 5, 0.3, "velocidad máxima");
      t.ok((await t.page.locator(".rtSplit").count()) === 3 && (await t.page.locator("#rtMap .rmLine").count()) >= 1, "detalle con parciales y trazado");
    },
  },
  {
    nombre: "estiramiento: el programa guiado avanza por lados y vueltas y registra los minutos",
    correr: async (t) => {
      await t.abrir();
      const d = await t.ev(() => ({ programas: ST_BUILTIN.length, existen: ST_BUILTIN.every((p) => p.steps.every((s) => typeof MUSCLE_TABLE[s.ex] !== "undefined")), dur: stDur(stFind("b_post_leg")) }));
      t.ok(d.programas >= 7 && d.existen, "los programas armados usan ejercicios de la biblioteca");
      await t.page.click(".lnCard.stretch"); await t.espera(250);
      await t.page.locator(".stProg", { hasText: "Estirar después: piernas" }).click(); await t.espera(200);
      await t.page.click("#stGo"); await t.espera(400);
      t.igual(await t.pantalla(), "stPlayScreen", "reproductor");
      const ui = () => t.ev(() => document.getElementById("stpSub").textContent + " | " + document.getElementById("stpClock").textContent);
      t.ok(/Preparate/.test(await ui()), "empieza con la preparación");
      await t.adelantar(6000); await t.espera(450); t.ok(/Lado derecho/.test(await ui()), "lado derecho");
      await t.adelantar(31000); await t.espera(450); t.ok(/Cambiá de lado/.test(await ui()), "aviso de cambio de lado");
      await t.adelantar(5000); await t.espera(450); t.ok(/Lado izquierdo/.test(await ui()), "lado izquierdo");
      await t.page.click("#stpPause"); await t.adelantar(60000); await t.espera(450);
      const antes = await ui(); await t.espera(450); t.igual(await ui(), antes, "en pausa no avanza");
      await t.page.click("#stpPause"); await t.adelantar(3600000); await t.espera(600);
      const log = await t.ev(() => stData.log[stData.log.length - 1]);
      t.igual(log.pid, "b_post_leg", "sesión registrada"); t.cerca(log.secs, d.dur, 2, "duración registrada");
      t.ok(log.hold.cuadriceps >= 140 && log.hold.isquios >= 140, "minutos por zona");
      t.ok(await t.page.locator("#stpDone").isVisible(), "pantalla de fin");
    },
  },
  {
    nombre: "copia de seguridad: exportar e importar devuelve todo, con resguardo previo",
    correr: async (t) => {
      await t.abrir(sembrarRutina);
      const r = await t.ev(async () => {
        const wk = getWeekKey(new Date()); gymData[wk] = { "Press de Banca": [{ reps: "8", weight: "80", d: localDay(), t: 1, rir: 2 }] }; persist();
        routes.push({ id: "r1", mode: "correr", start: 1, end: 2, dur: 600, dist: 2000, gain: 0, splits: [], poly: [] }); persistRoutes();
        const copia = JSON.parse(JSON.stringify(buildFullBackup())), claves = Object.keys(copia.data).sort();
        // se pisan los datos y se importa la copia
        gymData[wk]["Press de Banca"][0].weight = "999"; persist(); localStorage.setItem("gymRoutes", "[]");
        pendingImport = copia; window.__recargas = 0;
        return { claves, tieneRutas: claves.indexOf("gymRoutes") >= 0, tieneEstir: BACKUP_KEYS.indexOf("gymStretch") >= 0 };
      });
      t.ok(r.tieneRutas && r.tieneEstir && r.claves.indexOf("gymData") >= 0 && r.claves.indexOf("gymRoutines") >= 0, "la copia incluye registros, rutinas, recorridos y estiramientos");
      await Promise.all([t.page.waitForNavigation(), t.ev(() => { confirmImport(); })]);   // importa y recarga
      await t.page.waitForFunction(() => typeof launchInit === "function"); await t.espera(200);
      const d = await t.ev(async () => ({ peso: gymData[getWeekKey(new Date())]["Press de Banca"][0].weight, rutas: routes.length, resguardos: (await BackupStore.list()).items.filter((x) => x.name.indexOf("gimnasio_antes_de_importar_") === 0).length }));
      t.igual(d, { peso: "80", rutas: 1, resguardos: 1 }, "datos restaurados y resguardo guardado antes de importar");
      // el resguardo tiene lo que habia antes de importar
      const pre = await t.ev(async () => { const L = await BackupStore.list(); const x = L.items.filter((i) => i.name.indexOf("gimnasio_antes_") === 0)[0]; return JSON.parse(JSON.parse(await BackupStore.read(x.id)).data.gymData)[getWeekKey(new Date())]["Press de Banca"][0].weight; });
      t.igual(pre, "999", "contenido del resguardo");
    },
  },
  {
    nombre: "copia automática: solo cuando hay cambios, conserva las últimas y se puede restaurar",
    correr: async (t) => {
      await t.abrir((cfg) => { localStorage.setItem("gymStretchSug", "0"); }, null);
      const r = await t.ev(async () => {
        const out = {};
        out.sinDatos = await autoBackup("sesion");
        const wk = getWeekKey(new Date()); gymData[wk] = { "Sentadilla": [{ reps: "5", weight: "100", d: localDay(), t: 1, rir: 2 }] }; persist();
        out.primera = !!(await autoBackup("sesion"));
        out.sinCambios = await autoBackup("sesion");
        gymData[wk]["Sentadilla"].push({ reps: "5", weight: "105", d: localDay(), t: 2, rir: 1 }); persist();
        out.alAbrirMismoDia = await autoBackup("abrir");
        window.__off += 21 * 3600e3;
        out.alAbrirOtroDia = !!(await autoBackup("abrir"));
        for (let i = 0; i < 9; i++) { window.__off += 1000; gymData[wk]["Sentadilla"][0].reps = String(6 + i); persist(); await autoBackup("sesion"); }
        const L = await BackupStore.list(); out.guardadas = L.items.filter((x) => x.name.indexOf("gimnasio_auto_") === 0).length;
        localStorage.setItem("gymBkAuto", "0"); gymData[wk]["Sentadilla"][0].reps = "1"; persist();
        out.apagada = await autoBackup("sesion"); out.forzada = !!(await autoBackup("sesion", true));
        return out;
      });
      t.igual(r, { sinDatos: null, primera: true, sinCambios: null, alAbrirMismoDia: null, alAbrirOtroDia: true, guardadas: 7, apagada: null, forzada: true }, "reglas de la copia automática");
      // pantalla: estado y lista
      await t.ev(() => { showScreen("launchScreen"); }); await t.page.click("#lnBackup"); await t.espera(200);
      t.ok(/Copia automática/.test(await t.page.locator("#trSheetBody").innerText()), "hoja de copia de seguridad");
      await t.page.locator("#trSheetBody button", { hasText: "Ver y restaurar" }).click(); await t.espera(400);
      t.ok((await t.page.locator("#trSheetBody .trSheetBtn").count()) >= 7, "lista de copias guardadas");
    },
  },
  {
    nombre: "APK simulado: la copia va a Documentos/Gimnasio y al guardar una rutina se hace sola",
    correr: async (t) => {
      await t.abrir(sembrarRutina);
      await t.page.addInitScript(apkSimulado, { code: 340, name: "1.34", release: { name: "Gimnasio APK 1.34 (build 340)", body: "Novedad", assets: [{ name: "gimnasio.apk", size: 100 }] } });
      await t.page.reload(); await t.page.waitForFunction(() => typeof launchInit === "function"); await t.espera(300);
      await t.ev(() => { showScreen("homeScreen"); openRoutine("rB"); }); await t.espera(300);
      await registrarSerie(t, 100, 5);
      await t.ev(() => trainFinish()); await t.espera(250);
      await t.page.locator("#trSheetBody .trSheetPrimary").click(); await t.espera(2200);
      const r = await t.ev(() => ({ archivos: Object.values(__nat.archivos).map((a) => a.name.replace(/\d/g, "#")), tieneSerie: Object.values(__nat.archivos).some((a) => a.text.indexOf("Sentadilla") > 0), donde: localStorage.getItem("gymBkWhere") }));
      t.igual(r, { archivos: ["gimnasio_auto_####-##-##_######.json"], tieneSerie: true, donde: "Documentos/Gimnasio" }, "copia automática nativa");
    },
  },
  {
    nombre: "actualizador: ofrece la versión nueva y permite volver a las anteriores",
    correr: async (t) => {
      const release = { name: "Gimnasio APK 1.35 (build 350)", body: "Arreglo del GPS\n\ntexto\n\n<!-- versiones {\"actual\":{\"sha\":\"c\",\"name\":\"1.35\"},\"anteriores\":[{\"sha\":\"b\",\"name\":\"1.34\",\"novedad\":\"Copias automáticas\",\"build\":355,\"asset\":\"gimnasio-anterior-1.apk\"},{\"sha\":\"a\",\"name\":\"1.33\",\"novedad\":\"GPS\",\"build\":356,\"asset\":\"gimnasio-anterior-2.apk\"},{\"sha\":\"z\",\"name\":\"1.32\",\"novedad\":\"sin archivo\",\"build\":357,\"asset\":\"no-esta.apk\"}]} -->",
        assets: [{ name: "gimnasio.apk", size: 3600000 }, { name: "gimnasio-anterior-1.apk", size: 3500000 }, { name: "gimnasio-anterior-2.apk", size: 3400000 }] };
      // 1) instalada la 1.34: ofrece actualizar a 1.35 y volver solo a la 1.33
      await t.page.addInitScript(apkSimulado, { code: 340, name: "1.34", release });
      await t.abrir(); await t.ev(() => Updater.check(true)); await t.espera(300);
      let r = await t.ev(() => ({ tarjeta: document.getElementById("updCard").innerText.replace(/\n+/g, " | "), volver: Updater.older().map((p) => p.name), pie: document.querySelector(".updFoot").innerText.replace(/\n+/g, " | ") }));
      t.ok(/Nueva versión disponible/.test(r.tarjeta) && /1\.34 → 1\.35/.test(r.tarjeta) && /Arreglo del GPS/.test(r.tarjeta), "tarjeta de actualización: " + r.tarjeta);
      t.igual(r.volver, ["1.33"], "desde la 1.34 se puede volver a la 1.33");
      await t.page.locator("#updCard .updGo").click(); await t.espera(300);
      t.igual(await t.ev(() => __nat.instalado.url.split("/").pop()), "gimnasio.apk", "descarga la versión nueva");
      // 2) instalada la última (1.35): sin tarjeta, y se puede volver a 1.34 o 1.33
      await t.ev((rel) => { __nat.cfg.code = 350; __nat.cfg.name = "1.35"; __nat.instalado = null; Updater.state.phase = "idle"; return Updater.check(true); }, release); await t.espera(300);
      r = await t.ev(() => ({ tarjeta: document.getElementById("updCard").innerText, volver: Updater.older().map((p) => p.name + ":" + p.build) }));
      t.igual(r, { tarjeta: "", volver: ["1.34:355", "1.33:356"] }, "en la última versión");
      await t.page.locator(".updBack").click(); await t.espera(200);
      await t.page.locator("#trSheetBody button", { hasText: "Volver a la 1.34" }).click(); await t.espera(200);
      t.ok(/Volver a la versión anterior/.test(await t.page.locator("#updCard").innerText()), "tarjeta para volver");
      await t.page.locator("#updCard .updGo").click(); await t.espera(300);
      t.igual(await t.ev(() => __nat.instalado.url.split("/").pop() + ":" + __nat.instalado.size), "gimnasio-anterior-1.apk:3500000", "descarga la versión anterior");
      // 3) con una versión restaurada (código 355) no ofrece la 350, pero sí la 1.36 cuando salga
      r = await t.ev(async () => { __nat.cfg.code = 355; __nat.cfg.name = "1.34 (restaurada)"; Updater.state.phase = "idle"; Updater.state.rb = null; const a = await Updater.check(true); const o = Updater.older().map((p) => p.name);
        const nuevo = Updater.parseRelease({ name: "Gimnasio APK 1.36 (build 360)", body: "x", assets: [] }), viejo = Updater.parseRelease({ name: "Gimnasio APK (build 33)", body: "Novedad vieja", assets: [{ name: "gimnasio.apk", size: 5 }] });
        return { ofrece: !!a, volver: o, nuevo: nuevo.build > 355, viejo: viejo.name + "/" + viejo.build + "/" + viejo.prev.length }; });
      t.igual(r, { ofrece: false, volver: ["1.33"], nuevo: true, viejo: "1.33/33/0" }, "versión restaurada");
    },
  },
  {
    nombre: "entrada: con una rutina en curso o un recorrido grabando, la app abre directo ahí",
    correr: async (t) => {
      await t.abrir(() => { sessionStorage.setItem("x", "1"); });
      await t.ev(() => { localStorage.setItem("gymStretchSug", "0"); localStorage.setItem("gymRoutines", JSON.stringify({ folders: [{ id: "f1", name: "R", open: true, routines: [{ id: "rA", name: "Empuje", exercises: ["Press de Banca"] }] }] })); localStorage.setItem("gymSessionStart", JSON.stringify({ d: localDay(), t: Date.now() - 600000, routineId: "rA" })); });
      await t.page.reload(); await t.page.waitForFunction(() => typeof launchInit === "function"); await t.espera(400);
      t.igual(await t.pantalla(), "trainScreen", "abre en la rutina en curso");
      await t.ev(() => { localStorage.removeItem("gymSessionStart"); });
      await t.page.addInitScript(apkSimulado, { code: 340, name: "1.34", release: { name: "x" }, ruta: { state: "running", mode: "correr", elapsed: 754000, dist: 2100, count: 0, gps: true, granted: true, fixAcc: 9, fixAgo: 300 } });
      await t.page.reload(); await t.page.waitForFunction(() => typeof launchInit === "function"); await t.espera(900);
      t.igual(await t.pantalla(), "routeScreen", "abre en el recorrido que está grabando");
    },
  },
  {
    nombre: "fechas: entrenar un domingo a las 22:30 cuenta ese día y esa semana (no el lunes)",
    correr: async (t) => {
      await t.abrir(sembrarRutina);
      // se adelanta el reloj hasta el proximo domingo a las 22:30 de Argentina (lunes 01:30 UTC)
      await t.ev(() => { const real = new Date(), d = new Date(real.getTime()); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(22, 30, 0, 0); window.__off += d.getTime() - real.getTime(); });
      const antes = await t.ev(() => ({ dia: new Date().getDay(), hora: new Date().getHours(), utc: new Date().toISOString().slice(0, 10), local: localDay() }));
      t.ok(antes.dia === 0 && antes.hora === 22 && antes.utc !== antes.local, "reloj en domingo de noche (en UTC ya es lunes)");
      await t.ev(() => { showScreen("homeScreen"); openRoutine("rB"); }); await t.espera(300);
      await registrarSerie(t, 100, 5);
      await t.ev(() => trainFinish()); await t.espera(250);
      await t.page.locator("#trSheetBody .trSheetPrimary").click(); await t.espera(400);
      const r = await t.ev(() => { const wk = getWeekKey(new Date()), dias = weekDays(wk); return { ultimoDia: dias[6] === localDay(), serieEnSemana: (gymData[wk].Sentadilla || []).length, marcado: Object.keys(gymData.trainingDays), hoy: localDay(), entrenados: daysTrained(wk), siguiente: daysTrained(wkAdd(wk, 1)), racha: calcStreak(), entrada: launchGymInfo().txt, lunesEsLunes: wkDate(wk).getDay() }; });
      t.igual([r.ultimoDia, r.serieEnSemana, r.marcado, r.entrenados, r.siguiente, r.lunesEsLunes], [true, 1, [r.hoy], 1, 0, 1], "día y semana locales");
      t.ok(/Esta semana: 1 /.test(r.entrada), "la entrada cuenta 1 día: " + r.entrada);
    },
  },
  {
    nombre: "nombres: los ejercicios de cardio en inglés pasan a español sin perder historial, rutinas ni video",
    correr: async (t) => {
      await t.abrir(() => {
        if (localStorage.getItem("__s")) return; localStorage.setItem("__s", "1");
        localStorage.setItem("gymData", JSON.stringify({ "2026-11-02": { "Rowing": [{ reps: "1", weight: "0", d: "2026-11-03", t: 1 }], "Máquina de Remo": [{ reps: "2", weight: "0", d: "2026-11-04", t: 2 }], "Press de Banca": [{ reps: "8", weight: "80", d: "2026-11-03", t: 3, rir: 2 }] }, notes: { "Stationary Bike Run": "nivel 8" } }));
        localStorage.setItem("gymRoutines", JSON.stringify({ folders: [{ id: "f", name: "Rowing", open: true, routines: [{ id: "r", name: "Cardio", exercises: ["Elliptical Machine Walk", "Elíptica", "Press de Banca", "Bicycle Recline Walk"] }] }] }));
        localStorage.setItem("gymRepRange", JSON.stringify({ "Walk Elliptical Cross Trainer": [10, 15] }));
      });
      const r = await t.ev(() => {
        const todos = []; Object.keys(LIBRARY).forEach((g) => (LIBRARY[g].exercises || []).forEach((n) => todos.push(n)));
        const ingles = todos.filter((n) => /\b(Walk|Run|Bike|Bicycle|Rowing|Machine|Trainer)\b/.test(n));
        return { ingles, cardio: LIBRARY.Cardio.exercises.slice().sort(), remo: gymData["2026-11-02"]["Máquina de Remo"].map((x) => x.reps).sort(), viejo: gymData["2026-11-02"].Rowing === undefined, banca: gymData["2026-11-02"]["Press de Banca"].length,
          nota: gymData.notes["Bicicleta Fija"], carpeta: routinesData().folders[0].name, rutina: findRoutine("r").routine.exercises, rango: repRange("Elíptica con Brazos"),
          videos: ["Elíptica", "Elíptica con Brazos", "Bicicleta Fija", "Bicicleta Reclinada", "Máquina de Remo"].map((n) => decodeURIComponent(getVideoSrc(n).split("/").pop())),
          sinVolumen: exMuscles("Bicicleta Fija").p === null && exMuscles("Elíptica").src === "revisado" };
      });
      t.igual(r, { ingles: [], cardio: ["Bicicleta Fija", "Bicicleta Reclinada", "Elíptica", "Elíptica con Brazos", "Máquina de Remo"], remo: ["1", "2"], viejo: true, banca: 1, nota: "nivel 8", carpeta: "Rowing",
        rutina: ["Elíptica", "Press de Banca", "Bicicleta Reclinada"], rango: [10, 15],
        videos: ["Elíptica.mp4", "Elíptica.mp4", "Bicicleta Estacionaria.mp4", "Bicycle Recline Walk.mp4", "Máquina de Remo.mp4"], sinVolumen: true }, "migración de nombres");
    },
  },
  {
    nombre: "inicio del gimnasio: series de la semana contra el objetivo, sin restos del sistema viejo",
    correr: async (t) => {
      await t.abrir(sembrarRutina);
      await t.ev(() => { const wk = getWeekKey(new Date()), hoy = localDay(); gymData[wk] = { "Press de Banca": [1, 2, 3, 4].map((i) => ({ reps: "8", weight: "80", d: hoy, t: i, rir: 2 })) }; gymData.trainingDays = {}; gymData.trainingDays[hoy] = 1; persist(); showScreen("homeScreen"); });
      await t.espera(300);
      const r = await t.ev(() => { const T = weekTargets(getWeekKey(new Date())), pe = T.filter((x) => x.g === "Pecho")[0];
        return { grupos: T.length, pecho: pe.sets + "/" + pe.target, objetivoPecho: pe.target === LANDMARKS.Pecho.mav_min, celdas: document.querySelectorAll("#summaryArea .wkCell").length, texto: document.getElementById("summaryArea").innerText.replace(/\n+/g, " | "),
          viejo: ["exerciseList", "filterScroll", "dayViewToggle", "exOverlay", "editScreen", "dayAssignOverlay"].filter((id) => document.getElementById(id)), funcionesViejas: ["renderExercises", "openEx", "saveExercise", "renderEditScreen"].filter((f) => typeof window[f] === "function") }; });
      t.igual([r.grupos, r.pecho, r.objetivoPecho, r.celdas, r.viejo, r.funcionesViejas], [8, "4/" + r.pecho.split("/")[1], true, 8, [], []], "tarjeta de series");
      t.ok(/Series de esta semana/i.test(r.texto) && /Días esta semana/i.test(r.texto) && !/0\/22|Progreso semanal/.test(r.texto), "textos de la tarjeta: " + r.texto.slice(0, 200));
      await t.page.click("#wkGoBal"); await t.espera(250);
      t.igual(await t.pantalla(), "balanceScreen", "el título lleva al Balance");
      // con mesociclo, el objetivo es el del mesociclo
      const m = await t.ev(() => { const wk = getWeekKey(new Date()); safeStore("gymMeso", JSON.stringify({ id: "m1", start: wk, acc: 4, focus: {} })); try { mesoCache = null; } catch (e) {} const ma = mesoActive(wk); return ma ? { obj: weekTargets(wk).filter((x) => x.g === "Pecho")[0].target, esperado: mesoTarget(ma.m, "Pecho", ma.i) } : null; });
      if (m) t.igual(m.obj, m.esperado, "objetivo del mesociclo");
    },
  },
  {
    nombre: "estiramiento sin señal: el reproductor pide el video a la copia guardada en el celular",
    correr: async (t) => {
      await t.abrir();
      const r = await t.ev(async () => {
        const pedidos = []; const orig = window.setCachedVideoSrc; window.setCachedVideoSrc = function (v, url) { pedidos.push(decodeURIComponent(url.split("/").pop())); };
        stPlay(stFind("b_pre_leg")); await new Promise((ok) => setTimeout(ok, 400));
        const directo = !!document.querySelector("#stpVid video[src]"); spStop(false); window.setCachedVideoSrc = orig;
        return { pedidos, directo, precarga: typeof stPrefetch === "function" };
      });
      t.igual(r, { pedidos: ["Gato-Vaca.mp4"], directo: false, precarga: true }, "video del reproductor por la caché");
    },
  },
  {
    nombre: "menús: los 3 puntos del ejercicio, la biblioteca, el editor de rutina y el resumen semanal funcionan",
    correr: async (t) => {
      await t.abrir(sembrarRutina);
      await t.ev(() => { const wk = getWeekKey(new Date()), hoy = localDay(); gymData[wk] = { "Press de Banca": [1, 2, 3].map((i) => ({ reps: "8", weight: "80", d: hoy, t: i, rir: 2 })) }; gymData.trainingDays = {}; gymData.trainingDays[hoy] = 1; persist(); showScreen("homeScreen"); openRoutine("rA"); });
      await t.espera(300);
      const menu = async (texto) => { await t.ev(() => trainExMenu(exInfo("Press de Banca"))); await t.espera(200); await t.page.locator("#trSheetBody button", { hasText: texto }).first().click(); await t.espera(350); };
      await menu("Ver video"); t.ok(await t.ev(() => document.getElementById("exVideoOverlay").classList.contains("show") || document.getElementById("exDescOverlay").style.display !== "none"), "video y descripción");
      await t.ev(() => { closeTopOverlay(); closeTopOverlay(); }); await t.espera(150);
      await menu("Calculadora 1RM"); t.igual(await t.pantalla(), "rmScreen", "calculadora 1RM");
      await t.ev(() => handleRMBack()); await t.espera(250); t.igual(await t.pantalla(), "trainScreen", "volver de la calculadora");
      await menu("Progreso e historial"); t.igual(await t.pantalla(), "exHistScreen", "progreso");
      await t.ev(() => history.back()); await t.espera(300);
      await menu("Datos del ejercicio"); t.ok(/Músculo principal/.test(await t.page.locator("#trSheetBody").innerText()), "datos del ejercicio"); await t.ev(() => closeTrSheet());
      await menu("Nota"); await t.page.locator("#trSheetBody textarea").fill("agarre neutro"); await t.page.locator("#trSheetBody button", { hasText: /Guardar/ }).first().click(); await t.espera(200);
      t.igual(await t.ev(() => gymData.notes["Press de Banca"]), "agarre neutro", "nota guardada");
      await menu("Rango de repeticiones"); await t.page.locator("#trSheetBody button", { hasText: "8–12" }).click(); await t.espera(200);
      t.igual(await t.ev(() => repRange("Press de Banca")), [8, 12], "rango de repeticiones");
      // biblioteca: detalle de un ejercicio y agregarlo a una rutina
      await t.ev(() => { showScreen("libraryScreen"); }); await t.espera(300);
      await t.ev(() => openLibDetail("Curl con Barra", "Biceps", "#34D399", false)); await t.espera(400);
      t.igual(await t.ev(() => document.getElementById("libDetailName").textContent), "Curl con Barra", "detalle de la biblioteca");
      await t.ev(() => { try { closeLibDetail(); } catch (e) {} });
      // editor de rutina y superserie
      await t.ev(() => { showScreen("homeScreen"); openRoutineEditor("rA"); }); await t.espera(300);
      t.igual(await t.pantalla(), "rtEditScreen", "editor de rutina");
      await t.page.locator("button", { hasText: "Unir en superserie" }).first().click(); await t.espera(250);
      t.igual(await t.ev(() => supersets["Press de Banca"]), "Encogimientos de Hombros con Mancuernas", "superserie armada");
      // resumen semanal
      await t.ev(() => { showScreen("homeScreen"); showWeekSummary(getWeekKey(new Date())); }); await t.espera(300);
      t.igual(await t.pantalla(), "wsSummaryScreen", "resumen semanal");
      t.ok(/Días entrenados/i.test(await t.page.locator("#wsSummaryScreen").innerText()), "resumen con días entrenados");
    },
  },
  {
    nombre: "descarga: avisa cuando cae el rendimiento, y la semana de descarga baja series y peso",
    correr: async (t) => {
      await t.abrir(sembrarRutina); await irA(t, 3, 10);     // miercoles
      // caso sano: 5 semanas subiendo -> sin aviso
      let r = await t.ev((sem) => { eval("window.sembrarHistorial=" + sem); sembrarHistorial(5, "(i) => i === 0 ? [] : [['Press de Banca', 0, 3, 100 - i * 2.5, 8], ['Sentadilla', 2, 3, 120 - i * 2.5, 6], ['Remo con Barra', 4, 3, 80 - i * 2.5, 8]]"); const c = deloadCheck(); return { sug: c.suggest, sem: c.weeks, drops: c.drops.length }; }, sembrarHistorial.toString());
      t.igual(r, { sug: false, sem: 4, drops: 0 }, "progresando: no sugiere descarga");
      // 9 semanas de carga y en las dos ultimas cae el 1RM estimado en los tres ejercicios
      r = await t.ev(() => { Object.keys(gymData).forEach((k) => { if (/^\d{4}-/.test(k)) delete gymData[k]; }); _dlMemo = null;
        sembrarHistorial(10, "(i) => i === 0 ? [] : [['Press de Banca', 0, 3, i <= 2 ? 92.5 : 110 - i * 2.5, i <= 2 ? 7 : 8], ['Sentadilla', 2, 3, i <= 2 ? 115 : 135 - i * 2.5, 6], ['Remo con Barra', 4, 3, i <= 2 ? 70 : 90 - i * 2.5, 8]]");
        const c = deloadCheck(); showScreen("homeScreen"); return { sug: c.suggest, sem: c.weeks, drops: c.drops.map((d) => d.name).sort(), seguidos: c.tracked, motivos: c.reasons.join(" || "), tarjeta: !!document.querySelector(".dlCard") }; });
      t.igual([r.sug, r.sem, r.drops, r.seguidos, r.tarjeta], [true, 9, ["Press de Banca", "Remo con Barra", "Sentadilla"], 3, true], "sugiere descarga: " + r.motivos);
      t.ok(/Bajó el 1RM estimado en 3 de 3/.test(r.motivos) && /9 semanas seguidas/.test(r.motivos), "motivos: " + r.motivos);
      await t.page.click("#dlGo"); await t.espera(300);
      r = await t.ev(() => { const cur = getWeekKey(new Date()), s = progSuggest("Press de Banca"), T = weekTargets(cur).filter((x) => x.g === "Pecho")[0]; return { manual: dlManual() === cur, modo: s.mode, series: s.sets.length, peso: s.sets[0].weight, objetivo: T.target, mitadMev: Math.max(1, Math.round(LANDMARKS.Pecho.mev / 2)), tarjeta: (document.querySelector(".dlCard.on") || {}).innerText || "", activo: deloadCheck().active }; });
      t.igual([r.manual, r.modo, r.series, r.peso, r.objetivo === r.mitadMev, r.activo], [true, "deload", 2, "82.5", true, true], "semana de descarga en curso");
      t.ok(/Semana de descarga/.test(r.tarjeta), "tarjeta de descarga en curso");
      await t.page.click("#dlCancel"); await t.espera(300);
      t.igual(await t.ev(() => [dlManual(), progSuggest("Press de Banca").mode !== "deload", !!document.querySelector("#dlGo")]), ["", true, true], "cancelar la descarga");
      await t.page.click("#dlNo"); await t.espera(200);
      t.igual(await t.ev(() => { showScreen("homeScreen"); return [!!document.querySelector(".dlCard"), deloadCheck().snoozed]; }), [false, true], "'Ahora no' la pospone");
      // recien hecha una descarga no vuelve a sugerir
      t.igual(await t.ev(() => { localStorage.removeItem("gymDeloadSnooze"); localStorage.setItem("gymDeloadWk", wkAdd(getWeekKey(new Date()), -1)); _dlMemo = null; return deloadCheck().suggest; }), false, "después de una descarga no insiste");
    },
  },
  {
    nombre: "Balance: frecuencia por grupo con los días de la semana y equilibrio empuje/tracción",
    correr: async (t) => {
      await t.abrir(sembrarRutina); await irA(t, 6, 12);     // sabado
      const r = await t.ev((sem) => { eval("window.sembrarHistorial=" + sem);
        sembrarHistorial(3, "(i) => i === 0 ? [['Press de Banca', 0, 4, 80, 8], ['Press de Banca', 3, 3, 80, 8], ['Remo con Barra', 1, 3, 70, 8], ['Sentadilla', 0, 12, 100, 6], ['Curl Femoral Acostado', 2, 2, 40, 10], ['Press de Banca', 4, 2, 80, 8, 5]] : [['Press de Banca', 0, 6, 80, 8], ['Remo con Barra', 1, 6, 70, 8]]");
        const wk = getWeekKey(new Date()), F = weekFrequency(wk), W = weekPatterns(wk);
        return { patrones: [exMeta("Press de Banca").patron, exMeta("Remo con Barra").patron], pecho: F.Pecho.p.join(","), pechoDias: F.Pecho.days, triceps: F.Triceps.days + "/" + F.Triceps.s.join(","), piernasMax: F.Piernas.maxDay, push: W.push, pull: W.pull, eh: W.eh, quad: W.quad, ham: W.ham, veredicto: balVerdict(W.push, W.pull).c }; }, sembrarHistorial.toString());
      t.igual(r, { patrones: ["empuje_horizontal", "traccion_horizontal"], pecho: "4,0,0,3,0,0,0", pechoDias: 2, triceps: "0/2,0,0,1.5,0,0,0", piernasMax: 12, push: 7, pull: 3, eh: 7, quad: 12, ham: 2, veredicto: "warn" }, "frecuencia y patrones (las series con 4+ RIR no cuentan)");
      await t.ev(() => { balanceWeek = null; showScreen("balanceScreen"); }); await t.espera(300);
      const txt = await t.page.locator(".fqCard").innerText();
      t.ok(/Frecuencia por grupo/i.test(txt) && /2 días/.test(txt) && /solo secundario/.test(txt) && /12 series en un solo día/.test(txt), "tarjeta de frecuencia: " + txt.slice(0, 160).replace(/\n+/g, " | "));
      t.ok(/menos tracción que empuje/.test(txt) && /Promedio de las 2 semanas anteriores: 6 de empuje y 6 de tracción/.test(txt) && /Poco trabajo de isquios/.test(txt), "equilibrio: " + txt.slice(-420).replace(/\n+/g, " | "));
      t.igual(await t.page.locator(".fqRow .fqDots i.p").count() >= 5, true, "puntos de los días");
    },
  },
  {
    nombre: "máquina ocupada: la alternativa vale solo por hoy y la rutina vuelve a quedar como estaba",
    correr: async (t) => {
      await t.abrir(sembrarRutina);
      await t.ev(() => { const wk = wkAdd(getWeekKey(new Date()), -1); gymData[wk] = { "Press Inclinado con Mancuernas": [{ reps: "10", weight: "30", d: weekDays(wk)[1], t: 1, rir: 2 }] }; persist(); showScreen("homeScreen"); openRoutine("rA"); });
      await t.espera(300);
      const alts = await t.ev(() => machineAlternatives("Press de Banca", 6).map((a) => ({ n: a.name, p: exMuscles(a.name).p, conocido: a.known, patron: a.m.patron })));
      t.ok(alts.length >= 4 && alts.every((a) => a.p === "pecho") && !alts.some((a) => a.n === "Press de Banca" || a.n === "Encogimientos de Hombros con Mancuernas"), "alternativas del mismo músculo y fuera de la rutina");
      t.igual([alts[0].n, alts[0].conocido, alts[0].patron], ["Press Inclinado con Mancuernas", true, "empuje_horizontal"], "primero la que ya conocés, mismo patrón y otro equipo");
      await t.ev(() => trainExMenu(exInfo("Press de Banca"))); await t.espera(200);
      await t.page.locator("#trSheetBody button", { hasText: "Máquina ocupada" }).click(); await t.espera(350);
      t.ok(/última vez 30 kg × 10/.test(await t.page.locator("#trSheetBody").innerText()), "muestra la última marca");
      await t.page.locator("#trSheetBody button", { hasText: "Press Inclinado con Mancuernas" }).first().click(); await t.espera(350);
      let r = await t.ev(() => ({ rutina: findRoutine("rA").routine.exercises, cartel: (document.querySelector(".trSwap") || {}).textContent, primero: document.querySelector(".trEx .trExName").textContent }));
      t.igual(r, { rutina: ["Press Inclinado con Mancuernas", "Encogimientos de Hombros con Mancuernas"], cartel: "Hoy en lugar de Press de Banca", primero: "Press Inclinado con Mancuernas" }, "reemplazo por hoy");
      await registrarSerie(t, 32, 10);
      await t.ev(() => trainFinish()); await t.espera(250);
      await t.page.locator("#trSheetBody .trSheetPrimary").click(); await t.espera(400);
      r = await t.ev(() => ({ rutina: findRoutine("rA").routine.exercises, serie: (gymData[getWeekKey(new Date())]["Press Inclinado con Mancuernas"] || []).map((x) => x.weight), pendiente: localStorage.getItem("gymSwaps") }));
      t.igual(r, { rutina: ["Press de Banca", "Encogimientos de Hombros con Mancuernas"], serie: ["32"], pendiente: null }, "al terminar, la rutina vuelve a ser la original y la serie queda en el ejercicio que hiciste");
      // con series ya hechas en el original, la alternativa se agrega despues; y si la app se cierra, se deshace al abrir
      await t.ev(() => { openRoutine("rA"); }); await t.espera(300); await registrarSerie(t, 80, 8);
      r = await t.ev(() => { machineSwap("Press de Banca", "Press con Mancuernas"); const a = findRoutine("rA").routine.exercises.slice(); machineSwap("Encogimientos de Hombros con Mancuernas", "Encogimiento de Hombros con Barra"); const b = findRoutine("rA").routine.exercises.slice(); machineUndo("Encogimiento de Hombros con Barra", false); const c = findRoutine("rA").routine.exercises.slice(); localStorage.removeItem("gymSessionStart"); return { a, b, c }; });
      t.igual(r, { a: ["Press de Banca", "Press con Mancuernas", "Encogimientos de Hombros con Mancuernas"], b: ["Press de Banca", "Press con Mancuernas", "Encogimiento de Hombros con Barra"], c: ["Press de Banca", "Press con Mancuernas", "Encogimientos de Hombros con Mancuernas"] }, "agregar después y volver atrás");
      await t.page.reload(); await t.page.waitForFunction(() => typeof launchInit === "function"); await t.espera(300);
      t.igual(await t.ev(() => [findRoutine("rA").routine.exercises, localStorage.getItem("gymSwaps")]), [["Press de Banca", "Encogimientos de Hombros con Mancuernas"], null], "sin sesión en curso, el cambio se deshace al abrir la app");
    },
  },
  {
    nombre: "resumen semanal: queda listo el domingo a la tarde y se envía a Claude con los datos de la semana",
    correr: async (t) => {
      await t.page.addInitScript(apkSimulado, { code: 350, name: "1.35", release: { name: "x" } });
      await t.abrir(sembrarRutina); await irA(t, 0, 19);     // domingo 19 h
      const r = await t.ev((sem) => { eval("window.sembrarHistorial=" + sem);
        sembrarHistorial(3, "(i) => [['Press de Banca', 0, 3, 80 - i * 2.5, 8], ['Remo con Barra', 2, 3, 70, 8], ['Sentadilla', 4, 3, 100, 6]]");
        routes.push({ id: "r1", mode: "correr", start: Date.now() - 2 * 864e5, end: Date.now() - 2 * 864e5 + 18e5, dur: 1800, dist: 5000, gain: 0, splits: [], poly: [] }); persistRoutes();
        localStorage.setItem("gymSessions", JSON.stringify([{ id: "s1", start: Date.now() - 6 * 864e5 + 3600e3, end: Date.now() - 6 * 864e5 + 7200e3, dur: 3600, routineId: "rA", routine: "Empuje", totalSets: 3 }]));
        const cur = getWeekKey(new Date()); showScreen("launchScreen");
        return { lista: weeklyDue() === cur, tarjeta: (document.querySelector(".wkRep") || {}).innerText || "", texto: weeklyReport(cur) }; }, sembrarHistorial.toString());
      t.ok(r.lista && /Tu resumen de la semana está listo/.test(r.tarjeta) && /3 días y 9 series efectivas/.test(r.tarjeta), "tarjeta en la entrada: " + r.tarjeta.replace(/\n+/g, " | "));
      for (const trozo of [/Resumen de mi semana de entrenamiento/, /Días entrenados: 3/, /Rutinas terminadas: Empuje/, /Pecho: 3 \(objetivo \d+ · .* · 1 día · antes 3\)/, /Empuje 3 series \(3 horizontal, 0 vertical\) · Tracción 3/, /• Press de Banca: 80kg×8 RIR2, 80kg×8 RIR2, 80kg×8 RIR2 → 1RM est\. [\d,]+ kg \(\+[\d,]+ %\), mejor marca/, /Recorridos: correr 5,00 km en 30:00/])
        t.ok(trozo.test(r.texto), "el resumen incluye " + trozo + "\n" + r.texto);
      await t.page.locator(".wkRepGo").click(); await t.espera(300);
      const e = await t.ev(() => ({ compartido: (__nat.compartido || {}).text || "", hecho: localStorage.getItem("gymWeeklyDone") === getWeekKey(new Date()), tarjeta: !!document.querySelector(".wkRep"), otraVez: weeklyDue() }));
      t.ok(/Sos mi entrenador personal/.test(e.compartido) && /Analizá mi semana/.test(e.compartido) && /Series efectivas por grupo/.test(e.compartido), "se comparte con la pregunta y el resumen");
      t.igual([e.hecho, e.tarjeta, e.otraVez], [true, false, null], "una vez enviado, no vuelve a aparecer");
      // el miercoles siguiente, el resumen pendiente es el de la semana anterior (si no se envio)
      await irA(t, 3, 9);
      t.igual(await t.ev(() => { const cur = getWeekKey(new Date()), ant = wkAdd(cur, -1); const yaEnviada = weeklyDue(); localStorage.removeItem("gymWeeklyDone"); return [yaEnviada, weeklyDue() === ant, weekHasData(cur)]; }), [null, true, false], "entre semana se ofrece la semana anterior");
    },
  },
  {
    nombre: "pantallas principales: Balance, biblioteca, historial, récords, tiempos y mesociclo abren sin errores",
    correr: async (t) => {
      await t.abrir(sembrarRutina);
      await t.ev(() => { const wk = getWeekKey(new Date()), hoy = localDay(); gymData[wk] = { "Press de Banca": [1, 2, 3].map((i) => ({ reps: "8", weight: "80", d: hoy, t: i, rir: 2 })) }; persist(); });
      for (const p of ["homeScreen", "balanceScreen", "libraryScreen", "historyScreen", "prScreen", "tabataScreen", "mesoScreen", "stretchScreen", "routeScreen"]) {
        await t.ev((id) => showScreen(id), p); await t.espera(250);
        t.igual(await t.pantalla(), p, "pantalla " + p);
        t.ok(await t.ev((id) => document.getElementById(id).innerText.trim().length > 20, p), "la pantalla " + p + " tiene contenido");
      }
      await t.ev(() => { showScreen("balanceScreen"); }); await t.espera(200);
      t.ok(/Pecho/.test(await t.page.locator("#balanceScreen").innerText()), "el Balance muestra los grupos");
      await t.ev(() => { showExHistory("Press de Banca", "homeScreen"); }); await t.espera(300);
      t.igual(await t.pantalla(), "exHistScreen", "progreso de un ejercicio");
      const txt = await t.ev(() => aiSummary());
      t.ok(/Press de Banca/.test(txt) && /Series efectivas por grupo/.test(txt), "resumen para consultar a Claude");
    },
  },
];
