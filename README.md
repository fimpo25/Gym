# Gimnasio — APK de Android

Rama `android`: empaqueta la app (`www/index.html`) como APK nativo con Capacitor,
para que la alarma de fin de descanso suene con la pantalla bloqueada (notificación
nativa con AlarmManager) sin cortar la música de otras apps.

- **Actualizar la app:** reemplazar `www/index.html` y hacer push a esta rama.
  GitHub Actions compila, firma y publica `gimnasio.apk` en el release `apk`:
  https://github.com/fimpo25/Gym/releases/download/apk/gimnasio.apk
- **Instalar encima** de la versión anterior: se conservan los datos.
- **Firma:** `signing/gimnasio-release.p12.enc` (keystore cifrado). La contraseña vive en
  el secreto `ANDROID_KEYSTORE_PASSWORD`. Si se pierde, no se puede actualizar sin
  desinstalar (y desinstalar borra los datos): guardala en un gestor de contraseñas.
- La rama `main` no se toca.

## Pruebas, versiones y copias

- **Pruebas:** `tests/` abre la app en Chrome sin ventana y recorre los flujos principales
  (rutina, semana, progresión, músculos, recorridos, estiramiento, copias, actualizador).
  Se corren en cada push **antes** de compilar: si falla una, no se publica nada.
  En la computadora: `cd tests && npm install && node correr.js` (acepta un filtro: `node correr.js rutina`).
- **Versiones:** la compilación N se publica como `1.N` con código `N×10`. Android no deja
  instalar un código menor encima, así que cada compilación recompila también las dos versiones
  anteriores con códigos `N×10+5` y `N×10+6` (`gimnasio-anterior-1.apk` y `-2.apk`): la app las
  ofrece en "Volver a una versión anterior". El historial viaja en las notas del release
  (`.github/scripts/versiones.py`).
- **Copias automáticas:** la app guarda sola un archivo con todos los datos en
  `Documentos/Gimnasio` del celular (plugin `BackupPlugin`), conserva las últimas 7 y guarda un
  resguardo antes de importar.
