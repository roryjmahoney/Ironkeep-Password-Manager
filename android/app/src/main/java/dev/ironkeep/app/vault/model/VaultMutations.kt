package dev.ironkeep.app.vault.model

import java.net.URI
import java.time.Instant
import java.util.UUID
import dev.ironkeep.app.vault.session.SessionSecurity

data class LoginFields(
    val title: String,
    val username: String,
    val password: String,
    val uris: List<String>,
    val androidPackageNames: List<String>,
)

object VaultMutations {
    fun addLogin(
        payload: VaultPayload,
        fields: LoginFields,
        deviceId: String,
        now: Instant = Instant.now(),
        itemId: String = UUID.randomUUID().toString(),
    ): VaultPayload {
        val values = fields.validated()
        val timestamp = now.toString()
        val next = payload.next(deviceId, timestamp)
        require(payload.items.none { it.id == itemId } && payload.tombstones.none { it.itemId == itemId }) { "Login identifier already exists" }
        return next.copy(items = payload.items + LoginItem(
            id = itemId,
            title = values.title,
            createdAt = timestamp,
            updatedAt = timestamp,
            revision = 1,
            username = values.username,
            password = values.password,
            uris = values.uris,
            androidPackageNames = values.androidPackageNames,
        ))
    }

    fun editLogin(payload: VaultPayload, itemId: String, fields: LoginFields, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val values = fields.validated()
        val existing = payload.items.filterIsInstance<LoginItem>().find { it.id == itemId } ?: throw NoSuchElementException("Login not found")
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(items = payload.items.map { item ->
            if (item.id != itemId) item else existing.copy(
                title = values.title,
                username = values.username,
                password = values.password,
                uris = values.uris,
                androidPackageNames = values.androidPackageNames,
                updatedAt = timestamp,
                revision = existing.revision + 1,
            )
        })
    }

    fun deleteLogin(payload: VaultPayload, itemId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        require(payload.items.any { it is LoginItem && it.id == itemId }) { "Login not found" }
        val timestamp = now.toString()
        val next = payload.next(deviceId, timestamp)
        return next.copy(
            items = payload.items.filterNot { it.id == itemId },
            tombstones = payload.tombstones.filterNot { it.itemId == itemId } + Tombstone(itemId, timestamp, next.revision, deviceId),
        )
    }

    fun toggleFavorite(payload: VaultPayload, itemId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val existing = payload.items.filterIsInstance<LoginItem>().find { it.id == itemId } ?: throw NoSuchElementException("Login not found")
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(items = payload.items.map { item ->
            if (item.id != itemId) item else existing.copy(favorite = !existing.favorite, updatedAt = timestamp, revision = existing.revision + 1)
        })
    }

    fun updateSecuritySettings(
        payload: VaultPayload,
        autoLockMinutes: Int,
        clearClipboardSeconds: Int,
        deviceId: String,
        now: Instant = Instant.now(),
    ): VaultPayload {
        SessionSecurity.validate(autoLockMinutes, clearClipboardSeconds)
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(
            settings = payload.settings.copy(
                autoLockMinutes = autoLockMinutes,
                clearClipboardSeconds = clearClipboardSeconds,
            ),
        )
    }

    fun likelyDuplicates(payload: VaultPayload, fields: LoginFields, excludeItemId: String? = null): List<LoginItem> {
        val username = fields.username.trim().lowercase()
        val title = fields.title.trim().lowercase()
        val origins = fields.uris.mapNotNull(::origin).toSet()
        val packages = fields.androidPackageNames.map { it.trim().lowercase() }.filter { it.isNotEmpty() }.toSet()
        return payload.items.filterIsInstance<LoginItem>().filter { item ->
            if (item.id == excludeItemId) return@filter false
            val sameIdentity = username.isNotEmpty() && item.username.trim().lowercase() == username
            val sameTarget = item.uris.mapNotNull(::origin).any(origins::contains) || item.androidPackageNames.any { it.lowercase() in packages }
            val sameTitle = title.isNotEmpty() && item.title.trim().lowercase() == title
            sameTarget && (sameIdentity || sameTitle) || sameIdentity && sameTitle
        }
    }

    private fun VaultPayload.next(deviceId: String, updatedAt: String): VaultPayload {
        require(deviceId.isNotBlank() && revision < Long.MAX_VALUE) { "Invalid mutation metadata" }
        return copy(revision = revision + 1, updatedAt = updatedAt, writerDeviceId = deviceId)
    }

    private fun LoginFields.validated(): LoginFields {
        val value = copy(
            title = title.trim(),
            username = username.trim(),
            uris = uris.map(String::trim).filter(String::isNotEmpty).distinct(),
            androidPackageNames = androidPackageNames.map(String::trim).filter(String::isNotEmpty).distinct(),
        )
        require(value.title.isNotEmpty() && value.password.isNotEmpty()) { "Login title and password are required" }
        return value
    }

    private fun origin(value: String): String? = runCatching {
        val uri = URI(value)
        if ((uri.scheme.equals("https", true) || uri.scheme.equals("http", true)) && uri.host != null) {
            val port = if (uri.port >= 0) ":${uri.port}" else ""
            "${uri.scheme.lowercase()}://${uri.host.lowercase()}$port"
        } else null
    }.getOrNull()
}
