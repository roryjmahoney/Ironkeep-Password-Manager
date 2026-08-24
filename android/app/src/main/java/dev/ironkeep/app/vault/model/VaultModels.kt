package dev.ironkeep.app.vault.model

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Instant
import java.util.UUID

const val VAULT_FILE_FORMAT = "ironkeep-vault"
const val VAULT_FILE_VERSION = 1
const val VAULT_SCHEMA_VERSION = 1

@Serializable
sealed interface VaultItem {
    val id: String
    val title: String
    val categoryId: String?
    val tagIds: List<String>
    val favorite: Boolean
    val createdAt: String
    val updatedAt: String
    val revision: Long
}

@Serializable
@SerialName("login")
data class LoginItem(
    override val id: String,
    override val title: String,
    override val categoryId: String? = null,
    override val tagIds: List<String> = emptyList(),
    override val favorite: Boolean = false,
    override val createdAt: String,
    override val updatedAt: String,
    override val revision: Long,
    val username: String,
    val password: String,
    val uris: List<String>,
    val androidPackageNames: List<String> = emptyList(),
    val notes: String = "",
    val totpSecret: String? = null,
) : VaultItem

@Serializable
@SerialName("secureNote")
data class SecureNoteItem(
    override val id: String,
    override val title: String,
    override val categoryId: String? = null,
    override val tagIds: List<String> = emptyList(),
    override val favorite: Boolean = false,
    override val createdAt: String,
    override val updatedAt: String,
    override val revision: Long,
    val body: String,
) : VaultItem

@Serializable
@SerialName("creditCard")
data class CreditCardItem(
    override val id: String,
    override val title: String,
    override val categoryId: String? = null,
    override val tagIds: List<String> = emptyList(),
    override val favorite: Boolean = false,
    override val createdAt: String,
    override val updatedAt: String,
    override val revision: Long,
    val cardholderName: String,
    val number: String,
    val expiryMonth: Int,
    val expiryYear: Int,
    val verificationCode: String,
    val pin: String? = null,
    val notes: String = "",
) : VaultItem

@Serializable
@SerialName("identity")
data class IdentityItem(
    override val id: String,
    override val title: String,
    override val categoryId: String? = null,
    override val tagIds: List<String> = emptyList(),
    override val favorite: Boolean = false,
    override val createdAt: String,
    override val updatedAt: String,
    override val revision: Long,
    val firstName: String,
    val middleName: String,
    val lastName: String,
    val email: String,
    val phone: String,
    val company: String,
    val addressLine1: String,
    val addressLine2: String,
    val city: String,
    val region: String,
    val postalCode: String,
    val country: String,
    val notes: String = "",
) : VaultItem

@Serializable
data class VaultCategory(val id: String, val name: String, val icon: String, val color: String)

@Serializable
data class VaultTag(val id: String, val name: String)

@Serializable
data class Tombstone(val itemId: String, val deletedAt: String, val revision: Long, val deviceId: String)

@Serializable
data class PasswordGeneratorOptions(
    val length: Int = 20,
    val lowercase: Boolean = true,
    val uppercase: Boolean = true,
    val digits: Boolean = true,
    val symbols: Boolean = true,
    val excludeAmbiguous: Boolean = true,
    val avoidRepeatingCharacters: Boolean = false,
)

@Serializable
data class VaultSettings(
    val autoLockMinutes: Int = 5,
    val clearClipboardSeconds: Int = 30,
    val theme: String = "system",
    val generator: PasswordGeneratorOptions = PasswordGeneratorOptions(),
)

@Serializable
data class VaultPayload(
    val schemaVersion: Int = VAULT_SCHEMA_VERSION,
    val vaultId: String,
    val name: String,
    val revision: Long,
    val updatedAt: String,
    val writerDeviceId: String,
    val items: List<VaultItem>,
    val categories: List<VaultCategory>,
    val tags: List<VaultTag>,
    val tombstones: List<Tombstone>,
    val settings: VaultSettings,
) {
    companion object {
        fun empty(name: String, deviceId: String): VaultPayload {
            val now = Instant.now().toString()
            return VaultPayload(
                vaultId = UUID.randomUUID().toString(),
                name = name,
                revision = 1,
                updatedAt = now,
                writerDeviceId = deviceId,
                items = emptyList(),
                categories = listOf(
                    VaultCategory(UUID.randomUUID().toString(), "Personal", "user", "brass"),
                    VaultCategory(UUID.randomUUID().toString(), "Work", "briefcase", "slate"),
                ),
                tags = emptyList(),
                tombstones = emptyList(),
                settings = VaultSettings(),
            )
        }
    }
}

@Serializable
data class KdfParameters(
    val algorithm: String = "argon2id",
    val salt: String,
    val memoryKiB: Int,
    val iterations: Int,
    val parallelism: Int,
)

@Serializable
data class EncryptedBlob(
    val algorithm: String = "aes-256-gcm",
    val nonce: String,
    val ciphertext: String,
)

@Serializable
data class VaultFile(
    val format: String = VAULT_FILE_FORMAT,
    val fileVersion: Int = VAULT_FILE_VERSION,
    val vaultId: String,
    val revision: Long,
    val updatedAt: String,
    val writerDeviceId: String,
    val kdf: KdfParameters,
    val keyWrap: EncryptedBlob,
    val payload: EncryptedBlob,
)
