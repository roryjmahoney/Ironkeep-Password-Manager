package dev.ironkeep.app.autofill

import android.app.assist.AssistStructure
import android.os.CancellationSignal
import android.service.autofill.AutofillService
import android.service.autofill.Dataset
import android.service.autofill.FillCallback
import android.service.autofill.FillRequest
import android.service.autofill.FillResponse
import android.service.autofill.SaveCallback
import android.service.autofill.SaveRequest
import android.view.View
import android.view.autofill.AutofillId
import android.view.autofill.AutofillValue
import android.widget.RemoteViews
import dev.ironkeep.app.vault.model.LoginItem
import dev.ironkeep.app.vault.session.VaultSessionHolder

class IronkeepAutofillService : AutofillService() {
    @Suppress("DEPRECATION") // RemoteViews overload is required for the API 28 compatibility path.
    override fun onFillRequest(request: FillRequest, cancellationSignal: CancellationSignal, callback: FillCallback) {
        val payload = VaultSessionHolder.payloadOrNull() ?: return callback.onSuccess(null)
        val structure = request.fillContexts.lastOrNull()?.structure ?: return callback.onSuccess(null)
        val fields = FieldCollector().collect(structure)
        val matches = payload.items.filterIsInstance<LoginItem>().filter { login ->
            fields.packageName != null && login.androidPackageNames.contains(fields.packageName) ||
                fields.webDomain != null && login.uris.any { uri -> runCatching { java.net.URI(uri).host.equals(fields.webDomain, true) }.getOrDefault(false) }
        }
        if (matches.isEmpty() || fields.password == null) return callback.onSuccess(null)
        val response = FillResponse.Builder()
        matches.forEach { login ->
            val presentation = RemoteViews(packageName, android.R.layout.simple_list_item_1).apply {
                setTextViewText(android.R.id.text1, login.title)
            }
            val dataset = Dataset.Builder(presentation)
            fields.username?.let { dataset.setValue(it, AutofillValue.forText(login.username), presentation) }
            dataset.setValue(fields.password, AutofillValue.forText(login.password), presentation)
            response.addDataset(dataset.build())
        }
        callback.onSuccess(response.build())
    }

    override fun onSaveRequest(request: SaveRequest, callback: SaveCallback) {
        callback.onSuccess()
    }
}

private data class DetectedFields(
    val username: AutofillId?,
    val password: AutofillId?,
    val webDomain: String?,
    val packageName: String?,
)

private class FieldCollector {
    private var username: AutofillId? = null
    private var password: AutofillId? = null
    private var webDomain: String? = null
    private var packageName: String? = null

    fun collect(structure: AssistStructure): DetectedFields {
        packageName = structure.activityComponent?.packageName
        repeat(structure.windowNodeCount) { visit(structure.getWindowNodeAt(it).rootViewNode) }
        return DetectedFields(username, password, webDomain, packageName)
    }

    private fun visit(node: AssistStructure.ViewNode) {
        webDomain = webDomain ?: node.webDomain
        val hints = node.autofillHints.orEmpty().map(String::lowercase)
        if (node.autofillType == View.AUTOFILL_TYPE_TEXT && node.autofillId != null) {
            if (hints.any { it.contains("password") }) password = password ?: node.autofillId
            if (hints.any { it.contains("username") || it.contains("email") }) username = username ?: node.autofillId
        }
        repeat(node.childCount) { visit(node.getChildAt(it)) }
    }
}
