package dev.ironkeep.app.vault.csv

import dev.ironkeep.app.vault.model.CreditCardFields
import dev.ironkeep.app.vault.model.CreditCardItem
import dev.ironkeep.app.vault.model.IdentityFields
import dev.ironkeep.app.vault.model.IdentityItem
import dev.ironkeep.app.vault.model.LoginFields
import dev.ironkeep.app.vault.model.LoginItem
import dev.ironkeep.app.vault.model.SecureNoteFields
import dev.ironkeep.app.vault.model.SecureNoteItem
import dev.ironkeep.app.vault.model.VaultMutations
import dev.ironkeep.app.vault.model.VaultPayload

const val MAX_CSV_BYTES = 16 * 1024 * 1024
private const val MAX_CSV_ROWS = 10_000
private const val MAX_CSV_FIELD_LENGTH = 64 * 1024

data class CsvPreview(val totalRows: Int, val validRows: Int, val duplicateRows: Int, val invalidRows: Int)

sealed interface CsvRecord {
    data class Login(val fields: LoginFields) : CsvRecord
    data class SecureNote(val fields: SecureNoteFields) : CsvRecord
    data class CreditCard(val fields: CreditCardFields) : CsvRecord
    data class Identity(val fields: IdentityFields) : CsvRecord
}

data class ParsedCsvRecord(val record: CsvRecord, val duplicate: Boolean)
data class ParsedCsv(val preview: CsvPreview, val records: List<ParsedCsvRecord>)

object VaultCsv {
    private val headers = listOf(
        "kind", "title", "username", "password", "url", "notes", "cardholder_name", "card_number",
        "expiry_month", "expiry_year", "verification_code", "first_name", "middle_name", "last_name", "email",
        "phone", "company", "address_line_1", "address_line_2", "city", "region", "postal_code", "country",
    )

    fun export(payload: VaultPayload): ByteArray {
        val rows = payload.items.map { item ->
            when (item) {
                is LoginItem -> listOf("login", item.title, item.username, item.password, item.uris.joinToString("\n"), item.notes)
                is SecureNoteItem -> listOf("secureNote", item.title, "", "", "", item.body)
                is CreditCardItem -> listOf("creditCard", item.title, "", "", "", item.notes, item.cardholderName, item.number, item.expiryMonth, item.expiryYear, item.verificationCode)
                is IdentityItem -> listOf(
                    "identity", item.title, "", "", "", item.notes, "", "", "", "", "", item.firstName,
                    item.middleName, item.lastName, item.email, item.phone, item.company, item.addressLine1,
                    item.addressLine2, item.city, item.region, item.postalCode, item.country,
                )
            }
        }
        return buildString {
            append(headers.joinToString(","))
            append("\r\n")
            rows.forEach { row ->
                append(headers.indices.joinToString(",") { index -> csv(row.getOrNull(index)?.toString().orEmpty()) })
                append("\r\n")
            }
        }.encodeToByteArray()
    }

    fun preview(payload: VaultPayload, bytes: ByteArray): ParsedCsv {
        require(bytes.isNotEmpty() && bytes.size <= MAX_CSV_BYTES) { "CSV file size is invalid" }
        val rows = parse(bytes.decodeToString())
        require(rows.size >= 2) { "CSV must include a header and at least one row" }
        val headings = rows.first().map { it.trim().lowercase() }
        val commonLogin = "kind" !in headings && setOf("url", "username", "password").all(headings::contains)
        require(commonLogin || "kind" in headings) { "CSV header is unsupported" }

        var shadow = payload
        val records = mutableListOf<ParsedCsvRecord>()
        var invalid = 0
        rows.drop(1).forEach { values ->
            runCatching {
                val row = headings.mapIndexed { index, heading -> heading to values.getOrElse(index) { "" }.trim() }.toMap()
                val record = record(row, commonLogin)
                val duplicate = duplicate(shadow, record)
                shadow = add(shadow, record, "csv-preview")
                records += ParsedCsvRecord(record, duplicate)
            }.onFailure { invalid += 1 }
        }
        return ParsedCsv(
            CsvPreview(rows.size - 1, records.size, records.count(ParsedCsvRecord::duplicate), invalid),
            records,
        )
    }

