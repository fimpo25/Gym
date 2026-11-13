package ar.fimpo.gimnasio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.hardware.Sensor;
import android.hardware.SensorEvent;
import android.hardware.SensorEventListener;
import android.hardware.SensorManager;
import android.media.AudioAttributes;
import android.media.AudioFocusRequest;
import android.media.AudioManager;
import android.speech.tts.TextToSpeech;
import android.speech.tts.UtteranceProgressListener;
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
public class RouteService extends Service implements LocationListener, SensorEventListener {

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
    private SensorManager sm;
    private boolean stepping = false;
    private TextToSpeech tts;
    private boolean ttsReady = false;
    private String ttsPending = null;
    private AudioFocusRequest afr;
    private final Runnable tick = new Runnable() {
        @Override public void run() {
            RouteTrack.autoCheck(RouteService.this);
            String say = RouteTrack.kmAnnouncement();
            if (say != null) speak(say);
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
        try { if (tts != null) tts.shutdown(); } catch (Exception e) { /* nada */ }
        tts = null; ttsReady = false;
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
            startSteps();
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
        try { if (sm != null && stepping) sm.unregisterListener(this); } catch (Exception e) { /* nada */ }
        stepping = false;
        synchronized (RouteTrack.LOCK) { RouteTrack.stepPrev = -1; }
    }

    // ---- pasos: sensor contador de pasos (necesita el permiso de actividad fisica en Android 10+) ----
    private void startSteps() {
        if (stepping) return;
        try {
            sm = (SensorManager) getSystemService(Context.SENSOR_SERVICE);
            Sensor st = sm == null ? null : sm.getDefaultSensor(Sensor.TYPE_STEP_COUNTER);
            if (st != null) stepping = sm.registerListener(this, st, SensorManager.SENSOR_DELAY_NORMAL);
        } catch (Exception e) { stepping = false; }
    }
    @Override public void onSensorChanged(SensorEvent ev) {
        if (ev != null && ev.sensor != null && ev.sensor.getType() == Sensor.TYPE_STEP_COUNTER && ev.values.length > 0) RouteTrack.onStep(this, ev.values[0]);
    }
    @Override public void onAccuracyChanged(Sensor s, int a) { /* nada */ }

    // ---- aviso por voz en cada kilometro (baja la musica mientras habla) ----
    private void speak(final String text) {
        try {
            if (tts == null) {
                ttsPending = text;
                tts = new TextToSpeech(getApplicationContext(), status -> {
                    if (status != TextToSpeech.SUCCESS || tts == null) return;
                    int r = tts.setLanguage(new Locale("es", "AR"));
                    if (r == TextToSpeech.LANG_MISSING_DATA || r == TextToSpeech.LANG_NOT_SUPPORTED) tts.setLanguage(new Locale("es"));
                    if (Build.VERSION.SDK_INT >= 21) tts.setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build());
                    tts.setOnUtteranceProgressListener(new UtteranceProgressListener() {
                        @Override public void onStart(String id) { }
                        @Override public void onDone(String id) { releaseFocus(); }
                        @Override public void onError(String id) { releaseFocus(); }
                    });
                    ttsReady = true;
                    if (ttsPending != null) { String p = ttsPending; ttsPending = null; speakNow(p); }
                });
                return;
            }
            if (!ttsReady) { ttsPending = text; return; }
            speakNow(text);
        } catch (Exception e) { /* sin voz */ }
    }
    private void speakNow(String text) {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                afr = new AudioFocusRequest.Builder(AudioManager.AUDIOFOCUS_GAIN_TRANSIENT_MAY_DUCK)
                        .setAudioAttributes(new AudioAttributes.Builder().setUsage(AudioAttributes.USAGE_ASSISTANCE_NAVIGATION_GUIDANCE).setContentType(AudioAttributes.CONTENT_TYPE_SPEECH).build()).build();
                am.requestAudioFocus(afr);
            }
            Bundle b = new Bundle();
            tts.speak(text, TextToSpeech.QUEUE_ADD, b, "km" + System.currentTimeMillis());
        } catch (Exception e) { releaseFocus(); }
    }
    private void releaseFocus() {
        try {
            AudioManager am = (AudioManager) getSystemService(Context.AUDIO_SERVICE);
            if (am != null && afr != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) am.abandonAudioFocusRequest(afr);
        } catch (Exception e) { /* nada */ }
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
        double km, dist; long ms; String st, mode; boolean autoP; int steps;
        synchronized (RouteTrack.LOCK) { dist = RouteTrack.dist; km = dist / 1000.0; ms = RouteTrack.elapsedMs(); st = RouteTrack.state; mode = RouteTrack.mode; autoP = RouteTrack.autoPaused; steps = RouteTrack.steps; }
        boolean paused = "paused".equals(st);
        String kmTxt = String.format(Locale.US, "%.2f km", km).replace('.', ',');
        String now = paused ? "en pausa" : autoP ? "pausa automática" : RouteTrack.rate(mode, RouteTrack.curSpeed());
        double avgV = ms > 0 ? dist / (ms / 1000.0) : 0;
        String title = modeLabel(mode) + " · " + RouteTrack.clock(ms) + (paused ? " (en pausa)" : autoP ? " (pausa automática)" : "");
        String text = kmTxt + " · " + now;
        String big = kmTxt + " en " + RouteTrack.clock(ms) + "\nAhora: " + now + "\nPromedio: " + RouteTrack.rate(mode, avgV) + (steps > 0 && !"bici".equals(mode) ? "\nPasos: " + steps : "");
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
