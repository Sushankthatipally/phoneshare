package com.dropbeam.android

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.IBinder
import androidx.core.app.NotificationCompat

/**
 * IncomingTransferService — foreground service that keeps the receive lane alive
 * while the app is backgrounded. Required by Android 8+ for any sustained network
 * activity outside the foreground.
 */
class IncomingTransferService : Service() {
    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val channelId = "dropbeam-receive"
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            val mgr = getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
            if (mgr.getNotificationChannel(channelId) == null) {
                mgr.createNotificationChannel(
                    NotificationChannel(channelId, "Receiving files", NotificationManager.IMPORTANCE_LOW)
                )
            }
        }

        val notification: Notification = NotificationCompat.Builder(this, channelId)
            .setSmallIcon(android.R.drawable.stat_sys_download)
            .setContentTitle("DropBeam — receiving")
            .setContentText("Holding the lane open in the background.")
            .setOngoing(true)
            .build()

        startForeground(101, notification)
        return START_STICKY
    }
}
