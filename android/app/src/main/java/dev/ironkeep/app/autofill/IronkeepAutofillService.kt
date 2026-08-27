package dev.ironkeep.app.autofill

import android.app.PendingIntent
import android.app.assist.AssistStructure
import android.content.Context
import android.content.Intent
import android.os.Build
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveInfo
import android.service.autofill.SaveRequest
import android.text.InputType
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import dev.ironkeep.app.R
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.generator.PasswordGenerator
import dev.ironkeep.app.vault.model.CreditCardItem
import dev.ironkeep.app.vault.model.PasswordGeneratorOptions
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.session.VaultSessionHolder
import dev.ironkeep.app.vault.storage.VaultFileStore
import java.time.Month
import java.time.YearMonth
import java.time.ZoneOffset

class IronkeepAutofillService : AutofillService() {
    private val crypto = VaultCrypto()
    private val vaultStore by lazy { VaultFileStore(this, crypto.json) }

    @Suppress("DEPRECATION") // RemoteViews overload is required for the API 28 compatibility path.
    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val structure = request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess(null)
        val fields = FieldCollector().collect(listOf(structure))
        try {
            if (fields.packageName == packageName || !fields.hasSupportedFields) return callback.onSuccess(null)
            fields.target() ?: return callback.onSuccess(null)
            val payload = VaultSessionHolder.payloadOrNull()
            val response = if (payload == null) buildLockedFillResponse(request.id, fields) else {
                buildUnlockedFillResponse(this, fields, payload)
            }
            callback.onSuccess(response)
        } finally {
            fields.clearSensitive()
        }
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        val session = VaultSessionHolder.sessionOrNull()
        val fields = FieldCollector().collect(request.fillContexts.map { it.structure })
        if (fields.packageName == packageName) {
            fields.clearSensitive()
            callback.onFailure("Ironkeep does not capture its own fields.")
            return
        }
        val target = fields.target()
        val vaultId = session?.payload?.vaultId ?: runCatching { vaultStore.read().vaultId }.getOrNull()
        val candidate = if (target == null) null else fields.candidate(
            vaultId = vaultId.orEmpty(),
            title = titleFor(target),
            target = target,
        )
        fields.clearSensitive()
        if (candidate == null || vaultId.isNullOrBlank()) {
            candidate?.clear()
            callback.onFailure("Ironkeep could not safely identify a matching username, password, and target.")
            return
        }
        if (session != null && AutofillSavePlanner.isUnchanged(session.payload, candidate)) {
            candidate.clear()
            callback.onSuccess()
            return
        }

        val token = AutofillPendingSaveStore.put(candidate)
        val intent = Intent(this, AutofillSaveActivity::class.java)
            .putExtra(AutofillSaveActivity.EXTRA_PENDING_TOKEN, token)
            .addFlags(Intent.FLAG_ACTIVITY_NO_HISTORY)
        val pendingIntent = PendingIntent.getActivity(
            this,
            token.hashCode(),
            intent,
            PendingIntent.FLAG_ONE_SHOT or PendingIntent.FLAG_CANCEL_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        callback.onSuccess(pendingIntent.intentSender)
    }

    @Suppress("DEPRECATION") // RemoteViews authentication is the compatibility API for Android 9-12.
    private fun buildLockedFillResponse(requestId: Int, fields: DetectedFields): FillResponse {
        val presentation = autofillPresentation(this, getString(R.string.autofill_unlock))
        val intent = Intent(this, AutofillAuthActivity::class.java)
        val flags = PendingIntent.FLAG_CANCEL_CURRENT or if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            PendingIntent.FLAG_MUTABLE
        } else 0
        val authentication = PendingIntent.getActivity(this, requestId, intent, flags).intentSender
        return FillResponse.Builder().apply {
            fields.loginSaveInfoOrNull()?.let(::setSaveInfo)
            setAuthentication(fields.allIds.toTypedArray(), authentication, presentation)
        }.build()
    }

    private fun titleFor(target: AutofillTarget): String {
        target.webOrigin?.let { return runCatching { java.net.URI(it).host }.getOrNull() ?: it }
        val appPackage = requireNotNull(target.androidPackageName)
        return runCatching {
            val info = packageManager.getApplicationInfo(appPackage, 0)
            packageManager.getApplicationLabel(info).toString().trim().ifBlank { appPackage }
        }.getOrDefault(appPackage)
    }
}

