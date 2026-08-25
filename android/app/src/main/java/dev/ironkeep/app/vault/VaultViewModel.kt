package dev.ironkeep.app.vault

import android.app.Application
import android.os.SystemClock
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.ironkeep.app.autofill.AutofillPendingSaveStore
import dev.ironkeep.app.vault.crypto.BiometricKeyStore
import dev.ironkeep.app.vault.crypto.BiometricVaultBinding
import dev.ironkeep.app.vault.crypto.BiometricVaultRecord
import dev.ironkeep.app.vault.crypto.VaultAuthenticationException
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.model.LoginFields
import dev.ironkeep.app.vault.model.VaultFile
import dev.ironkeep.app.vault.model.VaultMutations
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.session.SecureClipboard
import dev.ironkeep.app.vault.session.DeviceIdProvider
import dev.ironkeep.app.vault.session.SessionDeadline
import dev.ironkeep.app.vault.session.SessionExpiryReason
import dev.ironkeep.app.vault.session.VaultPersistence
import dev.ironkeep.app.vault.session.VaultMutationCoordinator
import dev.ironkeep.app.vault.session.VaultMutationResult
import dev.ironkeep.app.vault.session.VaultSessionHolder
import dev.ironkeep.app.vault.storage.BiometricVaultStore
import dev.ironkeep.app.vault.storage.VaultFileStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext
import javax.crypto.Cipher

sealed interface VaultUiState {
    data object Loading : VaultUiState
    data object Setup : VaultUiState
    data class Locked(val biometricEnrolled: Boolean, val message: String? = null) : VaultUiState
    data class Unlocked(
        val vault: VaultPayload,
        val error: String? = null,
        val notice: String? = null,
        val biometricEnabled: Boolean = false,
    ) : VaultUiState
    data class Error(val creating: Boolean, val message: String, val biometricEnrolled: Boolean = false) : VaultUiState
}

enum class BiometricPurpose { ENROLL, UNLOCK }
data class BiometricPromptRequest(val purpose: BiometricPurpose, val cipher: Cipher)

private sealed interface PendingBiometric {
    val cipher: Cipher

    data class Enrollment(val binding: BiometricVaultBinding, override val cipher: Cipher) : PendingBiometric
    data class Unlock(val file: VaultFile, val record: BiometricVaultRecord, override val cipher: Cipher) : PendingBiometric
}

class VaultViewModel(application: Application) : AndroidViewModel(application) {
    private val crypto = VaultCrypto()
    private val store = VaultFileStore(application, crypto.json)
    private val biometricKeyStore = BiometricKeyStore()
    private val biometricStore = BiometricVaultStore(application, crypto.json)
    private val persistence = VaultPersistence(crypto, store)
    private val mutationCoordinator = VaultMutationCoordinator(persistence)
    private val sessionDeadline = SessionDeadline()
    private val secureClipboard = SecureClipboard(application, viewModelScope)
    private val deviceIdProvider = DeviceIdProvider(application)
    private val mutableState = MutableStateFlow<VaultUiState>(VaultUiState.Loading)
    val state: StateFlow<VaultUiState> = mutableState.asStateFlow()
    private val mutableBiometricRequests = MutableSharedFlow<BiometricPromptRequest>(extraBufferCapacity = 1)
    val biometricRequests: SharedFlow<BiometricPromptRequest> = mutableBiometricRequests.asSharedFlow()
    private val mutableBiometricCancelRequests = MutableSharedFlow<Unit>(extraBufferCapacity = 1)
    val biometricCancelRequests: SharedFlow<Unit> = mutableBiometricCancelRequests.asSharedFlow()
    @Volatile private var pendingBiometric: PendingBiometric? = null
    private var biometricRequestStarting = false
    private var sessionLockJob: Job? = null

    init {
        mutableState.value = if (store.exists()) VaultUiState.Locked(biometricMaterialPresent()) else VaultUiState.Setup
    }

    fun create(masterPassword: CharArray) {
        if (masterPassword.size < 12) {
            masterPassword.fill('\u0000')
            mutableState.value = VaultUiState.Error(true, "Use at least 12 characters.")
            return
        }
        viewModelScope.launch {
            mutableState.value = VaultUiState.Loading
            try {
                val result = withContext(Dispatchers.Default) {
                    crypto.encryptNew(masterPassword, VaultPayload.empty("My Keep", deviceId()))
                }
                try {
                    withContext(Dispatchers.IO) { store.write(result.file) }
                } catch (error: Exception) {
                    result.session.close()
                    throw error
                }
                withContext(Dispatchers.IO) { clearBiometricMaterial() }
                VaultSessionHolder.replace(result.session)
                openSessionDeadline()
                mutableState.value = VaultUiState.Unlocked(result.session.payload, biometricEnabled = false)
            } catch (_: Exception) {
                mutableState.value = VaultUiState.Error(true, "Vault creation failed. Check available memory and storage.")
            } finally {
                masterPassword.fill('\u0000')
            }
        }
    }

