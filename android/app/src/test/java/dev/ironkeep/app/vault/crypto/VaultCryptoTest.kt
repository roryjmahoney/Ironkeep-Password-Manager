package dev.ironkeep.app.vault.crypto

import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.model.VaultFile
import kotlinx.serialization.json.decodeFromJsonElement
import kotlinx.serialization.json.jsonObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertThrows
import org.junit.Test

class VaultCryptoTest {
    @Test
    fun changesMasterPasswordWithoutChangingVaultData() {
        val crypto = VaultCrypto()
        val payload = VaultPayload.empty("Test", "device-a")
        val created = crypto.encryptNew("correct horse battery staple".toCharArray(), payload, KdfProfile(memoryKiB = 19 * 1024, iterations = 2, parallelism = 1))
        val changed = crypto.changeMasterPassword(
            created.session,
            "correct horse battery staple".toCharArray(),
            "new correct horse battery staple".toCharArray(),
            KdfProfile(memoryKiB = 19 * 1024, iterations = 2, parallelism = 1),
        )

        assertThrows(VaultAuthenticationException::class.java) {
            crypto.unlock("correct horse battery staple".toCharArray(), changed)
        }
        val reopened = crypto.unlock("new correct horse battery staple".toCharArray(), changed)
        assertEquals(payload, reopened.payload)
        reopened.close()
        created.session.close()
    }

    @Test
    fun rejectsIncorrectCurrentPasswordDuringChange() {
        val crypto = VaultCrypto()
        val created = crypto.encryptNew(
            "correct horse battery staple".toCharArray(),
            VaultPayload.empty("Test", "device-a"),
            KdfProfile(memoryKiB = 19 * 1024, iterations = 2, parallelism = 1),
        )
        assertThrows(VaultAuthenticationException::class.java) {
            crypto.changeMasterPassword(
                created.session,
                "incorrect password".toCharArray(),
                "new correct horse battery staple".toCharArray(),
                KdfProfile(memoryKiB = 19 * 1024, iterations = 2, parallelism = 1),
            )
        }
        created.session.close()
    }

    @Test
    fun decryptsSharedTypescriptVector() {
        val crypto = VaultCrypto()
        val vector = requireNotNull(javaClass.classLoader?.getResourceAsStream("vault-v1.json"))
            .bufferedReader()
            .use { it.readText() }
        val root = crypto.json.parseToJsonElement(vector).jsonObject
        val file = crypto.json.decodeFromJsonElement<VaultFile>(requireNotNull(root["file"]))
        val expected = crypto.json.decodeFromJsonElement<VaultPayload>(requireNotNull(root["payload"]))
        val unlocked = crypto.unlock("correct horse battery staple".toCharArray(), file)
        assertEquals(expected, unlocked.payload)
        unlocked.close()
    }

    @Test
    fun decryptsSharedTypescriptLoginMutationVector() {
        val crypto = VaultCrypto()
        val vector = requireNotNull(javaClass.classLoader?.getResourceAsStream("vault-v1-login-crud.json"))
            .bufferedReader()
            .use { it.readText() }
        val root = crypto.json.parseToJsonElement(vector).jsonObject
        val file = crypto.json.decodeFromJsonElement<VaultFile>(requireNotNull(root["file"]))
        val expected = crypto.json.decodeFromJsonElement<VaultPayload>(requireNotNull(root["payload"]))
        val unlocked = crypto.unlock("correct horse battery staple".toCharArray(), file)
        assertEquals(expected, unlocked.payload)
        unlocked.close()
    }

    @Test
    fun roundTrip() {
        val crypto = VaultCrypto()
        val password = "correct horse battery staple".toCharArray()
        val encrypted = crypto.encryptNew(password, VaultPayload.empty("Test", "test-device"), KdfProfile(19 * 1024, 2, 1))
        val unlocked = crypto.unlock("correct horse battery staple".toCharArray(), encrypted.file)
        assertEquals(encrypted.session.payload.vaultId, unlocked.payload.vaultId)
        encrypted.session.close()
        unlocked.close()
    }

    @Test
    fun wrongPasswordFailsClosed() {
        val crypto = VaultCrypto()
        val encrypted = crypto.encryptNew("correct horse battery staple".toCharArray(), VaultPayload.empty("Test", "test-device"), KdfProfile(19 * 1024, 2, 1))
        assertThrows(VaultAuthenticationException::class.java) {
            crypto.unlock("wrong password".toCharArray(), encrypted.file)
        }
        encrypted.session.close()
    }

    @Test
    fun unlocksWithRetainedSessionDataKey() {
        val crypto = VaultCrypto()
        val encrypted = crypto.encryptNew(
            "correct horse battery staple".toCharArray(),
            VaultPayload.empty("Test", "test-device"),
            KdfProfile(19 * 1024, 2, 1),
        )
        val dataKey = encrypted.session.copyDataKey()

        encrypted.session.close()
        val unlocked = crypto.unlockWithDataKey(dataKey, encrypted.file)
        val unlockedKey = unlocked.copyDataKey()

        assertEquals(encrypted.file.vaultId, unlocked.payload.vaultId)
        assertArrayEquals(dataKey, unlockedKey)
        unlockedKey.fill(0)
        unlocked.close()
        dataKey.fill(0)
    }

    @Test
    fun wrongSessionDataKeyFailsClosed() {
        val crypto = VaultCrypto()
        val encrypted = crypto.encryptNew(
            "correct horse battery staple".toCharArray(),
            VaultPayload.empty("Test", "test-device"),
            KdfProfile(19 * 1024, 2, 1),
        )

        assertThrows(VaultAuthenticationException::class.java) {
            crypto.unlockWithDataKey(ByteArray(32) { 0x5a }, encrypted.file)
        }
        encrypted.session.close()
    }
}
