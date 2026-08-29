package dev.ironkeep.app.vault.csv

import dev.ironkeep.app.vault.model.LoginFields
import dev.ironkeep.app.vault.model.LoginItem
import dev.ironkeep.app.vault.model.VaultMutations
import dev.ironkeep.app.vault.model.VaultPayload
import org.junit.Assert.assertEquals
import org.junit.Test

class VaultCsvTest {
    @Test
    fun roundTripsQuotedLoginAndSkipsDuplicate() {
        val source = VaultMutations.addLogin(
            VaultPayload.empty("Source", "device-a"),
            LoginFields("Example, Inc.", "person@example.com", "p@ss,word", listOf("https://example.com"), emptyList()),
            "device-a",
        )
        val empty = VaultPayload.empty("Empty", "device-b")
        val parsed = VaultCsv.preview(empty, VaultCsv.export(source))
        val imported = VaultCsv.apply(empty, parsed.records, false, "device-b")
        assertEquals("Example, Inc.", (imported.items.single() as LoginItem).title)

        val duplicate = VaultCsv.preview(imported, VaultCsv.export(source))
        assertEquals(1, duplicate.preview.duplicateRows)
        assertEquals(1, VaultCsv.apply(imported, duplicate.records, false, "device-b").items.size)
    }

    @Test
    fun importsFirefoxStyleCsvWithoutNameColumn() {
        val parsed = VaultCsv.preview(
            VaultPayload.empty("Test", "device-a"),
            "url,username,password,httpRealm\r\nhttps://accounts.example.test/login,person@example.test,secret,\r\n".encodeToByteArray(),
        )
        val record = parsed.records.single().record as CsvRecord.Login
        assertEquals("accounts.example.test", record.fields.title)
    }
}
