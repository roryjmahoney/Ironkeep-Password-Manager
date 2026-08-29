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

data class SecureNoteFields(
    val title: String,
    val body: String,
)

data class CreditCardFields(
    val title: String,
    val cardholderName: String,
    val number: String,
    val expiryMonth: Int,
    val expiryYear: Int,
    val verificationCode: String,
    val pin: String?,
    val notes: String,
)

data class IdentityFields(
    val title: String,
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
    val notes: String,
)

object VaultMutations {
    fun addCategory(payload: VaultPayload, name: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val normalized = uniqueName(name, payload.categories.map { it.id to it.name })
        return payload.next(deviceId, now.toString()).copy(
            categories = payload.categories + VaultCategory(UUID.randomUUID().toString(), normalized, "folder", "slate"),
        )
    }

    fun renameCategory(payload: VaultPayload, categoryId: String, name: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        require(payload.categories.any { it.id == categoryId }) { "Category not found" }
        val normalized = uniqueName(name, payload.categories.map { it.id to it.name }, categoryId)
        return payload.next(deviceId, now.toString()).copy(
            categories = payload.categories.map { if (it.id == categoryId) it.copy(name = normalized) else it },
        )
    }

    fun deleteCategory(payload: VaultPayload, categoryId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        require(payload.categories.any { it.id == categoryId }) { "Category not found" }
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(
            categories = payload.categories.filterNot { it.id == categoryId },
            items = payload.items.map { item -> if (item.categoryId == categoryId) item.organized(null, item.tagIds, timestamp) else item },
        )
    }

    fun addTag(payload: VaultPayload, name: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val normalized = uniqueName(name, payload.tags.map { it.id to it.name })
        return payload.next(deviceId, now.toString()).copy(tags = payload.tags + VaultTag(UUID.randomUUID().toString(), normalized))
    }

    fun renameTag(payload: VaultPayload, tagId: String, name: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        require(payload.tags.any { it.id == tagId }) { "Tag not found" }
        val normalized = uniqueName(name, payload.tags.map { it.id to it.name }, tagId)
        return payload.next(deviceId, now.toString()).copy(tags = payload.tags.map { if (it.id == tagId) it.copy(name = normalized) else it })
    }

    fun deleteTag(payload: VaultPayload, tagId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        require(payload.tags.any { it.id == tagId }) { "Tag not found" }
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(
            tags = payload.tags.filterNot { it.id == tagId },
            items = payload.items.map { item -> if (tagId in item.tagIds) item.organized(item.categoryId, item.tagIds - tagId, timestamp) else item },
        )
    }

    fun setItemOrganization(
        payload: VaultPayload,
        itemId: String,
        categoryId: String?,
        tagIds: List<String>,
        deviceId: String,
        now: Instant = Instant.now(),
    ): VaultPayload {
        require(categoryId == null || payload.categories.any { it.id == categoryId }) { "Category not found" }
        val uniqueTags = tagIds.distinct()
        require(uniqueTags.all { id -> payload.tags.any { it.id == id } }) { "Tag not found" }
        require(payload.items.any { it.id == itemId }) { "Item not found" }
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(
            items = payload.items.map { item -> if (item.id == itemId) item.organized(categoryId, uniqueTags, timestamp) else item },
        )
    }

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

    fun addSecureNote(
        payload: VaultPayload,
        fields: SecureNoteFields,
        deviceId: String,
        now: Instant = Instant.now(),
        itemId: String = UUID.randomUUID().toString(),
    ): VaultPayload {
        val values = fields.validated()
        val timestamp = now.toString()
        val next = payload.next(deviceId, timestamp)
        require(payload.items.none { it.id == itemId } && payload.tombstones.none { it.itemId == itemId }) { "Secure note identifier already exists" }
        return next.copy(items = payload.items + SecureNoteItem(
            id = itemId,
            title = values.title,
            body = values.body,
            createdAt = timestamp,
            updatedAt = timestamp,
            revision = 1,
        ))
    }

