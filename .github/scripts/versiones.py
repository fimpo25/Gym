#!/usr/bin/env python3
"""Versiones publicadas de Gimnasio.

Android no deja instalar un APK con un codigo de version menor que el instalado. Para poder
"volver a la version anterior" desde la app, cada compilacion recompila tambien las dos versiones
publicadas antes, con un codigo mayor que el de la actual:
    actual            -> compilacion x 10        (ej. 340, se llama 1.34)
    anterior          -> compilacion x 10 + 5    (ej. 345, con el codigo de la 1.33)
    la de antes       -> compilacion x 10 + 6    (ej. 346, con el codigo de la 1.32)
La proxima version (350) se instala encima de cualquiera de las tres.

El historial viaja en las notas del release "apk", dentro de un comentario:
    <!-- versiones {"actual": {...}, "anteriores": [...]} -->

Uso:
    versiones.py plan  RELEASE.json            -> escribe hay= y matriz= en $GITHUB_OUTPUT
    versiones.py notas PLAN.json DIR_DE_APKS   -> imprime las notas del release nuevo
Variables: GITHUB_SHA, GITHUB_RUN_NUMBER y, para "notas", NOVEDAD.
"""
import json, os, re, sys

MARCA = re.compile(r"<!--\s*versiones\s+(\{.*\})\s*-->")


def limpiar(texto):
    # una sola linea y sin "--", para que entre en un comentario HTML
    return re.sub(r"\s+", " ", str(texto or "")).replace("--", "—").strip()[:200]


def historial(release):
    """Versiones ya publicadas, de la mas nueva a la mas vieja: [{sha, name, novedad}]"""
    if not release or not release.get("name"):
        return []
    cuerpo = release.get("body") or ""
    m = MARCA.search(cuerpo)
    if m:
        try:
            meta = json.loads(m.group(1))
            lista = [meta.get("actual") or {}] + list(meta.get("anteriores") or [])
            return [{"sha": v["sha"], "name": str(v.get("name", "")), "novedad": limpiar(v.get("novedad"))} for v in lista if v.get("sha")]
        except Exception:
            pass
    # release anterior a este esquema: titulo "Gimnasio APK (build 33)" y la novedad en la primera linea
    b = re.search(r"build\s+(\d+)", release.get("name") or "", re.I)
    sha = release.get("target_commitish") or ""
    if not b or not re.fullmatch(r"[0-9a-f]{40}", sha):
        return []
    return [{"sha": sha, "name": "1." + b.group(1), "novedad": limpiar(cuerpo.split("\n")[0])}]


def plan(release):
    sha, run = os.environ.get("GITHUB_SHA", ""), int(os.environ.get("GITHUB_RUN_NUMBER", "0"))
    vistos, anteriores = {sha}, []
    for v in historial(release):
        if v["sha"] in vistos:
            continue
        vistos.add(v["sha"])
        i = len(anteriores) + 1
        anteriores.append({"idx": i, "sha": v["sha"], "name": v["name"], "novedad": v["novedad"], "build": run * 10 + 4 + i, "asset": "gimnasio-anterior-%d.apk" % i})
        if i == 2:
            break
    return anteriores


def notas(anteriores, carpeta):
    sha, run = os.environ.get("GITHUB_SHA", ""), int(os.environ.get("GITHUB_RUN_NUMBER", "0"))
    novedad = limpiar(os.environ.get("NOVEDAD"))
    hechas = [a for a in anteriores if os.path.isfile(os.path.join(carpeta, a["asset"]))]
    meta = {"actual": {"sha": sha, "name": "1.%d" % run, "novedad": novedad, "build": run * 10}, "anteriores": hechas}
    lineas = [novedad, "", "APK de Android de Gimnasio. Instalar encima de la version anterior para conservar los datos."]
    if hechas:
        lineas += ["", "Versiones anteriores (se instalan encima de esta): " + ", ".join(a["name"] for a in hechas) + "."]
    lineas += ["", "<!-- versiones " + json.dumps(meta, ensure_ascii=False, separators=(",", ":")) + " -->"]
    return "\n".join(lineas) + "\n"


if __name__ == "__main__":
    modo = sys.argv[1]
    if modo == "plan":
        try:
            rel = json.load(open(sys.argv[2], encoding="utf-8"))
        except Exception:
            rel = {}
        ant = plan(rel)
        salida = "hay=%s\nmatriz=%s\n" % ("true" if ant else "false", json.dumps(ant, ensure_ascii=False, separators=(",", ":")))
        destino = os.environ.get("GITHUB_OUTPUT")
        if destino:
            open(destino, "a", encoding="utf-8").write(salida)
        sys.stdout.write(salida)
    elif modo == "notas":
        sys.stdout.write(notas(json.load(open(sys.argv[2], encoding="utf-8")), sys.argv[3]))
    else:
        sys.exit("modo desconocido")
