package dev.ironkeep.app.ui

import android.content.Context
import android.content.ContextWrapper
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
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
import androidx.compose.material.icons.outlined.Settings
import androidx.compose.material.icons.outlined.Delete
import androidx.compose.material.icons.outlined.ContentCopy
import androidx.compose.material.icons.outlined.CreditCard
import androidx.compose.material.icons.outlined.Description
import androidx.compose.material.icons.outlined.Person
import androidx.compose.material.icons.outlined.Timer
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
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
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import dev.ironkeep.app.vault.BiometricPurpose
import dev.ironkeep.app.vault.BackupUiState
import dev.ironkeep.app.vault.VaultUiState
import dev.ironkeep.app.vault.VaultViewModel
import dev.ironkeep.app.vault.model.LoginFields
import dev.ironkeep.app.vault.model.LoginItem
import dev.ironkeep.app.vault.model.CreditCardFields
import dev.ironkeep.app.vault.model.CreditCardItem
import dev.ironkeep.app.vault.model.IdentityFields
import dev.ironkeep.app.vault.model.IdentityItem
import dev.ironkeep.app.vault.model.SecureNoteFields
import dev.ironkeep.app.vault.model.SecureNoteItem
import dev.ironkeep.app.vault.model.VaultItem
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.model.VaultMutations

