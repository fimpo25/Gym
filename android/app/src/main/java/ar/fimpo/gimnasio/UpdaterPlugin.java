package ar.fimpo.gimnasio;

import android.content.Intent;
import android.content.pm.PackageInfo;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;

/**
 * Actualizaciones de la app: consulta la ultima version publicada, baja el APK y abre el
 * instalador de Android (el usuario confirma con "Instalar"; Android no permite instalar solo).
 */
@CapacitorPlugin(name = "Updater")
public class UpdaterPlugin extends Plugin {

    private static volatile long dlDone = 0;
    private static volatile long dlTotal = 0;
    private static volatile boolean dlRunning = false;

    private boolean canInstall() {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.O || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @SuppressWarnings("deprecation")
    @PluginMethod
    public void info(PluginCall call) {
        try {
            PackageInfo pi = getContext().getPackageManager().getPackageInfo(getContext().getPackageName(), 0);
            long code = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P ? pi.getLongVersionCode() : pi.versionCode;
            JSObject r = new JSObject();
            r.put("versionCode", code);
            r.put("versionName", pi.versionName);
            r.put("canInstall", canInstall());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudo leer la version: " + e.getMessage());
        }
    }

    /** GET de un texto (la API de GitHub), sin las restricciones de CORS del WebView. */
    @PluginMethod
    public void fetchText(PluginCall call) {
        final String url = call.getString("url");
        if (url == null) { call.reject("Falta la url"); return; }
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                c = open(url);
                int st = c.getResponseCode();
                if (st != 200) { call.reject("Respuesta " + st); return; }
                InputStream in = c.getInputStream();
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[8192];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
                JSObject r = new JSObject();
                r.put("text", new String(out.toByteArray(), StandardCharsets.UTF_8));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("Sin conexion: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
            }
        }).start();
    }

    /** Abre el ajuste "Permitir de esta fuente" de Gimnasio. */
    @PluginMethod
    public void openInstallSettings(PluginCall call) {
        try {
            Intent i;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                i = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            } else {
                i = new Intent(Settings.ACTION_SECURITY_SETTINGS);
            }
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo abrir el ajuste: " + e.getMessage());
        }
    }

    @PluginMethod
    public void progress(PluginCall call) {
        JSObject r = new JSObject();
        r.put("done", dlDone);
        r.put("total", dlTotal);
        r.put("running", dlRunning);
        call.resolve(r);
    }

    /** Baja el APK a la cache de la app y abre el instalador. */
    @PluginMethod
    public void downloadAndInstall(PluginCall call) {
        final String url = call.getString("url");
        final long expected = call.getLong("size", 0L);
        if (url == null) { call.reject("Falta la url"); return; }
        if (!canInstall()) { call.reject("Falta el permiso para instalar", "NO_PERMISSION"); return; }
        if (dlRunning) { call.reject("Ya se esta descargando"); return; }
        dlRunning = true;
        dlDone = 0;
        dlTotal = expected;
        new Thread(() -> {
            HttpURLConnection c = null;
            try {
                File dir = new File(getContext().getCacheDir(), "updates");
                if (!dir.exists() && !dir.mkdirs()) throw new Exception("sin espacio");
                File tmp = new File(dir, "gimnasio.apk.part");
                File apk = new File(dir, "gimnasio.apk");
                c = open(url);
                int st = c.getResponseCode();
                if (st != 200) throw new Exception("respuesta " + st);
                long len = c.getContentLength();
                if (len > 0) dlTotal = len;
                InputStream in = c.getInputStream();
                OutputStream out = new FileOutputStream(tmp);
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) { out.write(buf, 0, n); dlDone += n; }
                out.close();
                in.close();
                if (expected > 0 && tmp.length() != expected) throw new Exception("el archivo llego incompleto");
                if (apk.exists() && !apk.delete()) throw new Exception("no se pudo reemplazar el archivo anterior");
                if (!tmp.renameTo(apk)) throw new Exception("no se pudo guardar el archivo");
                final Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                final Intent i = new Intent(Intent.ACTION_VIEW);
                i.setDataAndType(uri, "application/vnd.android.package-archive");
                i.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getActivity().runOnUiThread(() -> {
                    try {
                        getActivity().startActivity(i);
                        call.resolve();
                    } catch (Exception e) {
                        call.reject("No se pudo abrir el instalador: " + e.getMessage());
                    }
                });
            } catch (Exception e) {
                call.reject("Fallo la descarga: " + e.getMessage());
            } finally {
                if (c != null) c.disconnect();
                dlRunning = false;
            }
        }).start();
    }

    private static HttpURLConnection open(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "Gimnasio-Android");
        c.setRequestProperty("Accept", "application/vnd.github+json, application/octet-stream, */*");
        return c;
    }
}
