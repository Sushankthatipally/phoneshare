package com.dropbeam.android

import android.content.BroadcastReceiver
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.util.Log

/**
 * Resolves notification action buttons (Accept / Decline / Change folder) back into
 * the JS layer by posting to the local backend, so the receive can complete without
 * opening the app.
 *
 * FOLDER action diverges from Accept/Decline: it opens the host app via the launcher
 * intent and carries `sessionId`, `batchId`, and `action=open-folder` as extras. The
 * RN side reads the launch intent (via expo-linking / getInitialURL) and routes the
 * user to the saved-files view for this batch.
 */
class IncomingTransferActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val sessionId = intent.getStringExtra("sessionId") ?: return
        val batchId = intent.getStringExtra("batchId") ?: return

        when (action) {
            "com.dropbeam.android.ACCEPT" -> postToBackend(context, sessionId, batchId, "accept")
            "com.dropbeam.android.DECLINE" -> postToBackend(context, sessionId, batchId, "decline")
            "com.dropbeam.android.FOLDER" -> openAppForFolder(context, sessionId, batchId)
        }
    }

    private fun openAppForFolder(context: Context, sessionId: String, batchId: String) {
        // Build a deep link the RN layer can route on cold start
        // (expo-linking parses `dropbeam://incoming/<batchId>?...`).
        val deepLink = Uri.parse(
            "dropbeam://incoming/$batchId?sessionId=$sessionId&action=open-folder",
        )

        val launchIntent = context.packageManager.getLaunchIntentForPackage(context.packageName)
        val target = launchIntent ?: Intent(Intent.ACTION_MAIN).apply {
            component = ComponentName(context.packageName, "${context.packageName}.MainActivity")
            addCategory(Intent.CATEGORY_LAUNCHER)
        }
        target.apply {
            action = Intent.ACTION_VIEW
            data = deepLink
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            addFlags(Intent.FLAG_ACTIVITY_CLEAR_TOP)
            addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP)
            putExtra("sessionId", sessionId)
            putExtra("batchId", batchId)
            putExtra("action", "open-folder")
        }

        try {
            context.startActivity(target)
        } catch (error: Throwable) {
            Log.w("DropBeam", "Failed to open app for folder action", error)
        }
    }

    private fun postToBackend(context: Context, sessionId: String, batchId: String, verb: String) {
        Thread {
            try {
                val origin = "http://127.0.0.1:17619"
                val url = java.net.URL("$origin/api/sessions/$sessionId/transfers/$batchId/$verb")
                val conn = url.openConnection() as java.net.HttpURLConnection
                conn.requestMethod = "POST"
                conn.setRequestProperty("Content-Type", "application/json")
                conn.doOutput = true
                conn.outputStream.use { it.write("{}".toByteArray()) }
                Log.i("DropBeam", "$verb $batchId → ${conn.responseCode}")
                conn.disconnect()
            } catch (error: Throwable) {
                Log.w("DropBeam", "Action post failed", error)
            }
        }.start()
    }
}
