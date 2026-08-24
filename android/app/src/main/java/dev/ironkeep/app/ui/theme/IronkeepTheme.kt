package dev.ironkeep.app.ui.theme

import android.app.Activity
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.material3.ColorScheme
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.Typography
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.SideEffect
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalView
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.view.WindowCompat

private val Graphite = Color(0xFF111416)
private val Ivory = Color(0xFFF3F0E7)
private val Brass = Color(0xFFD1A85B)
private val Field = Color(0xFF171B1E)
private val Line = Color(0xFF30373B)
private val Muted = Color(0xFFA6ACAE)
private val Danger = Color(0xFFC85D52)

private val DarkColors = darkColorScheme(
    primary = Brass,
    onPrimary = Graphite,
    background = Graphite,
    onBackground = Ivory,
    surface = Field,
    onSurface = Ivory,
    surfaceVariant = Color(0xFF1D2226),
    onSurfaceVariant = Muted,
    outline = Line,
    error = Danger,
)

private val LightColors = lightColorScheme(
    primary = Color(0xFF745518),
    onPrimary = Color.White,
    background = Color(0xFFF6F3EA),
    onBackground = Color(0xFF171A1B),
    surface = Color(0xFFFCFAF4),
    onSurface = Color(0xFF171A1B),
    surfaceVariant = Color(0xFFEAE6DC),
    onSurfaceVariant = Color(0xFF555C5F),
    outline = Color(0xFFB9B5AA),
    error = Color(0xFF9F3C34),
)

private val IronkeepTypography = Typography(
    displayLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Medium, fontSize = 48.sp, lineHeight = 47.sp, letterSpacing = (-1.2).sp),
    headlineLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.Medium, fontSize = 34.sp, lineHeight = 36.sp, letterSpacing = (-0.6).sp),
    titleLarge = TextStyle(fontFamily = FontFamily.Serif, fontWeight = FontWeight.SemiBold, fontSize = 24.sp, lineHeight = 28.sp),
    bodyLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 16.sp, lineHeight = 24.sp),
    bodyMedium = TextStyle(fontFamily = FontFamily.SansSerif, fontSize = 14.sp, lineHeight = 21.sp),
    labelLarge = TextStyle(fontFamily = FontFamily.SansSerif, fontWeight = FontWeight.Bold, fontSize = 13.sp, letterSpacing = 0.2.sp),
    labelSmall = TextStyle(fontFamily = FontFamily.Monospace, fontWeight = FontWeight.Bold, fontSize = 10.sp, letterSpacing = 1.4.sp),
)

@Composable
fun IronkeepTheme(darkTheme: Boolean = isSystemInDarkTheme(), content: @Composable () -> Unit) {
    val colors: ColorScheme = if (darkTheme) DarkColors else LightColors
    val view = LocalView.current
    if (!view.isInEditMode) {
        SideEffect {
            val window = (view.context as Activity).window
            WindowCompat.getInsetsController(window, view).isAppearanceLightStatusBars = !darkTheme
        }
    }
    MaterialTheme(
        colorScheme = colors,
        typography = IronkeepTypography,
        shapes = Shapes(extraSmall = androidx.compose.foundation.shape.RoundedCornerShape(2.dp), small = androidx.compose.foundation.shape.RoundedCornerShape(3.dp), medium = androidx.compose.foundation.shape.RoundedCornerShape(6.dp)),
        content = content,
    )
}
