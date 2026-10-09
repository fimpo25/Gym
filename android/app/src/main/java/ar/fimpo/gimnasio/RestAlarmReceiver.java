package ar.fimpo.gimnasio;

import android.app.Notification;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.media.AudioManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;
import androidx.core.app.NotificationManagerCompat;

/** Se dispara con AlarmManager.setAlarmClock y publica el aviso en el canal de alarma. */
public class RestAlarmReceiver extends BroadcastReceiver {
    @Override
    public void onReceive(Context ctx, Intent in) {
        PowerManager.WakeLock wl = null;
        try {
            PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
            if (pm != null) { wl = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "gimnasio:descanso"); wl.acquire(10000); }
            MainActivity.createRestChannel(ctx);
            int id = in.getIntExtra("id", 4242);
            String title = in.getStringExtra("title");
            String body = in.getStringExtra("body");
            Intent open = ctx.getPackageManager().getLaunchIntentForPackage(ctx.getPackageName());
            PendingIntent pi = open == null ? null : PendingIntent.getActivity(ctx, id, open, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            NotificationCompat.Builder b = new NotificationCompat.Builder(ctx, MainActivity.REST_CHANNEL)
                    .setSmallIcon(R.drawable.ic_stat_timer)
                    .setColor(0xFF22D3EE)
                    .setContentTitle(title != null ? title : "Descanso terminado")
                    .setContentText(body != null ? body : "")
                    .setPriority(NotificationCompat.PRIORITY_MAX)
                    .setCategory(NotificationCompat.CATEGORY_ALARM)
                    .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
                    .setAutoCancel(true)
                    .setWhen(System.currentTimeMillis());
            if (pi != null) b.setContentIntent(pi);
            if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) {
                Uri sound = Uri.parse("android.resource://" + ctx.getPackageName() + "/" + R.raw.descanso);
                b.setSound(sound, AudioManager.STREAM_ALARM).setVibrate(new long[] { 0, 300, 100, 300, 100, 300 });
            }
            Notification n = b.build();
            NotificationManagerCompat.from(ctx).notify(id, n);
        } catch (SecurityException e) {
            // sin permiso de notificaciones: no hay nada mas que hacer
        } catch (Exception e) {
            // nunca romper el receptor
        } finally {
            if (wl != null && wl.isHeld()) wl.release();
        }
    }
}
