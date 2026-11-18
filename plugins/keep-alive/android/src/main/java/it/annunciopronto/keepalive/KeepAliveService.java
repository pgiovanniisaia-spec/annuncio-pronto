package it.annunciopronto.keepalive;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.content.pm.ServiceInfo;
import android.os.Build;
import android.os.IBinder;
import android.os.PowerManager;
import androidx.core.app.NotificationCompat;

/** Servizio in primo piano: finché è acceso Android non sospende né chiude ListLab. */
public class KeepAliveService extends Service {
    static final String CHANNEL = "listlab_work";
    static final int ID = 4711;
    private PowerManager.WakeLock lock;

    @Override public IBinder onBind(Intent i) { return null; }

    static Notification build(Context c, String text) {
        NotificationManager nm = (NotificationManager) c.getSystemService(Context.NOTIFICATION_SERVICE);
        if (Build.VERSION.SDK_INT >= 26 && nm.getNotificationChannel(CHANNEL) == null) {
            NotificationChannel ch = new NotificationChannel(CHANNEL, "Lavoro in sottofondo", NotificationManager.IMPORTANCE_LOW);
            ch.setDescription("Mostrata mentre ListLab prepara foto e descrizioni");
            nm.createNotificationChannel(ch);
        }
        Intent open = c.getPackageManager().getLaunchIntentForPackage(c.getPackageName());
        PendingIntent pi = open == null ? null : PendingIntent.getActivity(c, 0, open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        int icon = c.getApplicationInfo().icon;
        NotificationCompat.Builder b = new NotificationCompat.Builder(c, CHANNEL)
            .setSmallIcon(icon != 0 ? icon : android.R.drawable.stat_sys_upload)
            .setContentTitle("ListLab")
            .setContentText(text == null || text.isEmpty() ? "Sto lavorando…" : text)
            .setOngoing(true).setOnlyAlertOnce(true).setSilent(true)
            .setProgress(0, 0, true);
        if (pi != null) b.setContentIntent(pi);
        return b.build();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        String text = intent != null ? intent.getStringExtra("text") : null;
        Notification n = build(this, text);
        try {
            if (Build.VERSION.SDK_INT >= 29) startForeground(ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC);
            else startForeground(ID, n);
        } catch (Exception e) { stopSelf(); return START_NOT_STICKY; }
        if (lock == null) {
            PowerManager pm = (PowerManager) getSystemService(Context.POWER_SERVICE);
            lock = pm.newWakeLock(PowerManager.PARTIAL_WAKE_LOCK, "listlab:work");
            lock.setReferenceCounted(false);
        }
        if (!lock.isHeld()) lock.acquire(30 * 60 * 1000L);   // al massimo 30 minuti
        return START_NOT_STICKY;
    }

    @Override public void onDestroy() {
        if (lock != null && lock.isHeld()) lock.release();
        super.onDestroy();
    }
}
