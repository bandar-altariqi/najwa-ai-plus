// Najwa AI — © 2026 Bandar Altariqi. All rights reserved.
// Licensed under the Najwa AI License (see LICENSE): non-commercial use only;
// keep the Najwa AI name and the "Najwa AI by Bandar Altariqi" credit; no rebranding.

package com.bandaraltariqi.najwa;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

/**
 * Najwa AI Plus: Allow or Deny tapped on the agent's notification. The answer
 * goes to the app (NetPlugin, "agentAnswer"), which answers the card as a tap
 * in the chat would. The app is running while the agent works (its reply
 * keeps it going); if it isn't, the notification asks to open the chat.
 */
public class AgentAnswerReceiver extends BroadcastReceiver {

    static final String ACTION = "com.bandaraltariqi.najwa.AGENT_ANSWER";
    static final String EXTRA_RUN = "najwa.runId";
    static final String EXTRA_CHOICE = "najwa.choice";

    @Override
    public void onReceive(Context context, Intent intent) {
        String chatId = intent.getStringExtra(AgentAlerts.EXTRA_CHAT);
        String runId = intent.getStringExtra(EXTRA_RUN);
        String choice = "once".equals(intent.getStringExtra(EXTRA_CHOICE)) ? "once" : "deny";
        if (chatId == null || runId == null) return;
        if (NetPlugin.answer(chatId, runId, choice)) {
            AgentAlerts.answered(context, chatId, "once".equals(choice));
        } else {
            AgentAlerts.openToAnswer(context, chatId);
        }
    }
}
