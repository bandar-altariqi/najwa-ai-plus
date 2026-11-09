// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandaraltariqi.najwa;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import androidx.core.app.NotificationCompat;

/**
 * Najwa AI Plus: a notification when the agent on a computer asks for
 * permission while the app isn't showing that chat. Tapping it opens the chat
 * (the intent carries EXTRA_CHAT; NetPlugin passes it to the app as an
 * "openChat" event). One notification per chat: a newer question replaces it.
 */
final class AgentAlerts {

    static final String EXTRA_CHAT = "najwa.openChat";
    private static final String CHANNEL = "agent";

    private AgentAlerts() {}

    private static int idFor(String chatId) {
        return 8000 + (chatId.hashCode() & 0xfff);
    }

    static void show(Context context, String title, String text, String chatId) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm == null) return;
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(CHANNEL, DownloadService.arabic ? "أسئلة الوكيل" : "The agent's questions", NotificationManager.IMPORTANCE_HIGH);
            channel.setDescription(DownloadService.arabic ? "عندما يطلب الوكيل إذنك" : "When the agent asks for your permission");
            nm.createNotificationChannel(channel);
        }
        Intent open = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent tap = null;
        if (open != null) {
            open.addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP | Intent.FLAG_ACTIVITY_CLEAR_TOP);
            open.putExtra(EXTRA_CHAT, chatId);
            tap = PendingIntent.getActivity(context, idFor(chatId), open, PendingIntent.FLAG_IMMUTABLE | PendingIntent.FLAG_UPDATE_CURRENT);
        }
        NotificationCompat.Builder b = new NotificationCompat.Builder(context, CHANNEL)
            .setSmallIcon(android.R.drawable.stat_notify_chat)
            .setContentTitle(title)
            .setContentText(text)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(text))
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_MESSAGE)
            .setAutoCancel(true)
            .setContentIntent(tap);
        try {
            nm.notify(idFor(chatId), b.build());
        } catch (Exception ignored) {
            // No permission to show notifications: the card is still in the chat.
        }
    }

    static void clear(Context context, String chatId) {
        NotificationManager nm = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (nm != null) nm.cancel(idFor(chatId));
    }
}
