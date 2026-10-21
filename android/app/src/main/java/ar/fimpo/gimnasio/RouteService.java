package ar.fimpo.gimnasio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.location.Location;
import android.location.LocationListener;
import android.location.LocationManager;
import android.os.Build;
import android.os.Bundle;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import java.util.Locale;

/**
 * Servicio en primer plano que sigue el GPS mientras hay un recorrido en curso, aunque la
 * pantalla este bloqueada. Muestra una notificacion fija con el tiempo y los kilometros.
 */
public class RouteService extends Service implements LocationListener {

    static final String CHANNEL = "recorrido_v2";
    private static final String OLD_CHANNEL = "recorrido";
    static final int NID = 7001;
    static final String A_START = "ar.fimpo.gimnasio.RUTA_START";
    static final String A_PAUSE = "ar.fimpo.gimnasio.RUTA_PAUSE";
    static final String A_RESUME = "ar.fimpo.gimnasio.RUTA_RESUME";
    static final String A_STOP = "ar.fimpo.gimnasio.RUTA_STOP";

    private LocationManager lm;
    private PowerManager.WakeLock wl;
    private final Handler handler = new Handler(Looper.getMainLooper());
    private boolean listening = false;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            notifyNow();
            handler.postDelayed(this, 1000);
        }
    };

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        createChannel(this);
        String action = intent == null ? null : intent.getAction();
        if (A_PAUSE.equals(action)) RouteTrack.pause(this);      // tambien llegan desde el boton de la notificacion
        else if (A_RESUME.equals(action)) RouteTrack.resume(this);
        if (intent == null) {                       // Android reinicio el servicio tras cerrarlo
            RouteTrack.restore(this);
            if ("idle".equals(RouteTrack.state)) { stopSelf(); return START_NOT_STICKY; }
        }
        startFg();
        if (A_STOP.equals(action) || "idle".equals(RouteTrack.state)) {
            stopUpdates();
            stopForeground(true);
            stopSelf();
            return START_NOT_STICKY;
        }
        if (A_PAUSE.equals(action) || "paused".equals(RouteTrack.state)) stopUpdates(); else startUpdates();
        handler.removeCallbacks(tick);
        handler.post(tick);
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        handler.removeCallbacks(tick);
        stopUpdates();
        super.onDestroy();
    }

    private void startFg() {
        Notification n = buildNotification();
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) startForeground(NID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION);
        else startForeground(NID, n);
    }

    private void startUpdates() {
        if (listening) return;
        try {
            lm = (LocationManager) getSystemService(Context.LOCATION_SERVICE);
            if (lm == null) return;
            lm.requestLocationUpdates(LocationManager.GPS_PROVIDER, 1000L, 0f, this, Looper.getMainLooper());
            listening = true;
            if (wl == null) {
                PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
                if (pm != null) wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gimnasio:recorrido");
            }
            if (wl != null && !wl.isHeld()) wl.acquire(12 * 60 * 60 * 1000L);
        } catch (SecurityException e) {
            // sin permiso de ubicacion: la pantalla lo avisa
        } catch (Exception e) {
            // nunca romper el servicio
        }
    }

    private void stopUpdates() {
        try { if (lm != null && listening) lm.removeUpdates(this); } catch (Exception e) { /* nada */ }
        listening = false;
        try { if (wl != null && wl.isHeld()) wl.release(); } catch (Exception e) { /* nada */ }
    }

    private void notifyNow() {
        try {
            NotificationManager nm = (NotificationManager) getSystemService(Context.NOTIFICATION_SERVICE);
            if (nm != null) nm.notify(NID, buildNotification());
        } catch (Exception e) { /* nada */ }
    }

    private static String modeLabel(String m) {
        return "caminar".equals(m) ? "Caminando" : "bici".equals(m) ? "En bici" : "Corriendo";
    }

    private Notification buildNotification() {
        double km, dist; long ms; String st, mode;
        synchronized (RouteTrack.LOCK) { dist = RouteTrack.dist; km = dist / 1000.0; ms = RouteTrack.elapsedMs(); st = RouteTrack.state; mode = RouteTrack.mode; }
        boolean paused = "paused".equals(st);
        String kmTxt = String.format(Locale.US, "%.2f km", km).replace('.', ',');
        String now = paused ? "en pausa" : RouteTrack.rate(mode, RouteTrack.curSpeed());
        double avgV = ms > 0 ? dist / (ms / 1000.0) : 0;
        String title = modeLabel(mode) + " · " + RouteTrack.clock(ms) + (paused ? " (en pausa)" : "");
        String text = kmTxt + " · " + now;
        String big = kmTxt + " en " + RouteTrack.clock(ms) + "\nAhora: " + now + "\nPromedio: " + RouteTrack.rate(mode, avgV);
        Intent open = getPackageManager().getLaunchIntentForPackage(getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(this, 7001, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        NotificationCompat.Builder b = new NotificationCompat.Builder(this, CHANNEL)
                .setSmallIcon(R.drawable.ic_stat_timer)
                .setColor(0xFF22D3EE)
                .setContentTitle(title)
                .setContentText(text)
                .setStyle(new NotificationCompat.BigTextStyle().bigText(big))
                .setOngoing(true)
                .setOnlyAlertOnce(true)
                .setSilent(true)
                .setCategory(NotificationCompat.CATEGORY_SERVICE)
                .setVisibility(NotificationCompat.VISIBILITY_PUBLIC);
        if (pi != null) b.setContentIntent(pi);
        Intent act = new Intent(this, RouteService.class).setAction(paused ? A_RESUME : A_PAUSE);
        int fl = PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE;
        PendingIntent api = Build.VERSION.SDK_INT >= Build.VERSION_CODES.O ? PendingIntent.getForegroundService(this, 7002, act, fl) : PendingIntent.getService(this, 7002, act, fl);
        b.addAction(R.drawable.ic_stat_timer, paused ? "Seguir" : "Pausar", api);
        return b.build();
    }

    static void createChannel(Context ctx) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = ctx.getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(OLD_CHANNEL) != null) nm.deleteNotificationChannel(OLD_CHANNEL);
        if (nm.getNotificationChannel(CHANNEL) != null) return;
        // Importancia normal pero sin sonido ni vibracion: se ve en la pantalla de bloqueo (la "baja" suele ocultarse alli)
        NotificationChannel ch = new NotificationChannel(CHANNEL, "Recorrido en curso", NotificationManager.IMPORTANCE_DEFAULT);
        ch.setSound(null, null);
        ch.enableVibration(false);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        ch.setDescription("Muestra el tiempo y la distancia mientras grabas un recorrido con GPS.");
        ch.setShowBadge(false);
        nm.createNotificationChannel(ch);
    }

    // ---- LocationListener ----
    @Override public void onLocationChanged(Location l) { RouteTrack.onLocation(this, l); }
    @Override public void onStatusChanged(String provider, int status, Bundle extras) { /* API vieja */ }
    @Override public void onProviderEnabled(String provider) { /* la pantalla consulta el estado */ }
    @Override public void onProviderDisabled(String provider) { /* la pantalla consulta el estado */ }
}
