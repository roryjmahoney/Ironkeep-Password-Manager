package dev.ironkeep.app.autofill

import dev.ironkeep.app.vault.model.LoginFields
import dev.ironkeep.app.vault.model.LoginItem
import dev.ironkeep.app.vault.model.CreditCardFields
import dev.ironkeep.app.vault.model.CreditCardItem
import dev.ironkeep.app.vault.model.VaultMutations
import dev.ironkeep.app.vault.model.VaultPayload
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class AutofillCredentialCaptureTest {
    @Test
    fun fieldClassificationPrioritizesNewPasswordsAndRecognizesIdentifiers() {
        assertEquals(AutofillFieldKind.NEW_PASSWORD, classifyAutofillField("new-password"))
        assertEquals(AutofillFieldKind.CURRENT_PASSWORD, classifyAutofillField("currentPassword"))
        assertEquals(AutofillFieldKind.USERNAME, classifyAutofillField("emailAddress"))
        assertNull(classifyAutofillField("display-name"))
    }

    @Test
    fun fieldClassificationRecognizesAndroidAndHtmlCreditCardHints() {
        assertEquals(AutofillFieldKind.CREDIT_CARD_NAME, classifyAutofillField("cc-name"))
        assertEquals(AutofillFieldKind.CREDIT_CARD_NUMBER, classifyAutofillField("creditCardNumber"))
        assertEquals(AutofillFieldKind.CREDIT_CARD_SECURITY_CODE, classifyAutofillField("cvv"))
        assertEquals(AutofillFieldKind.CREDIT_CARD_EXPIRATION_DATE, classifyAutofillField("cc-exp"))
        assertEquals(AutofillFieldKind.CREDIT_CARD_EXPIRATION_MONTH, classifyAutofillField("cc-exp-month"))
        assertEquals(AutofillFieldKind.CREDIT_CARD_EXPIRATION_YEAR, classifyAutofillField("creditCardExpirationYear"))
        assertNull(classifyAutofillField("account-number"))
    }

    @Test
    fun creditCardValuesMatchTextLengthsAndSelectOptions() {
        val card = creditCard()

        assertEquals("4111111111111111", creditCardAutofillText(AutofillFieldKind.CREDIT_CARD_NUMBER, card))
        assertEquals("07/30", creditCardAutofillText(AutofillFieldKind.CREDIT_CARD_EXPIRATION_DATE, card, maxLength = 5))
        assertEquals("07/2030", creditCardAutofillText(AutofillFieldKind.CREDIT_CARD_EXPIRATION_DATE, card))
        assertEquals("30", creditCardAutofillText(AutofillFieldKind.CREDIT_CARD_EXPIRATION_YEAR, card, maxLength = 2))
        assertEquals(2, creditCardAutofillListIndex(AutofillFieldKind.CREDIT_CARD_EXPIRATION_MONTH, card, listOf("Month", "06", "07", "08")))
        assertEquals(1, creditCardAutofillListIndex(AutofillFieldKind.CREDIT_CARD_EXPIRATION_YEAR, card, listOf("Year", "2030", "2031")))
    }

    @Test
    fun webTargetsRequireHttpsAndNormalizeExactOrigin() {
        assertEquals("https://example.com", httpsOrigin("HTTPS", "Example.COM"))
        assertEquals("https://example.com:8443", httpsOrigin("https", "example.com:8443"))
        assertNull(httpsOrigin("http", "example.com"))
        assertNull(httpsOrigin("https", "example.com/path"))
    }

    @Test
    fun exactTargetMatchingRejectsLookalikesAndDifferentSchemes() {
        val payload = vaultWith(
            LoginFields("Example", "person@example.com", "old", listOf("https://example.com/login"), emptyList()),
            LoginFields("Lookalike", "person@example.com", "other", listOf("https://example.com.evil.test"), emptyList()),
            LoginFields("Insecure", "person@example.com", "other", listOf("http://example.com"), emptyList()),
        )
        val candidate = candidate(password = "new", target = AutofillTarget(webOrigin = "https://example.com"))

        assertEquals(listOf("Example"), AutofillSavePlanner.matchingLogins(payload, candidate).map(LoginItem::title))
        candidate.clear()
    }

    @Test
    fun unchangedCredentialsDoNotCreateAnotherPrompt() {
        val payload = vaultWith(LoginFields("Example", "person@example.com", "same", emptyList(), listOf("com.example.app")))
        val same = candidate(password = "same", target = AutofillTarget(androidPackageName = "com.example.app"))
        val changed = candidate(password = "changed", target = AutofillTarget(androidPackageName = "com.example.app"))

        assertTrue(AutofillSavePlanner.isUnchanged(payload, same))
        assertFalse(AutofillSavePlanner.isUnchanged(payload, changed))
        same.clear()
        changed.clear()
    }

    @Test
    fun createAndUpdateFieldsKeepOnlyVerifiedAssociations() {
        val payload = vaultWith(LoginFields("Existing", "old@example.com", "old", listOf("https://example.com"), emptyList()))
        val existing = payload.items.single() as LoginItem
        val candidate = candidate(username = "new@example.com", password = "new", target = AutofillTarget(webOrigin = "https://example.com"))

        assertEquals(listOf("https://example.com"), AutofillSavePlanner.createFields(candidate).uris)
        assertEquals(emptyList<String>(), AutofillSavePlanner.createFields(candidate).androidPackageNames)
        val update = AutofillSavePlanner.updateFields(candidate, existing)
        assertEquals("Existing", update.title)
        assertEquals("new@example.com", update.username)
        assertEquals(listOf("https://example.com"), update.uris)
        candidate.clear()
    }

    @Test
    fun pendingCandidateExpiresAndIsWiped() {
        val candidate = candidate(password = "temporary", target = AutofillTarget(androidPackageName = "com.example.app"))
        val token = AutofillPendingSaveStore.put(candidate, nowMillis = 1_000L)

        assertNull(AutofillPendingSaveStore.candidate(token, nowMillis = 121_000L))
        assertTrue(candidate.passwordString().all { it == '\u0000' })
    }

    private fun candidate(
        username: String = "person@example.com",
        password: String,
        target: AutofillTarget,
    ) = AutofillCredentialCandidate("vault-one", "Example", username, password.toCharArray(), target)

    private fun vaultWith(vararg fields: LoginFields): VaultPayload = fields.foldIndexed(VaultPayload.empty("Test", "device-a")) { index, payload, login ->
        VaultMutations.addLogin(payload, login, "device-a", itemId = "login-$index")
    }

    private fun creditCard(): CreditCardItem = VaultMutations.addCreditCard(
        VaultPayload.empty("Test", "device-a"),
        CreditCardFields("Test card", "A Person", "4111 1111 1111 1111", 7, 2030, "123", null, ""),
        "device-a",
        itemId = "card-one",
    ).items.single() as CreditCardItem
}
