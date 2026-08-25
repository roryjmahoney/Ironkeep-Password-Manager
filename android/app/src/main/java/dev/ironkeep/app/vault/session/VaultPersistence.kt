package dev.ironkeep.app.vault.session

import dev.ironkeep.app.vault.crypto.UnlockedVault
import dev.ironkeep.app.vault.crypto.VaultCrypto
import dev.ironkeep.app.vault.model.VaultPayload
import dev.ironkeep.app.vault.storage.VaultStore

class VaultPersistence(private val crypto: VaultCrypto, private val store: VaultStore) {
    fun persist(session: UnlockedVault, payload: VaultPayload): VaultPayload {
        val file = crypto.encryptUpdated(session, payload)
        store.write(file)
        session.commit(file, payload)
        return payload
    }
}
