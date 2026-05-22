package com.dropbeam.android

import android.content.Context
import android.net.Uri
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Process-wide queue for files received via the system share sheet. The
 * Android `MainActivity` calls [enqueue] from `onCreate`/`onNewIntent`; React
 * Native pulls the queue via the `DropBeamAndroid.pullPendingShares` async
 * function and also subscribes to the `dropbeam.share-received` event for
 * shares delivered while the bundle is already running.
 */
object DropBeamShareInbox {
    private val pending: MutableList<String> = CopyOnWriteArrayList()
    @Volatile private var lastMimeType: String? = null
    @Volatile private var listener: ((List<String>, String?) -> Unit)? = null

    fun enqueue(context: Context, uris: List<Uri>, mimeType: String?) {
        if (uris.isEmpty()) return
        val strings = uris.map { it.toString() }
        // Persist read permission for content:// URIs where possible.
        uris.forEach { uri ->
            if (uri.scheme == "content") {
                try {
                    context.contentResolver.takePersistableUriPermission(
                        uri,
                        android.content.Intent.FLAG_GRANT_READ_URI_PERMISSION
                    )
                } catch (_: Throwable) {
                    // Some providers don't support persistable grants; we still
                    // hold the runtime grant for this Activity instance.
                }
            }
        }
        lastMimeType = mimeType
        val live = listener
        if (live != null) {
            live.invoke(strings, mimeType)
        } else {
            pending.addAll(strings)
        }
    }

    fun drain(): Pair<List<String>, String?> {
        val snapshot = pending.toList()
        pending.clear()
        val mime = lastMimeType
        return snapshot to mime
    }

    fun setListener(callback: ((List<String>, String?) -> Unit)?) {
        listener = callback
        // Flush anything that arrived before the listener attached.
        if (callback != null) {
            val (snapshot, mime) = drain()
            if (snapshot.isNotEmpty()) callback.invoke(snapshot, mime)
        }
    }
}
