package dev.ironkeep.app.vault.session

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import java.util.UUID

class SecureClipboard(context: Context, private val scope: CoroutineScope) {
    private val clipboard = context.getSystemService(ClipboardManager::class.java)
    private var clearJob: Job? = null
    private var ownedLabel: String? = null

    @Synchronized
    fun copy(secret: String, clearAfterSeconds: Int) {
        require(secret.isNotEmpty())
        SessionSecurity.validate(SessionSecurity.MIN_AUTO_LOCK_MINUTES, clearAfterSeconds)
        val label = "ironkeep-${UUID.randomUUID()}"
        clipboard.setPrimaryClip(ClipData.newPlainText(label, secret))
        clearJob?.cancel()
        ownedLabel = label
        clearJob = scope.launch {
            delay(clearAfterSeconds * 1_000L)
            clearOwned(label)
        }
    }

    @Synchronized
    fun clearOwned() {
        clearOwned(ownedLabel)
    }

    @Synchronized
    private fun clearOwned(expectedLabel: String?) {
        if (expectedLabel == null || ownedLabel != expectedLabel) return
        clearJob?.cancel()
        clearJob = null
        ownedLabel = null
        runCatching {
            if (clipboard.primaryClipDescription?.label?.toString() == expectedLabel) clipboard.clearPrimaryClip()
        }
    }
}
