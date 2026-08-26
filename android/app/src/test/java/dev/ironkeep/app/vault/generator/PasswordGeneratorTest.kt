package dev.ironkeep.app.vault.generator

import dev.ironkeep.app.vault.model.PasswordGeneratorOptions
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class PasswordGeneratorTest {
    @Test
    fun defaultsCoverEveryEnabledClassAndExcludeAmbiguousCharacters() {
        val password = PasswordGenerator.generate()

        assertEquals(20, password.length)
        assertTrue(password.any(Char::isLowerCase))
        assertTrue(password.any(Char::isUpperCase))
        assertTrue(password.any(Char::isDigit))
        assertTrue(password.any { !it.isLetterOrDigit() })
        assertFalse(password.any { it in "Il1O0o|`'\"{}[]()<>" })
    }

    @Test
    fun respectsLengthAndSelectedCharacterClasses() {
        val password = PasswordGenerator.generate(
            PasswordGeneratorOptions(
                length = 32,
                lowercase = false,
                uppercase = false,
                digits = true,
                symbols = false,
                excludeAmbiguous = false,
            ),
        )

        assertEquals(32, password.length)
        assertTrue(password.all(Char::isDigit))
    }

    @Test
    fun rejectsUnsafeLengthsAndEmptyCharacterSelection() {
        assertThrows(IllegalArgumentException::class.java) {
            PasswordGenerator.generate(PasswordGeneratorOptions(length = 7))
        }
        assertThrows(IllegalArgumentException::class.java) {
            PasswordGenerator.generate(
                PasswordGeneratorOptions(
                    lowercase = false,
                    uppercase = false,
                    digits = false,
                    symbols = false,
                ),
            )
        }
    }
}
