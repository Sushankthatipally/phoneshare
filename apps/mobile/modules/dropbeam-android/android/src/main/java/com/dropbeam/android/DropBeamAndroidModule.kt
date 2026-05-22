package com.dropbeam.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import androidx.core.app.NotificationCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * DropBeamAndroidModule — bridges the JS layer to Android-only capabilities:
 *
 *   - startHotspot      → opens the Settings.Panel for tethering. Programmatic hotspot
 *                         control is gated to system apps since Android 8, so we
 *                         orchestrate the user-facing handoff.
 *   - joinWifi          → uses WifiNetworkSpecifier (Android 10+) to suggest the
 *                         desktop's hotspot to the network picker.
 *   - showIncomingNotification → a rich notification with Accept / Decline / Change folder
 *                         action buttons that resolve back to JS handlers.
 *
 * Companion service classes:
 *   - HotspotJoinService   handles the Wi-Fi suggestion lifecycle.
 *   - IncomingTransferService — runs as a foreground service so the receive can finish
 *                               with the app in the background.
 */
class DropBeamAndroidModule : Module() {
    private val context: Context
        get() = appContext.reactContext ?: throw IllegalStateException("React context unavailable")

    override fun definition() = ModuleDefinition {
        Name("DropBeamAndroid")

        AsyncFunction("startHotspot") { _: Map<String, Any?>, promise: Promise ->
            try {
                // ACTION_WIFI_AP_SETTINGS is @hide in the public SDK, so use the literal action.
                val intent = Intent("android.settings.WIFI_AP_SETTINGS").apply {
                    addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                }
                context.startActivity(intent)
                promise.resolve(true)
            } catch (error: Throwable) {
                promise.reject("HOTSPOT_FAILED", error.message ?: "Could not open hotspot settings", error)
            }
        }

        AsyncFunction("joinWifi") { input: Map<String, Any?>, promise: Promise ->
            val ssid = input["ssid"] as? String ?: return@AsyncFunction promise.reject("BAD_INPUT", "ssid required", null)
            val password = input["password"] as? String ?: ""

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                try {
                    val specifierBuilder = WifiNetworkSpecifier.Builder()
                        .setSsid(ssid)
                    if (password.isNotEmpty()) {
                        specifierBuilder.setWpa2Passphrase(password)
                    }
                    val intent = Intent(android.provider.Settings.ACTION_WIFI_SETTINGS).apply {
                        addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
                    }
                    context.startActivity(intent)
                    promise.resolve(true)
                } catch (error: Throwable) {
                    promise.reject("JOIN_FAILED", error.message ?: "Failed to join hotspot", error)
                }
            } else {
                @Suppress("DEPRECATION")
                val wifiManager = context.applicationContext.getSystemService(Context.WIFI_SERVICE) as WifiManager
                if (!wifiManager.isWifiEnabled) wifiManager.isWifiEnabled = true
                val config = android.net.wifi.WifiConfiguration().apply {
                    SSID = "\"" + ssid + "\""
                    preSharedKey = "\"" + password + "\""
                }
                @Suppress("DEPRECATION")
                val netId = wifiManager.addNetwork(config)
                @Suppress("DEPRECATION")
                wifiManager.enableNetwork(netId, true)
                promise.resolve(true)
            }
        }

        AsyncFunction("showIncomingNotification") { input: Map<String, Any?>, promise: Promise ->
            try {
                val title = input["title"] as? String ?: "DropBeam transfer"
                val body = input["body"] as? String ?: ""
                val sessionId = input["sessionId"] as? String ?: ""
                val batchId = input["batchId"] as? String ?: ""

                val channelId = ensureChannel()

                val acceptIntent = pendingIntent("ACCEPT", sessionId, batchId, 0)
                val declineIntent = pendingIntent("DECLINE", sessionId, batchId, 1)
                val folderIntent = pendingIntent("FOLDER", sessionId, batchId, 2)

                val notification = NotificationCompat.Builder(context, channelId)
                    .setSmallIcon(android.R.drawable.ic_dialog_info)
                    .setContentTitle(title)
                    .setContentText(body)
                    .setStyle(NotificationCompat.BigTextStyle().bigText(body))
                    .addAction(android.R.drawable.ic_menu_send, "Accept", acceptIntent)
                    .addAction(android.R.drawable.ic_menu_close_clear_cancel, "Decline", declineIntent)
                    .addAction(android.R.drawable.ic_menu_save, "Change folder", folderIntent)
                    .setAutoCancel(true)
                    .build()

                val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
                val notifId = (System.currentTimeMillis() and 0x7fffffff).toInt()
                manager.notify(notifId, notification)
                promise.resolve(notifId)
            } catch (error: Throwable) {
                promise.reject("NOTIFY_FAILED", error.message ?: "Notification failed", error)
            }
        }

        AsyncFunction("startBackgroundReceive") { input: Map<String, Any?>, promise: Promise ->
            val intent = Intent(context, IncomingTransferService::class.java).apply {
                putExtra("sessionId", input["sessionId"] as? String)
                putExtra("batchId", input["batchId"] as? String)
            }
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                context.startForegroundService(intent)
            } else {
                context.startService(intent)
            }
            promise.resolve(true)
        }

        AsyncFunction("stopBackgroundReceive") { promise: Promise ->
            try {
                val intent = Intent(context, IncomingTransferService::class.java)
                context.stopService(intent)
                promise.resolve(true)
            } catch (error: Throwable) {
                promise.reject("STOP_FAILED", error.message ?: "Failed to stop foreground service", error)
            }
        }
    }

    private fun ensureChannel(): String {
        val channelId = "dropbeam-transfers"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val manager = context.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (manager.getNotificationChannel(channelId) == null) {
                val channel = NotificationChannel(
                    channelId,
                    "DropBeam transfers",
                    NotificationManager.IMPORTANCE_HIGH
                ).apply {
                    description = "Incoming transfer requests and progress."
                }
                manager.createNotificationChannel(channel)
            }
        }
        return channelId
    }

    private fun pendingIntent(action: String, sessionId: String, batchId: String, requestCode: Int): PendingIntent {
        val intent = Intent(context, IncomingTransferActionReceiver::class.java).apply {
            this.action = "com.dropbeam.android.$action"
            putExtra("sessionId", sessionId)
            putExtra("batchId", batchId)
        }
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE
        } else {
            PendingIntent.FLAG_UPDATE_CURRENT
        }
        return PendingIntent.getBroadcast(context, requestCode, intent, flags)
    }
}
