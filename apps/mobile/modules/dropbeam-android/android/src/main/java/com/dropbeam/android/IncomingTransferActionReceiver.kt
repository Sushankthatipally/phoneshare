package com.dropbeam.android

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log

/**
 * Resolves notification action buttons (Accept / Decline / Change folder) back into
 * the JS layer by posting to the local backend, so the receive can complete without
 * opening the app.
 */
class IncomingTransferActionReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        val action = intent.action ?: return
        val sessionId = intent.getStringExtra("sessionId") ?: return
        val batchId = intent.getStringExtra("batchId") ?: return

        when (action) {
            "com.dropbeam.android.ACCEPT" -> postToBackend(context, sessionId, batchId, "accept")
            "com.dropbeam.android.DECLINE" -> postToBackend(context, sessionId, batchId, "decline")
            "com.dropbeam.android.FOLDER" -> {
                Log.i("DropBeam", "Change folder requested for batch=$batchId")
                postToBackend(context, sessionId, batchId, "accept")
            }
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