    fun unlock(masterPassword: CharArray) {
        viewModelScope.launch {
            mutableState.value = VaultUiState.Loading
            try {
                val file = withContext(Dispatchers.IO) { store.read() }
                val session = withContext(Dispatchers.Default) { crypto.unlock(masterPassword, file) }
                val biometricEnabled = withContext(Dispatchers.IO) { biometricEnrollmentValidFor(file) }
                VaultSessionHolder.replace(session)
                openSessionDeadline()
                mutableState.value = VaultUiState.Unlocked(session.payload, biometricEnabled = biometricEnabled)
            } catch (_: VaultAuthenticationException) {
                mutableState.value = VaultUiState.Error(false, "Master password not accepted.", biometricMaterialPresent())
            } catch (_: Exception) {
                mutableState.value = VaultUiState.Error(false, "Vault could not be opened safely.", biometricMaterialPresent())
            } finally {
                masterPassword.fill('\u0000')
            }
        }
    }

    fun lock() {
        viewModelScope.launch { lockSession(null) }
    }

    fun recordUserActivity() {
        if (VaultSessionHolder.sessionOrNull() == null) return
        sessionDeadline.touch(SystemClock.elapsedRealtime())
        scheduleSessionLock()
    }

    fun onBackground() {
        if (VaultSessionHolder.sessionOrNull() == null) return
        sessionDeadline.background(SystemClock.elapsedRealtime())
        scheduleSessionLock()
    }

    fun onForeground() {
        val session = VaultSessionHolder.sessionOrNull() ?: return
        val current = mutableState.value as? VaultUiState.Unlocked
        if (current != null && current.vault.revision != session.payload.revision) {
            mutableState.value = current.copy(vault = session.payload, error = null, notice = "Vault updated by Android Autofill.")
        }
        val reason = sessionDeadline.expiryReason(SystemClock.elapsedRealtime(), session.payload.settings.autoLockMinutes)
        if (reason != null) {
            viewModelScope.launch { lockSession(reason) }
            return
        }
        sessionDeadline.foreground()
        scheduleSessionLock()
    }

    fun requestBiometricEnrollment() {
        val session = VaultSessionHolder.sessionOrNull() ?: return
        if (!beginBiometricRequest()) return
        viewModelScope.launch {
            try {
                val binding = BiometricVaultBinding.from(session.file)
                val cipher = withContext(Dispatchers.IO) {
                    clearBiometricMaterial()
                    biometricKeyStore.createKey()
                    biometricKeyStore.newEncryptionCipher()
                }
                if (VaultSessionHolder.sessionOrNull() !== session) {
                    withContext(Dispatchers.IO) { clearBiometricMaterial() }
                    return@launch
                }
                pendingBiometric = PendingBiometric.Enrollment(binding, cipher)
                mutableBiometricRequests.emit(BiometricPromptRequest(BiometricPurpose.ENROLL, cipher))
            } catch (_: Exception) {
                withContext(Dispatchers.IO) { clearBiometricMaterial() }
                if (VaultSessionHolder.sessionOrNull() === session) {
                    mutableState.value = VaultUiState.Unlocked(session.payload, error = "Biometric enrollment could not start. Use the master password.")
                }
            } finally {
                endBiometricRequestPreparation()
            }
        }
    }

    fun requestBiometricUnlock() {
        if (!beginBiometricRequest()) return
        viewModelScope.launch {
            try {
                val request = withContext(Dispatchers.IO) {
                    val file = store.read()
                    val record = biometricStore.read() ?: error("Biometric enrollment not found")
                    if (!record.matches(file) || !biometricKeyStore.hasKey()) error("Biometric enrollment is stale")
                    val nonce = record.nonceBytes()
                    val cipher = try {
                        biometricKeyStore.newDecryptionCipher(nonce)
                    } finally {
                        nonce.fill(0)
                    }
                    pendingBiometric = PendingBiometric.Unlock(file, record, cipher)
                    BiometricPromptRequest(BiometricPurpose.UNLOCK, cipher)
                }
                mutableBiometricRequests.emit(request)
            } catch (_: Exception) {
                withContext(Dispatchers.IO) { clearBiometricMaterial() }
                mutableState.value = VaultUiState.Locked(false, "Biometric unlock was reset. Unlock with your master password to enroll again.")
            } finally {
                endBiometricRequestPreparation()
            }
        }
    }

