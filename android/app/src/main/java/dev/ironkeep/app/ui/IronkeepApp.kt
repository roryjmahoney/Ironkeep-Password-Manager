package dev.ironkeep.app.ui

import android.content.Context
import android.content.ContextWrapper
import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Favorite
import androidx.compose.material.icons.outlined.FavoriteBorder
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material.icons.outlined.Save
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dev.ironkeep.app.vault.BiometricPurpose
import dev.ironkeep.app.vault.VaultUiState
import dev.ironkeep.app.vault.VaultViewModel
import dev.ironkeep.app.vault.model.LoginFields
import dev.ironkeep.app.vault.model.LoginItem
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.model.VaultMutations

@Composable
fun IronkeepApp(viewModel: VaultViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findFragmentActivity()
    val biometricPrompt = remember(activity, viewModel) {
        BiometricPrompt(
            activity,
            ContextCompat.getMainExecutor(activity),
            object : BiometricPrompt.AuthenticationCallback() {
                override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                    val cipher = result.cryptoObject?.cipher
                    if (cipher == null) viewModel.cancelBiometricAuthentication("Biometric authentication returned no cryptographic proof.")
                    else viewModel.completeBiometricAuthentication(cipher)
                }

                override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                    val cancelled = errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                        errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                        errorCode == BiometricPrompt.ERROR_CANCELED
                    viewModel.cancelBiometricAuthentication(if (cancelled) null else "Biometric authentication unavailable. Use the master password.")
                }
            },
        )
    }
    LaunchedEffect(viewModel, biometricPrompt) {
        viewModel.biometricRequests.collect { request ->
            val available = BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            if (available != BiometricManager.BIOMETRIC_SUCCESS) {
                viewModel.cancelBiometricAuthentication("A strong enrolled biometric is required. Use the master password.")
                return@collect
            }
            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle(if (request.purpose == BiometricPurpose.ENROLL) "Enable biometric unlock" else "Unlock Ironkeep")
                .setSubtitle(if (request.purpose == BiometricPurpose.ENROLL) "Confirm to protect the vault key on this device" else "Authenticate to decrypt your local vault")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setNegativeButtonText("Use master password")
                .build()
            biometricPrompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(request.cipher))
        }
    }
    LaunchedEffect(viewModel, biometricPrompt) {
        viewModel.biometricCancelRequests.collect { biometricPrompt.cancelAuthentication() }
    }
    AnimatedContent(
        targetState = state,
        transitionSpec = { fadeIn(spring(stiffness = 600f)) togetherWith fadeOut() },
        label = "vault state",
    ) { current ->
        when (current) {
            VaultUiState.Loading -> LoadingScreen()
            VaultUiState.Setup -> GateScreen(creating = true, error = null, onSubmit = viewModel::create)
            is VaultUiState.Locked -> GateScreen(
                creating = false,
                error = current.message,
                biometricEnrolled = current.biometricEnrolled,
                onSubmit = viewModel::unlock,
                onBiometricUnlock = viewModel::requestBiometricUnlock,
            )
            is VaultUiState.Error -> GateScreen(
                creating = current.creating,
                error = current.message,
                biometricEnrolled = current.biometricEnrolled,
                onSubmit = if (current.creating) viewModel::create else viewModel::unlock,
                onBiometricUnlock = viewModel::requestBiometricUnlock,
            )
            is VaultUiState.Unlocked -> VaultHome(
                vault = current.vault,
                error = current.error,
                notice = current.notice,
                biometricEnabled = current.biometricEnabled,
                onAdd = viewModel::addLogin,
                onEdit = viewModel::editLogin,
                onDelete = viewModel::deleteLogin,
                onToggleFavorite = viewModel::toggleLoginFavorite,
                onEnableBiometric = viewModel::requestBiometricEnrollment,
                onDisableBiometric = viewModel::disableBiometricUnlock,
                onUpdateSecuritySettings = viewModel::updateSecuritySettings,
                onCopyPassword = viewModel::copyPassword,
                onLock = viewModel::lock,
            )
        }
    }
}

