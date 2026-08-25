package dev.ironkeep.app.vault.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class VaultMutationsTest {
    private val fields = LoginFields(
        title = "Example",
        username = "person@example.com",
        password = "secret",
        uris = listOf("https://example.com/login"),
        androidPackageNames = listOf("com.example.app"),
    )

    @Test
    fun addEditFavoriteAndDeleteUpdateMetadataAndCreateTombstone() {
        val empty = VaultPayload.empty("Test", "device-a").copy(revision = 1, updatedAt = "2026-01-01T00:00:00Z")
        val added = VaultMutations.addLogin(empty, fields, "device-a", Instant.parse("2026-01-02T00:00:00Z"), "login-one")
        assertEquals(2, added.revision)
        assertEquals(1, (added.items.single() as LoginItem).revision)

        val edited = VaultMutations.editLogin(added, "login-one", fields.copy(title = "Updated"), "device-b", Instant.parse("2026-01-03T00:00:00Z"))
        assertEquals(3, edited.revision)
        assertEquals("device-b", edited.writerDeviceId)
        assertEquals(2, (edited.items.single() as LoginItem).revision)

        val favorite = VaultMutations.toggleFavorite(edited, "login-one", "device-b", Instant.parse("2026-01-04T00:00:00Z"))
        assertTrue((favorite.items.single() as LoginItem).favorite)

        val deleted = VaultMutations.deleteLogin(favorite, "login-one", "device-b", Instant.parse("2026-01-05T00:00:00Z"))
        assertTrue(deleted.items.isEmpty())
        assertEquals(Tombstone("login-one", "2026-01-05T00:00:00Z", 5, "device-b"), deleted.tombstones.single())
    }

    @Test
    fun duplicateDetectionRequiresSameIdentityAndExactOriginOrPackage() {
        val vault = VaultMutations.addLogin(VaultPayload.empty("Test", "device-a"), fields, "device-a", itemId = "login-one")
        assertEquals(1, VaultMutations.likelyDuplicates(vault, fields.copy(uris = listOf("https://example.com/other"), androidPackageNames = emptyList())).size)
        assertFalse(VaultMutations.likelyDuplicates(vault, fields.copy(title = "Other", username = "other@example.com", uris = listOf("https://other.example"), androidPackageNames = emptyList())).isNotEmpty())
    }

    @Test
    fun securitySettingsUpdateVaultMetadataOnce() {
        val empty = VaultPayload.empty("Test", "device-a").copy(revision = 1, updatedAt = "2026-01-01T00:00:00Z")
        val updated = VaultMutations.updateSecuritySettings(empty, 15, 60, "device-b", Instant.parse("2026-01-02T00:00:00Z"))
        assertEquals(2, updated.revision)
        assertEquals("2026-01-02T00:00:00Z", updated.updatedAt)
        assertEquals("device-b", updated.writerDeviceId)
        assertEquals(15, updated.settings.autoLockMinutes)
        assertEquals(60, updated.settings.clearClipboardSeconds)
    }
}
