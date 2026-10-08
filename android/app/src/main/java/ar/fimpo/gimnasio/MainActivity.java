package ar.fimpo.gimnasio;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.ContentResolver;
import android.media.AudioAttributes;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {

    /** Canal del aviso de fin de descanso (el HTML programa las notificaciones en este id). */
    public static final String REST_CHANNEL = "descanso_alarma";
    /** Canal anterior (tipo notificacion: se silenciaba con el celular en vibrar). */
    private static final String OLD_REST_CHANNEL = "descanso";

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(UpdaterPlugin.class);   // actualizaciones desde la app (antes de super.onCreate)
        super.onCreate(savedInstanceState);
        createRestChannel();
    }

    /**
     * Crea el canal con sonido de ALARMA (USAGE_ALARM): usa el volumen de alarma y suena
     * aunque el celular este en vibrar o en "No molestar" (si las alarmas estan permitidas,
     * que es lo predeterminado). Un canal de notificacion comun se silencia en esos modos.
     * Android no deja cambiar el sonido de un canal ya creado, por eso es un id nuevo.
     */
    private void createRestChannel() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return;
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm == null) return;
        if (nm.getNotificationChannel(OLD_REST_CHANNEL) != null) nm.deleteNotificationChannel(OLD_REST_CHANNEL);
        if (nm.getNotificationChannel(REST_CHANNEL) != null) return;

        NotificationChannel ch = new NotificationChannel(REST_CHANNEL, "Fin de descanso", NotificationManager.IMPORTANCE_HIGH);
        ch.setDescription("Alarma al terminar el descanso entre series. Suena aunque el celular este en vibrar.");
        // URI por id de recurso (no por nombre): no depende de como se empaqueten los recursos.
        Uri sound = Uri.parse(ContentResolver.SCHEME_ANDROID_RESOURCE + "://" + getPackageName() + "/" + R.raw.descanso);
        AudioAttributes attrs = new AudioAttributes.Builder()
                .setUsage(AudioAttributes.USAGE_ALARM)
                .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                .build();
        ch.setSound(sound, attrs);
        ch.enableVibration(true);
        ch.setVibrationPattern(new long[] { 0, 300, 100, 300, 100, 300 });
        ch.enableLights(true);
        ch.setLightColor(0xFF4ECDC4);
        ch.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
        nm.createNotificationChannel(ch);
    }
}