@Suppress("DEPRECATION") // Dataset RemoteViews overloads are required for the API 28 compatibility path.
internal fun buildUnlockedFillResponse(context: Context, fields: DetectedFields, payload: VaultPayload): FillResponse? {
    val target = requireNotNull(fields.target())
    val saveInfo = fields.loginSaveInfoOrNull()
    val response = FillResponse.Builder().apply { saveInfo?.let(::setSaveInfo) }
    var hasResponseContent = saveInfo != null
    generatedPasswordDataset(context, fields, payload.settings.generator)?.let { dataset ->
        response.addDataset(dataset)
        hasResponseContent = true
    }
    if (fields.currentPasswordIds.isNotEmpty()) {
        AutofillSavePlanner.matchingLogins(payload, target).forEach { login ->
            val presentation = autofillPresentation(context, login.title)
            val dataset = Dataset.Builder(presentation)
            fields.usernameIds.forEach { dataset.setValue(it, AutofillValue.forText(login.username), presentation) }
            fields.currentPasswordIds.forEach { dataset.setValue(it, AutofillValue.forText(login.password), presentation) }
            response.addDataset(dataset.build())
            hasResponseContent = true
        }
    }
    if (fields.creditCardIds.isNotEmpty()) {
        payload.items.filterIsInstance<CreditCardItem>()
            .sortedWith(compareByDescending<CreditCardItem> { it.favorite }.thenBy { it.title.lowercase() })
            .forEach { card ->
                creditCardDataset(context, fields, card)?.let { dataset ->
                    response.addDataset(dataset)
                    hasResponseContent = true
                }
            }
    }
    return if (hasResponseContent) response.build() else null
}

@Suppress("DEPRECATION") // RemoteViews overloads retain the Android 9-12 compatibility path.
private fun creditCardDataset(context: Context, fields: DetectedFields, card: CreditCardItem): Dataset? {
    val presentation = autofillPresentation(context, "${card.title} · •••• ${card.number.takeLast(4)}")
    val dataset = Dataset.Builder(presentation)
    var valueCount = 0
    fields.creditCardFields.forEach { (kind, detected) ->
        detected.forEach { field ->
            creditCardAutofillValue(kind, field, card)?.let { value ->
                dataset.setValue(field.id, value, presentation)
                valueCount += 1
            }
        }
    }
    return if (valueCount == 0) null else dataset.build()
}

private fun creditCardAutofillValue(
    kind: AutofillFieldKind,
    field: DetectedAutofillField,
    card: CreditCardItem,
): AutofillValue? = when (field.autofillType) {
    View.AUTOFILL_TYPE_TEXT -> creditCardAutofillText(kind, card, field.maxTextLength)?.let(AutofillValue::forText)
    View.AUTOFILL_TYPE_LIST -> creditCardAutofillListIndex(kind, card, field.options)?.let(AutofillValue::forList)
    View.AUTOFILL_TYPE_DATE -> when (kind) {
        AutofillFieldKind.CREDIT_CARD_EXPIRATION_DATE,
        AutofillFieldKind.CREDIT_CARD_EXPIRATION_MONTH,
        AutofillFieldKind.CREDIT_CARD_EXPIRATION_YEAR,
        -> AutofillValue.forDate(YearMonth.of(card.expiryYear, card.expiryMonth).atDay(1).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli())

        else -> null
    }

    else -> null
}

internal fun creditCardAutofillText(kind: AutofillFieldKind, card: CreditCardItem, maxLength: Int = -1): String? = when (kind) {
    AutofillFieldKind.CREDIT_CARD_NAME -> card.cardholderName
    AutofillFieldKind.CREDIT_CARD_NUMBER -> card.number
    AutofillFieldKind.CREDIT_CARD_SECURITY_CODE -> card.verificationCode
    AutofillFieldKind.CREDIT_CARD_EXPIRATION_MONTH -> card.expiryMonth.toString().padStart(2, '0')
    AutofillFieldKind.CREDIT_CARD_EXPIRATION_YEAR -> if (maxLength in 1..2) {
        (card.expiryYear % 100).toString().padStart(2, '0')
    } else {
        card.expiryYear.toString()
    }
    AutofillFieldKind.CREDIT_CARD_EXPIRATION_DATE -> if (maxLength in 1..5) {
        "${card.expiryMonth.toString().padStart(2, '0')}/${(card.expiryYear % 100).toString().padStart(2, '0')}"
    } else {
        "${card.expiryMonth.toString().padStart(2, '0')}/${card.expiryYear}"
    }
    else -> null
}

