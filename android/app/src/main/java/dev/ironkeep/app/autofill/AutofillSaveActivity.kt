package dev.ironkeep.app.autofill

import android.content.Intent
import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import dev.ironkeep.app.ui.theme.IronkeepTheme
import dev.ironkeep.app.MainActivity
import dev.ironkeep.app.vault.model.LoginItem
import dev.ironkeep.app.vault.model.CreditCardItem
import dev.ironkeep.app.vault.model.VaultMutations
import dev.ironkeep.app.vault.session.DeviceIdProvider
import dev.ironkeep.app.vault.session.VaultMutationCoordinator
import dev.ironkeep.app.vault.session.VaultMutationResult
import dev.ironkeep.app.vault.session.VaultSessionHolder
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class AutofillSaveActivity : FragmentActivity() {
    private val mutationCoordinator by lazy { VaultMutationCoordinator(this) }
    private val deviceIdProvider by lazy { DeviceIdProvider(this) }
    private lateinit var pendingToken: String
    private lateinit var unlockController: AutofillBiometricUnlockController
    private var completed = false
    private var unlockedForSave = false
    private var unlockMessage by mutableStateOf<String?>(null)

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        pendingToken = intent.getStringExtra(EXTRA_PENDING_TOKEN).orEmpty()
        if (pendingToken.isBlank()) {
            finish()
            return
        }
        unlockController = AutofillBiometricUnlockController(
            activity = this,
            onUnlocked = {
                unlockedForSave = true
                unlockMessage = "Vault unlocked. Choose how to save this item."
            },
            onMessage = { unlockMessage = it },
        )
        enableEdgeToEdge()
        setContent {
            IronkeepTheme {
                val summary = AutofillPendingSaveStore.summary(pendingToken)
                val candidate = AutofillPendingSaveStore.candidate(pendingToken)
                val session = VaultSessionHolder.sessionOrNull()
                val choices = if (candidate != null && session?.payload?.vaultId == candidate.vaultId) {
                    when (candidate) {
                        is AutofillCredentialCandidate -> AutofillSavePlanner.matchingLogins(session.payload, candidate)
                            .map { SaveChoice(it.id, it.title, it.username.ifBlank { "no username" }) }
                        is AutofillCreditCardCandidate -> AutofillCreditCardSavePlanner.matchingCards(session.payload, candidate)
                            .map { SaveChoice(it.id, it.title, "•••• ${it.number.takeLast(4)}") }
                    }
                } else emptyList()
                AutofillSaveScreen(
                    summary = summary,
                    choices = choices,
                    vaultAvailable = candidate != null && session?.payload?.vaultId == candidate.vaultId,
                    unlockMessage = unlockMessage,
                    onUnlock = unlockController::start,
                    onOpenIronkeep = {
                        AutofillPendingSaveStore.discard(pendingToken)
                        completed = true
                        startActivity(Intent(this@AutofillSaveActivity, MainActivity::class.java))
                        finish()
                    },
                    onSaveNew = { save(null) },
                    onUpdate = { itemId -> save(itemId) },
                    onNotNow = {
                        AutofillPendingSaveStore.discard(pendingToken)
                        completed = true
                        finish()
                    },
                    onFinished = {
                        completed = true
                        finish()
                    },
                )
            }
        }
        if (VaultSessionHolder.sessionOrNull() == null) unlockController.start()
    }

    override fun onStop() {
        if (unlockedForSave) VaultSessionHolder.lock()
        super.onStop()
    }

    override fun onDestroy() {
        if (::unlockController.isInitialized) unlockController.cancel()
        if (isFinishing && !completed) AutofillPendingSaveStore.discard(pendingToken)
        if (unlockedForSave) VaultSessionHolder.lock()
        super.onDestroy()
    }

    private suspend fun save(updateItemId: String?): String? {
        val candidate = AutofillPendingSaveStore.candidate(pendingToken) ?: return "This save request expired. Submit the form again."
        val session = VaultSessionHolder.sessionOrNull()
        if (session == null || session.payload.vaultId != candidate.vaultId) {
            return "Ironkeep locked before the item was saved. Unlock with your fingerprint and try again."
        }
        val unchanged = when (candidate) {
            is AutofillCredentialCandidate -> AutofillSavePlanner.isUnchanged(session.payload, candidate)
            is AutofillCreditCardCandidate -> AutofillCreditCardSavePlanner.isUnchanged(session.payload, candidate)
        }
        if (unchanged) {
            AutofillPendingSaveStore.discard(pendingToken)
            return null
        }
        val result = mutationCoordinator.mutate { payload ->
            when (candidate) {
                is AutofillCredentialCandidate -> if (updateItemId == null) {
                    VaultMutations.addLogin(payload, AutofillSavePlanner.createFields(candidate), deviceIdProvider.id())
                } else {
                    val existing = payload.items.filterIsInstance<LoginItem>().find { it.id == updateItemId }
                        ?: throw NoSuchElementException("Login not found")
                    VaultMutations.editLogin(payload, existing.id, AutofillSavePlanner.updateFields(candidate, existing), deviceIdProvider.id())
                }
                is AutofillCreditCardCandidate -> if (updateItemId == null) {
                    VaultMutations.addCreditCard(payload, AutofillCreditCardSavePlanner.createFields(candidate), deviceIdProvider.id())
                } else {
                    val existing = payload.items.filterIsInstance<CreditCardItem>().find { it.id == updateItemId }
                        ?: throw NoSuchElementException("Credit card not found")
                    VaultMutations.editCreditCard(payload, existing.id, AutofillCreditCardSavePlanner.updateFields(candidate, existing), deviceIdProvider.id())
                }
            }
        }
        return when (result) {
            is VaultMutationResult.Success -> {
                AutofillPendingSaveStore.discard(pendingToken)
                null
            }

            VaultMutationResult.Locked -> {
                "Ironkeep locked before the item was saved. Unlock with your fingerprint and try again."
            }

            VaultMutationResult.Failed -> "The encrypted vault could not be updated. Your previous vault is intact; try again."
        }
    }

    companion object {
        const val EXTRA_PENDING_TOKEN = "dev.ironkeep.app.autofill.PENDING_TOKEN"
    }
}