    fun completeBiometricAuthentication(cipher: Cipher) {
        val pending = pendingBiometric.also { pendingBiometric = null } ?: return
        if (pending.cipher !== cipher) {
            viewModelScope.launch {
                if (pending is PendingBiometric.Enrollment) {
                    withContext(Dispatchers.IO) { clearBiometricMaterial() }
                }
                when (val current = mutableState.value) {
                    is VaultUiState.Unlocked -> mutableState.value = current.copy(error = "Biometric authentication could not be verified.")
                    is VaultUiState.Locked -> mutableState.value = current.copy(message = "Biometric authentication could not be verified.")
                    else -> Unit
                }
            }
            return
        }
        viewModelScope.launch {
            when (pending) {
                is PendingBiometric.Enrollment -> completeBiometricEnrollment(pending, cipher)
                is PendingBiometric.Unlock -> completeBiometricUnlock(pending, cipher)
            }
        }
    }

    fun cancelBiometricAuthentication(message: String? = null) {
        val pending = pendingBiometric.also { pendingBiometric = null }
        viewModelScope.launch {
            if (pending is PendingBiometric.Enrollment) withContext(Dispatchers.IO) { clearBiometricMaterial() }
            when (val current = mutableState.value) {
                is VaultUiState.Unlocked -> mutableState.value = current.copy(error = message)
                is VaultUiState.Locked -> mutableState.value = current.copy(message = message)
                is VaultUiState.Error -> mutableState.value = current.copy(message = message ?: current.message)
                else -> Unit
            }
        }
    }

    fun disableBiometricUnlock() {
        val session = VaultSessionHolder.sessionOrNull() ?: return
        viewModelScope.launch {
            withContext(Dispatchers.IO) { clearBiometricMaterial() }
            if (VaultSessionHolder.sessionOrNull() === session) {
                mutableState.value = VaultUiState.Unlocked(session.payload, notice = "Biometric unlock disabled on this device.")
            }
        }
    }

    fun copyPassword(password: String) {
        val session = VaultSessionHolder.sessionOrNull() ?: return
        if (password.isEmpty()) return
        val seconds = session.payload.settings.clearClipboardSeconds
        secureClipboard.copy(password, seconds)
        recordUserActivity()
        val current = mutableState.value as? VaultUiState.Unlocked ?: return
        mutableState.value = current.copy(error = null, notice = "Password copied. Clipboard clears in $seconds seconds.")
    }

    fun updateSecuritySettings(autoLockMinutes: Int, clearClipboardSeconds: Int) = mutate("Session safety settings saved.") { payload ->
        VaultMutations.updateSecuritySettings(payload, autoLockMinutes, clearClipboardSeconds, deviceId())
    }

    fun addLogin(fields: LoginFields) = mutate { payload -> VaultMutations.addLogin(payload, fields, deviceId()) }

    fun editLogin(itemId: String, fields: LoginFields) = mutate { payload -> VaultMutations.editLogin(payload, itemId, fields, deviceId()) }

    fun deleteLogin(itemId: String) = mutate { payload -> VaultMutations.deleteLogin(payload, itemId, deviceId()) }

    fun toggleLoginFavorite(itemId: String) = mutate { payload -> VaultMutations.toggleFavorite(payload, itemId, deviceId()) }

    private fun mutate(notice: String? = null, transform: (VaultPayload) -> VaultPayload) {
        recordUserActivity()
        viewModelScope.launch {
            val biometricEnabled = (mutableState.value as? VaultUiState.Unlocked)?.biometricEnabled == true
            when (val result = mutationCoordinator.mutate(transform)) {
                VaultMutationResult.Locked -> {
                    mutableState.value = VaultUiState.Locked(biometricMaterialPresent())
                }

                is VaultMutationResult.Success -> {
                    mutableState.value = VaultUiState.Unlocked(result.payload, notice = notice, biometricEnabled = biometricEnabled)
                    scheduleSessionLock()
                }

                VaultMutationResult.Failed -> {
                    val previous = VaultSessionHolder.sessionOrNull()?.payload
                    mutableState.value = if (previous == null) VaultUiState.Locked(biometricMaterialPresent()) else {
                        VaultUiState.Unlocked(previous, "Encrypted vault could not be saved. Previous data is intact.", biometricEnabled = biometricEnabled)
                    }
                }
            }
        }
    }

    override fun onCleared() {
        sessionLockJob?.cancel()
        sessionDeadline.close()
        secureClipboard.clearOwned()
        if (pendingBiometric is PendingBiometric.Enrollment) clearBiometricMaterial()
        pendingBiometric = null
        AutofillPendingSaveStore.clear()
        VaultSessionHolder.lock()
        super.onCleared()
    }

