package dev.ironkeep.app.vault.session

import android.content.Context
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.storage.VaultFileStore
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.sync.Mutex
import kotlinx.coroutines.sync.withLock
import kotlinx.coroutines.withContext

sealed interface VaultMutationResult {
    data class Success(val payload: VaultPayload) : VaultMutationResult
    data object Locked : VaultMutationResult
    data object Failed : VaultMutationResult
}

class VaultMutationCoordinator internal constructor(
    private val persistence: VaultPersistence,
) {
    constructor(context: Context) : this(
        VaultCrypto().let { crypto -> VaultPersistence(crypto, VaultFileStore(context.applicationContext, crypto.json)) },
    )

    suspend fun mutate(transform: (VaultPayload) -> VaultPayload): VaultMutationResult = sessionMutex.withLock {
        val session = VaultSessionHolder.sessionOrNull() ?: return@withLock VaultMutationResult.Locked
        val previous = session.payload
        try {
            val next = withContext(Dispatchers.Default) { transform(previous) }
            withContext(Dispatchers.IO) { persistence.persist(session, next) }
            VaultMutationResult.Success(next)
        } catch (_: Exception) {
            VaultMutationResult.Failed
        }
    }

    suspend fun <T> withSessionLock(block: suspend () -> T): T = sessionMutex.withLock { block() }

    private companion object {
        val sessionMutex = Mutex()
    }
}
