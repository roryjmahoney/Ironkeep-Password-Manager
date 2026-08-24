package dev.ironkeep.app.sync

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.MultipartBody
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.net.URLEncoder
import java.io.ByteArrayOutputStream

interface GoogleAccessTokenProvider {
    suspend fun accessToken(interactive: Boolean): String
}

data class RemoteVault(
    val fileId: String,
    val etag: String,
    val modifiedTime: String,
    val md5Checksum: String,
    val bytes: ByteArray,
)

class DriveConflictException(message: String) : IllegalStateException(message)

class GoogleDriveRemote(
    private val tokens: GoogleAccessTokenProvider,
    private val http: OkHttpClient = OkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true },
) {
    companion object {
        const val SCOPE = "https://www.googleapis.com/auth/drive.appdata"
        private const val FILE_NAME = "ironkeep-vault.ikv"
        private const val MAX_VAULT_BYTES = 64 * 1024 * 1024
    }

    suspend fun read(interactive: Boolean = false): RemoteVault? = withContext(Dispatchers.IO) {
        val query = URLEncoder.encode("name = '$FILE_NAME' and trashed = false", Charsets.UTF_8.name())
        val listUrl = "https://www.googleapis.com/drive/v3/files?spaces=appDataFolder&q=$query&orderBy=modifiedTime%20desc&pageSize=10&fields=files(id,modifiedTime,md5Checksum)"
        val list = execute(listUrl, interactive = interactive).use {
            json.decodeFromString(DriveList.serializer(), it.body.string())
        }
        if (list.files.isEmpty()) return@withContext null
        if (list.files.size > 1) throw DriveConflictException("Multiple Ironkeep vault files exist in Drive")
        val summary = list.files.single()
        val metadata = execute("https://www.googleapis.com/drive/v3/files/${summary.id}?fields=id,modifiedTime,md5Checksum")
        val etag = metadata.header("ETag").orEmpty()
        metadata.close()
        val content = execute("https://www.googleapis.com/drive/v3/files/${summary.id}?alt=media")
        val bytes = content.use(::readBounded)
        RemoteVault(summary.id, etag, summary.modifiedTime, summary.md5Checksum.orEmpty(), bytes)
    }

    suspend fun create(bytes: ByteArray): RemoteVault = withContext(Dispatchers.IO) {
        require(bytes.size <= MAX_VAULT_BYTES) { "Vault exceeds the 64 MiB limit" }
        if (read() != null) throw DriveConflictException("An Ironkeep vault already exists in Drive")
        val multipart = MultipartBody.Builder("ironkeep-${java.util.UUID.randomUUID()}")
            .setType("multipart/related".toMediaType())
            .addPart(
                json.encodeToString(
                    DriveCreateMetadata.serializer(),
                    DriveCreateMetadata(name = FILE_NAME, parents = listOf("appDataFolder")),
                ).toRequestBody("application/json; charset=UTF-8".toMediaType()),
            )
            .addPart(bytes.toRequestBody("application/octet-stream".toMediaType()))
            .build()
        val request = Request.Builder()
            .url("https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id")
            .header("Authorization", "Bearer ${tokens.accessToken(false)}")
            .post(multipart)
            .build()
        val createdId = http.newCall(request).execute().use { response ->
            if (!response.isSuccessful) error("Drive create failed (${response.code})")
            json.decodeFromString(DriveCreated.serializer(), response.body.string()).id
        }
        val created = read() ?: error("Drive create succeeded but the vault could not be read back")
        if (created.fileId != createdId) throw DriveConflictException("Multiple Ironkeep vault files exist in Drive")
        created
    }

    suspend fun update(remote: RemoteVault, bytes: ByteArray): String = withContext(Dispatchers.IO) {
        require(bytes.size <= MAX_VAULT_BYTES) { "Vault exceeds the 64 MiB limit" }
        if (remote.etag.isBlank()) throw DriveConflictException("Missing Drive ETag; refusing an unconditional overwrite")
        val request = Request.Builder()
            .url("https://www.googleapis.com/upload/drive/v3/files/${remote.fileId}?uploadType=media&fields=id,modifiedTime,md5Checksum")
            .header("Authorization", "Bearer ${tokens.accessToken(false)}")
            .header("If-Match", remote.etag)
            .patch(bytes.toRequestBody("application/octet-stream".toMediaType()))
            .build()
        http.newCall(request).execute().use { response ->
            if (response.code == 412) throw DriveConflictException("Drive vault changed since download")
            if (!response.isSuccessful) error("Drive update failed (${response.code})")
            response.header("ETag").orEmpty()
        }
    }

    private suspend fun execute(url: String, interactive: Boolean = false): okhttp3.Response {
        val token = tokens.accessToken(interactive)
        val response = http.newCall(Request.Builder().url(url).header("Authorization", "Bearer $token").get().build()).execute()
        if (!response.isSuccessful) {
            val code = response.code
            response.close()
            error("Drive request failed ($code)")
        }
        return response
    }

    private fun readBounded(response: okhttp3.Response): ByteArray {
        val declared = response.body.contentLength()
        if (declared > MAX_VAULT_BYTES) throw IllegalArgumentException("Remote vault exceeds the 64 MiB limit")
        val output = ByteArrayOutputStream(if (declared in 1..MAX_VAULT_BYTES) declared.toInt() else 8192)
        val buffer = ByteArray(8192)
        response.body.byteStream().use { input ->
            while (true) {
                val count = input.read(buffer)
                if (count < 0) break
                if (output.size() + count > MAX_VAULT_BYTES) throw IllegalArgumentException("Remote vault exceeds the 64 MiB limit")
                output.write(buffer, 0, count)
            }
        }
        buffer.fill(0)
        return output.toByteArray()
    }
}

@Serializable private data class DriveList(val files: List<DriveFile> = emptyList())
@Serializable private data class DriveFile(val id: String, val modifiedTime: String, val md5Checksum: String? = null)
@Serializable private data class DriveCreateMetadata(val name: String, val parents: List<String>, val mimeType: String = "application/vnd.ironkeep.vault")
@Serializable private data class DriveCreated(val id: String)
