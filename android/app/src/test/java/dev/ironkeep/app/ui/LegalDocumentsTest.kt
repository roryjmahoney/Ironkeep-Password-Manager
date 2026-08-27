package dev.ironkeep.app.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class LegalDocumentsTest {
    @Test
    fun parserKeepsHeadingsParagraphsAndWrappedBullets() {
        val blocks = parseLegalMarkdown(
            """
            # Document title

            **Status:** Effective

            ## Information handled

            - First bullet wraps
              onto another source line.
            - Second `bullet`.

            Read the [privacy notice](PRIVACY.md) now.
            """.trimIndent(),
        )

        assertEquals(
            listOf(
                LegalBlock(LegalBlockKind.PARAGRAPH, "Status: Effective"),
                LegalBlock(LegalBlockKind.HEADING, "Information handled"),
                LegalBlock(LegalBlockKind.BULLET, "First bullet wraps onto another source line."),
                LegalBlock(LegalBlockKind.BULLET, "Second bullet."),
                LegalBlock(LegalBlockKind.PARAGRAPH, "Read the privacy notice now."),
            ),
            blocks,
        )
    }

    @Test
    fun everyLegalDocumentUsesBundledMarkdown() {
        LegalDocument.entries.forEach { document ->
            assertTrue(document.assetName.startsWith("legal/"))
            assertTrue(document.assetName.endsWith(".md"))
            assertFalse(document.title.isBlank())
        }
    }
}
