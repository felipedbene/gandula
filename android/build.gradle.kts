// Root build script. Plugin versions are declared here (apply false) and applied
// in the :app module, so every module agrees on one AGP / Kotlin version.
plugins {
    id("com.android.application") version "8.7.3" apply false
    id("org.jetbrains.kotlin.android") version "2.0.21" apply false
}