    fun apply(payload: VaultPayload, records: List<ParsedCsvRecord>, includeDuplicates: Boolean, deviceId: String): VaultPayload =
        records.fold(payload) { current, entry -> if (entry.duplicate && !includeDuplicates) current else add(current, entry.record, deviceId) }

    private fun record(row: Map<String, String>, commonLogin: Boolean): CsvRecord {
        fun value(key: String) = row[key].orEmpty()
        return when (val kind = if (commonLogin) "login" else value("kind")) {
            "login" -> CsvRecord.Login(LoginFields(
                title = value("title").ifBlank { value("name") }.ifBlank { runCatching { java.net.URI(value("url")).host }.getOrNull().orEmpty().ifBlank { "Imported login" } },
                username = value("username"),
                password = value("password"),
                uris = value("url").ifBlank { value("uris") }.lines().map(String::trim).filter(String::isNotEmpty),
                androidPackageNames = emptyList(),
            ))
            "secureNote" -> CsvRecord.SecureNote(SecureNoteFields(value("title"), value("notes").ifBlank { value("body") }))
            "creditCard" -> CsvRecord.CreditCard(CreditCardFields(
                value("title"), value("cardholder_name"), value("card_number"), value("expiry_month").toInt(),
                value("expiry_year").toInt(), value("verification_code"), null, value("notes"),
            ))
            "identity" -> CsvRecord.Identity(IdentityFields(
                value("title"), value("first_name"), value("middle_name"), value("last_name"), value("email"),
                value("phone"), value("company"), value("address_line_1"), value("address_line_2"), value("city"),
                value("region"), value("postal_code"), value("country"), value("notes"),
            ))
            else -> error("Unsupported CSV item kind: $kind")
        }
    }

    private fun duplicate(payload: VaultPayload, record: CsvRecord): Boolean = when (record) {
        is CsvRecord.Login -> VaultMutations.likelyDuplicates(payload, record.fields).isNotEmpty()
        is CsvRecord.SecureNote -> VaultMutations.likelySecureNoteDuplicates(payload, record.fields).isNotEmpty()
        is CsvRecord.CreditCard -> VaultMutations.likelyCreditCardDuplicates(payload, record.fields).isNotEmpty()
        is CsvRecord.Identity -> VaultMutations.likelyIdentityDuplicates(payload, record.fields).isNotEmpty()
    }

    private fun add(payload: VaultPayload, record: CsvRecord, deviceId: String): VaultPayload = when (record) {
        is CsvRecord.Login -> VaultMutations.addLogin(payload, record.fields, deviceId)
        is CsvRecord.SecureNote -> VaultMutations.addSecureNote(payload, record.fields, deviceId)
        is CsvRecord.CreditCard -> VaultMutations.addCreditCard(payload, record.fields, deviceId)
        is CsvRecord.Identity -> VaultMutations.addIdentity(payload, record.fields, deviceId)
    }

    private fun csv(value: String): String = if (value.any { it == ',' || it == '"' || it == '\r' || it == '\n' }) {
        "\"${value.replace("\"", "\"\"")}\""
    } else value

    private fun parse(text: String): List<List<String>> {
        val rows = mutableListOf<List<String>>()
        var row = mutableListOf<String>()
        val field = StringBuilder()
        var quoted = false
        var index = 0
        while (index < text.length) {
            val character = text[index]
            when {
                quoted && character == '"' && text.getOrNull(index + 1) == '"' -> { field.append('"'); index += 1 }
                quoted && character == '"' -> quoted = false
                quoted -> field.append(character)
                character == '"' && field.isEmpty() -> quoted = true
                character == ',' -> { require(field.length <= MAX_CSV_FIELD_LENGTH); row += field.toString(); field.clear() }
                character == '\r' || character == '\n' -> {
                    if (character == '\r' && text.getOrNull(index + 1) == '\n') index += 1
                    require(field.length <= MAX_CSV_FIELD_LENGTH)
                    row += field.toString()
                    field.clear()
                    if (row.any(String::isNotEmpty)) rows += row
                    row = mutableListOf()
                    require(rows.size <= MAX_CSV_ROWS + 1) { "CSV has too many rows" }
                }
                else -> field.append(character)
            }
            index += 1
        }
        require(!quoted) { "CSV has an unterminated quoted field" }
        if (field.isNotEmpty() || row.isNotEmpty()) {
            row += field.toString()
            if (row.any(String::isNotEmpty)) rows += row
        }
        return rows
    }
}
