package dev.ironkeep.app.vault.storage

import android.content.Context
import android.util.AtomicFile
import dev.ironkeep.app.vault.crypto.BiometricVaultRecord
import kotlinx.serialization.json.Json
import java.io.File

class BiometricVaultStore(context: Context, private val json: Json) {
    private val file = AtomicFile(File(context.filesDir, "biometric-vault-key.json"))

    fun exists(): Boolean = file.baseFile.isFile

    fun read(): BiometricVaultRecord? {
        if (!exists()) return null
        val length = file.baseFile.length()
        require(length in 1..4096) { "Biometric record size is invalid" }
        val bytes = file.readFully()
        return try {
            json.decodeFromString(BiometricVaultRecord.serializer(), bytes.decodeToString()).also(BiometricVaultRecord::validate)
        } finally {
            bytes.fill(0)
        }
    }

    fun write(record: BiometricVaultRecord) {
        record.validate()
        val bytes = json.encodeToString(BiometricVaultRecord.serializer(), record).encodeToByteArray()
        try {
            val stream = file.startWrite()
            try {
                stream.write(bytes)
                stream.fd.sync()
                file.finishWrite(stream)
            } catch (error: Throwable) {
                file.failWrite(stream)
                throw error
            }
        } finally {
            bytes.fill(0)
        }
    }

    fun clear() = file.delete()
}
