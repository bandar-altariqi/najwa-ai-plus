// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandaraltariqi.najwa;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.security.MessageDigest;

/**
 * Updating Najwa AI Plus (see src/updates.js): downloads the new APK from this
 * app's GitHub release, checks its SHA-256 against the release's version.json
 * and opens Android's installer for it. Android asks the user once to allow
 * Najwa AI Plus to install apps, then shows its own "Update" screen.
 * Progress goes to the web layer as "progress" events ({ value: 0..1 }).
 */
@CapacitorPlugin(name = "Update")
public class UpdatePlugin extends Plugin {

    private static final String RELEASES = "https://github.com/bandar-altariqi/najwa-ai-plus/releases/download/";
    private volatile boolean busy = false;

    /** Whether Android lets this app install apps yet (asked once, in Settings). */
    @PluginMethod
    public void canInstall(PluginCall call) {
        JSObject out = new JSObject();
        out.put("allowed", allowed());
        call.resolve(out);
    }

    private boolean allowed() {
        return Build.VERSION.SDK_INT < 26 || getContext().getPackageManager().canRequestPackageInstalls();
    }

    @PluginMethod
    public void install(PluginCall call) {
        String url = call.getString("url", "");
        String sha256 = call.getString("sha256", "").toLowerCase();
        // Only this app's own releases, and only a checked file.
        if (!url.startsWith(RELEASES) || !sha256.matches("[0-9a-f]{64}")) {
            call.reject("Not an update for this app.");
            return;
        }
        if (!allowed()) {
            // Android's page for "Install unknown apps" for this app; the user
            // comes back and taps Update again.
            Intent intent = new Intent(Settings.ACTION_MANAGE_UNKNOWN_APP_SOURCES, Uri.parse("package:" + getContext().getPackageName()));
            intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
            getContext().startActivity(intent);
            JSObject out = new JSObject();
            out.put("needsPermission", true);
            call.resolve(out);
            return;
        }
        if (busy) {
            call.reject("An update is already downloading.");
            return;
        }
        busy = true;
        new Thread(() -> {
            try {
                File apk = download(url, sha256);
                Uri uri = FileProvider.getUriForFile(getContext(), getContext().getPackageName() + ".fileprovider", apk);
                Intent intent = new Intent(Intent.ACTION_VIEW);
                intent.setDataAndType(uri, "application/vnd.android.package-archive");
                intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);
                getContext().startActivity(intent);
                JSObject out = new JSObject();
                out.put("started", true);
                call.resolve(out);
            } catch (Exception e) {
                call.reject(e.getMessage() != null ? e.getMessage() : "The update couldn't be downloaded.");
            } finally {
                busy = false;
            }
        }).start();
    }

    private File download(String address, String sha256) throws Exception {
        File dir = new File(getContext().getCacheDir(), "update");
        if (!dir.exists() && !dir.mkdirs()) throw new Exception("No room to download the update.");
        File[] olds = dir.listFiles();
        if (olds != null) for (File old : olds) old.delete();
        File part = new File(dir, "Najwa-AI-Plus.apk.part");
        File apk = new File(dir, "Najwa-AI-Plus.apk");

        HttpURLConnection conn = null;
        URL url = new URL(address);
        // GitHub sends the file from another address: follow https redirects only.
        for (int hops = 0; ; hops++) {
            conn = (HttpURLConnection) url.openConnection();
            conn.setInstanceFollowRedirects(false);
            conn.setConnectTimeout(20000);
            conn.setReadTimeout(30000);
            int code = conn.getResponseCode();
            if (code >= 300 && code < 400 && hops < 5) {
                URL next = new URL(url, conn.getHeaderField("Location"));
                conn.disconnect();
                if (!"https".equals(next.getProtocol())) throw new Exception("The download was sent somewhere unsafe.");
                url = next;
                continue;
            }
            if (code != 200) throw new Exception("The download failed (HTTP " + code + ").");
            break;
        }

        long total = conn.getContentLengthLong();
        MessageDigest digest = MessageDigest.getInstance("SHA-256");
        long got = 0;
        long lastSent = 0;
        try (InputStream in = conn.getInputStream(); OutputStream out = new FileOutputStream(part)) {
            byte[] buf = new byte[64 * 1024];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                digest.update(buf, 0, n);
                got += n;
                if (total > 0 && (got - lastSent > total / 100 || got == total)) {
                    lastSent = got;
                    JSObject p = new JSObject();
                    p.put("value", Math.min(1.0, (double) got / total));
                    notifyListeners("progress", p);
                }
            }
        } finally {
            conn.disconnect();
        }

        StringBuilder hex = new StringBuilder();
        for (byte b : digest.digest()) hex.append(String.format("%02x", b));
        if (!hex.toString().equals(sha256)) {
            part.delete();
            throw new Exception("The downloaded file doesn't match the release, so it wasn't installed. Try again later.");
        }
        if (!part.renameTo(apk)) throw new Exception("The update couldn't be saved.");
        return apk;
    }
}