internal fun creditCardAutofillListIndex(kind: AutofillFieldKind, card: CreditCardItem, options: List<String>): Int? {
    val accepted = when (kind) {
        AutofillFieldKind.CREDIT_CARD_EXPIRATION_MONTH -> {
            val month = Month.of(card.expiryMonth)
            setOf(card.expiryMonth.toString(), card.expiryMonth.toString().padStart(2, '0'), month.name.lowercase(), month.name.take(3).lowercase())
        }
        AutofillFieldKind.CREDIT_CARD_EXPIRATION_YEAR -> setOf(card.expiryYear.toString(), (card.expiryYear % 100).toString().padStart(2, '0'))
        else -> return null
    }
    return options.indexOfFirst { option -> option.lowercase().filter(Char::isLetterOrDigit) in accepted }.takeIf { it >= 0 }
}

@Suppress("DEPRECATION") // RemoteViews overloads retain the Android 9-12 compatibility path.
private fun generatedPasswordDataset(
    context: Context,
    fields: DetectedFields,
    options: PasswordGeneratorOptions,
): Dataset? {
    if (fields.newPasswordIds.isEmpty()) return null
    val password = runCatching { PasswordGenerator.generate(options) }.getOrNull() ?: return null
    val presentation = autofillPresentation(context, context.getString(R.string.autofill_generate_password))
    return Dataset.Builder(presentation).apply {
        fields.newPasswordIds.forEach { id ->
            setValue(id, AutofillValue.forText(password), null, presentation)
        }
    }.build()
}

private fun autofillPresentation(context: Context, label: String): RemoteViews =
    RemoteViews(context.packageName, R.layout.autofill_presentation).apply {
        setTextViewText(R.id.autofill_presentation_text, label)
    }

internal class DetectedFields {
    val usernameIds = mutableListOf<AutofillId>()
    val currentPasswordIds = mutableListOf<AutofillId>()
    val newPasswordIds = mutableListOf<AutofillId>()
    private val usernames = linkedMapOf<AutofillId, String>()
    private val currentPasswords = linkedMapOf<AutofillId, CharArray>()
    private val newPasswords = linkedMapOf<AutofillId, CharArray>()
    private val cardFields = linkedMapOf<AutofillFieldKind, MutableList<DetectedAutofillField>>()
    var webDomain: String? = null
    var webScheme: String? = null
    var packageName: String? = null

    val savePasswordIds: List<AutofillId> get() = newPasswordIds.ifEmpty { currentPasswordIds }
    val creditCardFields: Map<AutofillFieldKind, List<DetectedAutofillField>> get() = cardFields
    val creditCardIds: List<AutofillId> get() = cardFields.values.flatten().map(DetectedAutofillField::id).distinct()
    val hasSupportedFields: Boolean get() = savePasswordIds.isNotEmpty() || creditCardIds.isNotEmpty()
    val allIds: List<AutofillId> get() = (usernameIds + currentPasswordIds + newPasswordIds + creditCardIds).distinct()

    fun target(): AutofillTarget? {
        if (webDomain != null) {
            return httpsOrigin(webScheme, webDomain)?.let { AutofillTarget(webOrigin = it) }
        }
        val appPackage = packageName?.takeIf { it.matches(PACKAGE_PATTERN) } ?: return null
        return AutofillTarget(androidPackageName = appPackage)
    }

