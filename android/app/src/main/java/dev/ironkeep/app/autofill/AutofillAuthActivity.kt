package dev.ironkeep.app.autofill

import android.app.assist.AssistStructure
import android.content.Intent
import android.os.Build
import android.os.Bundle
import android.view.autofill.AutofillManager
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.RectangleShape
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.fragment.app.FragmentActivity
import dev.ironkeep.app.MainActivity
import dev.ironkeep.app.ui.theme.IronkeepTheme
import dev.ironkeep.app.vault.session.VaultSessionHolder

class AutofillAuthActivity : FragmentActivity() {
    private lateinit var fields: DetectedFields
    private lateinit var unlockController: AutofillBiometricUnlockController
    private var message by mutableStateOf("Preparing fingerprint unlock…")
    private var started = false
    private var completed = false

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val structure = assistStructure() ?: return finishCancelled()
        fields = FieldCollector().collect(listOf(structure))
        if (fields.packageName == packageName || !fields.hasSupportedFields || fields.target() == null) {
            fields.clearSensitive()
            return finishCancelled()
        }
        unlockController = AutofillBiometricUnlockController(
            activity = this,
            onUnlocked = ::returnUnlockedResponse,
            onMessage = { message = it },
        )
        enableEdgeToEdge()
        setContent {
            IronkeepTheme {
                Scaffold(containerColor = MaterialTheme.colorScheme.background) { insets ->
                    Column(
                        Modifier.fillMaxSize().padding(insets).padding(24.dp),
                        verticalArrangement = Arrangement.Center,
                    ) {
                        Text("AUTOFILL AUTHENTICATION", style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.primary)
                        Text(
                            "Unlock Ironkeep",
                            style = MaterialTheme.typography.headlineLarge,
                            modifier = Modifier.padding(top = 8.dp).semantics { heading() },
                        )
                        Text(
                            message,
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(top = 12.dp, bottom = 24.dp),
                        )
                        Button(
                            onClick = unlockController::start,
                            shape = RectangleShape,
                            modifier = Modifier.fillMaxWidth().height(52.dp),
                        ) { Text("Use fingerprint") }
                        OutlinedButton(
                            onClick = {
                                startActivity(Intent(this@AutofillAuthActivity, MainActivity::class.java))
                                finishCancelled()
                            },
                            shape = RectangleShape,
                            modifier = Modifier.fillMaxWidth().height(52.dp).padding(top = 8.dp),
                        ) { Text("Open Ironkeep instead") }
                    }
                }
            }
        }
    }

    override fun onStart() {
        super.onStart()
        if (!started && ::unlockController.isInitialized) {
            started = true
            unlockController.start()
        }
    }

    override fun onDestroy() {
        if (::unlockController.isInitialized) unlockController.cancel()
        if (::fields.isInitialized) fields.clearSensitive()
        if (!completed) VaultSessionHolder.lock()
        super.onDestroy()
    }

    private fun returnUnlockedResponse() {
        val payload = VaultSessionHolder.payloadOrNull() ?: return finishCancelled()
        val response = runCatching { buildUnlockedFillResponse(this, fields, payload) }.getOrNull()
            ?: return finishCancelled()
        val reply = Intent().putExtra(AutofillManager.EXTRA_AUTHENTICATION_RESULT, response)
        completed = true
        fields.clearSensitive()
        VaultSessionHolder.lock()
        setResult(RESULT_OK, reply)
        finish()
    }

    private fun finishCancelled() {
        setResult(RESULT_CANCELED)
        finish()
    }

    private fun assistStructure(): AssistStructure? = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
        intent.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE, AssistStructure::class.java)
    } else {
        @Suppress("DEPRECATION")
        intent.getParcelableExtra(AutofillManager.EXTRA_ASSIST_STRUCTURE)
    }
}
