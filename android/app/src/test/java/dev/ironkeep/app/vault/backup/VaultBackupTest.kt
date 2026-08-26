package dev.ironkeep.app.vault.backup

import dev.ironkeep.app.vault.crypto.KdfProfile
import dev.ironkeep.app.vault.crypto.VaultAuthenticationException
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.crypto.VaultFormatException
import dev.ironkeep.app.vault.model.VaultFile
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.storage.VaultStore
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Assert.assertThrows
import org.junit.Test

class VaultBackupTest {
    @Test
    fun authenticatesPreviewAndRestoresAfterRecoverySnapshot() {
        val fixture = fixture()
        val candidate = fixture.backup.authenticate(fixture.bytes, password())

        assertEquals(1, candidate.preview.revision)
        assertEquals(0, candidate.preview.itemCount)
        assertEquals(64, candidate.preview.checksum.length)

        val replacement = fixture.backup.restore(fixture.current.session, candidate)
        assertSame(candidate.session, replacement)
        assertEquals(fixture.current.file, fixture.store.recovery)
        assertEquals(candidate.session.file, fixture.store.file)
        fixture.current.session.close()
        replacement.close()
    }

    @Test
    fun cancellationBeforeConfirmationDoesNotWrite() {
        val fixture = fixture()
        fixture.backup.authenticate(fixture.bytes, password()).close()
        assertNull(fixture.store.recovery)
        assertEquals(fixture.current.file, fixture.store.file)
        fixture.current.session.close()
    }

    @Test
    fun rejectsCorruption() {
        val fixture = fixture()
        val corrupted = fixture.bytes.copyOf().also { it[it.lastIndex - 10] = (it[it.lastIndex - 10].toInt() xor 1).toByte() }
        assertThrows(Exception::class.java) { fixture.backup.authenticate(corrupted, password()) }
        fixture.current.session.close()
    }

    @Test
    fun rejectsWrongPassword() {
        val fixture = fixture()
        assertThrows(VaultAuthenticationException::class.java) { fixture.backup.authenticate(fixture.bytes, "wrong password".toCharArray()) }
        fixture.current.session.close()
    }

    @Test
    fun rejectsIncompatibleFormatBeforeAuthentication() {
        val fixture = fixture()
        val incompatible = fixture.bytes.decodeToString().replace("\"fileVersion\":1", "\"fileVersion\":2").encodeToByteArray()
        assertThrows(VaultFormatException::class.java) { fixture.backup.authenticate(incompatible, password()) }
        fixture.current.session.close()
    }

    @Test
    fun rejectsOversizedFile() {
        val fixture = fixture()
        assertThrows(VaultFormatException::class.java) { fixture.backup.authenticate(ByteArray(MAX_BACKUP_BYTES + 1), password()) }
        fixture.current.session.close()
    }

    @Test
    fun failedAtomicReplacementLeavesCurrentAndRecoveryIntact() {
        val fixture = fixture(failReplacement = true)
        val candidate = fixture.backup.authenticate(fixture.bytes, password())
        assertThrows(IllegalStateException::class.java) { fixture.backup.restore(fixture.current.session, candidate) }
        assertEquals(fixture.current.file, fixture.store.file)
        assertEquals(fixture.current.file, fixture.store.recovery)
        fixture.current.session.close()
        candidate.close()
    }

    private fun fixture(failReplacement: Boolean = false): Fixture {
        val crypto = VaultCrypto()
        val current = crypto.encryptNew(password(), VaultPayload.empty("Current", "device-current"), profile)
        val source = crypto.encryptNew(password(), VaultPayload.empty("Backup", "device-backup"), profile)
        val bytes = crypto.json.encodeToString(VaultFile.serializer(), source.file).encodeToByteArray()
        source.session.close()
        val store = FakeStore(current.file, failReplacement)
        return Fixture(current, bytes, store, VaultBackup(crypto, store))
    }

    private class FakeStore(initial: VaultFile, private val failReplacement: Boolean) : VaultStore {
        var file: VaultFile = initial
        var recovery: VaultFile? = null
        override fun exists() = true
        override fun read() = file
        override fun write(vault: VaultFile) {
            if (failReplacement) error("replacement failed")
            file = vault
        }
        override fun writeRecovery(vault: VaultFile) { recovery = vault }
    }

    private data class Fixture(
        val current: dev.ironkeep.app.vault.crypto.EncryptedVaultResult,
        val bytes: ByteArray,
        val store: FakeStore,
        val backup: VaultBackup,
    )

    companion object {
        private val profile = KdfProfile(19 * 1024, 2, 1)
        private fun password() = "correct horse battery staple".toCharArray()
    }
}
