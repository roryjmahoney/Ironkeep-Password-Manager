package dev.ironkeep.app.vault.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class VaultMutationsTest {
    @Test
    fun categoriesAndTagsDoNotLeaveDanglingItemReferences() {
        val login = VaultMutations.addLogin(
            VaultPayload.empty("Test", "device-a"),
            LoginFields("Example", "person@example.com", "secret", emptyList(), emptyList()),
            "device-a",
            itemId = "login-a",
        )
        val withCategory = VaultMutations.addCategory(login, "Finance", "device-a")
        val category = withCategory.categories.first { it.name == "Finance" }
        val withTag = VaultMutations.addTag(withCategory, "Important", "device-a")
        val tag = withTag.tags.first { it.name == "Important" }
        val organized = VaultMutations.setItemOrganization(withTag, "login-a", category.id, listOf(tag.id), "device-a")
        assertEquals(category.id, organized.items.single().categoryId)
        assertEquals(listOf(tag.id), organized.items.single().tagIds)

        val cleaned = VaultMutations.deleteTag(VaultMutations.deleteCategory(organized, category.id, "device-a"), tag.id, "device-a")
        assertNull(cleaned.items.single().categoryId)
        assertTrue(cleaned.items.single().tagIds.isEmpty())
    }

    private val fields = LoginFields(
        title = "Example",
        username = "person@example.com",
        password = "secret",
        uris = listOf("https://example.com/login"),
        androidPackageNames = listOf("com.example.app"),
    )

    @Test
    fun addEditFavoriteAndDeleteUpdateMetadataAndCreateTombstone() {
        val empty = VaultPayload.empty("Test", "device-a").copy(revision = 1, updatedAt = "2026-01-01T00:00:00Z")
        val added = VaultMutations.addLogin(empty, fields, "device-a", Instant.parse("2026-01-02T00:00:00Z"), "login-one")
        assertEquals(2, added.revision)
        assertEquals(1, (added.items.single() as LoginItem).revision)

        val edited = VaultMutations.editLogin(added, "login-one", fields.copy(title = "Updated"), "device-b", Instant.parse("2026-01-03T00:00:00Z"))
        assertEquals(3, edited.revision)
        assertEquals("device-b", edited.writerDeviceId)
        assertEquals(2, (edited.items.single() as LoginItem).revision)

        val favorite = VaultMutations.toggleFavorite(edited, "login-one", "device-b", Instant.parse("2026-01-04T00:00:00Z"))
        assertTrue((favorite.items.single() as LoginItem).favorite)

        val deleted = VaultMutations.deleteLogin(favorite, "login-one", "device-b", Instant.parse("2026-01-05T00:00:00Z"))
        assertTrue(deleted.items.isEmpty())
        assertEquals(Tombstone("login-one", "2026-01-05T00:00:00Z", 5, "device-b"), deleted.tombstones.single())
    }

    @Test
    fun duplicateDetectionRequiresSameIdentityAndExactOriginOrPackage() {
        val vault = VaultMutations.addLogin(VaultPayload.empty("Test", "device-a"), fields, "device-a", itemId = "login-one")
        assertEquals(1, VaultMutations.likelyDuplicates(vault, fields.copy(uris = listOf("https://example.com/other"), androidPackageNames = emptyList())).size)
        assertFalse(VaultMutations.likelyDuplicates(vault, fields.copy(title = "Other", username = "other@example.com", uris = listOf("https://other.example"), androidPackageNames = emptyList())).isNotEmpty())
    }

    @Test
    fun securitySettingsUpdateVaultMetadataOnce() {
        val empty = VaultPayload.empty("Test", "device-a").copy(revision = 1, updatedAt = "2026-01-01T00:00:00Z")
        val updated = VaultMutations.updateSecuritySettings(empty, 15, 60, "device-b", Instant.parse("2026-01-02T00:00:00Z"))
        assertEquals(2, updated.revision)
        assertEquals("2026-01-02T00:00:00Z", updated.updatedAt)
        assertEquals("device-b", updated.writerDeviceId)
        assertEquals(15, updated.settings.autoLockMinutes)
        assertEquals(60, updated.settings.clearClipboardSeconds)
    }

    @Test
    fun secureNoteCrudPreservesMetadataAndCreatesTombstone() {
        val empty = VaultPayload.empty("Test", "device-a").copy(revision = 1, updatedAt = "2026-01-01T00:00:00Z")
        val added = VaultMutations.addSecureNote(empty, SecureNoteFields("Recovery", "Offline codes"), "device-a", Instant.parse("2026-01-02T00:00:00Z"), "note-one")
        assertEquals(SecureNoteItem::class, added.items.single()::class)
        assertEquals(1, added.items.single().revision)

        val edited = VaultMutations.editSecureNote(added, "note-one", SecureNoteFields("Recovery codes", "Updated codes"), "device-b", Instant.parse("2026-01-03T00:00:00Z"))
        val note = edited.items.single() as SecureNoteItem
        assertEquals("Recovery codes", note.title)
        assertEquals("Updated codes", note.body)
        assertEquals(2, note.revision)
        assertEquals("2026-01-02T00:00:00Z", note.createdAt)

        val favorite = VaultMutations.toggleSecureNoteFavorite(edited, "note-one", "device-b", Instant.parse("2026-01-04T00:00:00Z"))
        assertTrue((favorite.items.single() as SecureNoteItem).favorite)

        val deleted = VaultMutations.deleteSecureNote(favorite, "note-one", "device-b", Instant.parse("2026-01-05T00:00:00Z"))
        assertTrue(deleted.items.isEmpty())
        assertEquals(Tombstone("note-one", "2026-01-05T00:00:00Z", 5, "device-b"), deleted.tombstones.single())
    }

    @Test
    fun secureNoteValidationAndDuplicateDetectionFailClosed() {
        val empty = VaultPayload.empty("Test", "device-a")
        assertTrue(runCatching { VaultMutations.addSecureNote(empty, SecureNoteFields("", "body"), "device-a") }.isFailure)
        assertTrue(runCatching { VaultMutations.addSecureNote(empty, SecureNoteFields("Title", " "), "device-a") }.isFailure)
        val added = VaultMutations.addSecureNote(empty, SecureNoteFields("Recovery", "codes"), "device-a", itemId = "note-one")
        assertEquals(1, VaultMutations.likelySecureNoteDuplicates(added, SecureNoteFields(" recovery ", "different")).size)
        assertTrue(VaultMutations.likelySecureNoteDuplicates(added, SecureNoteFields("Other", "different")).isEmpty())
    }

    @Test
    fun creditCardCrudNormalizesSecretsAndCreatesTombstone() {
        val card = CreditCardFields("Travel card", "A Person", "4111 1111 1111 1111", 12, 2030, "123", "9876", "Use abroad")
        val empty = VaultPayload.empty("Test", "device-a").copy(revision = 1, updatedAt = "2026-01-01T00:00:00Z")
        val added = VaultMutations.addCreditCard(empty, card, "device-a", Instant.parse("2026-01-02T00:00:00Z"), "card-one")
        assertEquals("4111111111111111", (added.items.single() as CreditCardItem).number)
        val edited = VaultMutations.editCreditCard(added, "card-one", card.copy(title = "Primary card", notes = "Updated"), "device-b", Instant.parse("2026-01-03T00:00:00Z"))
        assertEquals(2, (edited.items.single() as CreditCardItem).revision)
        val favorite = VaultMutations.toggleCreditCardFavorite(edited, "card-one", "device-b", Instant.parse("2026-01-04T00:00:00Z"))
        assertTrue((favorite.items.single() as CreditCardItem).favorite)
        val deleted = VaultMutations.deleteCreditCard(favorite, "card-one", "device-b", Instant.parse("2026-01-05T00:00:00Z"))
        assertTrue(deleted.items.isEmpty())
        assertEquals(Tombstone("card-one", "2026-01-05T00:00:00Z", 5, "device-b"), deleted.tombstones.single())
    }

    @Test
    fun creditCardValidationAndDuplicateDetectionFailClosed() {
        val card = CreditCardFields("Travel card", "A Person", "4111111111111111", 12, 2030, "123", null, "")
        val empty = VaultPayload.empty("Test", "device-a")
        assertTrue(runCatching { VaultMutations.addCreditCard(empty, card.copy(number = "123"), "device-a") }.isFailure)
        assertTrue(runCatching { VaultMutations.addCreditCard(empty, card.copy(expiryMonth = 13), "device-a") }.isFailure)
        assertTrue(runCatching { VaultMutations.addCreditCard(empty, card.copy(verificationCode = "x"), "device-a") }.isFailure)
        val added = VaultMutations.addCreditCard(empty, card, "device-a", itemId = "card-one")
        assertEquals(1, VaultMutations.likelyCreditCardDuplicates(added, card.copy(number = "4111-1111-1111-1111")).size)
    }

    @Test
    fun identityCrudPreservesFieldsAndCreatesTombstone() {
        val identity = identityFields()
        val empty = VaultPayload.empty("Test", "device-a").copy(revision = 1, updatedAt = "2026-01-01T00:00:00Z")
        val added = VaultMutations.addIdentity(empty, identity, "device-a", Instant.parse("2026-01-02T00:00:00Z"), "identity-one")
        assertEquals("Alex", (added.items.single() as IdentityItem).firstName)
        val edited = VaultMutations.editIdentity(added, "identity-one", identity.copy(company = "Updated"), "device-b", Instant.parse("2026-01-03T00:00:00Z"))
        assertEquals(2, (edited.items.single() as IdentityItem).revision)
        val favorite = VaultMutations.toggleIdentityFavorite(edited, "identity-one", "device-b", Instant.parse("2026-01-04T00:00:00Z"))
        assertTrue((favorite.items.single() as IdentityItem).favorite)
        val deleted = VaultMutations.deleteIdentity(favorite, "identity-one", "device-b", Instant.parse("2026-01-05T00:00:00Z"))
        assertTrue(deleted.items.isEmpty())
        assertEquals(Tombstone("identity-one", "2026-01-05T00:00:00Z", 5, "device-b"), deleted.tombstones.single())
    }

    @Test
    fun identityValidationAndDuplicateDetectionFailClosed() {
        val identity = identityFields()
        val empty = VaultPayload.empty("Test", "device-a")
        assertTrue(runCatching { VaultMutations.addIdentity(empty, identity.copy(firstName = "", middleName = "", lastName = "", email = "", phone = "", company = "", addressLine1 = "", addressLine2 = "", city = "", region = "", postalCode = "", country = ""), "device-a") }.isFailure)
        assertTrue(runCatching { VaultMutations.addIdentity(empty, identity.copy(email = "invalid"), "device-a") }.isFailure)
        val added = VaultMutations.addIdentity(empty, identity, "device-a", itemId = "identity-one")
        assertEquals(1, VaultMutations.likelyIdentityDuplicates(added, identity.copy(title = "Other", email = " ALEX@example.com ")).size)
    }

    private fun identityFields() = IdentityFields(
        title = "Personal identity", firstName = "Alex", middleName = "Q", lastName = "Person",
        email = "alex@example.com", phone = "+1 555 0100", company = "Example", addressLine1 = "1 Main Street",
        addressLine2 = "Unit 2", city = "Seattle", region = "WA", postalCode = "98101", country = "US", notes = "Primary",
    )
}
