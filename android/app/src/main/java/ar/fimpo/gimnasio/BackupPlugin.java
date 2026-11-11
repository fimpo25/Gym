package ar.fimpo.gimnasio;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.ByteArrayOutputStream;
import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;

/**
 * Copias de seguridad automaticas en una carpeta que sobrevive a desinstalar la app:
 * Documentos/Gimnasio (Android 10+, sin pedir permisos: la app solo ve los archivos que ella creo).
 * En Android mas viejo se guardan en la carpeta externa propia de la app.
 */
@android.annotation.SuppressLint("NewApi")
@CapacitorPlugin(name = "Backup")
public class BackupPlugin extends Plugin {

    private static final String FOLDER = "Gimnasio";

    private boolean modern() { return Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q; }

    private Uri collection() { return MediaStore.Files.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY); }

    private String relPath() { return Environment.DIRECTORY_DOCUMENTS + "/" + FOLDER + "/"; }

    private File legacyDir() {
        File d = getContext().getExternalFilesDir(FOLDER);
        if (d == null) d = new File(getContext().getFilesDir(), FOLDER);
        if (!d.exists()) d.mkdirs();
        return d;
    }

    private String where() { return modern() ? "Documentos/" + FOLDER : "la carpeta de la app"; }

    @PluginMethod
    public void save(PluginCall call) {
        final String name = call.getString("name");
        final String text = call.getString("text");
        if (name == null || text == null) { call.reject("Faltan datos"); return; }
        new Thread(() -> {
            try {
                byte[] bytes = text.getBytes(StandardCharsets.UTF_8);
                JSObject r = new JSObject();
                if (modern()) {
                    ContentResolver cr = getContext().getContentResolver();
                    ContentValues v = new ContentValues();
                    v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
                    v.put(MediaStore.MediaColumns.MIME_TYPE, "application/json");
                    v.put(MediaStore.MediaColumns.RELATIVE_PATH, relPath());
                    v.put(MediaStore.MediaColumns.IS_PENDING, 1);
                    Uri uri = cr.insert(collection(), v);
                    if (uri == null) throw new Exception("no se pudo crear el archivo");
                    try {
                        OutputStream out = cr.openOutputStream(uri);
                        if (out == null) throw new Exception("no se pudo abrir el archivo");
                        out.write(bytes);
                        out.close();
                        ContentValues done = new ContentValues();
                        done.put(MediaStore.MediaColumns.IS_PENDING, 0);
                        cr.update(uri, done, null, null);
                    } catch (Exception e) {
                        try { cr.delete(uri, null, null); } catch (Exception ignored) { /* nada */ }
                        throw e;
                    }
                    r.put("id", String.valueOf(ContentUris.parseId(uri)));
                } else {
                    File f = new File(legacyDir(), name);
                    FileOutputStream out = new FileOutputStream(f);
                    out.write(bytes);
                    out.close();
                    r.put("id", name);
                }
                r.put("name", name);
                r.put("size", bytes.length);
                r.put("where", where());
                call.resolve(r);
            } catch (Exception e) {
                call.reject("No se pudo guardar la copia: " + e.getMessage());
            }
        }).start();
    }

    /** Copias creadas por la app, de la mas nueva a la mas vieja. */
    @PluginMethod
    public void list(PluginCall call) {
        try {
            JSArray arr = new JSArray();
            if (modern()) {
                String[] proj = { MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME, MediaStore.MediaColumns.SIZE, MediaStore.MediaColumns.DATE_MODIFIED };
                String sel = MediaStore.MediaColumns.RELATIVE_PATH + " = ? AND " + MediaStore.MediaColumns.DISPLAY_NAME + " LIKE ?";
                Cursor c = getContext().getContentResolver().query(collection(), proj, sel, new String[] { relPath(), "gimnasio_%" }, MediaStore.MediaColumns.DATE_MODIFIED + " DESC");
                if (c != null) {
                    while (c.moveToNext()) {
                        JSObject o = new JSObject();
                        o.put("id", String.valueOf(c.getLong(0)));
                        o.put("name", c.getString(1));
                        o.put("size", c.getLong(2));
                        o.put("date", c.getLong(3) * 1000L);
                        arr.put(o);
                    }
                    c.close();
                }
            } else {
                File[] fs = legacyDir().listFiles();
                if (fs != null) {
                    java.util.Arrays.sort(fs, (a, b) -> Long.compare(b.lastModified(), a.lastModified()));
                    for (File f : fs) {
                        if (!f.getName().startsWith("gimnasio_")) continue;
                        JSObject o = new JSObject();
                        o.put("id", f.getName());
                        o.put("name", f.getName());
                        o.put("size", f.length());
                        o.put("date", f.lastModified());
                        arr.put(o);
                    }
                }
            }
            JSObject r = new JSObject();
            r.put("items", arr);
            r.put("where", where());
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudieron listar las copias: " + e.getMessage());
        }
    }

    @PluginMethod
    public void read(PluginCall call) {
        final String id = call.getString("id");
        if (id == null) { call.reject("Falta la copia"); return; }
        new Thread(() -> {
            try {
                InputStream in = modern()
                        ? getContext().getContentResolver().openInputStream(ContentUris.withAppendedId(collection(), Long.parseLong(id)))
                        : new FileInputStream(new File(legacyDir(), new File(id).getName()));
                if (in == null) throw new Exception("no se pudo abrir");
                ByteArrayOutputStream out = new ByteArrayOutputStream();
                byte[] buf = new byte[65536];
                int n;
                while ((n = in.read(buf)) > 0) out.write(buf, 0, n);
                in.close();
                JSObject r = new JSObject();
                r.put("text", new String(out.toByteArray(), StandardCharsets.UTF_8));
                call.resolve(r);
            } catch (Exception e) {
                call.reject("No se pudo leer la copia: " + e.getMessage());
            }
        }).start();
    }

    @PluginMethod
    public void remove(PluginCall call) {
        String id = call.getString("id");
        if (id == null) { call.reject("Falta la copia"); return; }
        try {
            if (modern()) getContext().getContentResolver().delete(ContentUris.withAppendedId(collection(), Long.parseLong(id)), null, null);
            else new File(legacyDir(), new File(id).getName()).delete();
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo borrar la copia: " + e.getMessage());
        }
    }
}
