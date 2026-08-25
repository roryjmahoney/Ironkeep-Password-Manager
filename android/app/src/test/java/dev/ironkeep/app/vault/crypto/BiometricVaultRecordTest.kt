package dev.ironkeep.app.vault.crypto

import dev.ironkeep.app.vault.model.EncryptedBlob
import dev.ironkeep.app.vault.model.VaultPayload
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class BiometricVaultRecordTest {
    @Test
    fun bindsToVaultIdentityAndKeyWrapButNotPayloadRevision() {
        val encrypted = VaultCrypto().encryptNew(
            "correct horse battery staple".toCharArray(),
            VaultPayload.empty("Test", "test-device"),
            KdfProfile(19 * 1024, 2, 1),
        )
        val binding = BiometricVaultBinding.from(encrypted.file)
        val nonce = ByteArray(12) { it.toByte() }
        val ciphertext = ByteArray(48) { (it + 12).toByte() }
        val record = binding.wrapped(nonce, ciphertext)

        record.validate()
        assertTrue(record.matches(encrypted.file))
        assertTrue(record.matches(encrypted.file.copy(revision = encrypted.file.revision + 1)))
        assertFalse(
            record.matches(
                encrypted.file.copy(
                    keyWrap = EncryptedBlob(nonce = encrypted.file.keyWrap.nonce, ciphertext = "AA"),
                ),
            ),
        )
        assertArrayEquals(nonce, record.nonceBytes())
        assertArrayEquals(ciphertext, record.ciphertextBytes())
        encrypted.session.close()
    }

    @Test
    fun rejectsMalformedWrappedKeyMaterial() {
        val invalid = BiometricVaultRecord(
            vaultId = "vault-id",
            keyWrapNonce = "AA",
            keyWrapCiphertext = "AA",
            nonce = "AA",
            ciphertext = "not+base64url",
        )

        assertThrows(IllegalArgumentException::class.java) { invalid.validate() }
    }
}
