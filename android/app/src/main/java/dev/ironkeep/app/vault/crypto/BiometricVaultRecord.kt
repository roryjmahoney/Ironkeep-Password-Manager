package dev.ironkeep.app.vault.crypto

import dev.ironkeep.app.vault.model.VaultFile
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.add
import kotlinx.serialization.json.buildJsonArray
import java.util.Base64

private const val BIOMETRIC_RECORD_VERSION = 1
private const val AES_GCM_NONCE_BYTES = 12
private const val WRAPPED_DATA_KEY_BYTES = 48
private val aadJson = Json { encodeDefaults = true }
private val base64UrlPattern = Regex("^[A-Za-z0-9_-]+$")

data class BiometricVaultBinding(
    val vaultId: String,
    val keyWrapNonce: String,
    val keyWrapCiphertext: String,
) {
    fun matches(file: VaultFile): Boolean =
        vaultId == file.vaultId && keyWrapNonce == file.keyWrap.nonce && keyWrapCiphertext == file.keyWrap.ciphertext

    fun aad(): ByteArray = biometricAad(vaultId, keyWrapNonce, keyWrapCiphertext)

    fun wrapped(nonce: ByteArray, ciphertext: ByteArray): BiometricVaultRecord {
        require(nonce.size == AES_GCM_NONCE_BYTES && ciphertext.size == WRAPPED_DATA_KEY_BYTES)
        return BiometricVaultRecord(
            vaultId = vaultId,
            keyWrapNonce = keyWrapNonce,
            keyWrapCiphertext = keyWrapCiphertext,
            nonce = encode(nonce),
            ciphertext = encode(ciphertext),
        )
    }

    companion object {
        fun from(file: VaultFile) = BiometricVaultBinding(file.vaultId, file.keyWrap.nonce, file.keyWrap.ciphertext)
    }
}

@Serializable
data class BiometricVaultRecord(
    val version: Int = BIOMETRIC_RECORD_VERSION,
    val vaultId: String,
    val keyWrapNonce: String,
    val keyWrapCiphertext: String,
    val nonce: String,
    val ciphertext: String,
) {
    fun binding() = BiometricVaultBinding(vaultId, keyWrapNonce, keyWrapCiphertext)
    fun matches(file: VaultFile): Boolean = version == BIOMETRIC_RECORD_VERSION && binding().matches(file)
    fun aad(): ByteArray = binding().aad()
    fun nonceBytes(): ByteArray = decode(nonce).also { require(it.size == AES_GCM_NONCE_BYTES) }
    fun ciphertextBytes(): ByteArray = decode(ciphertext).also { require(it.size == WRAPPED_DATA_KEY_BYTES) }

    fun validate() {
        require(version == BIOMETRIC_RECORD_VERSION && vaultId.isNotBlank() && vaultId.length <= 128)
        require(keyWrapNonce.isNotBlank() && keyWrapCiphertext.isNotBlank())
        nonceBytes().fill(0)
        ciphertextBytes().fill(0)
    }
}

private fun biometricAad(vaultId: String, keyWrapNonce: String, keyWrapCiphertext: String): ByteArray =
    aadJson.encodeToString(
        JsonArray.serializer(),
        buildJsonArray {
            add("IronkeepBiometricWrap")
            add(BIOMETRIC_RECORD_VERSION)
            add(vaultId)
            add(keyWrapNonce)
            add(keyWrapCiphertext)
        },
    ).encodeToByteArray()

private fun encode(bytes: ByteArray): String = Base64.getUrlEncoder().withoutPadding().encodeToString(bytes)

private fun decode(value: String): ByteArray {
    require(value.matches(base64UrlPattern)) { "Invalid biometric base64url value" }
    return Base64.getUrlDecoder().decode(value)
}
