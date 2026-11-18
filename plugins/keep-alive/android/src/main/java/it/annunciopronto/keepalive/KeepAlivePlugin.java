package it.annunciopronto.keepalive;

import android.Manifest;
import android.content.Intent;
import android.os.Build;
import android.webkit.WebView;
import androidx.core.content.ContextCompat;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;

/**
 * KeepAlive.start({text}) / KeepAlive.stop(): servizio in primo piano con notifica,
 * così le chiamate a Claude/OpenAI continuano anche con l'app chiusa o in sottofondo.
 * Tiene anche la WebView a priorità alta e i suoi timer accesi.
 */
@CapacitorPlugin(name = "KeepAlive", permissions = { @Permission(strings = { Manifest.permission.POST_NOTIFICATIONS }, alias = "notify") })
public class KeepAlivePlugin extends Plugin {
    private boolean running = false;

    @Override public void load() {
        WebView w = getBridge().getWebView();
        if (Build.VERSION.SDK_INT >= 26) w.setRendererPriorityPolicy(WebView.RENDERER_PRIORITY_IMPORTANT, false);
    }

    @PluginMethod public void start(PluginCall call) {
        if (Build.VERSION.SDK_INT >= 33 && getPermissionState("notify") != PermissionState.GRANTED) {
            requestPermissionForAlias("notify", call, "afterPerm");   // senza permesso parte comunque, solo senza notifica visibile
            return;
        }
        run(call);
    }
    @com.getcapacitor.annotation.PermissionCallback private void afterPerm(PluginCall call) { run(call); }

    private void run(PluginCall call) {
        Intent i = new Intent(getContext(), KeepAliveService.class);
        i.putExtra("text", call.getString("text", ""));
        try { ContextCompat.startForegroundService(getContext(), i); running = true; call.resolve(); }
        catch (Exception e) { call.reject(e.getMessage()); }
    }

    @PluginMethod public void stop(PluginCall call) {
        getContext().stopService(new Intent(getContext(), KeepAliveService.class));
        running = false; call.resolve();
    }

    @Override protected void handleOnPause() {
        super.handleOnPause();
        if (running) getBridge().getWebView().resumeTimers();   // i timer JavaScript non si fermano
    }
}
