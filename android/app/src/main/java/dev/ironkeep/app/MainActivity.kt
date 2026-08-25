package dev.ironkeep.app

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.activity.viewModels
import androidx.fragment.app.FragmentActivity
import dev.ironkeep.app.ui.IronkeepApp
import dev.ironkeep.app.ui.theme.IronkeepTheme
import dev.ironkeep.app.vault.VaultViewModel

class MainActivity : FragmentActivity() {
    private val vaultViewModel by viewModels<VaultViewModel>()

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            IronkeepTheme {
                IronkeepApp(vaultViewModel)
            }
        }
    }

    override fun onStart() {
        super.onStart()
        vaultViewModel.onForeground()
    }

    override fun onStop() {
        vaultViewModel.onBackground()
        super.onStop()
    }

    override fun onUserInteraction() {
        super.onUserInteraction()
        vaultViewModel.recordUserActivity()
    }
}
