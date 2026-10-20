package ar.fimpo.gimnasio;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.location.LocationManager;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.util.ArrayList;

/** Recorridos con GPS: el puente entre la pantalla y el servicio RouteService. */
@CapacitorPlugin(
    name = "Route",
    permissions = {
        @Permission(strings = { Manifest.permission.ACCESS_FINE_LOCATION, Manifest.permission.ACCESS_COARSE_LOCATION }, alias = "location"),
        @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notif")
    }
)
public class RoutePlugin extends Plugin {

    private void send(String action) {
        Intent i = new Intent(getContext(), RouteService.class);
        i.setAction(action);
        ContextCompat.startForegroundService(getContext(), i);
    }

    private boolean gpsOn() {
        try {
            LocationManager lm = (LocationManager) getContext().getSystemService(Context.LOCATION_SERVICE);
            return lm != null && lm.isProviderEnabled(LocationManager.GPS_PROVIDER);
        } catch (Exception e) { return false; }
    }

    private JSObject permState() {
        JSObject r = new JSObject();
        r.put("granted", getPermissionState("location") == PermissionState.GRANTED);
        r.put("gps", gpsOn());
        return r;
    }

    /** Pide el permiso de ubicacion (y el de notificaciones, para ver el aviso fijo). */
    @PluginMethod
    public void ask(PluginCall call) {
        if (getPermissionState("location") == PermissionState.GRANTED) { call.resolve(permState()); return; }
        requestPermissionForAliases(new String[] { "location", "notif" }, call, "askDone");
    }

    @PermissionCallback
    private void askDone(PluginCall call) {
        call.resolve(permState());
    }

    @PluginMethod
    public void start(PluginCall call) {
        if (getPermissionState("location") != PermissionState.GRANTED) { call.reject("Falta el permiso de ubicacion", "NO_PERMISSION"); return; }
        try {
            RouteTrack.begin(getContext(), call.getString("mode", "correr"), call.getDouble("maxSpeed", 9.0));
            send(RouteService.A_START);
            call.resolve();
        } catch (Exception e) {
            call.reject("No se pudo iniciar: " + e.getMessage());
        }
    }

    @PluginMethod
    public void pause(PluginCall call) {
        RouteTrack.pause(getContext());
        send(RouteService.A_PAUSE);
        call.resolve();
    }

    @PluginMethod
    public void resume(PluginCall call) {
        RouteTrack.resume(getContext());
        send(RouteService.A_RESUME);
        call.resolve();
    }

    /** Estado liviano: se consulta cada segundo mientras la pantalla esta abierta. */
    @PluginMethod
    public void status(PluginCall call) {
        RouteTrack.restore(getContext());
        JSObject r = new JSObject();
        synchronized (RouteTrack.LOCK) {
            r.put("state", RouteTrack.state);
            r.put("mode", RouteTrack.mode);
            r.put("startedAt", RouteTrack.startedAt);
            r.put("elapsed", RouteTrack.elapsedMs());
            r.put("dist", RouteTrack.dist);
            r.put("gain", RouteTrack.gain);
            r.put("loss", RouteTrack.loss);
            r.put("count", RouteTrack.pts.size());
            r.put("fixAcc", RouteTrack.fixAcc);
            r.put("fixAgo", RouteTrack.fixAt == 0 ? -1 : System.currentTimeMillis() - RouteTrack.fixAt);
            r.put("lat", RouteTrack.curLat);
            r.put("lon", RouteTrack.curLon);
        }
        r.put("gps", gpsOn());
        r.put("granted", getPermissionState("location") == PermissionState.GRANTED);
        call.resolve(r);
    }

    /** Puntos desde el indice "from": [[lat, lon, t, tramo, alt], ...] */
    @PluginMethod
    public void points(PluginCall call) {
        int from = call.getInt("from", 0);
        JSArray arr = new JSArray();
        synchronized (RouteTrack.LOCK) {
            for (int i = Math.max(0, from); i < RouteTrack.pts.size(); i++) arr.put(row(RouteTrack.pts.get(i)));
        }
        JSObject r = new JSObject();
        r.put("points", arr);
        call.resolve(r);
    }

    /** Termina el recorrido y devuelve todo lo grabado. */
    @PluginMethod
    public void stop(PluginCall call) {
        try {
            Object[] f = RouteTrack.finish(getContext());
            send(RouteService.A_STOP);
            JSObject r = new JSObject();
            r.put("mode", f[0]);
            r.put("startedAt", f[1]);
            r.put("endedAt", f[2]);
            r.put("elapsed", f[3]);
            r.put("dist", f[4]);
            r.put("gain", f[5]);
            r.put("loss", f[7]);
            JSArray arr = new JSArray();
            @SuppressWarnings("unchecked") ArrayList<double[]> pts = (ArrayList<double[]>) f[6];
            for (double[] p : pts) arr.put(row(p));
            r.put("points", arr);
            call.resolve(r);
        } catch (Exception e) {
            call.reject("No se pudo terminar: " + e.getMessage());
        }
    }

    /** Descarta lo grabado sin guardarlo. */
    @PluginMethod
    public void discard(PluginCall call) {
        RouteTrack.clear(getContext());
        send(RouteService.A_STOP);
        call.resolve();
    }

    private static JSArray row(double[] p) {
        JSArray a = new JSArray();
        try {
            a.put(p[0]); a.put(p[1]); a.put((long) p[2]); a.put((int) p[3]); a.put(p[4]);
        } catch (Exception e) { /* nada */ }
        return a;
    }
}
