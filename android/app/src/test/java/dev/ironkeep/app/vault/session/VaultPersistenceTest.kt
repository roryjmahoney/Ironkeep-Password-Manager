package dev.ironkeep.app.vault.session

import dev.ironkeep.app.vault.crypto.KdfProfile
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.model.LoginFields
import dev.ironkeep.app.vault.model.VaultFile
import dev.ironkeep.app.vault.model.VaultMutations
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.storage.VaultStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertThrows
import org.junit.Test
import java.time.Instant

class VaultPersistenceTest {
    @Test
    fun mutationUsesFreshNonceAndSurvivesLockRestartUnlock() {
        val crypto = VaultCrypto()
        val created = crypto.encryptNew("correct horse battery staple".toCharArray(), VaultPayload.empty("Test", "device-a"), KdfProfile(19 * 1024, 2, 1))
        val store = FakeStore(created.file)
        val updated = VaultMutations.addLogin(created.session.payload, fields, "device-a", Instant.parse("2026-01-02T00:00:00Z"), "login-one")
        VaultPersistence(crypto, store).persist(created.session, updated)
        assertNotEquals(created.file.payload.nonce, requireNotNull(store.file).payload.nonce)
        created.session.close()

        val restarted = crypto.unlock("correct horse battery staple".toCharArray(), requireNotNull(store.file))
        assertEquals("login-one", restarted.payload.items.single().id)
        restarted.close()
    }

    @Test
    fun failedWriteLeavesPreviousEncryptedAndUnlockedVaultIntact() {
        val crypto = VaultCrypto()
        val created = crypto.encryptNew("correct horse battery staple".toCharArray(), VaultPayload.empty("Test", "device-a"), KdfProfile(19 * 1024, 2, 1))
        val store = FakeStore(created.file, failWrites = true)
        val updated = VaultMutations.addLogin(created.session.payload, fields, "device-a", itemId = "login-one")

        assertThrows(IllegalStateException::class.java) { VaultPersistence(crypto, store).persist(created.session, updated) }
        assertEquals(1, requireNotNull(store.file).revision)
        assertEquals(1, created.session.payload.revision)
        assertEquals(0, created.session.payload.items.size)
        created.session.close()
    }

    private class FakeStore(initial: VaultFile, private val failWrites: Boolean = false) : VaultStore {
        var file: VaultFile? = initial
        override fun exists() = file != null
        override fun read(): VaultFile = requireNotNull(file)
        override fun write(vault: VaultFile) {
            if (failWrites) error("disk full")
            file = vault
        }
    }

    companion object {
        private val fields = LoginFields("Example", "person@example.com", "secret", listOf("https://example.com"), listOf("com.example.app"))
    }
}