@Composable
fun IronkeepApp(viewModel: VaultViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val backupState by viewModel.backupState.collectAsStateWithLifecycle()
    val activity = LocalContext.current.findFragmentActivity()
    val createBackup = rememberLauncherForActivityResult(ActivityResultContracts.CreateDocument("application/vnd.ironkeep.vault")) { uri ->
        if (uri != null) viewModel.exportSnapshot(uri)
    }
    val openBackup = rememberLauncherForActivityResult(ActivityResultContracts.OpenDocument()) { uri ->
        if (uri != null) viewModel.loadRestore(uri)
    }
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
                onAddSecureNote = viewModel::addSecureNote,
                onEditSecureNote = viewModel::editSecureNote,
                onDeleteSecureNote = viewModel::deleteSecureNote,
                onToggleSecureNoteFavorite = viewModel::toggleSecureNoteFavorite,
                onAddCreditCard = viewModel::addCreditCard,
                onEditCreditCard = viewModel::editCreditCard,
                onDeleteCreditCard = viewModel::deleteCreditCard,
                onToggleCreditCardFavorite = viewModel::toggleCreditCardFavorite,
                onAddIdentity = viewModel::addIdentity,
                onEditIdentity = viewModel::editIdentity,
                onDeleteIdentity = viewModel::deleteIdentity,
                onToggleIdentityFavorite = viewModel::toggleIdentityFavorite,
                onEnableBiometric = viewModel::requestBiometricEnrollment,
                onDisableBiometric = viewModel::disableBiometricUnlock,
                onUpdateSecuritySettings = viewModel::updateSecuritySettings,
                backupState = backupState,
                onCreateBackup = { createBackup.launch("ironkeep-backup-${current.vault.revision}.ikv") },
                onChooseRestore = { openBackup.launch(arrayOf("application/vnd.ironkeep.vault", "application/json", "application/octet-stream")) },
                onAuthenticateRestore = viewModel::authenticateRestore,
                onConfirmRestore = viewModel::confirmRestore,
                onCancelRestore = viewModel::cancelRestore,
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

private enum class VaultDestination { VAULT, SETTINGS }

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
    onAddSecureNote: (SecureNoteFields) -> Unit,
    onEditSecureNote: (String, SecureNoteFields) -> Unit,
    onDeleteSecureNote: (String) -> Unit,
    onToggleSecureNoteFavorite: (String) -> Unit,
    onAddCreditCard: (CreditCardFields) -> Unit,
    onEditCreditCard: (String, CreditCardFields) -> Unit,
    onDeleteCreditCard: (String) -> Unit,
    onToggleCreditCardFavorite: (String) -> Unit,
    onAddIdentity: (IdentityFields) -> Unit,
    onEditIdentity: (String, IdentityFields) -> Unit,
    onDeleteIdentity: (String) -> Unit,
    onToggleIdentityFavorite: (String) -> Unit,
    onEnableBiometric: () -> Unit,
    onDisableBiometric: () -> Unit,
    onUpdateSecuritySettings: (Int, Int) -> Unit,
    backupState: BackupUiState,
    onCreateBackup: () -> Unit,
    onChooseRestore: () -> Unit,
    onAuthenticateRestore: (CharArray) -> Unit,
    onConfirmRestore: () -> Unit,
    onCancelRestore: () -> Unit,
    onCopyPassword: (String) -> Unit,
    onLock: () -> Unit,
) {
    var query by remember { mutableStateOf("") }
    var editingId by remember { mutableStateOf<String?>(null) }
    var creating by remember { mutableStateOf(false) }
    var editingNoteId by remember { mutableStateOf<String?>(null) }
    var creatingNote by remember { mutableStateOf(false) }
    var editingCardId by remember { mutableStateOf<String?>(null) }
    var creatingCard by remember { mutableStateOf(false) }
    var editingIdentityId by remember { mutableStateOf<String?>(null) }
    var creatingIdentity by remember { mutableStateOf(false) }
    var deleteTarget by remember { mutableStateOf<VaultItem?>(null) }
    var confirmDisableBiometric by remember { mutableStateOf(false) }
    var showSecuritySettings by remember { mutableStateOf(false) }
    var destination by remember { mutableStateOf(VaultDestination.VAULT) }
    val logins = vault.items.filterIsInstance<LoginItem>().filter {
        query.isBlank() || it.title.contains(query, true) || it.username.contains(query, true)
    }
    val notes = vault.items.filterIsInstance<SecureNoteItem>().filter {
        query.isBlank() || it.title.contains(query, true) || it.body.contains(query, true)
    }
    val cards = vault.items.filterIsInstance<CreditCardItem>().filter {
        query.isBlank() || it.title.contains(query, true) || it.cardholderName.contains(query, true) || it.number.contains(query)
    }
    val identities = vault.items.filterIsInstance<IdentityItem>().filter {
        query.isBlank() || listOf(it.title, it.firstName, it.middleName, it.lastName, it.email, it.phone, it.company, it.city, it.country).any { value -> value.contains(query, true) }
    }
    val visibleItems: List<VaultItem> = (logins + notes + cards + identities).sortedWith(compareByDescending<VaultItem> { it.favorite }.thenBy { it.title.lowercase() })

    val editing = vault.items.filterIsInstance<LoginItem>().find { it.id == editingId }
    val editingNote = vault.items.filterIsInstance<SecureNoteItem>().find { it.id == editingNoteId }
    val editingCard = vault.items.filterIsInstance<CreditCardItem>().find { it.id == editingCardId }
    val editingIdentity = vault.items.filterIsInstance<IdentityItem>().find { it.id == editingIdentityId }
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
    } else if (creatingNote || editingNote != null) {
        SecureNoteForm(
            vault = vault,
            item = editingNote,
            onCancel = { creatingNote = false; editingNoteId = null },
            onSave = { fields ->
                if (editingNote == null) onAddSecureNote(fields) else onEditSecureNote(editingNote.id, fields)
                creatingNote = false
                editingNoteId = null
            },
            onDelete = editingNote?.let { item -> { deleteTarget = item } },
        )
    } else if (creatingCard || editingCard != null) {
        CreditCardForm(
            vault = vault,
            item = editingCard,
            onCancel = { creatingCard = false; editingCardId = null },
            onSave = { fields ->
                if (editingCard == null) onAddCreditCard(fields) else onEditCreditCard(editingCard.id, fields)
                creatingCard = false
                editingCardId = null
            },
            onDelete = editingCard?.let { item -> { deleteTarget = item } },
        )
    } else if (creatingIdentity || editingIdentity != null) {
        IdentityForm(
            vault = vault,
            item = editingIdentity,
            onCancel = { creatingIdentity = false; editingIdentityId = null },
            onSave = { fields ->
                if (editingIdentity == null) onAddIdentity(fields) else onEditIdentity(editingIdentity.id, fields)
                creatingIdentity = false
                editingIdentityId = null
            },
            onDelete = editingIdentity?.let { item -> { deleteTarget = item } },
        )
    } else {
    Scaffold(
        containerColor = MaterialTheme.colorScheme.background,
        bottomBar = {
            NavigationBar(containerColor = MaterialTheme.colorScheme.background) {
                NavigationBarItem(
                    selected = destination == VaultDestination.VAULT,
                    onClick = { destination = VaultDestination.VAULT },
                    icon = { Icon(Icons.Outlined.Key, contentDescription = null) },
                    label = { Text("Vault") },
                )
                NavigationBarItem(
                    selected = destination == VaultDestination.SETTINGS,
                    onClick = { destination = VaultDestination.SETTINGS },
                    icon = { Icon(Icons.Outlined.Settings, contentDescription = null) },
                    label = { Text("Settings") },
                )
            }
        },
    ) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            Row(Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Wordmark()
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onLock) { Icon(Icons.Outlined.Lock, contentDescription = "Lock vault") }
            }
            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
            if (error != null) Text(error, color = MaterialTheme.colorScheme.error, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            if (notice != null) Text(notice, color = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp))
            when (destination) {
                VaultDestination.VAULT -> {
                    OutlinedTextField(
                        value = query,
                        onValueChange = { query = it },
                        modifier = Modifier.fillMaxWidth().padding(16.dp),
                        leadingIcon = { Icon(Icons.Outlined.Search, contentDescription = null) },
                        placeholder = { Text("Search passwords, notes, cards…") },
                        singleLine = true,
                        shape = RectangleShape,
                    )
                    if (vault.items.none { it is LoginItem || it is SecureNoteItem || it is CreditCardItem || it is IdentityItem }) {
                        Column(
                            Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 40.dp),
                            horizontalAlignment = Alignment.CenterHorizontally,
                        ) {
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            Icon(Icons.Outlined.Key, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 40.dp).size(34.dp))
                            Text("Nothing in this drawer.", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.padding(top = 16.dp).semantics { heading() })
                            Text("Add the first login, secure note, payment card, or identity to this encrypted vault.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                            Column(Modifier.fillMaxWidth().padding(vertical = 24.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { creating = true }, shape = RectangleShape, modifier = Modifier.weight(1f).height(48.dp)) {
                                    Icon(Icons.Outlined.Add, contentDescription = null)
                                    Spacer(Modifier.size(8.dp))
                                    Text("Login")
                                }
                                OutlinedButton(onClick = { creatingNote = true }, shape = RectangleShape, modifier = Modifier.weight(1f).height(48.dp)) {
                                    Icon(Icons.Outlined.Description, contentDescription = null)
                                    Spacer(Modifier.size(8.dp))
                                    Text("Note")
                                }
                                }
                                Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                OutlinedButton(onClick = { creatingCard = true }, shape = RectangleShape, modifier = Modifier.weight(1f).height(48.dp)) {
                                    Icon(Icons.Outlined.CreditCard, contentDescription = null)
                                    Spacer(Modifier.size(8.dp))
                                    Text("Card")
                                }
                                OutlinedButton(onClick = { creatingIdentity = true }, shape = RectangleShape, modifier = Modifier.weight(1f).height(48.dp)) {
                                    Icon(Icons.Outlined.Person, contentDescription = null)
                                    Spacer(Modifier.size(8.dp))
                                    Text("Identity")
                                }
                                }
                            }
                            HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                        }
                    } else {
                        Column(Modifier.fillMaxWidth().padding(horizontal = 16.dp, vertical = 4.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
                            Text("VAULT ITEMS", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                            Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            Button(onClick = { creating = true }, shape = RectangleShape, modifier = Modifier.weight(1f).height(48.dp)) {
                                Icon(Icons.Outlined.Add, contentDescription = null)
                                Spacer(Modifier.size(6.dp))
                                Text("Login")
                            }
                            OutlinedButton(onClick = { creatingNote = true }, shape = RectangleShape, modifier = Modifier.weight(1f).height(48.dp)) {
                                Icon(Icons.Outlined.Description, contentDescription = null)
                                Spacer(Modifier.size(6.dp))
                                Text("Note")
                            }
                            OutlinedButton(onClick = { creatingCard = true }, shape = RectangleShape, modifier = Modifier.weight(1f).height(48.dp)) {
                                Icon(Icons.Outlined.CreditCard, contentDescription = null)
                                Spacer(Modifier.size(6.dp))
                                Text("Card")
                            }
                            OutlinedButton(onClick = { creatingIdentity = true }, shape = RectangleShape, modifier = Modifier.weight(1f).height(48.dp)) {
                                Icon(Icons.Outlined.Person, contentDescription = null)
                                Spacer(Modifier.size(6.dp))
                                Text("ID")
                            }
                            }
                        }
                        LazyColumn(Modifier.weight(1f)) {
                            items(visibleItems, key = { it.id }) { item ->
                                Row(
                                    Modifier.fillMaxWidth().clickable {
                                        when (item) {
                                            is LoginItem -> editingId = item.id
                                            is SecureNoteItem -> editingNoteId = item.id
                                            is CreditCardItem -> editingCardId = item.id
                                            is IdentityItem -> editingIdentityId = item.id
                                        }
                                    }.padding(horizontal = 20.dp, vertical = 12.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                ) {
                                    Box(Modifier.size(48.dp).border(1.dp, MaterialTheme.colorScheme.outline), contentAlignment = Alignment.Center) {
                                        Icon(
                                            when (item) {
                                                is LoginItem -> Icons.Outlined.Key
                                                is CreditCardItem -> Icons.Outlined.CreditCard
                                                is IdentityItem -> Icons.Outlined.Person
                                                else -> Icons.Outlined.Description
                                            },
                                            contentDescription = null,
                                            tint = MaterialTheme.colorScheme.primary,
                                        )
                                    }
                                    Column(Modifier.weight(1f).padding(horizontal = 12.dp)) {
                                        Text(item.title, style = MaterialTheme.typography.titleMedium)
                                        Text(
                                            when (item) {
                                                is LoginItem -> item.username.ifBlank { item.uris.firstOrNull() ?: "Login" }
                                                is SecureNoteItem -> "Secure note"
                                                is CreditCardItem -> "•••• ${item.number.takeLast(4)} · ${item.expiryMonth.toString().padStart(2, '0')}/${item.expiryYear}"
                                                is IdentityItem -> item.email.ifBlank { listOf(item.firstName, item.lastName).filter(String::isNotBlank).joinToString(" ").ifBlank { "Identity" } }
                                            },
                                            style = MaterialTheme.typography.bodySmall,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                    IconButton(onClick = {
                                        when (item) {
                                            is LoginItem -> onToggleFavorite(item.id)
                                            is SecureNoteItem -> onToggleSecureNoteFavorite(item.id)
                                            is CreditCardItem -> onToggleCreditCardFavorite(item.id)
                                            is IdentityItem -> onToggleIdentityFavorite(item.id)
                                        }
                                    }, modifier = Modifier.size(48.dp)) {
                                        Icon(if (item.favorite) Icons.Outlined.Favorite else Icons.Outlined.FavoriteBorder, contentDescription = if (item.favorite) "Remove ${item.title} from favorites" else "Add ${item.title} to favorites")
                                    }
                                }
                                HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                            }
                        }
                    }
                }

                VaultDestination.SETTINGS -> Column(Modifier.weight(1f).verticalScroll(rememberScrollState())) {
                    Text(
                        "SETTINGS",
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(start = 20.dp, top = 24.dp),
                    )
                    Text(
                        "Security & privacy",
                        style = MaterialTheme.typography.headlineLarge,
                        modifier = Modifier.padding(horizontal = 20.dp, vertical = 8.dp).semantics { heading() },
                    )
                    Text(
                        "Local controls for this device and encrypted vault.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(start = 20.dp, end = 20.dp, bottom = 20.dp),
                    )
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
                    Column(Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 16.dp)) {
                        Text("Encrypted backups", style = MaterialTheme.typography.titleSmall)
                        Text(
                            "Create or restore an encrypted .ikv snapshot using Android's file picker.",
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 4.dp, bottom = 12.dp),
                        )
                        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                            OutlinedButton(onClick = onCreateBackup, shape = RectangleShape, modifier = Modifier.height(48.dp)) { Text("Create backup") }
                            OutlinedButton(onClick = onChooseRestore, shape = RectangleShape, modifier = Modifier.height(48.dp)) { Text("Restore") }
                        }
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
            }
        }
    }
    }

    deleteTarget?.let { item ->
        AlertDialog(
            onDismissRequest = { deleteTarget = null },
            title = { Text("Delete ${item.title}?") },
            text = { Text("The ${when (item) { is SecureNoteItem -> "secure note"; is CreditCardItem -> "credit card"; is IdentityItem -> "identity"; else -> "login" }} will be removed and a deletion tombstone will be encrypted into the vault.") },
            confirmButton = {
                Button(
                    onClick = {
                        when (item) {
                            is SecureNoteItem -> onDeleteSecureNote(item.id)
                            is CreditCardItem -> onDeleteCreditCard(item.id)
                            is IdentityItem -> onDeleteIdentity(item.id)
                            else -> onDelete(item.id)
                        }
                        deleteTarget = null
                        creating = false
                        creatingNote = false
                        creatingCard = false
                        creatingIdentity = false
                        editingId = null
                        editingNoteId = null
                        editingCardId = null
                        editingIdentityId = null
                    },
                    shape = RectangleShape,
                    colors = ButtonDefaults.buttonColors(containerColor = MaterialTheme.colorScheme.error, contentColor = MaterialTheme.colorScheme.onError),
                ) {
                    Icon(Icons.Outlined.Delete, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text(when (item) { is SecureNoteItem -> "Delete note"; is CreditCardItem -> "Delete card"; is IdentityItem -> "Delete identity"; else -> "Delete login" })
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
    when (backupState) {
        BackupUiState.Idle -> Unit
        BackupUiState.Reading -> AlertDialog(
            onDismissRequest = {},
            title = { Text("Checking encrypted backup") },
            text = { Row(verticalAlignment = Alignment.CenterVertically) { CircularProgressIndicator(Modifier.size(24.dp)); Text("Validating locally…", modifier = Modifier.padding(start = 12.dp)) } },
            confirmButton = {},
        )
        BackupUiState.PasswordRequired -> RestorePasswordDialog(onCancelRestore, onAuthenticateRestore)
        is BackupUiState.Preview -> RestorePreviewDialog(backupState.details, onCancelRestore, onConfirmRestore)
    }
}

@Composable
private fun RestorePasswordDialog(onCancel: () -> Unit, onSubmit: (CharArray) -> Unit) {
    var password by remember { mutableStateOf("") }
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Authenticate backup") },
        text = {
            Column {
                Text("Enter the master password that encrypts this snapshot. Ironkeep validates it before showing restore details.")
                OutlinedTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = { Text("Master password") },
                    visualTransformation = PasswordVisualTransformation(),
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                )
            }
        },
        confirmButton = { Button(onClick = { onSubmit(password.toCharArray()); password = "" }, enabled = password.isNotEmpty(), shape = RectangleShape) { Text("Validate") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
    )
}

@Composable
private fun RestorePreviewDialog(details: dev.ironkeep.app.vault.backup.RestorePreview, onCancel: () -> Unit, onConfirm: () -> Unit) {
    AlertDialog(
        onDismissRequest = onCancel,
        title = { Text("Restore encrypted backup?") },
        text = {
            Column {
                Text("Revision ${details.revision}")
                Text("Date ${details.updatedAt}")
                Text("Items ${details.itemCount}")
                Text("SHA-256 ${details.checksum}", style = MaterialTheme.typography.bodySmall)
                Text("The current encrypted vault will be preserved as a local recovery snapshot first.", modifier = Modifier.padding(top = 12.dp))
            }
        },
        confirmButton = { Button(onClick = onConfirm, shape = RectangleShape) { Text("Restore") } },
        dismissButton = { TextButton(onClick = onCancel) { Text("Cancel") } },
    )
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
private fun IdentityForm(
    vault: VaultPayload,
    item: IdentityItem?,
    onCancel: () -> Unit,
    onSave: (IdentityFields) -> Unit,
    onDelete: (() -> Unit)?,
) {
    var title by remember(item?.id) { mutableStateOf(item?.title.orEmpty()) }
    var firstName by remember(item?.id) { mutableStateOf(item?.firstName.orEmpty()) }
    var middleName by remember(item?.id) { mutableStateOf(item?.middleName.orEmpty()) }
    var lastName by remember(item?.id) { mutableStateOf(item?.lastName.orEmpty()) }
    var email by remember(item?.id) { mutableStateOf(item?.email.orEmpty()) }
    var phone by remember(item?.id) { mutableStateOf(item?.phone.orEmpty()) }
    var company by remember(item?.id) { mutableStateOf(item?.company.orEmpty()) }
    var addressLine1 by remember(item?.id) { mutableStateOf(item?.addressLine1.orEmpty()) }
    var addressLine2 by remember(item?.id) { mutableStateOf(item?.addressLine2.orEmpty()) }
    var city by remember(item?.id) { mutableStateOf(item?.city.orEmpty()) }
    var region by remember(item?.id) { mutableStateOf(item?.region.orEmpty()) }
    var postalCode by remember(item?.id) { mutableStateOf(item?.postalCode.orEmpty()) }
    var country by remember(item?.id) { mutableStateOf(item?.country.orEmpty()) }
    var notes by remember(item?.id) { mutableStateOf(item?.notes.orEmpty()) }
    var localError by remember { mutableStateOf<String?>(null) }
    var duplicateFields by remember { mutableStateOf<IdentityFields?>(null) }

    fun fields() = IdentityFields(title, firstName, middleName, lastName, email, phone, company, addressLine1, addressLine2, city, region, postalCode, country, notes)
    fun submit() {
        val values = fields()
        val hasDetails = listOf(values.firstName, values.middleName, values.lastName, values.email, values.phone, values.company, values.addressLine1, values.addressLine2, values.city, values.region, values.postalCode, values.country).any(String::isNotBlank)
        if (values.title.isBlank() || !hasDetails || (values.email.isNotBlank() && '@' !in values.email)) {
            localError = "Enter a title and at least one valid identity field."
            return
        }
        val duplicates = VaultMutations.likelyIdentityDuplicates(vault, values, item?.id)
        if (duplicates.isNotEmpty()) duplicateFields = values else onSave(values)
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(20.dp)) {
            Text("IDENTITY RECORD", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Text(if (item == null) "Add identity" else "Edit identity", style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
            Spacer(Modifier.height(24.dp))
            OutlinedTextField(title, { title = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Title") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(firstName, { firstName = it; localError = null }, Modifier.weight(1f), label = { Text("First name") }, singleLine = true, shape = RectangleShape)
                OutlinedTextField(lastName, { lastName = it; localError = null }, Modifier.weight(1f), label = { Text("Last name") }, singleLine = true, shape = RectangleShape)
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(middleName, { middleName = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Middle name") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(email, { email = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Email") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(phone, { phone = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Phone") }, singleLine = true, keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(company, { company = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Company") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(addressLine1, { addressLine1 = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Address line 1") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(addressLine2, { addressLine2 = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Address line 2") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(city, { city = it; localError = null }, Modifier.weight(1f), label = { Text("City") }, singleLine = true, shape = RectangleShape)
                OutlinedTextField(region, { region = it; localError = null }, Modifier.weight(1f), label = { Text("Region") }, singleLine = true, shape = RectangleShape)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(postalCode, { postalCode = it; localError = null }, Modifier.weight(1f), label = { Text("Postal code") }, singleLine = true, shape = RectangleShape)
                OutlinedTextField(country, { country = it; localError = null }, Modifier.weight(1f), label = { Text("Country") }, singleLine = true, shape = RectangleShape)
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("Notes") }, minLines = 3, shape = RectangleShape)
            Text(localError.orEmpty(), color = MaterialTheme.colorScheme.error, modifier = Modifier.height(52.dp).padding(top = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = ::submit, shape = RectangleShape, modifier = Modifier.height(48.dp)) {
                    Icon(Icons.Outlined.Save, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Save encrypted")
                }
                OutlinedButton(onClick = onCancel, shape = RectangleShape, modifier = Modifier.height(48.dp)) { Text("Cancel") }
            }
            if (onDelete != null) {
                TextButton(onClick = onDelete, modifier = Modifier.padding(top = 16.dp).height(48.dp), colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                    Icon(Icons.Outlined.Delete, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Delete identity")
                }
            }
        }
    }

    duplicateFields?.let { values ->
        AlertDialog(
            onDismissRequest = { duplicateFields = null },
            title = { Text("Identity already stored") },
            text = { Text("An identity with this email or name already exists. Save another identity anyway?") },
            confirmButton = { Button(onClick = { duplicateFields = null; onSave(values) }, shape = RectangleShape) { Text("Save anyway") } },
            dismissButton = { TextButton(onClick = { duplicateFields = null }) { Text("Review fields") } },
        )
    }
}

@Composable
private fun CreditCardForm(
    vault: VaultPayload,
    item: CreditCardItem?,
    onCancel: () -> Unit,
    onSave: (CreditCardFields) -> Unit,
    onDelete: (() -> Unit)?,
) {
    var title by remember(item?.id) { mutableStateOf(item?.title.orEmpty()) }
    var cardholder by remember(item?.id) { mutableStateOf(item?.cardholderName.orEmpty()) }
    var number by remember(item?.id) { mutableStateOf(item?.number.orEmpty()) }
    var month by remember(item?.id) { mutableStateOf(item?.expiryMonth?.toString() ?: "1") }
    var year by remember(item?.id) { mutableStateOf(item?.expiryYear?.toString() ?: java.time.Year.now().value.toString()) }
    var verificationCode by remember(item?.id) { mutableStateOf(item?.verificationCode.orEmpty()) }
    var pin by remember(item?.id) { mutableStateOf(item?.pin.orEmpty()) }
    var notes by remember(item?.id) { mutableStateOf(item?.notes.orEmpty()) }
    var localError by remember { mutableStateOf<String?>(null) }
    var duplicateFields by remember { mutableStateOf<CreditCardFields?>(null) }

    fun fields() = CreditCardFields(title, cardholder, number, month.toIntOrNull() ?: 0, year.toIntOrNull() ?: 0, verificationCode, pin.ifBlank { null }, notes)
    fun submit() {
        val values = fields()
        val normalizedNumber = values.number.replace(Regex("[\\s-]"), "")
        if (values.title.isBlank() || values.cardholderName.isBlank() || !normalizedNumber.matches(Regex("\\d{12,19}")) || values.expiryMonth !in 1..12 || values.expiryYear !in 2000..9999 || !values.verificationCode.matches(Regex("\\d{3,4}"))) {
            localError = "Enter a title, cardholder, valid card number, expiry, and verification code."
            return
        }
        val duplicates = VaultMutations.likelyCreditCardDuplicates(vault, values, item?.id)
        if (duplicates.isNotEmpty()) duplicateFields = values else onSave(values)
    }

    val numberKeyboard = KeyboardOptions(keyboardType = KeyboardType.Number)
    Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(20.dp)) {
            Text("PAYMENT CARD", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Text(if (item == null) "Add card" else "Edit card", style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
            Spacer(Modifier.height(24.dp))
            OutlinedTextField(title, { title = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Title") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(cardholder, { cardholder = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Cardholder name") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(number, { number = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Card number") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = numberKeyboard, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(month, { month = it; localError = null }, Modifier.weight(1f), label = { Text("Month") }, singleLine = true, keyboardOptions = numberKeyboard, shape = RectangleShape)
                OutlinedTextField(year, { year = it; localError = null }, Modifier.weight(1f), label = { Text("Year") }, singleLine = true, keyboardOptions = numberKeyboard, shape = RectangleShape)
            }
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(verificationCode, { verificationCode = it; localError = null }, Modifier.weight(1f), label = { Text("CVV/CVC") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = numberKeyboard, shape = RectangleShape)
                OutlinedTextField(pin, { pin = it; localError = null }, Modifier.weight(1f), label = { Text("PIN · optional") }, singleLine = true, visualTransformation = PasswordVisualTransformation(), keyboardOptions = numberKeyboard, shape = RectangleShape)
            }
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(notes, { notes = it }, Modifier.fillMaxWidth(), label = { Text("Notes") }, minLines = 3, shape = RectangleShape)
            Text(localError.orEmpty(), color = MaterialTheme.colorScheme.error, modifier = Modifier.height(52.dp).padding(top = 8.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                Button(onClick = ::submit, shape = RectangleShape, modifier = Modifier.height(48.dp)) {
                    Icon(Icons.Outlined.Save, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Save encrypted")
                }
                OutlinedButton(onClick = onCancel, shape = RectangleShape, modifier = Modifier.height(48.dp)) { Text("Cancel") }
            }
            if (onDelete != null) {
                TextButton(onClick = onDelete, modifier = Modifier.padding(top = 16.dp).height(48.dp), colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error)) {
                    Icon(Icons.Outlined.Delete, contentDescription = null)
                    Spacer(Modifier.size(8.dp))
                    Text("Delete card")
                }
            }
        }
    }

    duplicateFields?.let { values ->
        AlertDialog(
            onDismissRequest = { duplicateFields = null },
            title = { Text("Card already stored") },
            text = { Text("A payment card with this number already exists. Save another card anyway?") },
            confirmButton = { Button(onClick = { duplicateFields = null; onSave(values) }, shape = RectangleShape) { Text("Save anyway") } },
            dismissButton = { TextButton(onClick = { duplicateFields = null }) { Text("Review fields") } },
        )
    }
}

@Composable
private fun SecureNoteForm(
    vault: VaultPayload,
    item: SecureNoteItem?,
    onCancel: () -> Unit,
    onSave: (SecureNoteFields) -> Unit,
    onDelete: (() -> Unit)?,
) {
    var title by remember(item?.id) { mutableStateOf(item?.title.orEmpty()) }
    var body by remember(item?.id) { mutableStateOf(item?.body.orEmpty()) }
    var localError by remember { mutableStateOf<String?>(null) }
    var duplicateFields by remember { mutableStateOf<SecureNoteFields?>(null) }

    fun submit() {
        val values = SecureNoteFields(title, body)
        if (values.title.isBlank() || values.body.isBlank()) {
            localError = "Title and note body are required."
            return
        }
        val duplicates = VaultMutations.likelySecureNoteDuplicates(vault, values, item?.id)
        if (duplicates.isNotEmpty()) duplicateFields = values else onSave(values)
    }

    Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
        Column(Modifier.fillMaxSize().padding(insets).verticalScroll(rememberScrollState()).padding(20.dp)) {
            Text("SECURE NOTE", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
            Text(if (item == null) "Add note" else "Edit note", style = MaterialTheme.typography.displaySmall, modifier = Modifier.padding(top = 8.dp).semantics { heading() })
            Spacer(Modifier.height(24.dp))
            OutlinedTextField(title, { title = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Title") }, singleLine = true, shape = RectangleShape)
            Spacer(Modifier.height(12.dp))
            OutlinedTextField(body, { body = it; localError = null }, Modifier.fillMaxWidth(), label = { Text("Private note") }, minLines = 10, shape = RectangleShape)
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
                    Text("Delete note")
                }
            }
        }
    }

    duplicateFields?.let { values ->
        AlertDialog(
            onDismissRequest = { duplicateFields = null },
            title = { Text("Likely duplicate note") },
            text = { Text("A secure note with this title already exists. Save another note anyway?") },
            confirmButton = { Button(onClick = { duplicateFields = null; onSave(values) }, shape = RectangleShape) { Text("Save anyway") } },
            dismissButton = { TextButton(onClick = { duplicateFields = null }) { Text("Review fields") } },
        )
    }
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
