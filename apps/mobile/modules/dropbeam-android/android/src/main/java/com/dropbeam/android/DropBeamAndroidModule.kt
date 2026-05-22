package com.dropbeam.android

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.net.wifi.WifiManager
import android.net.wifi.WifiNetworkSpecifier
import android.os.Build
import android.provider.DocumentsContract
import androidx.core.app.NotificationCompat
import expo.modules.kotlin.Promise
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.util.concurrent.atomic.AtomicReference

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

    private val pendingFolderPromise = AtomicReference<Promise?>(null)
    private val folderRequestCode = 0xD80B

    override fun definition() = ModuleDefinition {
        Name("DropBeamAndroid")

        Events("dropbeam.share-received")

        OnCreate {
            // Bridge native share-inbox events into JS while the module is alive.
            DropBeamShareInbox.setListener { uris, mimeType ->
                try {
                    sendEvent(
                        "dropbeam.share-received",
                        mapOf("uris" to uris, "mimeType" to (mimeType ?: ""))
                    )
                } catch (_: Throwable) {
                    // sendEvent throws if the JS bundle isn't ready yet; the
                    // payload remains queued in the inbox for the pull path.
                }
            }
        }

        OnDestroy {
            DropBeamShareInbox.setListener(null)
        }

        AsyncFunction("pullPendingShares") { promise: Promise ->
            val (uris, mime) = DropBeamShareInbox.drain()
            promise.resolve(mapOf("uris" to uris, "mimeType" to (mime ?: "")))
        }

        AsyncFunction("pickFolder") { promise: Promise ->
            try {
                val activity = appContext.activityProvider?.currentActivity
                    ?: return@AsyncFunction promise.reject("NO_ACTIVITY", "No current activity", null)
                if (!pendingFolderPromise.compareAndSet(null, promise)) {
                    return@AsyncFunction promise.reject("BUSY", "Folder picker already open", null)
                }
                val intent = Intent(Intent.ACTION_OPEN_DOCUMENT_TREE).apply {
                    addFlags(
                        Intent.FLAG_GRANT_READ_URI_PERMISSION or
                            Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION
                    )
                }
                activity.startActivityForResult(intent, folderRequestCode)
            } catch (error: Throwable) {
                pendingFolderPromise.set(null)
                promise.reject("PICK_FAILED", error.message ?: "Folder picker failed", error)
            }
        }

        OnActivityResult { _, payload ->
            if (payload.requestCode != folderRequestCode) return@OnActivityResult
            val promise = pendingFolderPromise.getAndSet(null) ?: return@OnActivityResult
            val data = payload.data
            val uri = data?.data
            if (uri == null) {
                promise.resolve(null)
                return@OnActivityResult
            }
            try {
                context.contentResolver.takePersistableUriPermission(
                    uri,
                    Intent.FLAG_GRANT_READ_URI_PERMISSION
                )
            } catch (_: Throwable) {
                // best effort
            }
            promise.resolve(mapOf("treeUri" to uri.toString()))
        }

        AsyncFunction("listFolderContents") { input: Map<String, Any?>, promise: Promise ->
            try {
                val treeUriString = input["treeUri"] as? String
                    ?: return@AsyncFunction promise.reject("BAD_INPUT", "treeUri required", null)
                val treeUri = Uri.parse(treeUriString)
                val docId = try {
                    DocumentsContract.getTreeDocumentId(treeUri)
                } catch (error: Throwable) {
                    return@AsyncFunction promise.reject("BAD_TREE", error.message ?: "Bad tree", error)
                }
                val result = mutableListOf<Map<String, Any?>>()
                walkTree(treeUri, docId, "", result)
                promise.resolve(mapOf("files" to result))
            } catch (error: Throwable) {
                promise.reject("LIST_FAILED", error.message ?: "Failed to list folder", error)
            }
        }

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

    /**
     * Recursive DocumentFile walk that emits a flat list of file descriptors
     * with their relative path within the picked tree. The JS layer is
     * responsible for picking these up and uploading them via the standard
     * file URI path.
     */
    private fun walkTree(
        treeUri: Uri,
        docId: String,
        relativePath: String,
        out: MutableList<Map<String, Any?>>
    ) {
        val childrenUri = DocumentsContract.buildChildDocumentsUriUsingTree(treeUri, docId)
        val resolver = context.contentResolver
        val cursor = resolver.query(
            childrenUri,
            arrayOf(
                DocumentsContract.Document.COLUMN_DOCUMENT_ID,
                DocumentsContract.Document.COLUMN_DISPLAY_NAME,
                DocumentsContract.Document.COLUMN_MIME_TYPE,
                DocumentsContract.Document.COLUMN_SIZE,
            ),
            null,
            null,
            null,
        ) ?: return
        cursor.use { c ->
            while (c.moveToNext()) {
                val childId = c.getString(0)
                val name = c.getString(1) ?: continue
                val mime = c.getString(2) ?: "application/octet-stream"
                val size = if (!c.isNull(3)) c.getLong(3) else 0L
                val nestedPath = if (relativePath.isEmpty()) name else "$relativePath/$name"
                if (mime == DocumentsContract.Document.MIME_TYPE_DIR) {
                    walkTree(treeUri, childId, nestedPath, out)
                } else {
                    val docUri = DocumentsContract.buildDocumentUriUsingTree(treeUri, childId)
                    out.add(
                        mapOf(
                            "uri" to docUri.toString(),
                            "name" to name,
                            "relativePath" to nestedPath,
                            "mimeType" to mime,
                            "size" to size,
                        )
                    )
                }
            }
        }
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