    fun editSecureNote(payload: VaultPayload, itemId: String, fields: SecureNoteFields, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val values = fields.validated()
        val existing = payload.items.filterIsInstance<SecureNoteItem>().find { it.id == itemId } ?: throw NoSuchElementException("Secure note not found")
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(items = payload.items.map { item ->
            if (item.id != itemId) item else existing.copy(
                title = values.title,
                body = values.body,
                updatedAt = timestamp,
                revision = existing.revision + 1,
            )
        })
    }

    fun deleteSecureNote(payload: VaultPayload, itemId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        require(payload.items.any { it is SecureNoteItem && it.id == itemId }) { "Secure note not found" }
        val timestamp = now.toString()
        val next = payload.next(deviceId, timestamp)
        return next.copy(
            items = payload.items.filterNot { it.id == itemId },
            tombstones = payload.tombstones.filterNot { it.itemId == itemId } + Tombstone(itemId, timestamp, next.revision, deviceId),
        )
    }

    fun toggleSecureNoteFavorite(payload: VaultPayload, itemId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val existing = payload.items.filterIsInstance<SecureNoteItem>().find { it.id == itemId } ?: throw NoSuchElementException("Secure note not found")
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(items = payload.items.map { item ->
            if (item.id != itemId) item else existing.copy(favorite = !existing.favorite, updatedAt = timestamp, revision = existing.revision + 1)
        })
    }

    fun likelySecureNoteDuplicates(payload: VaultPayload, fields: SecureNoteFields, excludeItemId: String? = null): List<SecureNoteItem> {
        val title = fields.title.trim().lowercase()
        if (title.isEmpty()) return emptyList()
        return payload.items.filterIsInstance<SecureNoteItem>().filter { it.id != excludeItemId && it.title.trim().lowercase() == title }
    }

    fun addCreditCard(
        payload: VaultPayload,
        fields: CreditCardFields,
        deviceId: String,
        now: Instant = Instant.now(),
        itemId: String = UUID.randomUUID().toString(),
    ): VaultPayload {
        val values = fields.validated()
        val timestamp = now.toString()
        val next = payload.next(deviceId, timestamp)
        require(payload.items.none { it.id == itemId } && payload.tombstones.none { it.itemId == itemId }) { "Credit card identifier already exists" }
        return next.copy(items = payload.items + CreditCardItem(
            id = itemId,
            title = values.title,
            cardholderName = values.cardholderName,
            number = values.number,
            expiryMonth = values.expiryMonth,
            expiryYear = values.expiryYear,
            verificationCode = values.verificationCode,
            pin = values.pin,
            notes = values.notes,
            createdAt = timestamp,
            updatedAt = timestamp,
            revision = 1,
        ))
    }

    fun editCreditCard(payload: VaultPayload, itemId: String, fields: CreditCardFields, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val values = fields.validated()
        val existing = payload.items.filterIsInstance<CreditCardItem>().find { it.id == itemId } ?: throw NoSuchElementException("Credit card not found")
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(items = payload.items.map { item ->
            if (item.id != itemId) item else existing.copy(
                title = values.title,
                cardholderName = values.cardholderName,
                number = values.number,
                expiryMonth = values.expiryMonth,
                expiryYear = values.expiryYear,
                verificationCode = values.verificationCode,
                pin = values.pin,
                notes = values.notes,
                updatedAt = timestamp,
                revision = existing.revision + 1,
            )
        })
    }

    fun deleteCreditCard(payload: VaultPayload, itemId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        require(payload.items.any { it is CreditCardItem && it.id == itemId }) { "Credit card not found" }
        val timestamp = now.toString()
        val next = payload.next(deviceId, timestamp)
        return next.copy(
            items = payload.items.filterNot { it.id == itemId },
            tombstones = payload.tombstones.filterNot { it.itemId == itemId } + Tombstone(itemId, timestamp, next.revision, deviceId),
        )
    }

