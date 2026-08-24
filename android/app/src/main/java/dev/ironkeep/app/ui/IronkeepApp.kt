package dev.ironkeep.app.ui

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.core.spring
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
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
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.Add
import androidx.compose.material.icons.outlined.Fingerprint
import androidx.compose.material.icons.outlined.Key
import androidx.compose.material.icons.outlined.Lock
import androidx.compose.material.icons.outlined.Search
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import dev.ironkeep.app.vault.VaultUiState
import dev.ironkeep.app.vault.VaultViewModel
import dev.ironkeep.app.vault.model.VaultPayload

@Composable
fun IronkeepApp(viewModel: VaultViewModel) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    AnimatedContent(
        targetState = state,
        transitionSpec = { fadeIn(spring(stiffness = 600f)) togetherWith fadeOut() },
        label = "vault state",
    ) { current ->
        when (current) {
            VaultUiState.Loading -> LoadingScreen()
            VaultUiState.Setup -> GateScreen(creating = true, error = null, onSubmit = viewModel::create)
            VaultUiState.Locked -> GateScreen(creating = false, error = null, onSubmit = viewModel::unlock)
            is VaultUiState.Error -> GateScreen(creating = current.creating, error = current.message, onSubmit = if (current.creating) viewModel::create else viewModel::unlock)
            is VaultUiState.Unlocked -> VaultHome(current.vault, onLock = viewModel::lock)
        }
    }
}

@Composable
private fun LoadingScreen() = Box(Modifier.fillMaxSize().background(MaterialTheme.colorScheme.background), contentAlignment = Alignment.Center) {
    CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
}

@Composable
private fun GateScreen(creating: Boolean, error: String?, onSubmit: (CharArray) -> Unit) {
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
                if (!creating) {
                    TextButton(onClick = { }, modifier = Modifier.align(Alignment.CenterHorizontally)) {
                        Icon(Icons.Outlined.Fingerprint, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("Use biometric unlock")
                    }
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
private fun VaultHome(vault: VaultPayload, onLock: () -> Unit) {
    var query by remember { mutableStateOf("") }
    Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
        Column(Modifier.fillMaxSize().padding(insets)) {
            Row(Modifier.fillMaxWidth().height(72.dp).padding(horizontal = 20.dp), verticalAlignment = Alignment.CenterVertically) {
                Wordmark()
                Spacer(Modifier.weight(1f))
                IconButton(onClick = onLock) { Icon(Icons.Outlined.Lock, contentDescription = "Lock vault") }
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
            if (vault.items.isEmpty()) {
                Column(
                    Modifier.fillMaxWidth().padding(horizontal = 20.dp, vertical = 40.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                ) {
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                    Icon(Icons.Outlined.Key, contentDescription = null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.padding(top = 40.dp).size(34.dp))
                    Text("Nothing in this drawer.", style = MaterialTheme.typography.headlineLarge, modifier = Modifier.padding(top = 16.dp).semantics { heading() })
                    Text("Add the first login, note, card, or identity.", color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 8.dp))
                    OutlinedButton(onClick = { }, shape = RectangleShape, modifier = Modifier.padding(vertical = 24.dp)) {
                        Icon(Icons.Outlined.Add, contentDescription = null)
                        Spacer(Modifier.size(8.dp))
                        Text("Add first item")
                    }
                    HorizontalDivider(color = MaterialTheme.colorScheme.outline)
                }
            }
        }
    }
}
