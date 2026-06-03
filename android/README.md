# Gandula — native Android build

A native Android port of Gandula. The **same Rust simulation core** that powers
the CLI and the WebAssembly/web build is here cross-compiled to a native shared
library (`libgandula_android.so`) and called from a small Kotlin app through
JNI. The engine is reused as-is — no simulation logic is reimplemented — so a
match played on Android is bit-for-bit identical to the same seed on the web or
CLI.

```
android/
├── rust/                 # JNI bridge crate (gandula-android) → libgandula_android.so
│   └── src/lib.rs        #   thin shim over gandula-core, mirrors wasm/src/lib.rs
└── app/                  # Kotlin app (classic Views, AndroidX/Material)
    └── src/main/
        ├── java/.../NativeEngine.kt   # external fun bindings to the .so
        ├── java/.../MainActivity.kt   # pick two teams + seed, render the feed
        └── assets/teams/*.json        # bundled sample clubs
```

## How the bridge works

The boundary is **JSON strings**, exactly like the WASM build: Kotlin hands the
engine `Team` JSON (the same shape as `assets/teams/*.json`) and gets back
`Match` / `SeasonRecord` JSON. This keeps the Rust core the single source of
truth — the Kotlin side never has to mirror the engine's struct layout.

`NativeEngine.kt` ⇄ `rust/src/lib.rs`:

| Kotlin (`NativeEngine`)                       | Rust / engine call        |
|-----------------------------------------------|---------------------------|
| `playMatch(home, away, seed)`                 | `simulate`                |
| `playFirstHalf(home, away, seed)`             | `simulate_first_half`     |
| `playSecondHalf(snapshot, home, away)`        | `simulate_second_half`    |
| `projectMatch(home, away)`                    | `project_match`           |
| `runSeason(teams, seed, name)`                | `simulate_season`         |
| `deriveMatchSeed(seasonSeed, fixtureIdx)`     | `match_seed`              |

## Prerequisites

- **Rust** (stable, via `rustup`) with the Android targets:
  ```bash
  rustup target add aarch64-linux-android armv7-linux-androideabi x86_64-linux-android
  ```
- **cargo-ndk** — drives the cross-compile and drops each `.so` into `jniLibs`:
  ```bash
  cargo install cargo-ndk
  ```
- **Android SDK + NDK** (Android Studio, or the command-line tools). Point
  cargo-ndk at the NDK via `ANDROID_NDK_HOME`, e.g.
  `export ANDROID_NDK_HOME=$ANDROID_SDK_ROOT/ndk/27.2.12479018`.

## Build & run

From this `android/` directory:

```bash
# Debug APK (builds the native engine for every ABI in gradle.properties first)
./gradlew assembleDebug

# Install on a connected device / running emulator
./gradlew installDebug
```

The APK lands in `app/build/outputs/apk/debug/`. Open the project in Android
Studio for the usual Run ▶ workflow — the `cargoBuild` Gradle task compiles the
Rust engine automatically before packaging.

### Faster local builds

Building three ABIs is slow. Restrict to your device/emulator's ABI:

```bash
./gradlew assembleDebug -Pandroid.abis=arm64-v8a   # most physical devices
./gradlew assembleDebug -Pandroid.abis=x86_64       # most emulators
```

### Build just the native library

To iterate on the Rust bridge without Gradle:

```bash
cd rust
cargo ndk -t arm64-v8a -o ../app/src/main/jniLibs build --release
```

## CI

`.github/workflows/android.yml` installs the NDK + cargo-ndk, builds the engine
for all ABIs, assembles the debug APK, and uploads it as an artifact. That
workflow is the canonical "does it compile natively for Android" check.
