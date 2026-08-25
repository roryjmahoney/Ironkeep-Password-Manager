package dev.ironkeep.app.vault.session

import dev.ironkeep.app.vault.crypto.UnlockedVault
import dev.ironkeep.app.vault.model.VaultPayload

object VaultSessionHolder {
    @Volatile private var session: UnlockedVault? = null

    @Synchronized
    fun replace(value: UnlockedVault) {
        session?.close()
        session = value
    }

    fun payloadOrNull(): VaultPayload? = session?.payload

    fun sessionOrNull(): UnlockedVault? = session

    @Synchronized
    fun lock() {
        session?.close()
        session = null
    }
}