    fun toggleCreditCardFavorite(payload: VaultPayload, itemId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val existing = payload.items.filterIsInstance<CreditCardItem>().find { it.id == itemId } ?: throw NoSuchElementException("Credit card not found")
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(items = payload.items.map { item ->
            if (item.id != itemId) item else existing.copy(favorite = !existing.favorite, updatedAt = timestamp, revision = existing.revision + 1)
        })
    }

    fun likelyCreditCardDuplicates(payload: VaultPayload, fields: CreditCardFields, excludeItemId: String? = null): List<CreditCardItem> {
        val number = fields.number.replace(Regex("[\\s-]"), "")
        if (number.isEmpty()) return emptyList()
        return payload.items.filterIsInstance<CreditCardItem>().filter {
            it.id != excludeItemId && it.number.replace(Regex("[\\s-]"), "") == number
        }
    }

    fun addIdentity(
        payload: VaultPayload,
        fields: IdentityFields,
        deviceId: String,
        now: Instant = Instant.now(),
        itemId: String = UUID.randomUUID().toString(),
    ): VaultPayload {
        val values = fields.validated()
        val timestamp = now.toString()
        val next = payload.next(deviceId, timestamp)
        require(payload.items.none { it.id == itemId } && payload.tombstones.none { it.itemId == itemId }) { "Identity identifier already exists" }
        return next.copy(items = payload.items + IdentityItem(
            id = itemId,
            title = values.title,
            firstName = values.firstName,
            middleName = values.middleName,
            lastName = values.lastName,
            email = values.email,
            phone = values.phone,
            company = values.company,
            addressLine1 = values.addressLine1,
            addressLine2 = values.addressLine2,
            city = values.city,
            region = values.region,
            postalCode = values.postalCode,
            country = values.country,
            notes = values.notes,
            createdAt = timestamp,
            updatedAt = timestamp,
            revision = 1,
        ))
    }

    fun editIdentity(payload: VaultPayload, itemId: String, fields: IdentityFields, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val values = fields.validated()
        val existing = payload.items.filterIsInstance<IdentityItem>().find { it.id == itemId } ?: throw NoSuchElementException("Identity not found")
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(items = payload.items.map { item ->
            if (item.id != itemId) item else existing.copy(
                title = values.title,
                firstName = values.firstName,
                middleName = values.middleName,
                lastName = values.lastName,
                email = values.email,
                phone = values.phone,
                company = values.company,
                addressLine1 = values.addressLine1,
                addressLine2 = values.addressLine2,
                city = values.city,
                region = values.region,
                postalCode = values.postalCode,
                country = values.country,
                notes = values.notes,
                updatedAt = timestamp,
                revision = existing.revision + 1,
            )
        })
    }

    fun deleteIdentity(payload: VaultPayload, itemId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        require(payload.items.any { it is IdentityItem && it.id == itemId }) { "Identity not found" }
        val timestamp = now.toString()
        val next = payload.next(deviceId, timestamp)
        return next.copy(
            items = payload.items.filterNot { it.id == itemId },
            tombstones = payload.tombstones.filterNot { it.itemId == itemId } + Tombstone(itemId, timestamp, next.revision, deviceId),
        )
    }

    fun toggleIdentityFavorite(payload: VaultPayload, itemId: String, deviceId: String, now: Instant = Instant.now()): VaultPayload {
        val existing = payload.items.filterIsInstance<IdentityItem>().find { it.id == itemId } ?: throw NoSuchElementException("Identity not found")
        val timestamp = now.toString()
        return payload.next(deviceId, timestamp).copy(items = payload.items.map { item ->
            if (item.id != itemId) item else existing.copy(favorite = !existing.favorite, updatedAt = timestamp, revision = existing.revision + 1)
        })
    }

