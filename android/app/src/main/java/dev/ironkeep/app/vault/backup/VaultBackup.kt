package dev.ironkeep.app.vault.backup

import dev.ironkeep.app.vault.crypto.UnlockedVault
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.crypto.VaultFormatException
import dev.ironkeep.app.vault.model.VaultFile
import dev.ironkeep.app.vault.storage.VaultStore
import kotlinx.serialization.SerializationException
import java.security.MessageDigest
import java.time.Instant
import java.nio.ByteBuffer
import java.nio.charset.CodingErrorAction

const val MAX_BACKUP_BYTES = 64 * 1024 * 1024

data class RestorePreview(
    val revision: Long,
    val updatedAt: Instant,
    val itemCount: Int,
    val checksum: String,
)

class AuthenticatedRestore internal constructor(
    internal val session: UnlockedVault,
    val preview: RestorePreview,
) : AutoCloseable {
    override fun close() = session.close()
}

class VaultBackup(
    private val crypto: VaultCrypto,
    private val store: VaultStore,
) {
    fun snapshotBytes(session: UnlockedVault): ByteArray =
        crypto.json.encodeToString(VaultFile.serializer(), session.file).encodeToByteArray()

    fun authenticate(bytes: ByteArray, masterPassword: CharArray): AuthenticatedRestore {
        if (bytes.isEmpty() || bytes.size > MAX_BACKUP_BYTES) {
            masterPassword.fill('\u0000')
            throw VaultFormatException("Backup file size is invalid")
        }
        val file = try {
            val text = Charsets.UTF_8.newDecoder()
                .onMalformedInput(CodingErrorAction.REPORT)
                .onUnmappableCharacter(CodingErrorAction.REPORT)
                .decode(ByteBuffer.wrap(bytes))
                .toString()
            crypto.json.decodeFromString(VaultFile.serializer(), text)
        } catch (_: SerializationException) {
            masterPassword.fill('\u0000')
            throw VaultFormatException("Backup file is malformed")
        } catch (_: IllegalArgumentException) {
            masterPassword.fill('\u0000')
            throw VaultFormatException("Backup file is malformed")
        }
        val session = crypto.unlock(masterPassword, file)
        return try {
            AuthenticatedRestore(
                session,
                RestorePreview(
                    revision = session.payload.revision,
                    updatedAt = Instant.parse(session.payload.updatedAt),
                    itemCount = session.payload.items.size,
                    checksum = MessageDigest.getInstance("SHA-256").digest(bytes).toHex(),
                ),
            )
        } catch (error: Exception) {
            session.close()
            throw VaultFormatException("Backup metadata is invalid")
        }
    }

    fun restore(current: UnlockedVault, candidate: AuthenticatedRestore): UnlockedVault {
        store.writeRecovery(current.file)
        store.write(candidate.session.file)
        return candidate.session
    }
}

private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }
