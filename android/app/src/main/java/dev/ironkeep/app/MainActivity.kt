package dev.ironkeep.app

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import androidx.lifecycle.viewmodel.compose.viewModel
import dev.ironkeep.app.ui.IronkeepApp
import dev.ironkeep.app.ui.theme.IronkeepTheme
import dev.ironkeep.app.vault.VaultViewModel

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            IronkeepTheme {
                IronkeepApp(viewModel<VaultViewModel>())
            }
        }
    }
}
