package dev.ironkeep.app.vault.storage

import android.content.Context
import android.util.AtomicFile
import dev.ironkeep.app.vault.crypto.VaultFormatException
import dev.ironkeep.app.vault.model.VaultFile
import kotlinx.serialization.json.Json
import java.io.File

interface VaultStore {
    fun exists(): Boolean
    fun read(): VaultFile
    fun write(vault: VaultFile)
}

class VaultFileStore(context: Context, private val json: Json) : VaultStore {
    private val file = AtomicFile(File(context.filesDir, "vault.ikv"))

    override fun exists(): Boolean = file.baseFile.isFile

    override fun read(): VaultFile {
        val length = file.baseFile.length()
        if (length <= 0 || length > 64L * 1024 * 1024) throw VaultFormatException("Vault file size is invalid")
        val bytes = file.readFully()
        return try {
            json.decodeFromString(VaultFile.serializer(), bytes.decodeToString())
        } finally {
            bytes.fill(0)
        }
    }

    override fun write(vault: VaultFile) {
        val bytes = json.encodeToString(VaultFile.serializer(), vault).encodeToByteArray()
        val stream = file.startWrite()
        try {
            stream.write(bytes)
            stream.fd.sync()
            file.finishWrite(stream)
        } catch (error: Throwable) {
            file.failWrite(stream)
            throw error
        } finally {
            bytes.fill(0)
        }
    }
}