    fun loginSaveInfoOrNull(): SaveInfo? {
        if (savePasswordIds.isEmpty()) return null
        val required = arrayOf(savePasswordIds.first())
        val optional = (usernameIds + savePasswordIds.drop(1)).distinct().toTypedArray()
        return SaveInfo.Builder(SaveInfo.SAVE_DATA_TYPE_USERNAME or SaveInfo.SAVE_DATA_TYPE_PASSWORD, required)
            .apply {
                if (optional.isNotEmpty()) setOptionalIds(optional)
                setDescription("Choose save or update in Ironkeep.")
                if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                    setPositiveAction(SaveInfo.POSITIVE_BUTTON_STYLE_CONTINUE)
                }
                setFlags(SaveInfo.FLAG_SAVE_ON_ALL_VIEWS_INVISIBLE)
            }
            .build()
    }

    fun candidate(vaultId: String, title: String, target: AutofillTarget): AutofillCredentialCandidate? {
        val passwords = newPasswords.ifEmpty { currentPasswords }.values.filter { it.isNotEmpty() }
        val password = passwords.lastOrNull() ?: return null
        if (passwords.any { !it.contentEquals(password) }) return null
        val username = usernames.values.lastOrNull { it.isNotBlank() }.orEmpty()
        return AutofillCredentialCandidate(vaultId, title, username, password, target)
    }

    fun add(
        kind: AutofillFieldKind,
        id: AutofillId,
        value: CharSequence?,
        autofillType: Int,
        options: List<String>,
        maxTextLength: Int,
    ) {
        when (kind) {
            AutofillFieldKind.USERNAME -> {
                if (autofillType != View.AUTOFILL_TYPE_TEXT) return
                if (id !in usernameIds) usernameIds += id
                value?.toString()?.let { usernames[id] = it }
            }

            AutofillFieldKind.CURRENT_PASSWORD -> {
                if (autofillType != View.AUTOFILL_TYPE_TEXT) return
                if (id !in currentPasswordIds) currentPasswordIds += id
                value?.toChars()?.let { replacement -> currentPasswords.put(id, replacement)?.fill('\u0000') }
            }

            AutofillFieldKind.NEW_PASSWORD -> {
                if (autofillType != View.AUTOFILL_TYPE_TEXT) return
                if (id !in newPasswordIds) newPasswordIds += id
                value?.toChars()?.let { replacement -> newPasswords.put(id, replacement)?.fill('\u0000') }
            }

            AutofillFieldKind.CREDIT_CARD_NAME,
            AutofillFieldKind.CREDIT_CARD_NUMBER,
            AutofillFieldKind.CREDIT_CARD_SECURITY_CODE,
            AutofillFieldKind.CREDIT_CARD_EXPIRATION_DATE,
            AutofillFieldKind.CREDIT_CARD_EXPIRATION_MONTH,
            AutofillFieldKind.CREDIT_CARD_EXPIRATION_YEAR,
            -> if (autofillType == View.AUTOFILL_TYPE_TEXT || autofillType == View.AUTOFILL_TYPE_LIST || autofillType == View.AUTOFILL_TYPE_DATE) {
                val fields = cardFields.getOrPut(kind) { mutableListOf() }
                if (fields.none { it.id == id }) fields += DetectedAutofillField(id, autofillType, options, maxTextLength)
            }
        }
    }

    fun clearSensitive() {
        currentPasswords.values.forEach { it.fill('\u0000') }
        newPasswords.values.forEach { it.fill('\u0000') }
        currentPasswords.clear()
        newPasswords.clear()
    }

    private fun CharSequence.toChars(): CharArray = CharArray(length) { index -> this[index] }

    private companion object {
        val PACKAGE_PATTERN = Regex("[A-Za-z0-9_]+(?:\\.[A-Za-z0-9_]+)+")
    }
}

internal class FieldCollector {
    fun collect(structures: List<AssistStructure>): DetectedFields {
        val result = DetectedFields()
        structures.forEach { structure ->
            result.packageName = structure.activityComponent?.packageName ?: result.packageName
            repeat(structure.windowNodeCount) { visit(structure.getWindowNodeAt(it).rootViewNode, result) }
        }
        return result
    }

    private fun visit(node: AssistStructure.ViewNode, result: DetectedFields) {
        result.webDomain = node.webDomain ?: result.webDomain
        result.webScheme = node.webScheme ?: result.webScheme
        val id = node.autofillId
        if (node.autofillType != View.AUTOFILL_TYPE_NONE && id != null && node.isEnabled && node.visibility == View.VISIBLE) {
            val htmlLabels = node.htmlInfo?.attributes.orEmpty().flatMap { listOf(it.first, it.second) }
            val labels = node.autofillHints.orEmpty().toList() + htmlLabels + listOf(node.hint, node.idEntry)
            val kind = classifyAutofillField(*labels.toTypedArray()) ?: kindFromInputType(node.inputType)
            val value = node.autofillValue?.takeIf(AutofillValue::isText)?.textValue
            if (kind != null) {
                result.add(
                    kind = kind,
                    id = id,
                    value = value,
                    autofillType = node.autofillType,
                    options = node.autofillOptions.orEmpty().map(CharSequence::toString),
                    maxTextLength = node.maxTextLength,
                )
            }
        }
        repeat(node.childCount) { visit(node.getChildAt(it), result) }
    }

    private fun kindFromInputType(inputType: Int): AutofillFieldKind? = when (inputType and InputType.TYPE_MASK_VARIATION) {
        InputType.TYPE_TEXT_VARIATION_PASSWORD,
        InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD,
        InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD,
        -> AutofillFieldKind.CURRENT_PASSWORD

        InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS,
        InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS,
        -> AutofillFieldKind.USERNAME

        else -> null
    }
}

internal data class DetectedAutofillField(
    val id: AutofillId,
    val autofillType: Int,
    val options: List<String>,
    val maxTextLength: Int,
)
