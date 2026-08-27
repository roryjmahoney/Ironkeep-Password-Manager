package dev.ironkeep.app.ui

internal enum class LegalDocument(
    val title: String,
    val assetName: String,
) {
    PRIVACY("Privacy notice", "legal/PRIVACY.md"),
    TERMS("Terms of use", "legal/TERMS.md"),
}

internal enum class LegalBlockKind { HEADING, PARAGRAPH, BULLET }

internal data class LegalBlock(
    val kind: LegalBlockKind,
    val text: String,
)

internal fun parseLegalMarkdown(source: String): List<LegalBlock> {
    val lines = source.replace("\r\n", "\n").split('\n')
    val blocks = mutableListOf<LegalBlock>()
    var index = 0

    while (index < lines.size) {
        val line = lines[index].trimEnd()
        if (line.isBlank()) {
            index += 1
            continue
        }

        if (line.startsWith("# ")) {
            index += 1
            continue
        }

        if (line.startsWith("## ")) {
            blocks += LegalBlock(LegalBlockKind.HEADING, plainLegalText(line.removePrefix("## ")))
            index += 1
            continue
        }

        if (line.startsWith("- ")) {
            val text = StringBuilder(line.removePrefix("- "))
            index += 1
            while (index < lines.size) {
                val continuation = lines[index]
                if (continuation.isBlank() || continuation.trimStart().startsWith("- ") || continuation.startsWith("#")) break
                text.append(' ').append(continuation.trim())
                index += 1
            }
            blocks += LegalBlock(LegalBlockKind.BULLET, plainLegalText(text.toString()))
            continue
        }

        val paragraph = StringBuilder(line.trim())
        index += 1
        while (index < lines.size) {
            val continuation = lines[index]
            if (continuation.isBlank() || continuation.startsWith("#") || continuation.trimStart().startsWith("- ")) break
            paragraph.append(' ').append(continuation.trim())
            index += 1
        }
        blocks += LegalBlock(LegalBlockKind.PARAGRAPH, plainLegalText(paragraph.toString()))
    }

    return blocks
}

private fun plainLegalText(value: String): String = value
    .replace(Regex("""\[([^]]+)]\([^)]+\)"""), "$1")
    .replace("**", "")
    .replace("`", "")
    .trim()