    private suspend fun completeBiometricEnrollment(pending: PendingBiometric.Enrollment, cipher: Cipher) {
        val session = VaultSessionHolder.sessionOrNull()
        if (session == null || !pending.binding.matches(session.file)) {
            withContext(Dispatchers.IO) { clearBiometricMaterial() }
            mutableState.value = VaultUiState.Locked(false, "Vault changed before biometric enrollment completed.")
            return
        }
        var dataKey: ByteArray? = null
        var wrappedKey: ByteArray? = null
        var aad: ByteArray? = null
        try {
            val key = session.copyDataKey()
            dataKey = key
            val authenticatedData = pending.binding.aad()
            aad = authenticatedData
            cipher.updateAAD(authenticatedData)
            val encrypted = withContext(Dispatchers.Default) { cipher.doFinal(key) }
            wrappedKey = encrypted
            val record = pending.binding.wrapped(cipher.iv, encrypted)
            withContext(Dispatchers.IO) { biometricStore.write(record) }
            mutableState.value = VaultUiState.Unlocked(session.payload, notice = "Biometric unlock enabled on this device.", biometricEnabled = true)
        } catch (_: Exception) {
            withContext(Dispatchers.IO) { clearBiometricMaterial() }
            mutableState.value = VaultUiState.Unlocked(session.payload, error = "Biometric enrollment failed. Use the master password.")
        } finally {
            dataKey?.fill(0)
            wrappedKey?.fill(0)
            aad?.fill(0)
        }
    }

    private suspend fun completeBiometricUnlock(pending: PendingBiometric.Unlock, cipher: Cipher) {
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
            openSessionDeadline()
            mutableState.value = VaultUiState.Unlocked(session.payload, biometricEnabled = true)
        } catch (_: Exception) {
            withContext(Dispatchers.IO) { clearBiometricMaterial() }
            mutableState.value = VaultUiState.Locked(false, "Biometric unlock failed and was reset. Use your master password to enroll again.")
        } finally {
            encryptedKey?.fill(0)
            dataKey?.fill(0)
            aad?.fill(0)
        }
    }

    private fun biometricMaterialPresent(): Boolean = try {
        val recordExists = biometricStore.exists()
        val keyExists = biometricKeyStore.hasKey()
        if (recordExists != keyExists) {
            clearBiometricMaterial()
            false
        } else recordExists
    } catch (_: Exception) {
        clearBiometricMaterial()
        false
    }

    private fun biometricEnrollmentValidFor(file: VaultFile): Boolean = try {
        val record = biometricStore.read()
        if (record != null && record.matches(file) && biometricKeyStore.hasKey()) true else {
            clearBiometricMaterial()
            false
        }
    } catch (_: Exception) {
        clearBiometricMaterial()
        false
    }

    private fun clearBiometricMaterial() {
        runCatching { biometricStore.clear() }
        runCatching { biometricKeyStore.deleteKey() }
    }

    private fun openSessionDeadline() {
        sessionDeadline.open(SystemClock.elapsedRealtime())
        scheduleSessionLock()
    }

    private fun scheduleSessionLock() {
        sessionLockJob?.cancel()
        sessionLockJob = null
        val session = VaultSessionHolder.sessionOrNull() ?: return
        val remaining = sessionDeadline.remainingMillis(SystemClock.elapsedRealtime(), session.payload.settings.autoLockMinutes) ?: return
        sessionLockJob = viewModelScope.launch {
            delay(remaining)
            sessionLockJob = null
            enforceSessionDeadline()
        }
    }

    private suspend fun enforceSessionDeadline() {
        val session = VaultSessionHolder.sessionOrNull() ?: return
        val reason = sessionDeadline.expiryReason(SystemClock.elapsedRealtime(), session.payload.settings.autoLockMinutes)
        if (reason == null) scheduleSessionLock() else lockSession(reason)
    }

    private suspend fun lockSession(reason: SessionExpiryReason?) {
        mutationCoordinator.withSessionLock {
            sessionLockJob?.cancel()
            sessionLockJob = null
            val pending = pendingBiometric.also { pendingBiometric = null }
            if (pending != null) mutableBiometricCancelRequests.tryEmit(Unit)
            if (pending is PendingBiometric.Enrollment) withContext(Dispatchers.IO) { clearBiometricMaterial() }
            secureClipboard.clearOwned()
            AutofillPendingSaveStore.clear()
            VaultSessionHolder.lock()
            sessionDeadline.close()
            val message = when (reason) {
                SessionExpiryReason.BACKGROUND -> "Locked after Ironkeep remained in the background."
                SessionExpiryReason.INACTIVITY -> "Locked after the configured inactivity timeout."
                null -> null
            }
            mutableState.value = VaultUiState.Locked(biometricMaterialPresent(), message)
        }
    }

    @Synchronized
    private fun beginBiometricRequest(): Boolean {
        if (biometricRequestStarting || pendingBiometric != null) return false
        biometricRequestStarting = true
        return true
    }

    @Synchronized
    private fun endBiometricRequestPreparation() {
        biometricRequestStarting = false
    }

    private fun deviceId(): String = deviceIdProvider.id()
}