    fun likelyIdentityDuplicates(payload: VaultPayload, fields: IdentityFields, excludeItemId: String? = null): List<IdentityItem> {
        val email = fields.email.trim().lowercase()
        val firstName = fields.firstName.trim().lowercase()
        val lastName = fields.lastName.trim().lowercase()
        val title = fields.title.trim().lowercase()
        return payload.items.filterIsInstance<IdentityItem>().filter { item ->
            item.id != excludeItemId && ((email.isNotEmpty() && item.email.trim().lowercase() == email) ||
                ((firstName.isNotEmpty() || lastName.isNotEmpty()) && item.firstName.trim().lowercase() == firstName &&
                    item.lastName.trim().lowercase() == lastName && item.title.trim().lowercase() == title))
        }
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

    private fun uniqueName(name: String, existing: List<Pair<String, String>>, excludeId: String? = null): String {
        val normalized = name.trim()
        require(normalized.isNotEmpty() && normalized.length <= 64) { "Name must be between 1 and 64 characters" }
        require(existing.none { (id, value) -> id != excludeId && value.trim().equals(normalized, true) }) { "Name already exists" }
        return normalized
    }

    private fun VaultItem.organized(categoryId: String?, tagIds: List<String>, updatedAt: String): VaultItem = when (this) {
        is LoginItem -> copy(categoryId = categoryId, tagIds = tagIds, updatedAt = updatedAt, revision = revision + 1)
        is SecureNoteItem -> copy(categoryId = categoryId, tagIds = tagIds, updatedAt = updatedAt, revision = revision + 1)
        is CreditCardItem -> copy(categoryId = categoryId, tagIds = tagIds, updatedAt = updatedAt, revision = revision + 1)
        is IdentityItem -> copy(categoryId = categoryId, tagIds = tagIds, updatedAt = updatedAt, revision = revision + 1)
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

    private fun SecureNoteFields.validated(): SecureNoteFields {
        val value = copy(title = title.trim())
        require(value.title.isNotEmpty() && value.body.isNotBlank()) { "Secure note title and body are required" }
        return value
    }

    private fun CreditCardFields.validated(): CreditCardFields {
        val value = copy(
            title = title.trim(),
            cardholderName = cardholderName.trim(),
            number = number.replace(Regex("[\\s-]"), ""),
            verificationCode = verificationCode.trim(),
            pin = pin?.trim()?.takeIf(String::isNotEmpty),
        )
        require(value.title.isNotEmpty() && value.cardholderName.isNotEmpty() && value.number.matches(Regex("\\d{12,19}"))) { "Card title, cardholder, and a valid card number are required" }
        require(value.expiryMonth in 1..12 && value.expiryYear in 2000..9999 && value.verificationCode.matches(Regex("\\d{3,4}"))) { "Card expiry or verification fields are invalid" }
        require(value.pin == null || value.pin.matches(Regex("\\d{3,12}"))) { "Card PIN is invalid" }
        return value
    }

    private fun IdentityFields.validated(): IdentityFields {
        val value = copy(
            title = title.trim(), firstName = firstName.trim(), middleName = middleName.trim(), lastName = lastName.trim(),
            email = email.trim(), phone = phone.trim(), company = company.trim(), addressLine1 = addressLine1.trim(),
            addressLine2 = addressLine2.trim(), city = city.trim(), region = region.trim(), postalCode = postalCode.trim(), country = country.trim(),
        )
        val hasDetails = listOf(value.firstName, value.middleName, value.lastName, value.email, value.phone, value.company, value.addressLine1, value.addressLine2, value.city, value.region, value.postalCode, value.country).any(String::isNotEmpty)
        require(value.title.isNotEmpty() && hasDetails) { "Identity title and at least one identity field are required" }
        require(value.email.isEmpty() || ('@' in value.email && value.email.length <= 320)) { "Identity email is invalid" }
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
