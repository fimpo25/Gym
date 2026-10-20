package ar.fimpo.gimnasio;

import android.content.Context;
import android.content.SharedPreferences;
import android.location.Location;
import java.io.BufferedReader;
import java.io.File;
import java.io.FileOutputStream;
import java.io.FileReader;
import java.util.ArrayList;
import java.util.Locale;

/**
 * Estado y calculo de un recorrido con GPS. Vive en memoria (para que el servicio y la pantalla
 * lo lean sin pasar por el WebView) y se guarda en disco punto a punto, asi un recorrido no se
 * pierde si Android cierra la app.
 */
final class RouteTrack {
    static final Object LOCK = new Object();
    static final String PREFS = "gym_route";
    static final String FILE = "route_active.csv";

    static String state = "idle";        // idle | running | paused
    static String mode = "correr";
    static double maxSpeed = 9;          // m/s: por encima se considera un salto del GPS
    static long startedAt = 0, accMs = 0, runSince = 0;
    static double dist = 0, gain = 0, loss = 0, refAlt = Double.NaN;
    static int seg = 0, rejects = 0;
    static double[] last = null;         // ultimo punto aceptado del tramo
    static final ArrayList<double[]> pts = new ArrayList<>();   // lat, lon, t, tramo, alt, precision
    // Ultima senal recibida (aunque no se haya contado)
    static double fixAcc = -1, curLat = 0, curLon = 0;
    static long fixAt = 0;

    private RouteTrack() {}

    static long elapsedMs() {
        synchronized (LOCK) {
            return accMs + ("running".equals(state) ? System.currentTimeMillis() - runSince : 0);
        }
    }

    static void begin(Context ctx, String m, double maxV) {
        synchronized (LOCK) {
            state = "running"; mode = m; maxSpeed = maxV;
            startedAt = System.currentTimeMillis(); accMs = 0; runSince = startedAt;
            dist = 0; gain = 0; loss = 0; refAlt = Double.NaN; seg = 0; rejects = 0; last = null;
            pts.clear(); fixAcc = -1; fixAt = 0;
            try { new File(ctx.getFilesDir(), FILE).delete(); } catch (Exception e) { /* nada */ }
            save(ctx);
        }
    }

    static void pause(Context ctx) {
        synchronized (LOCK) {
            if (!"running".equals(state)) return;
            accMs += System.currentTimeMillis() - runSince;
            state = "paused"; last = null; rejects = 0; seg++;
            save(ctx);
        }
    }

    static void resume(Context ctx) {
        synchronized (LOCK) {
            if (!"paused".equals(state)) return;
            runSince = System.currentTimeMillis();
            state = "running"; last = null;
            save(ctx);
        }
    }

    /** Termina: devuelve el resultado y deja todo en blanco. */
    static Object[] finish(Context ctx) {
        synchronized (LOCK) {
            if ("running".equals(state)) accMs += System.currentTimeMillis() - runSince;
            Object[] r = new Object[] { mode, startedAt, System.currentTimeMillis(), accMs, dist, gain, new ArrayList<>(pts), loss };
            clear(ctx);
            return r;
        }
    }

    static void clear(Context ctx) {
        synchronized (LOCK) {
            state = "idle"; accMs = 0; dist = 0; gain = 0; loss = 0; seg = 0; last = null; refAlt = Double.NaN; rejects = 0;
            pts.clear();
            try { new File(ctx.getFilesDir(), FILE).delete(); } catch (Exception e) { /* nada */ }
            ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit().clear().apply();
        }
    }

