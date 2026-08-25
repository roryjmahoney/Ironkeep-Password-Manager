package dev.ironkeep.app.vault.session

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class SessionDeadlineTest {
    @Test
    fun inactivityDeadlineResetsOnlyOnActivity() {
        val deadline = SessionDeadline()
        deadline.open(1_000)
        assertNull(deadline.expiryReason(60_999, 1))
        deadline.touch(50_000)
        assertNull(deadline.expiryReason(109_999, 1))
        assertEquals(SessionExpiryReason.INACTIVITY, deadline.expiryReason(110_000, 1))
    }

    @Test
    fun backgroundGraceUsesShorterDeadline() {
        val deadline = SessionDeadline()
        deadline.open(1_000)
        deadline.background(2_000)
        assertEquals(SessionSecurity.BACKGROUND_LOCK_GRACE_MILLIS, deadline.remainingMillis(2_000, 5))
        assertEquals(
            SessionExpiryReason.BACKGROUND,
            deadline.expiryReason(2_000 + SessionSecurity.BACKGROUND_LOCK_GRACE_MILLIS, 5),
        )
        deadline.foreground()
        assertNull(deadline.expiryReason(2_000 + SessionSecurity.BACKGROUND_LOCK_GRACE_MILLIS, 5))
    }
}
