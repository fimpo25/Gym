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
