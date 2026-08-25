package dev.ironkeep.app.vault.session

object SessionSecurity {
    const val MIN_AUTO_LOCK_MINUTES = 1
    const val MAX_AUTO_LOCK_MINUTES = 60
    const val MIN_CLIPBOARD_CLEAR_SECONDS = 15
    const val MAX_CLIPBOARD_CLEAR_SECONDS = 120
    const val BACKGROUND_LOCK_GRACE_MILLIS = 15_000L

    fun validate(autoLockMinutes: Int, clearClipboardSeconds: Int) {
        require(autoLockMinutes in MIN_AUTO_LOCK_MINUTES..MAX_AUTO_LOCK_MINUTES) { "Auto-lock timeout is outside Ironkeep limits" }
        require(clearClipboardSeconds in MIN_CLIPBOARD_CLEAR_SECONDS..MAX_CLIPBOARD_CLEAR_SECONDS) { "Clipboard timeout is outside Ironkeep limits" }
    }
}

enum class SessionExpiryReason { BACKGROUND, INACTIVITY }

class SessionDeadline {
    private var lastActivityMillis: Long? = null
    private var backgroundedAtMillis: Long? = null

    @Synchronized
    fun open(nowMillis: Long) {
        lastActivityMillis = nowMillis
        backgroundedAtMillis = null
    }

    @Synchronized
    fun touch(nowMillis: Long) {
        if (lastActivityMillis != null) lastActivityMillis = nowMillis
    }

    @Synchronized
    fun background(nowMillis: Long) {
        if (lastActivityMillis != null && backgroundedAtMillis == null) backgroundedAtMillis = nowMillis
    }

    @Synchronized
    fun foreground() {
        backgroundedAtMillis = null
    }

    @Synchronized
    fun close() {
        lastActivityMillis = null
        backgroundedAtMillis = null
    }

    @Synchronized
    fun expiryReason(nowMillis: Long, autoLockMinutes: Int): SessionExpiryReason? {
        val lastActivity = lastActivityMillis ?: return null
        val inactivityDeadline = lastActivity + autoLockMinutes * 60_000L
        val backgroundDeadline = backgroundedAtMillis?.plus(SessionSecurity.BACKGROUND_LOCK_GRACE_MILLIS) ?: Long.MAX_VALUE
        if (nowMillis < minOf(inactivityDeadline, backgroundDeadline)) return null
        return if (backgroundDeadline <= inactivityDeadline) SessionExpiryReason.BACKGROUND else SessionExpiryReason.INACTIVITY
    }

    @Synchronized
    fun remainingMillis(nowMillis: Long, autoLockMinutes: Int): Long? {
        val lastActivity = lastActivityMillis ?: return null
        val inactivityDeadline = lastActivity + autoLockMinutes * 60_000L
        val backgroundDeadline = backgroundedAtMillis?.plus(SessionSecurity.BACKGROUND_LOCK_GRACE_MILLIS) ?: Long.MAX_VALUE
        return (minOf(inactivityDeadline, backgroundDeadline) - nowMillis).coerceAtLeast(0)
    }
}
