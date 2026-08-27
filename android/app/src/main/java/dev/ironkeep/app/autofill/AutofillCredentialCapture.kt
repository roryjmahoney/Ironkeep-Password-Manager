package dev.ironkeep.app.autofill

import android.os.SystemClock
import dev.ironkeep.app.vault.model.LoginFields
import dev.ironkeep.app.vault.model.LoginItem
import dev.ironkeep.app.vault.model.VaultPayload
import java.net.URI
import java.util.UUID

internal data class AutofillTarget(
    val webOrigin: String? = null,
    val androidPackageName: String? = null,
) {
    init {
        require((webOrigin == null) != (androidPackageName == null)) { "Exactly one autofill target is required" }
    }

    val displayValue: String get() = webOrigin ?: requireNotNull(androidPackageName)
}

internal class AutofillCredentialCandidate(
    val vaultId: String,
    val title: String,
    val username: String,
    password: CharArray,
    val target: AutofillTarget,
) {
    private val password = password.copyOf()

    fun passwordString(): String = password.concatToString()

    fun clear() = password.fill('\u0000')
}

internal data class AutofillCandidateSummary(
    val title: String,
    val username: String,
    val target: String,
)

internal object AutofillSavePlanner {
    fun matchingLogins(payload: VaultPayload, candidate: AutofillCredentialCandidate): List<LoginItem> =
        matchingLogins(payload, candidate.target)

    fun matchingLogins(payload: VaultPayload, target: AutofillTarget): List<LoginItem> =
        payload.items.filterIsInstance<LoginItem>().filter { it.matches(target) }

    fun isUnchanged(payload: VaultPayload, candidate: AutofillCredentialCandidate): Boolean {
        val username = candidate.username.trim()
        val password = candidate.passwordString()
        return matchingLogins(payload, candidate).any { login ->
            login.username.trim().equals(username, ignoreCase = true) && login.password == password
        }
    }

    fun createFields(candidate: AutofillCredentialCandidate): LoginFields = LoginFields(
        title = candidate.title,
        username = candidate.username,
        password = candidate.passwordString(),
        uris = listOfNotNull(candidate.target.webOrigin),
        androidPackageNames = listOfNotNull(candidate.target.androidPackageName),
    )

    fun updateFields(candidate: AutofillCredentialCandidate, existing: LoginItem): LoginFields = LoginFields(
        title = existing.title,
        username = candidate.username.ifBlank { existing.username },
        password = candidate.passwordString(),
        uris = existing.uris,
        androidPackageNames = existing.androidPackageNames,
    )

    private fun LoginItem.matches(target: AutofillTarget): Boolean = when {
        target.webOrigin != null -> uris.any { origin(it) == target.webOrigin }
        else -> androidPackageNames.any { it.equals(target.androidPackageName, ignoreCase = true) }
    }
}

internal object AutofillPendingSaveStore {
    private const val TIMEOUT_MILLIS = 2 * 60 * 1_000L

    private data class Pending(
        val token: String,
        val candidate: AutofillCredentialCandidate,
        val createdAtMillis: Long,
    )

    private var pending: Pending? = null

    @Synchronized
    fun put(candidate: AutofillCredentialCandidate, nowMillis: Long = SystemClock.elapsedRealtime()): String {
        clearLocked()
        val token = UUID.randomUUID().toString()
        pending = Pending(token, candidate, nowMillis)
        return token
    }

    @Synchronized
    fun summary(token: String, nowMillis: Long = SystemClock.elapsedRealtime()): AutofillCandidateSummary? {
        val candidate = candidateLocked(token, nowMillis) ?: return null
        return AutofillCandidateSummary(candidate.title, candidate.username, candidate.target.displayValue)
    }

    @Synchronized
    fun candidate(token: String, nowMillis: Long = SystemClock.elapsedRealtime()): AutofillCredentialCandidate? =
        candidateLocked(token, nowMillis)

    @Synchronized
    fun discard(token: String) {
        if (pending?.token == token) clearLocked()
    }

    @Synchronized
    fun clear() = clearLocked()

    private fun candidateLocked(token: String, nowMillis: Long): AutofillCredentialCandidate? {
        val value = pending ?: return null
        if (nowMillis - value.createdAtMillis >= TIMEOUT_MILLIS || value.token != token) {
            if (nowMillis - value.createdAtMillis >= TIMEOUT_MILLIS) clearLocked()
            return null
        }
        return value.candidate
    }