@Composable
private fun LoadingScreen() = Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun GateScreen(
    creating: Boolean,
    error: String?,
    biometricEnrolled: Boolean = false,
    onSubmit: (CharArray) -> Unit,
    onBiometricUnlock: () -> Unit = {},
) {
    var password by remember(creating) { mutableStateOf("") }
    var confirmation by remember(creating) { mutableStateOf("") }
    var localError by remember { mutableStateOf<String?>(null) }
    fun submit() {
        localError = if (creating && password != confirmation) "Passwords do not match." else null
        if (localError == null) {
            val secret = password.toCharArray()
            password = ""
            confirmation = ""
            onSubmit(secret)
        }
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
        Column(
            Modifier.fillMaxSize().padding(insets).padding(horizontal = 24.dp, vertical = 20.dp),
            verticalArrangement = Arrangement.SpaceBetween,
        ) {
            Wordmark()
            Column(Modifier.fillMaxWidth().border(BorderStroke(1.dp, MaterialTheme.colorScheme.outline)).padding(20.dp)) {
                Text(if (creating) "ZERO KNOWLEDGE" else "LOCAL DECRYPTION", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                Spacer(Modifier.height(12.dp))
                Text(if (creating) "Forge your\nprivate keep." else "Open the\nkeep.", style = MaterialTheme.typography.displayLarge, modifier = Modifier.semantics { heading() })
                Spacer(Modifier.height(18.dp))
                Text(
                    if (creating) "No account required. Your master password never leaves this device." else "Decrypt locally. Nothing is sent to Ironkeep.",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
                Spacer(Modifier.height(28.dp))
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    modifier = Modifier.fillMaxWidth(),
                    label = { Text("Master password") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    shape = RectangleShape,
                    keyboardOptions = KeyboardOptions(imeAction = if (creating) ImeAction.Next else ImeAction.Done),
                    keyboardActions = KeyboardActions(onDone = { submit() }),
                )
                if (creating) {
                    Spacer(Modifier.height(12.dp))
                    OutlinedTextField(
                        value = confirmation,
                        onValueChange = { confirmation = it },
                        modifier = Modifier.fillMaxWidth(),
                        label = { Text("Confirm master password") },
                        visualTransformation = PasswordVisualTransformation(),
                        singleLine = true,
                        shape = RectangleShape,
                        keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
                        keyboardActions = KeyboardActions(onDone = { submit() }),
                    )
                }
                Text(localError ?: error.orEmpty(), color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodyMedium, modifier = Modifier.height(32.dp).padding(top = 8.dp))
                Button(
                    onClick = { submit() },
                    modifier = Modifier.fillMaxWidth().height(52.dp),
                    shape = RectangleShape,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.primary),
                ) {
                    Icon(Icons.Outlined.Lock, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text(if (creating) "Create encrypted vault" else "Unlock locally")
                }
                if (!creating && biometricEnrolled) {
                    TextButton(onClick = onBiometricUnlock, modifier = Modifier.align(Alignment.CenterHorizontally).height(48.dp)) {
                        Icon(Icons.Outlined.Fingerprint, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("Use biometric unlock")
                    }
                } else if (!creating) {
                    Text(
                        "Unlock once with your master password to enable biometrics on this device.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(top = 12.dp),
                    )
                }
            }
            Text("Offline by default · AES-256-GCM · Argon2id", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
    }
}

@Composable
private fun Wordmark() = Row(verticalAlignment = Alignment.CenterVertically) {
    Box(Modifier.size(40.dp).border(1.dp, MaterialTheme.colorScheme.primary), contentAlignment = Alignment.Center) {
        Icon(Icons.Outlined.Fingerprint, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
    }
    Spacer(Modifier.size(12.dp))
    Column {
        Text("Ironkeep", style = MaterialTheme.typography.titleLarge)
        Text("PRIVATE VAULT", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun VaultHome(
    vault: VaultPayload,
    error: String?,
    notice: String?,
    biometricEnabled: Boolean,
    onAdd: (LoginFields) -> Unit,
    onEdit: (String, LoginFields) -> Unit,
    onDelete: (String) -> Unit,
    onToggleFavorite: (String) -> Unit,
    onEnableBiometric: () -> Unit,
    onDisableBiometric: () -> Unit,
    onUpdateSecuritySettings: (Int, Int) -> Unit,
    onCopyPassword: (String) -> Unit,
    onLock: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var editingId by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<LoginItem?>(null) }
    var confirmDisableBiometric by remember { mutableStateOf(false) }
    var showSecuritySettings by remember { mutableStateOf(false) }
    val logins = vault.items.filterIsInstance<LoginItem>().filter {
        query.isBlank() || it.title.contains(query, true) || it.username.contains(query, true)
    }

    val editing = vault.items.filterIsInstance<LoginItem>().find { it.id == editingId }
    if (creating || editing != null) {
        LoginForm(
            vault = vault,
            item = editing,
            onCancel = { creating = false; editingId = null },
            onSave = { fields ->
                if (editing == null) onAdd(fields) else onEdit(editing.id, fields)
                creating = false
                editingId = null
            },
            onDelete = editing?.let { item -> { deleteTarget = item } },
            onCopyPassword = onCopyPassword,
        )
    } else {
    Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            Row(Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Wordmark()
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onLock) { Icon(Icons.Outlined.Lock, contentDescription = "Lock vault") }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Fingerprint, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text(if (biometricEnabled) "Biometric unlock enabled" else "Faster local unlock", style = MaterialTheme.typography.titleSmall)
                    Text(
                        if (biometricEnabled) "Protected by Android Keystore on this device." else "Require a strong biometric for every vault-key unwrap.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedButton(
                    onClick = { if (biometricEnabled) confirmDisableBiometric = true else onEnableBiometric() },
                    shape = RectangleShape,
                    modifier = Modifier.height(48.dp),
                ) { Text(if (biometricEnabled) "Disable" else "Enable") }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            Row(
                Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Icon(Icons.Outlined.Timer, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                    Text("Session safety", style = MaterialTheme.typography.titleSmall)
                    Text(
                        "Auto-lock ${vault.settings.autoLockMinutes} min · Clipboard ${vault.settings.clearClipboardSeconds} sec",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
                OutlinedButton(
                    onClick = { showSecuritySettings = true },
                    shape = RectangleShape,
                    modifier = Modifier.height(48.dp),
                ) { Text("Change") }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            OutlinedTextField(
                value = query,
                onValueChange = { query = it },
                modifier = Modifier.fillMaxWidth().padding(16.dp),
                leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                placeholder = { Text("Search passwords, notes, cards…") },
                singleLine = true,
                shape = RectangleShape,
            )
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            if (notice != null) Text(notice, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            if (vault.items.filterIsInstance<LoginItem>().isEmpty()) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    Icon(Icons.Outlined.Key, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 40.dp).size(34.dp))
                    Text("Nothing in this drawer.", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.padding(top = 16.dp).semantics { heading() })
                    Text("Add the first login to this encrypted vault.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    OutlinedButton(onClick = { creating = true }, shape = RectangleShape, modifier = Modifier.padding(vertical = 24.dp).height(48.dp)) {
                        Icon(Icons.Outlined.Add, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("Add first login")
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
            } else {
                Row(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalAlignment = Alignment.CenterVertically) {
                    Text("LOGINS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                    Spacer(Modifier.weight(1f))
                    Button(onClick = { creating = true }, shape = RectangleShape, modifier = Modifier.height(48.dp)) {
                        Icon(Icons.Outlined.Add, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("Add login")
                    }
                }
                LazyColumn(Modifier.weight(1f)) {
                    items(logins, key = { it.id }) { login ->
                        Row(
                            Modifier.fillMaxWidth().clickable { editingId = login.id }.padding(horizontal = 20.dp, vertical = 12.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            Box(Modifier.size(48.dp).border(1.dp, MaterialTheme.colorScheme.outline), contentAlignment = Alignment.Center) {
                                Icon(Icons.Outlined.Key, contentDescription = null, tint = MaterialTheme.colorScheme.primary)
                            }
                            Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                Text(login.title, style = MaterialTheme.typography.titleMedium)
                                Text(login.username.ifBlank { login.uris.firstOrNull() ?: "Login" }, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            }
                            IconButton(onClick = { onToggleFavorite(login.id) }, modifier = Modifier.size(48.dp)) {
                                Icon(if (login.favorite) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, contentDescription = if (login.favorite) "Remove ${login.title} from favorites" else "Add ${login.title} to favorites")
                            }
                        }
                        HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    }
                }
            }
        }
    }
    }

    deleteTarget?.let { item ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Delete ${item.title}?") },
            text = { Text("The login will be removed and a deletion tombstone will be encrypted into the vault.") },
            confirmButton = {
                Button(
                    onClick = { onDelete(item.id); deleteTarget = null; creating = false; editingId = null },
                    shape = RectangleShape,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                ) {
                    Icon(Icons.Outlined.Delete, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Delete login")
                }
            },
            dismissButton = { TextButton(onClick = { deleteTarget = null }) { Text("Cancel") } },
        )
    }
    if (confirmDisableBiometric) {
        AlertDialog(
            onDismissRequest = { confirmDisableBiometric = false },
            title = { Text("Disable biometric unlock?") },
            text = { Text("Your vault remains encrypted. You will need the master password the next time you unlock it.") },
            confirmButton = {
                Button(
                    onClick = { confirmDisableBiometric = false; onDisableBiometric() },
                    shape = RectangleShape,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                ) { Text("Disable") }
            },
            dismissButton = { TextButton(onClick = { confirmDisableBiometric = false }) { Text("Keep enabled") } },
        )
    }
    if (showSecuritySettings) {
        SecuritySettingsDialog(
            currentAutoLockMinutes = vault.settings.autoLockMinutes,
            currentClipboardSeconds = vault.settings.clearClipboardSeconds,
            onDismiss = { showSecuritySettings = false },
            onSave = { autoLockMinutes, clipboardSeconds ->
                showSecuritySettings = false
                onUpdateSecuritySettings(autoLockMinutes, clipboardSeconds)
            },
        )
    }
}

@Composable
private fun SecuritySettingsDialog(
    currentAutoLockMinutes: Int,
    currentClipboardSeconds: Int,
    onDismiss: () -> Unit,
    onSave: (Int, Int) -> Unit,
) {
    var autoLockMinutes by remember(currentAutoLockMinutes) { mutableStateOf(currentAutoLockMinutes) }
    var clipboardSeconds by remember(currentClipboardSeconds) { mutableStateOf(currentClipboardSeconds) }
    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Session safety") },
        text = {
            Column(Modifier.verticalScroll(rememberScrollState())) {
                Text("Auto-lock after inactivity", style = MaterialTheme.typography.titleSmall)
                listOf(1, 5, 15, 30, 60).forEach { minutes ->
                    Row(
                        Modifier.fillMaxWidth().height(48.dp).selectable(
                            selected = autoLockMinutes == minutes,
                            onClick = { autoLockMinutes = minutes },
                            role = Role.RadioButton,
                        ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = autoLockMinutes == minutes, onClick = null)
                        Text("$minutes ${if (minutes == 1) "minute" else "minutes"}", modifier = Modifier.padding(start = 8.dp))
                    }
                }
                Text("Clear an Ironkeep-owned clipboard", style = MaterialTheme.typography.titleSmall, modifier = Modifier.padding(top = 16.dp))
                listOf(15, 30, 60, 120).forEach { seconds ->
                    Row(
                        Modifier.fillMaxWidth().height(48.dp).selectable(
                            selected = clipboardSeconds == seconds,
                            onClick = { clipboardSeconds = seconds },
                            role = Role.RadioButton,
                        ),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(selected = clipboardSeconds == seconds, onClick = null)
                        Text("$seconds seconds", modifier = Modifier.padding(start = 8.dp))
                    }
                }
                Text(
                    "Ironkeep only clears clipboard content it still owns. Clipboard managers may retain history.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 12.dp),
                )
            }
        },
        confirmButton = { Button(onClick = { onSave(autoLockMinutes, clipboardSeconds) }, shape = RectangleShape) { Text("Save settings") } },
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } },
    )
}

private tailrec fun Context.findFragmentActivity(): FragmentActivity = when (this) {
    is FragmentActivity -> this
    is ContextWrapper -> baseContext.findFragmentActivity()
    else -> error("Ironkeep requires a FragmentActivity context")
}

@Composable
private fun LoginForm(
    vault: VaultPayload,
    item: LoginItem?,
    onCancel: () -> Unit,
    onSave: (LoginFields) -> Unit,
    onDelete: (() -> Unit)?,
    onCopyPassword: (String) -> Unit,
) {
    var title by remember(item?.id) { mutableStateOf(item?.title.orEmpty()) }
    var username by remember(item?.id) { mutableStateOf(item?.username.orEmpty()) }
    var password by remember(item?.id) { mutableStateOf(item?.password.orEmpty()) }
    var uris by remember(item?.id) { mutableStateOf(item?.uris?.joinToString("\n").orEmpty()) }
    var packages by remember(item?.id) { mutableStateOf(item?.androidPackageNames?.joinToString("\n").orEmpty()) }
    var localError by remember { mutableStateOf<String?>(null) }
    var duplicateFields by remember { mutableStateOf<LoginFields?>(null) }
    var copyNotice by remember(item?.id) { mutableStateOf<String?>(null) }

    fun fields() = LoginFields(title, username, password, uris.lines(), packages.lines())
    fun submit() {
        val values = fields()
        if (values.title.isBlank() || values.password.isEmpty()) {
            localError = "Title and password are required."
            return
        }
        val duplicates = VaultMutations.likelyDuplicates(vault, values, item?.id)
        if (duplicates.isNotEmpty()) duplicateFields = values else onSave(values)
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(20.dp)) {
            Text("LOGIN RECORD", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Text(if (item == null) "Add login" else "Edit login", style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
            Spacer(Modifier.height(24.dp))
            OutlinedTextField(title, { title = it }, Modifier.fillMaxWidth(), label = { Text("Title") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(username, { username = it }, Modifier.fillMaxWidth(), label = { Text("Username, email, or phone") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(
                password,
                { password = it; copyNotice = null },
                Modifier.fillMaxWidth(),
                label = { Text("Password") },
                visualTransformation = PasswordVisualTransformation(),
                singleLine = true,
                shape = RectangleShape,
                trailingIcon = {
                    if (password.isNotEmpty()) {
                        IconButton(onClick = {
                            onCopyPassword(password)
                            copyNotice = "Copied. Clears in ${vault.settings.clearClipboardSeconds} seconds."
                        }) {
                            Icon(Icons.Outlined.ContentCopy, contentDescription = "Copy password")
                        }
                    }
                },
            )
            if (copyNotice != null) {
                Text(copyNotice.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 8.dp))
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(uris, { uris = it }, Modifier.fillMaxWidth(), label = { Text("Website URIs · one per line") }, minLines = 2, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(packages, { packages = it }, Modifier.fillMaxWidth(), label = { Text("Android packages · one per line") }, minLines = 2, shape = RectangleShape)
            Text(localError.orEmpty(), color = MaterialTheme.colorScheme.error, modifier = Modifier.height(36.dp).padding(top = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = ::submit, shape = RectangleShape, modifier = Modifier.height(48.dp)) {
                    Icon(Icons.Outlined.Save, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Save encrypted")
                }
                OutlinedButton(onClick = onCancel, shape = RectangleShape, modifier = Modifier.height(48.dp)) { Text("Cancel") }
            }
            if (onDelete != null) {
                TextButton(
                    onClick = onDelete,
                    modifier = Modifier.padding(top = 16.dp).height(48.dp),
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                ) {
                    Icon(Icons.Outlined.Delete, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Delete login")
                }
            }
        }
    }

    duplicateFields?.let { values ->
        AlertDialog(
            onDismissRequest = { duplicateFields = null },
            title = { Text("Likely duplicate login") },
            text = { Text("A login with this identifier and website or app already exists. Save another login anyway?") },
            confirmButton = { Button(onClick = { duplicateFields = null; onSave(values) }, shape = RectangleShape) { Text("Save anyway") } },
            dismissButton = { TextButton(onClick = { duplicateFields = null }) { Text("Review fields") } },
        )
    }
}
