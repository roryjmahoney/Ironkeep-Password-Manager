package dev.ironkeep.app.autofill

import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.core.content.ContextCompat
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.lifecycleScope
import dev.ironkeep.app.vault.crypto.BiometricKeyStore
import dev.ironkeep.app.vault.crypto.BiometricVaultRecord
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.model.VaultFile
import dev.ironkeep.app.vault.session.VaultSessionHolder
import dev.ironkeep.app.vault.storage.BiometricVaultStore
import dev.ironkeep.app.vault.storage.VaultFileStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.crypto.Cipher

internal class AutofillBiometricUnlockController(
    private val activity: FragmentActivity,
    private val onUnlocked: () -> Unit,
    private val onMessage: (String) -> Unit,
) {
    private val crypto = VaultCrypto()
    private val vaultStore = VaultFileStore(activity, crypto.json)
    private val biometricStore = BiometricVaultStore(activity, crypto.json)
    private val keyStore = BiometricKeyStore()
    private var prepared: PreparedUnlock? = null
    private var running = false

    private val prompt = BiometricPrompt(
        activity,
        ContextCompat.getMainExecutor(activity),
        object : BiometricPrompt.AuthenticationCallback() {
            override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                val pending = prepared.also { prepared = null }
                val cipher = result.cryptoObject?.cipher
                if (pending == null || cipher == null || pending.cipher !== cipher) {
                    running = false
                    onMessage("Fingerprint authentication returned no cryptographic proof. Try again.")
                    return
                }
                activity.lifecycleScope.launch { complete(pending, cipher) }
            }

            override fun onAuthenticationError(errorCode: Int, errString: CharSequence) {
                prepared = null
                running = false
                val cancelled = errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                    errorCode == BiometricPrompt.ERROR_USER_CANCELED ||
                    errorCode == BiometricPrompt.ERROR_CANCELED
                onMessage(
                    if (cancelled) "Fingerprint unlock canceled. Try again or open Ironkeep."
                    else "Fingerprint authentication is unavailable. Unlock Ironkeep with your master password and try again.",
                )
            }
        },
    )

    fun start() {
        if (running) return
        running = true
        onMessage("Preparing fingerprint unlock…")
        activity.lifecycleScope.launch {
            val available = BiometricManager.from(activity).canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG)
            if (available != BiometricManager.BIOMETRIC_SUCCESS) {
                running = false
                onMessage("A strong enrolled fingerprint is required. Unlock Ironkeep with your master password and enable biometric unlock.")
                return@launch
            }
            val request = runCatching { prepare() }.getOrElse {
                clearInvalidMaterial()
                running = false
                onMessage("Biometric unlock is unavailable. Unlock Ironkeep with your master password and enable it again.")
                return@launch
            }
            prepared = request
            val promptInfo = BiometricPrompt.PromptInfo.Builder()
                .setTitle("Unlock Ironkeep")
                .setSubtitle("Authenticate to use your encrypted vault for Autofill")
                .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                .setNegativeButtonText("Cancel")
                .build()
            prompt.authenticate(promptInfo, BiometricPrompt.CryptoObject(request.cipher))
        }
    }

    fun cancel() {
        if (running) prompt.cancelAuthentication()
        prepared = null
        running = false
    }

    private suspend fun prepare(): PreparedUnlock = withContext(Dispatchers.IO) {
        val file = vaultStore.read()
        val record = biometricStore.read() ?: error("Biometric enrollment not found")
        require(record.matches(file) && keyStore.hasKey()) { "Biometric enrollment is stale" }
        val nonce = record.nonceBytes()
        try {
            PreparedUnlock(file, record, keyStore.newDecryptionCipher(nonce))
        } finally {
            nonce.fill(0)
        }
    }

    private suspend fun complete(pending: PreparedUnlock, cipher: Cipher) {
        var encryptedKey: ByteArray? = null
        var dataKey: ByteArray? = null
        var aad: ByteArray? = null
        try {
            val wrapped = pending.record.ciphertextBytes()
            encryptedKey = wrapped
            val authenticatedData = pending.record.aad()
            aad = authenticatedData
            cipher.updateAAD(authenticatedData)
            val key = withContext(Dispatchers.Default) { cipher.doFinal(wrapped) }
            dataKey = key
            val session = withContext(Dispatchers.Default) { crypto.unlockWithDataKey(key, pending.file) }
            VaultSessionHolder.replace(session)
            running = false
            onUnlocked()
        } catch (_: Exception) {
            clearInvalidMaterial()
            running = false
            onMessage("Fingerprint unlock failed and was reset. Unlock Ironkeep with your master password to enable it again.")
        } finally {
            encryptedKey?.fill(0)
            dataKey?.fill(0)
            aad?.fill(0)
        }
    }

    private suspend fun clearInvalidMaterial() = withContext(Dispatchers.IO) {
        runCatching { biometricStore.clear() }
        runCatching { keyStore.deleteKey() }
    }

    private data class PreparedUnlock(
        val file: VaultFile,
        val record: BiometricVaultRecord,
        val cipher: Cipher,
    )
}
