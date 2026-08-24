package dev.ironkeep.app.vault.crypto

import dev.ironkeep.app.vault.model.EncryptedBlob
import dev.ironkeep.app.vault.model.KdfParameters
import dev.ironkeep.app.vault.model.VAULT_FILE_FORMAT
import dev.ironkeep.app.vault.model.VAULT_FILE_VERSION
import dev.ironkeep.app.vault.model.VAULT_SCHEMA_VERSION
import dev.ironkeep.app.vault.model.VaultFile
import dev.ironkeep.app.vault.model.VaultPayload
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import java.nio.CharBuffer
import java.security.GeneralSecurityException
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

class VaultAuthenticationException : GeneralSecurityException("Vault authentication failed")
class VaultFormatException(message: String) : IllegalArgumentException(message)

data class KdfProfile(val memoryKiB: Int = 64 * 1024, val iterations: Int = 3, val parallelism: Int = 4)

class UnlockedVault internal constructor(
    val payload: VaultPayload,
    internal val dataKey: ByteArray,
) : AutoCloseable {
    override fun close() = dataKey.fill(0)
}

data class EncryptedVaultResult(val file: VaultFile, val session: UnlockedVault)

class VaultCrypto(
    private val random: SecureRandom = SecureRandom(),
    val json: Json = Json {
        classDiscriminator = "kind"
        encodeDefaults = true
        explicitNulls = false
        ignoreUnknownKeys = false
    },
) {
    companion object {
        private const val AES_KEY_BYTES = 32
        private const val NONCE_BYTES = 12
        private const val SALT_BYTES = 16
        private const val MIN_MEMORY_KIB = 19 * 1024
        private const val MAX_MEMORY_KIB = 256 * 1024
        private const val MAX_ITERATIONS = 10
        private const val MAX_PARALLELISM = 8
    }

    fun encryptNew(masterPassword: CharArray, payload: VaultPayload, profile: KdfProfile = KdfProfile()): EncryptedVaultResult {
        validateKdf(profile.memoryKiB, profile.iterations, profile.parallelism)
        require(masterPassword.isNotEmpty()) { "Master password must not be empty" }
        val salt = randomBytes(SALT_BYTES)
        val dataKey = randomBytes(AES_KEY_BYTES)
        val wrapNonce = randomBytes(NONCE_BYTES)
        val payloadNonce = randomBytes(NONCE_BYTES)
        val kdf = KdfParameters(
            salt = encode(salt),
            memoryKiB = profile.memoryKiB,
            iterations = profile.iterations,
            parallelism = profile.parallelism,
        )
        val partial = VaultFileHeader(payload, kdf)
        var kek: ByteArray? = null
        var plaintext: ByteArray? = null
        try {
            kek = derive(masterPassword, kdf)
            val keyWrap = EncryptedBlob(
                nonce = encode(wrapNonce),
                ciphertext = encode(aesGcmEncrypt(kek, dataKey, wrapNonce, keyWrapAad(partial))),
            )
            plaintext = json.encodeToString(VaultPayload.serializer(), payload).encodeToByteArray()
            val payloadBlob = EncryptedBlob(
                nonce = encode(payloadNonce),
                ciphertext = encode(aesGcmEncrypt(dataKey, plaintext, payloadNonce, payloadAad(partial, keyWrap))),
            )
            val file = partial.toVaultFile(keyWrap, payloadBlob)
            return EncryptedVaultResult(file, UnlockedVault(payload, dataKey))
        } catch (error: Exception) {
            dataKey.fill(0)
            throw error
        } finally {
            kek?.fill(0)
            plaintext?.fill(0)
            salt.fill(0)
            wrapNonce.fill(0)
            payloadNonce.fill(0)
            masterPassword.fill('\u0000')
        }
    }

    fun unlock(masterPassword: CharArray, file: VaultFile): UnlockedVault {
        validateEnvelope(file)
        var kek: ByteArray? = null
        var dataKey: ByteArray? = null
        var plaintext: ByteArray? = null
        try {
            kek = derive(masterPassword, file.kdf)
            dataKey = aesGcmDecrypt(kek, decode(file.keyWrap.ciphertext), decode(file.keyWrap.nonce), keyWrapAad(file.header()))
            if (dataKey.size != AES_KEY_BYTES) throw VaultAuthenticationException()
            plaintext = aesGcmDecrypt(dataKey, decode(file.payload.ciphertext), decode(file.payload.nonce), payloadAad(file.header(), file.keyWrap))
            val payload = json.decodeFromString(VaultPayload.serializer(), plaintext.decodeToString())
            if (
                payload.schemaVersion != VAULT_SCHEMA_VERSION || payload.vaultId != file.vaultId ||
                payload.revision != file.revision || payload.updatedAt != file.updatedAt ||
                payload.writerDeviceId != file.writerDeviceId
            ) throw VaultAuthenticationException()
            return UnlockedVault(payload, dataKey).also { dataKey = null }
        } catch (error: VaultFormatException) {
            throw error
        } catch (_: Exception) {
            throw VaultAuthenticationException()
        } finally {
            kek?.fill(0)
            dataKey?.fill(0)
            plaintext?.fill(0)
            masterPassword.fill('\u0000')
        }
    }

    private fun derive(password: CharArray, kdf: KdfParameters): ByteArray {
        val byteBuffer = Charsets.UTF_8.newEncoder().encode(CharBuffer.wrap(password))
        val passwordBytes = ByteArray(byteBuffer.remaining())
        byteBuffer.get(passwordBytes)
        val output = ByteArray(AES_KEY_BYTES)
        try {
            val parameters = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
                .withVersion(Argon2Parameters.ARGON2_VERSION_13)
                .withSalt(decode(kdf.salt))
                .withMemoryAsKB(kdf.memoryKiB)
                .withIterations(kdf.iterations)
                .withParallelism(kdf.parallelism)
                .build()
            Argon2BytesGenerator().apply { init(parameters) }.generateBytes(passwordBytes, output)
            return output
        } finally {
            passwordBytes.fill(0)
        }
    }

    private fun aesGcmEncrypt(key: ByteArray, plaintext: ByteArray, nonce: ByteArray, aad: ByteArray): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.ENCRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad)
            doFinal(plaintext)
        }

    private fun aesGcmDecrypt(key: ByteArray, ciphertext: ByteArray, nonce: ByteArray, aad: ByteArray): ByteArray =
        Cipher.getInstance("AES/GCM/NoPadding").run {
            init(Cipher.DECRYPT_MODE, SecretKeySpec(key, "AES"), GCMParameterSpec(128, nonce))
            updateAAD(aad)
            doFinal(ciphertext)
        }

    private fun keyWrapAad(header: VaultFileHeader): ByteArray = aad(
        buildJsonArray {
            add("IronkeepKeyWrap"); add(VAULT_FILE_FORMAT); add(VAULT_FILE_VERSION); add(header.vaultId)
            add("argon2id"); add(header.kdf.salt); add(header.kdf.memoryKiB); add(header.kdf.iterations); add(header.kdf.parallelism)
        },
    )

    private fun payloadAad(header: VaultFileHeader, keyWrap: EncryptedBlob): ByteArray = aad(
        buildJsonArray {
            add("IronkeepPayload"); add(VAULT_FILE_FORMAT); add(VAULT_FILE_VERSION); add(header.vaultId)
            add(header.revision); add(header.updatedAt); add(header.writerDeviceId)
            add("aes-256-gcm"); add(keyWrap.nonce); add(keyWrap.ciphertext)
        },
    )

    private fun aad(array: JsonArray): ByteArray = json.encodeToString(JsonArray.serializer(), array).encodeToByteArray()
    private fun randomBytes(size: Int) = ByteArray(size).also(random::nextBytes)
    private fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)
    private fun decode(value: String): ByteArray {
        if (!value.matches(Regex("^[A-Za-z0-9_-]+$"))) throw VaultFormatException("Invalid base64url")
        return Base64.getUrlDecoder().decode(value)
    }

    private fun validateKdf(memoryKiB: Int, iterations: Int, parallelism: Int) {
        if (memoryKiB !in MIN_MEMORY_KIB..MAX_MEMORY_KIB || iterations !in 2..MAX_ITERATIONS || parallelism !in 1..MAX_PARALLELISM) {
            throw VaultFormatException("Argon2id parameters outside Ironkeep limits")
        }
    }

    private fun validateEnvelope(file: VaultFile) {
        if (
            file.format != VAULT_FILE_FORMAT || file.fileVersion != VAULT_FILE_VERSION || file.kdf.algorithm != "argon2id" ||
            file.keyWrap.algorithm != "aes-256-gcm" || file.payload.algorithm != "aes-256-gcm" ||
            file.vaultId.length > 128 || file.writerDeviceId.length > 128
        ) throw VaultFormatException("Unsupported Ironkeep vault envelope")
        validateKdf(file.kdf.memoryKiB, file.kdf.iterations, file.kdf.parallelism)
        if (decode(file.kdf.salt).size != SALT_BYTES || decode(file.keyWrap.nonce).size != NONCE_BYTES || decode(file.payload.nonce).size != NONCE_BYTES) {
            throw VaultFormatException("Invalid cryptographic material length")
        }
    }
}

private data class VaultFileHeader(
    val vaultId: String,
    val revision: Long,
    val updatedAt: String,
    val writerDeviceId: String,
    val kdf: KdfParameters,
) {
    constructor(payload: VaultPayload, kdf: KdfParameters) : this(payload.vaultId, payload.revision, payload.updatedAt, payload.writerDeviceId, kdf)
    fun toVaultFile(keyWrap: EncryptedBlob, payload: EncryptedBlob) = VaultFile(
        vaultId = vaultId,
        revision = revision,
        updatedAt = updatedAt,
        writerDeviceId = writerDeviceId,
        kdf = kdf,
        keyWrap = keyWrap,
        payload = payload,
    )
}

private fun VaultFile.header() = VaultFileHeader(vaultId, revision, updatedAt, writerDeviceId, kdf)
