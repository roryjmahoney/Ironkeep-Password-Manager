package dev.ironkeep.app.vault.session

import android.annotation.SuppressLint
import android.content.Context
import java.util.UUID

class DeviceIdProvider(context: Context) {
    private val preferences = context.applicationContext.getSharedPreferences("ironkeep.device", Context.MODE_PRIVATE)

    @SuppressLint("UseKtx") // A durable device identifier requires checking the synchronous commit result.
    @Synchronized
    fun id(): String {
        preferences.getString("id", null)?.let { return it }
        val created = UUID.randomUUID().toString()
        if (!preferences.edit().putString("id", created).commit()) error("Could not persist device identifier")
        return created
    }
}
