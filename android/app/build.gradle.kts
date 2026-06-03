import org.gradle.internal.os.OperatingSystem

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// ABIs to build the native engine for, from gradle.properties (overridable with
// -Pandroid.abis=...). These names are both valid Android ABI filters AND valid
// cargo-ndk -t targets, so the same list drives both.
val abiList: List<String> =
    (project.findProperty("android.abis") as String? ?: "arm64-v8a")
        .split(",").map { it.trim() }.filter { it.isNotEmpty() }

android {
    namespace = "dev.debene.gandula"
    compileSdk = 35

    defaultConfig {
        applicationId = "dev.debene.gandula"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "1.1.0"
        ndk { abiFilters += abiList }
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions {
        jvmTarget = "17"
    }

    // The native libs are produced by the cargoBuild task below into this dir.
    sourceSets["main"].jniLibs.srcDir(layout.buildDirectory.dir("rustJniLibs"))
}

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.appcompat:appcompat:1.7.0")
    implementation("com.google.android.material:material:1.12.0")
}

// ─── Native engine: cross-compile the Rust core with cargo-ndk ───────────────
//
// Runs `cargo ndk` to build android/rust into a per-ABI libgandula_android.so
// under build/rustJniLibs/<abi>/, which the jniLibs srcDir above then packages
// into the APK. Requires the Rust toolchain (rustup) and `cargo-ndk`
// (`cargo install cargo-ndk`) on PATH, plus the Android NDK — cargo-ndk locates
// it via ANDROID_NDK_HOME or the SDK's ndk/ folder.
val rustDir = file("${rootDir}/rust")
val jniOut = layout.buildDirectory.dir("rustJniLibs")

val cargoBuild by tasks.registering(Exec::class) {
    group = "build"
    description = "Cross-compiles the Rust simulation engine for: ${abiList.joinToString()}"

    // Re-run only when the engine sources or this ABI selection change.
    inputs.dir(rustDir)
    inputs.dir(file("${rootDir}/../core"))
    inputs.property("abis", abiList)
    outputs.dir(jniOut)

    workingDir = rustDir
    val cargo = if (OperatingSystem.current().isWindows) "cargo.exe" else "cargo"
    val args = mutableListOf(cargo, "ndk", "-o", jniOut.get().asFile.absolutePath)
    abiList.forEach { args += listOf("-t", it) }
    args += listOf("build", "--release")
    commandLine(args)
}

// Make sure the .so files exist before the APK is assembled.
tasks.named("preBuild").configure { dependsOn(cargoBuild) }
