# =====================================================
# Pasify · ProGuard / R8 rules
# =====================================================
# Activado vía buildTypes.release { minifyEnabled true }
# Reglas mínimas y necesarias para que la APK ofuscada NO crashee al
# arrancar por clases removidas via reflection.

# ----- Capacitor core + plugins -----
# Capacitor escanea plugins via reflection (Plugin.LOAD), por lo que
# no podemos ofuscar sus nombres ni los métodos @PluginMethod.
-keep public class com.getcapacitor.** { *; }
-keep public class * implements com.getcapacitor.Plugin
-keep @com.getcapacitor.annotation.CapacitorPlugin public class *
-keepclassmembers class * {
    @com.getcapacitor.PluginMethod public *;
}
-keepclassmembers class * {
    @com.getcapacitor.annotation.PluginMethod public *;
}

# ----- Capacitor third-party plugins en uso -----
# (camera, browser, filesystem, haptics, preferences, push, share,
#  status-bar, privacy-screen, codetrix google-auth, sentry/capacitor)
-keep class com.capacitorjs.plugins.** { *; }
-keep class com.codetrix.studio.capacitor.googleauth.** { *; }
-keep class community.capacitor.privacyscreen.** { *; }
-keep class io.sentry.capacitor.** { *; }

# ----- Sentry (JVM SDK transitivo) -----
-keep class io.sentry.** { *; }
-dontwarn io.sentry.**

# ----- OkHttp / Okio (Supabase + plugins de red) -----
-dontwarn okhttp3.**
-dontwarn okio.**
-dontwarn javax.annotation.**
-dontwarn org.conscrypt.**
-dontwarn org.bouncycastle.**
-dontwarn org.openjsse.**

# ----- WebView JS interfaces -----
# Capacitor expone bridges via addJavascriptInterface — los nombres
# de clase/método NO pueden ofuscarse o el JS no los encuentra.
-keep public class * extends android.webkit.WebViewClient
-keep public class * extends android.webkit.WebChromeClient
-keepclassmembers class * {
    @android.webkit.JavascriptInterface <methods>;
}

# ----- AndroidX core/splash (Capacitor depende) -----
-keep class androidx.core.splashscreen.** { *; }
-dontwarn androidx.core.splashscreen.**

# ----- Anotaciones / metadata útiles para stack traces -----
-keepattributes Signature, InnerClasses, EnclosingMethod,
                Exceptions, Annotation, *Annotation*,
                SourceFile, LineNumberTable

# ----- Reflection generales (Gson/Json - por si Supabase usa) -----
-keepattributes RuntimeVisible*Annotations
