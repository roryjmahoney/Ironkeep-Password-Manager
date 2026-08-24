package dev.ironkeep.app.vault

import android.app.Application
import android.content.Context
import androidx.lifecycle.AndroidViewModel
import androidx.lifecycle.viewModelScope
import dev.ironkeep.app.vault.crypto.VaultAuthenticationException
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.session.VaultSessionHolder
import dev.ironkeep.app.vault.storage.VaultFileStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed interface VaultUiState {
    data object Loading : VaultUiState
    data object Setup : VaultUiState
    data object Locked : VaultUiState
    data class Unlocked(val vault: VaultPayload) : VaultUiState
    data class Error(val creating: Boolean, val message: String) : VaultUiState
}

class VaultViewModel(application: Application) : AndroidViewModel(application) {
    private val crypto = VaultCrypto()
    private val store = VaultFileStore(application, crypto.json)
    private val mutableState = MutableStateFlow<VaultUiState>(VaultUiState.Loading)
    val state: StateFlow<VaultUiState> = mutableState.asStateFlow()

    init {
        mutableState.value = if (store.exists()) VaultUiState.Locked else VaultUiState.Setup
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
                withContext(Dispatchers.IO) { store.write(result.file) }
                VaultSessionHolder.replace(result.session)
                mutableState.value = VaultUiState.Unlocked(result.session.payload)
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
                VaultSessionHolder.replace(session)
                mutableState.value = VaultUiState.Unlocked(session.payload)
            } catch (_: VaultAuthenticationException) {
                mutableState.value = VaultUiState.Error(false, "Master password not accepted.")
            } catch (_: Exception) {
                mutableState.value = VaultUiState.Error(false, "Vault could not be opened safely.")
            } finally {
                masterPassword.fill('\u0000')
            }
        }
    }

    fun lock() {
        VaultSessionHolder.lock()
        mutableState.value = VaultUiState.Locked
    }

    override fun onCleared() {
        VaultSessionHolder.lock()
        super.onCleared()
    }

    private fun deviceId(): String {
        val preferences = getApplication<Application>().getSharedPreferences("ironkeep.device", Context.MODE_PRIVATE)
        preferences.getString("id", null)?.let { return it }
        val created = java.util.UUID.randomUUID().toString()
        if (!preferences.edit().putString("id", created).commit()) error("Could not persist device identifier")
        return created
    }
}
