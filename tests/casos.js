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
