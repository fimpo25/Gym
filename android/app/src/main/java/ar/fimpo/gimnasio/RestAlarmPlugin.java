package ar.fimpo.gimnasio;

import android.app.AlarmManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.app.NotificationManagerCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

/**
 * Alarma de fin de descanso con AlarmManager.setAlarmClock: es el mecanismo de los
 * despertadores, suena en el segundo exacto aunque el celular este en reposo (Doze) y no
 * tiene el limite de "una alarma cada 9 minutos" de las notificaciones programadas comunes.
 */
@CapacitorPlugin(name = "RestAlarm")
public class RestAlarmPlugin extends Plugin {

    private PendingIntent alarmIntent(int id, String title, String body) {
        Intent i = new Intent(getContext(), RestAlarmReceiver.class);
        i.setAction("ar.fimpo.gimnasio.DESCANSO_" + id);
        i.putExtra("id", id);
        if (title != null) i.putExtra("title", title);
        if (body != null) i.putExtra("body", body);
        return PendingIntent.getBroadcast(getContext(), id, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private boolean canExact(AlarmManager am) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || am.canScheduleExactAlarms();
    }

    private boolean scheduleOne(AlarmManager am, int id, long at, String title, String body) {
        PendingIntent op = alarmIntent(id, title, body);
        NotificationManagerCompat.from(getContext()).cancel(id);
        if (canExact(am)) {
            Intent open = getContext().getPackageManager().getLaunchIntentForPackage(getContext().getPackageName());
            PendingIntent show = PendingIntent.getActivity(getContext(), 90000 + id, open != null ? open : new Intent(), PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
            am.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show), op);
            return true;
        }
        am.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, op);
        return false;
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            Integer id = call.getInt("id", 4242);
            Long at = call.getLong("at");
            if (am == null || at == null) { call.reject("Faltan datos"); return; }
            boolean exact = scheduleOne(am, id, at, call.getString("title"), call.getString("body"));
            JSObject r = new JSObject();
            r.put("exact", exact);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudo programar la alarma: " + e.getMessage());
        }
    }

    /** items: [{id, at, title, body}] */
    @PluginMethod
    public void scheduleMany(PluginCall call) {
        try {
            AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            JSArray items = call.getArray("items");
            if (am == null || items == null) { call.reject("Faltan datos"); return; }
            boolean exact = true;
            for (int k = 0; k < items.length(); k++) {
                org.json.JSONObject it = items.getJSONObject(k);
                exact &= scheduleOne(am, it.getInt("id"), it.getLong("at"), it.optString("title", "Tiempo"), it.optString("body", ""));
            }
            JSObject r = new JSObject();
            r.put("exact", exact);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudieron programar las alarmas: " + e.getMessage());
        }
    }

    /** ids: [int] (o id) */
    @PluginMethod
    public void cancel(PluginCall call) {
        try {
            AlarmManager am = (AlarmManager) getContext().getSystemService(Context.ALARM_SERVICE);
            JSArray ids = call.getArray("ids");
            java.util.List<Integer> list = new java.util.ArrayList<>();
            if (ids != null) for (int k = 0; k < ids.length(); k++) list.add(ids.getInt(k));
            else list.add(call.getInt("id", 4242));
            for (int id : list) {
                if (am != null) am.cancel(alarmIntent(id, null, null));
                NotificationManagerCompat.from(getContext()).cancel(id);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo cancelar: " + e.getMessage());
        }
    }

    /** Estado de todo lo que necesita la alarma para sonar con la pantalla bloqueada. */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject r = new JSObject();
        Context ctx = getContext();
        AlarmManager am = (AlarmManager) ctx.getSystemService(Context.ALARM_SERVICE);
        r.put("exact", am != null && canExact(am));
        r.put("notifications", NotificationManagerCompat.from(ctx).areNotificationsEnabled());
        PowerManager pm = (PowerManager) ctx.getSystemService(Context.POWER_SERVICE);
        r.put("battery", pm != null && pm.isIgnoringBatteryOptimizations(ctx.getPackageName()));
        boolean channel = true;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            MainActivity.createRestChannel(ctx);
            NotificationManager nm = ctx.getSystemService(NotificationManager.class);
            NotificationChannel ch = nm != null ? nm.getNotificationChannel(MainActivity.REST_CHANNEL) : null;
            channel = ch != null && ch.getImportance() >= NotificationManager.IMPORTANCE_DEFAULT && ch.getSound() != null;
        }
        r.put("channel", channel);
        r.put("sdk", Build.VERSION.SDK_INT);
        r.put("maker", Build.MANUFACTURER);
        call.resolve(r);
    }

    private void open(PluginCall call, Intent i, Intent fallback) {
        try {
            i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(i);
            call.resolve();
        } catch (Exception e) {
            try {
                fallback.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(fallback);
                call.resolve();
            } catch (Exception e2) {
                call.reject("No se pudo abrir el ajuste");
            }
        }
    }

    @PluginMethod
    public void openBattery(PluginCall call) {
        Intent i = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + getContext().getPackageName()));
        open(call, i, new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
    }

    @PluginMethod
    public void openExact(PluginCall call) {
        Intent app = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            open(call, new Intent(Settings.ACTION_REQUEST_SCHEDULE_EXACT_ALARM, Uri.parse("package:" + getContext().getPackageName())), app);
        } else open(call, app, app);
    }

    @PluginMethod
    public void openNotifications(PluginCall call) {
        Intent app = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.parse("package:" + getContext().getPackageName()));
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            Intent i = new Intent(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
            i.putExtra(Settings.EXTRA_APP_PACKAGE, getContext().getPackageName());
            i.putExtra(Settings.EXTRA_CHANNEL_ID, MainActivity.REST_CHANNEL);
            open(call, i, app);
        } else open(call, app, app);
    }
}
