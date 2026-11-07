package it.annunciopronto.gallery;

import android.Manifest;
import android.content.ContentResolver;
import android.content.ContentValues;
import android.media.MediaScannerConnection;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.MediaStore;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.PermissionState;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.getcapacitor.annotation.Permission;
import com.getcapacitor.annotation.PermissionCallback;
import java.io.File;
import java.io.FileOutputStream;
import java.io.OutputStream;

/**
 * Salva una foto JPEG nella Galleria, in Pictures/AnnuncioPronto/<cartella>/<nome>.
 * Android 10+: MediaStore, nessun permesso. Android 6-9: file + scansione, con permesso di scrittura.
 * "time" (millisecondi) diventa la data dello scatto: con date crescenti la Galleria
 * mostra le foto nello stesso ordine della griglia.
 */
@CapacitorPlugin(
    name = "GallerySaver",
    permissions = { @Permission(strings = { Manifest.permission.WRITE_EXTERNAL_STORAGE }, alias = "storage") }
)
public class GallerySaverPlugin extends Plugin {

    private static final String ROOT = "AnnuncioPronto";

    @PluginMethod
    public void saveImage(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q && getPermissionState("storage") != PermissionState.GRANTED) {
            requestPermissionForAlias("storage", call, "storageCallback");
            return;
        }
        save(call);
    }

    @PermissionCallback
    private void storageCallback(PluginCall call) {
        if (getPermissionState("storage") == PermissionState.GRANTED) {
            save(call);
        } else {
            call.reject("Permesso per salvare le foto negato");
        }
    }

    private static String clean(String s, String fallback) {
        if (s == null) return fallback;
        String c = s.replaceAll("[\\\\/:*?\"<>|\\p{Cntrl}]", " ").replaceAll("\\s+", " ").trim();
        if (c.startsWith(".")) c = c.substring(1).trim();
        return c.isEmpty() ? fallback : c;
    }

    private void save(PluginCall call) {
        String data = call.getString("data");
        if (data == null || data.isEmpty()) {
            call.reject("Nessuna immagine");
            return;
        }
        String folder = clean(call.getString("folder"), "Annuncio");
        String fileName = clean(call.getString("fileName"), "foto.jpg");
        long time = call.getData().optLong("time", 0);
        if (time <= 0) time = System.currentTimeMillis();

        try {
            int comma = data.indexOf(',');
            if (data.startsWith("data:") && comma > 0) data = data.substring(comma + 1);
            byte[] bytes = Base64.decode(data, Base64.DEFAULT);
            String uri;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                uri = saveMediaStore(bytes, folder, fileName, time);
            } else {
                uri = saveLegacy(bytes, folder, fileName, time);
            }
            JSObject ret = new JSObject();
            ret.put("uri", uri);
            ret.put("path", Environment.DIRECTORY_PICTURES + "/" + ROOT + "/" + folder + "/" + fileName);
            call.resolve(ret);
        } catch (Exception e) {
            call.reject("Salvataggio nella Galleria non riuscito: " + e.getMessage(), e);
        }
    }

    private String saveMediaStore(byte[] bytes, String folder, String fileName, long time) throws Exception {
        ContentResolver resolver = getContext().getContentResolver();
        ContentValues v = new ContentValues();
        v.put(MediaStore.Images.Media.DISPLAY_NAME, fileName);
        v.put(MediaStore.Images.Media.MIME_TYPE, "image/jpeg");
        v.put(MediaStore.Images.Media.RELATIVE_PATH, Environment.DIRECTORY_PICTURES + "/" + ROOT + "/" + folder);
        v.put(MediaStore.Images.Media.DATE_TAKEN, time);
        v.put(MediaStore.Images.Media.DATE_ADDED, time / 1000);
        v.put(MediaStore.Images.Media.DATE_MODIFIED, time / 1000);
        v.put(MediaStore.Images.Media.IS_PENDING, 1);
        Uri collection = MediaStore.Images.Media.getContentUri(MediaStore.VOLUME_EXTERNAL_PRIMARY);
        Uri item = resolver.insert(collection, v);
        if (item == null) throw new Exception("MediaStore non disponibile");
        try (OutputStream os = resolver.openOutputStream(item)) {
            if (os == null) throw new Exception("impossibile scrivere il file");
            os.write(bytes);
        } catch (Exception e) {
            resolver.delete(item, null, null);
            throw e;
        }
        ContentValues done = new ContentValues();
        done.put(MediaStore.Images.Media.IS_PENDING, 0);
        done.put(MediaStore.Images.Media.DATE_TAKEN, time);
        resolver.update(item, done, null, null);
        return item.toString();
    }

    @SuppressWarnings("deprecation")
    private String saveLegacy(byte[] bytes, String folder, String fileName, long time) throws Exception {
        File dir = new File(Environment.getExternalStoragePublicDirectory(Environment.DIRECTORY_PICTURES), ROOT + "/" + folder);
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("impossibile creare la cartella");
        File f = new File(dir, fileName);
        try (FileOutputStream os = new FileOutputStream(f)) {
            os.write(bytes);
        }
        f.setLastModified(time);
        MediaScannerConnection.scanFile(getContext(), new String[] { f.getAbsolutePath() }, new String[] { "image/jpeg" }, null);
        return Uri.fromFile(f).toString();
    }
}
