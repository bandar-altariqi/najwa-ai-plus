// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandaraltariqi.najwa;

import android.content.Intent;
import android.util.Base64;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.util.HashMap;
import java.util.Iterator;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

/**
 * Requests made with the phone's own network code instead of the web view,
 * for servers that refuse the web view's Origin (Hermes Agent does, unless
 * told otherwise). See src/native-fetch.js for the JavaScript side.
 *
 * request({id, url, method, headers, body}) resolves with {status, headers}
 * when the answer starts; "net" events then bring {id, data} (base64) and
 * finally {id, done: true} or {id, error}. cancel({id}) stops a request.
 */
@CapacitorPlugin(name = "Net")
public class NetPlugin extends Plugin {

    private final ExecutorService pool = Executors.newCachedThreadPool();
    private final Map<String, NetRequest> running = new ConcurrentHashMap<>();

    @PluginMethod
    public void request(PluginCall call) {
        String id = call.getString("id");
        String url = call.getString("url");
        if (id == null || url == null) {
            call.reject("id and url are needed");
            return;
        }
        Map<String, String> headers = new HashMap<>();
        JSObject h = call.getObject("headers", new JSObject());
        if (h != null) {
            for (Iterator<String> keys = h.keys(); keys.hasNext(); ) {
                String key = keys.next();
                String value = h.optString(key, null);
                if (value != null) headers.put(key, value);
            }
        }
        String body = call.getData().isNull("body") ? null : call.getString("body");
        NetRequest req = new NetRequest(url, call.getString("method", "GET"), headers, body);
        running.put(id, req);
        pool.execute(() -> {
            req.run(new NetRequest.Listener() {
                @Override
                public void onHead(int status, Map<String, String> head) {
                    JSObject out = new JSObject();
                    JSObject hs = new JSObject();
                    for (Map.Entry<String, String> e : head.entrySet()) hs.put(e.getKey(), e.getValue());
                    out.put("status", status);
                    out.put("headers", hs);
                    call.resolve(out);
                }

                @Override
                public void onData(byte[] buffer, int length) {
                    JSObject evt = new JSObject();
                    evt.put("id", id);
                    evt.put("data", Base64.encodeToString(buffer, 0, length, Base64.NO_WRAP));
                    notifyListeners("net", evt);
                }

                @Override
                public void onEnd() {
                    JSObject evt = new JSObject();
                    evt.put("id", id);
                    evt.put("done", true);
                    notifyListeners("net", evt);
                }

                @Override
                public void onError(String message, boolean headSent) {
                    if (!headSent) {
                        call.reject(message);
                        return;
                    }
                    JSObject evt = new JSObject();
                    evt.put("id", id);
                    evt.put("error", message);
                    notifyListeners("net", evt);
                }
            });
            running.remove(id);
        });
    }

    /**
     * { on } A reply is being written (on: true) or no longer: Android keeps
     * the app and its network going in the background meanwhile (with a
     * notification), so leaving the app doesn't cut the reply off.
     */
    /** { lang } The app's language ("en" or "ar"), for the notifications. */
    @PluginMethod
    public void language(PluginCall call) {
        DownloadService.arabic = "ar".equals(call.getString("lang", "en"));
        call.resolve();
    }

    /**
     * Najwa AI Plus: { title, text, chatId } The agent on a computer asks for
     * permission: a notification that opens the chat (see AgentAlerts).
     */
    @PluginMethod
    public void agentAsks(PluginCall call) {
        String chatId = call.getString("chatId", "");
        AgentAlerts.show(getContext().getApplicationContext(), call.getString("title", "Najwa AI Plus"), call.getString("text", ""), chatId);
        call.resolve();
    }

    /** { chatId } The chat is open (or answered): its notification goes. */
    @PluginMethod
    public void agentSeen(PluginCall call) {
        AgentAlerts.clear(getContext().getApplicationContext(), call.getString("chatId", ""));
        call.resolve();
    }

    /** Android 13+ asks before an app shows notifications: asked once, when an agent chat starts. */
    @PluginMethod
    public void askNotifications(PluginCall call) {
        if (android.os.Build.VERSION.SDK_INT >= 33 && getActivity() != null) {
            String perm = "android.permission.POST_NOTIFICATIONS";
            if (androidx.core.content.ContextCompat.checkSelfPermission(getContext(), perm) != android.content.pm.PackageManager.PERMISSION_GRANTED) {
                android.content.SharedPreferences prefs = getContext().getSharedPreferences("balimda", android.content.Context.MODE_PRIVATE);
                if (!prefs.getBoolean("askedAgentNotifications", false)) {
                    prefs.edit().putBoolean("askedAgentNotifications", true).apply();
                    androidx.core.app.ActivityCompat.requestPermissions(getActivity(), new String[] {perm}, 7003);
                }
            }
        }
        call.resolve();
    }

    // A tapped notification opens its chat: when the app was closed (the
    // launch intent) and when it was running (a new intent). Kept until the
    // app listens.
    @Override
    public void load() {
        if (getActivity() != null) openFrom(getActivity().getIntent());
    }

    @Override
    protected void handleOnNewIntent(Intent intent) {
        super.handleOnNewIntent(intent);
        openFrom(intent);
    }

    private void openFrom(Intent intent) {
        if (intent == null) return;
        String chatId = intent.getStringExtra(AgentAlerts.EXTRA_CHAT);
        if (chatId == null || chatId.isEmpty()) return;
        intent.removeExtra(AgentAlerts.EXTRA_CHAT);
        JSObject evt = new JSObject();
        evt.put("chatId", chatId);
        notifyListeners("openChat", evt, true);
    }

    @PluginMethod
    public void replying(PluginCall call) {
        DownloadService.replying(getContext().getApplicationContext(), Boolean.TRUE.equals(call.getBoolean("on", false)));
        call.resolve();
    }

    @PluginMethod
    public void cancel(PluginCall call) {
        String id = call.getString("id");
        NetRequest req = id == null ? null : running.remove(id);
        // disconnect() may block briefly, so not on the bridge's thread.
        if (req != null) pool.execute(req::cancel);
        call.resolve();
    }

    @Override
    protected void handleOnDestroy() {
        for (NetRequest req : running.values()) req.cancel();
        running.clear();
        pool.shutdownNow();
    }
}