    private fun clearLocked() {
        pending?.candidate?.clear()
        pending = null
    }
}

internal enum class AutofillFieldKind {
    USERNAME,
    CURRENT_PASSWORD,
    NEW_PASSWORD,
    CREDIT_CARD_NAME,
    CREDIT_CARD_NUMBER,
    CREDIT_CARD_SECURITY_CODE,
    CREDIT_CARD_EXPIRATION_DATE,
    CREDIT_CARD_EXPIRATION_MONTH,
    CREDIT_CARD_EXPIRATION_YEAR,
}

internal fun classifyAutofillField(vararg labels: String?): AutofillFieldKind? {
    val tokens = labels.filterNotNull().map { label -> label.lowercase().filter(Char::isLetterOrDigit) }
    return when {
        tokens.any { it in CARD_EXPIRATION_MONTH_TOKENS } -> AutofillFieldKind.CREDIT_CARD_EXPIRATION_MONTH
        tokens.any { it in CARD_EXPIRATION_YEAR_TOKENS } -> AutofillFieldKind.CREDIT_CARD_EXPIRATION_YEAR
        tokens.any { it in CARD_EXPIRATION_DATE_TOKENS } -> AutofillFieldKind.CREDIT_CARD_EXPIRATION_DATE
        tokens.any { it in CARD_SECURITY_CODE_TOKENS } -> AutofillFieldKind.CREDIT_CARD_SECURITY_CODE
        tokens.any { it in CARD_NUMBER_TOKENS } -> AutofillFieldKind.CREDIT_CARD_NUMBER
        tokens.any { it in CARD_NAME_TOKENS } -> AutofillFieldKind.CREDIT_CARD_NAME
        tokens.any { it.contains("newpassword") || it.contains("passwordnew") } -> AutofillFieldKind.NEW_PASSWORD
        tokens.any { it.contains("password") || it == "pwd" } -> AutofillFieldKind.CURRENT_PASSWORD
        tokens.any { it.contains("username") || it.contains("email") || it.contains("phone") || it.contains("loginid") } -> AutofillFieldKind.USERNAME
        else -> null
    }
}

private val CARD_NAME_TOKENS = setOf("creditcardname", "ccname", "cardholder", "cardholdername", "nameoncard")
private val CARD_NUMBER_TOKENS = setOf("creditcardnumber", "ccnumber", "cardnumber", "paymentcardnumber", "pan")
private val CARD_SECURITY_CODE_TOKENS = setOf(
    "creditcardsecuritycode",
    "cardsecuritycode",
    "cccsc",
    "securitycode",
    "cvc",
    "cvc2",
    "cvv",
    "cvv2",
)
private val CARD_EXPIRATION_DATE_TOKENS = setOf(
    "creditcardexpirationdate",
    "cardexpirationdate",
    "cardexpirydate",
    "ccexp",
    "expirationdate",
    "expirydate",
    "expdate",
)
private val CARD_EXPIRATION_MONTH_TOKENS = setOf(
    "creditcardexpirationmonth",
    "cardexpirationmonth",
    "cardexpirymonth",
    "ccexpmonth",
    "expirationmonth",
    "expirymonth",
    "expmonth",
)
private val CARD_EXPIRATION_YEAR_TOKENS = setOf(
    "creditcardexpirationyear",
    "cardexpirationyear",
    "cardexpiryyear",
    "ccexpyear",
    "expirationyear",
    "expiryyear",
    "expyear",
)

internal fun httpsOrigin(scheme: String?, domain: String?): String? {
    if (!scheme.equals("https", ignoreCase = true) || domain.isNullOrBlank()) return null
    return runCatching {
        val uri = URI("https://$domain")
        require(uri.rawPath.isNullOrEmpty() && uri.rawQuery == null && uri.rawFragment == null && uri.userInfo == null)
        val host = requireNotNull(uri.host).lowercase()
        val port = if (uri.port >= 0) ":${uri.port}" else ""
        "https://$host$port"
    }.getOrNull()
}

private fun origin(value: String): String? = runCatching {
    val uri = URI(value)
    if (!uri.scheme.equals("https", true) || uri.host == null) return@runCatching null
    val port = if (uri.port >= 0) ":${uri.port}" else ""
    "https://${uri.host.lowercase()}$port"
}.getOrNull()