    static void onLocation(Context ctx, Location l) {
        synchronized (LOCK) {
            fixAcc = l.hasAccuracy() ? l.getAccuracy() : 99;
            fixAt = System.currentTimeMillis();
            curLat = l.getLatitude(); curLon = l.getLongitude();
            if (!"running".equals(state)) return;
            if (fixAcc > 35) return;                       // senal pobre
            double t = l.getTime();
            double alt = l.hasAltitude() ? l.getAltitude() : Double.NaN;
            if (last != null) {
                float[] r = new float[1];
                Location.distanceBetween(last[0], last[1], l.getLatitude(), l.getLongitude(), r);
                double d = r[0], dt = (t - last[2]) / 1000.0;
                if (dt <= 0) return;
                double v = d / dt;
                if (v > maxSpeed) {                        // salto imposible: se ignora; si se repite, se reengancha
                    if (++rejects < 5) return;
                    rejects = 0; seg++; last = null;
                } else {
                    rejects = 0;
                    if (d < 3 || v < 0.3) return;          // quieto: ruido del GPS
                    dist += d;
                }
            }
            if (!Double.isNaN(alt)) {                      // desnivel con histeresis de 4 m
                if (Double.isNaN(refAlt)) refAlt = alt;
                else if (alt - refAlt >= 4) { gain += alt - refAlt; refAlt = alt; }
                else if (refAlt - alt >= 4) { loss += refAlt - alt; refAlt = alt; }
            }
            double[] p = new double[] { l.getLatitude(), l.getLongitude(), t, seg, Double.isNaN(alt) ? 0 : alt, fixAcc };
            pts.add(p); last = p;
            try {
                FileOutputStream fo = new FileOutputStream(new File(ctx.getFilesDir(), FILE), true);
                fo.write(String.format(Locale.US, "%.6f,%.6f,%d,%d,%.1f,%.1f\n", p[0], p[1], (long) p[2], (int) p[3], p[4], p[5]).getBytes("UTF-8"));
                fo.close();
            } catch (Exception e) { /* se pierde solo la copia de respaldo */ }
            save(ctx);
        }
    }

    static void save(Context ctx) {
        ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).edit()
                .putString("state", state).putString("mode", mode).putFloat("maxSpeed", (float) maxSpeed)
                .putLong("startedAt", startedAt).putLong("accMs", accMs).putLong("runSince", runSince)
                .putFloat("dist", (float) dist).putFloat("gain", (float) gain).putFloat("loss", (float) loss).putInt("seg", seg).apply();
    }

    /** Si la app se cerro con un recorrido en curso, lo recupera (queda en pausa). */
    static boolean restore(Context ctx) {
        synchronized (LOCK) {
            if (!"idle".equals(state)) return true;
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            String st = sp.getString("state", "idle");
            if ("idle".equals(st)) return false;
            mode = sp.getString("mode", "correr"); maxSpeed = sp.getFloat("maxSpeed", 9);
            startedAt = sp.getLong("startedAt", 0); accMs = sp.getLong("accMs", 0);
            if ("running".equals(st)) accMs += Math.max(0, System.currentTimeMillis() - sp.getLong("runSince", System.currentTimeMillis()));
            dist = sp.getFloat("dist", 0); gain = sp.getFloat("gain", 0); loss = sp.getFloat("loss", 0); seg = sp.getInt("seg", 0) + 1;
            last = null; rejects = 0; refAlt = Double.NaN; pts.clear();
            try {
                BufferedReader br = new BufferedReader(new FileReader(new File(ctx.getFilesDir(), FILE)));
                String ln;
                while ((ln = br.readLine()) != null) {
                    String[] a = ln.split(",");
                    if (a.length < 6) continue;
                    pts.add(new double[] { Double.parseDouble(a[0]), Double.parseDouble(a[1]), Double.parseDouble(a[2]), Double.parseDouble(a[3]), Double.parseDouble(a[4]), Double.parseDouble(a[5]) });
                }
                br.close();
            } catch (Exception e) { /* sin puntos guardados */ }
            state = "paused";
            return true;
        }
    }

    static String clock(long ms) {
        long s = ms / 1000, h = s / 3600, m = (s % 3600) / 60;
        return h > 0 ? String.format(Locale.US, "%d:%02d:%02d", h, m, s % 60) : String.format(Locale.US, "%d:%02d", m, s % 60);
    }
}
