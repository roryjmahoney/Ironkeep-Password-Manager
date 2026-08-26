package dev.ironkeep.app.vault.generator

import dev.ironkeep.app.vault.model.PasswordGeneratorOptions
import java.security.SecureRandom

internal object PasswordGenerator {
    private const val LOWERCASE = "abcdefghijklmnopqrstuvwxyz"
    private const val UPPERCASE = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    private const val DIGITS = "0123456789"
    private const val SYMBOLS = "!@#$%^&*()-_=+[]{};:,.?/"
    private val ambiguous = "Il1O0o|`'\"{}[]()<>".toSet()
    private val random = SecureRandom()

    fun generate(options: PasswordGeneratorOptions = PasswordGeneratorOptions()): String {
        require(options.length in 8..256) { "Password length must be between 8 and 256" }

        val sets = buildList {
            if (options.lowercase) add(LOWERCASE)
            if (options.uppercase) add(UPPERCASE)
            if (options.digits) add(DIGITS)
            if (options.symbols) add(SYMBOLS)
        }.map { characters ->
            if (options.excludeAmbiguous) characters.filterNot(ambiguous::contains) else characters
        }
        require(sets.isNotEmpty() && options.length >= sets.size) {
            "Select at least one character set and allow room for every selected set"
        }

        val combined = sets.joinToString("")
        val password = CharArray(options.length)
        var size = 0
        try {
            sets.forEach { characters ->
                password[size++] = choose(characters)
            }
            while (size < password.size) {
                val previous = password.getOrNull(size - 1).takeIf { options.avoidRepeatingCharacters }
                password[size++] = choose(combined, previous)
            }
            for (index in password.lastIndex downTo 1) {
                val target = random.nextInt(index + 1)
                val value = password[index]
                password[index] = password[target]
                password[target] = value
            }
            return password.concatToString()
        } finally {
            password.fill('\u0000')
        }
    }

    private fun choose(characters: String, previous: Char? = null): Char {
        require(characters.isNotEmpty()) { "Character set is empty" }
        if (characters.length == 1) return characters[0]
        var selected: Char
        do {
            selected = characters[random.nextInt(characters.length)]
        } while (selected == previous)
        return selected
    }
}