private data class SaveChoice(val id: String, val title: String, val subtitle: String)

@Composable
private fun AutofillSaveScreen(
    summary: AutofillCandidateSummary?,
    choices: List<SaveChoice>,
    vaultAvailable: Boolean,
    unlockMessage: String?,
    onUnlock: () -> Unit,
    onOpenIronkeep: () -> Unit,
    onSaveNew: suspend () -> String?,
    onUpdate: suspend (String) -> String?,
    onNotNow: () -> Unit,
    onFinished: () -> Unit,
) {
    val scope = rememberCoroutineScope()
    var saving by remember { mutableStateOf(false) }
    var error by remember { mutableStateOf<String?>(null) }
    var saved by remember { mutableStateOf(false) }
    var confirmDuplicate by remember { mutableStateOf(false) }

    fun runSave(action: suspend () -> String?) {
        if (saving) return
        saving = true
        error = null
        scope.launch {
            val failure = action()
            saving = false
            if (failure == null) {
                saved = true
                delay(650)
                onFinished()
            } else error = failure
        }
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
        Column(
            Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(24.dp),
            verticalArrangement = Arrangement.Center,
        ) {
            Text("AUTOFILL CONFIRMATION", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Text(
                if (saved) "${summary?.kind?.replaceFirstChar(Char::uppercase)} saved." else "Save this ${summary?.kind ?: "item"}?",
                style = MaterialTheme.typography.headlineLarge,
                modifier = Modifier.padding(top = 8.dp).semantics { heading() },
            )
            Text(
                "Choose exactly what Ironkeep should do. Sensitive values stay hidden and are never placed in this screen or Intent.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(top = 8.dp, bottom = 24.dp),
            )

            if (summary != null) {
                DetailRow(Icons.Outlined.Security, "Verified target", summary.target)
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                DetailRow(Icons.Outlined.Description, "Proposed title", summary.title)
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                DetailRow(if (summary.kind == "payment card") Icons.Outlined.CreditCard else Icons.Outlined.Person, summary.primaryLabel, summary.primaryValue.ifBlank { "Not detected" })
                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                DetailRow(Icons.Outlined.Key, "Sensitive values", "Hidden until encrypted save")
            }

            if (!vaultAvailable) {
                Text(
                    error ?: unlockMessage ?: "Ironkeep is locked. Unlock it to review this item before saving.",
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(top = 20.dp),
                )
                if (summary != null) {
                    Button(
                        onClick = onUnlock,
                        shape = RectangleShape,
                        modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 8.dp),
                    ) { Text("Unlock with fingerprint") }
                    OutlinedButton(
                        onClick = onOpenIronkeep,
                        shape = RectangleShape,
                        modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 8.dp),
                    ) { Text("Open Ironkeep instead") }
                }
            } else if (!saved) {
                if (choices.isNotEmpty()) {
                    Text("UPDATE AN EXISTING ${summary?.kind?.uppercase() ?: "ITEM"}", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 24.dp, bottom = 8.dp))
                    choices.forEach { choice ->
                        OutlinedButton(
                            onClick = { runSave { onUpdate(choice.id) } },
                            enabled = !saving,
                            shape = RectangleShape,
                            modifier = Modifier.fillMaxWidth().height(52.dp).padding(bottom = 4.dp),
                        ) {
                            Text("Update ${choice.title} — ${choice.subtitle}")
                        }
                    }
                }
                Button(
                    onClick = { if (choices.isEmpty()) runSave(onSaveNew) else confirmDuplicate = true },
                    enabled = !saving,
                    shape = RectangleShape,
                    modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 8.dp),
                ) {
                    if (saving) CircularProgressIndicator(Modifier.size(20.dp), strokeWidth = 2.dp)
                    else Text("Save as new ${summary?.kind ?: "item"}")
                }
                TextButton(onClick = onNotNow, enabled = !saving, modifier = Modifier.align(Alignment.CenterHorizontally).height(48.dp)) {
                    Text("Not now")
                }
                if (error != null) Text(error.orEmpty(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium)
            }
        }
    }

    if (confirmDuplicate) {
        AlertDialog(
            onDismissRequest = { confirmDuplicate = false },
            title = { Text("Save another ${summary?.kind ?: "item"}?") },
            text = { Text("Ironkeep already has a likely match. Saving as new will not overwrite it.") },
            confirmButton = {
                Button(
                    onClick = { confirmDuplicate = false; runSave(onSaveNew) },
                    shape = RectangleShape,
                ) { Text("Save another") }
            },
            dismissButton = { TextButton(onClick = { confirmDuplicate = false }) { Text("Choose existing") } },
        )
    }
}

@Composable
private fun DetailRow(icon: androidx.compose.ui.graphics.vector.ImageVector, label: String, value: String) {
    Row(
        Modifier.fillMaxWidth().border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)).padding(16.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Icon(icon, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
        Spacer(Modifier.size(12.dp))
        Column(Modifier.weight(1f)) {
            Text(label, style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            Text(value, style = MaterialTheme.typography.titleSmall)
        }
    }
}
