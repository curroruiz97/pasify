package es.pasify.app;

import android.os.Bundle;
import android.view.View;
import androidx.core.view.WindowCompat;
import androidx.core.view.WindowInsetsCompat;
import androidx.core.view.WindowInsetsControllerCompat;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        enableImmersive();
    }

    @Override
    public void onWindowFocusChanged(boolean hasFocus) {
        super.onWindowFocusChanged(hasFocus);
        // Riaffermo immersive quando l'app riprende il focus: Android altrimenti
        // ripristina le barre quando l'utente swipa dal bordo.
        if (hasFocus) enableImmersive();
    }

    private void enableImmersive() {
        // App disegna sotto le system bars (status + nav).
        WindowCompat.setDecorFitsSystemWindows(getWindow(), false);

        View decor = getWindow().getDecorView();
        WindowInsetsControllerCompat controller = WindowCompat.getInsetsController(getWindow(), decor);
        if (controller != null) {
            controller.hide(WindowInsetsCompat.Type.systemBars());
            // Sticky immersive: swipe dal bordo le mostra ma poi spariscono di nuovo.
            controller.setSystemBarsBehavior(
                WindowInsetsControllerCompat.BEHAVIOR_SHOW_TRANSIENT_BARS_BY_SWIPE
            );
        }
    }
}
