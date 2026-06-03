package dev.debene.gandula

/**
 * Kotlin binding for the native Gandula simulation engine.
 *
 * Every method here is implemented in Rust (`android/rust/src/lib.rs`) and maps
 * 1:1 to the engine functions the WASM/web build also uses. The boundary is
 * JSON strings: pass `Team` JSON in, get `Match` / `SeasonRecord` JSON back —
 * the exact same shapes the CLI loads from `assets/teams/*.json`. This keeps the
 * Rust core the single source of truth; the app never re-implements simulation.
 *
 * On any engine error the native side throws a [RuntimeException] carrying the
 * engine's message, so callers can wrap calls in a normal try/catch.
 */
object NativeEngine {
    init {
        // Loads libgandula_android.so from the APK's jniLibs/<abi>/ folder,
        // produced by `cargo ndk` (see android/app/build.gradle.kts).
        System.loadLibrary("gandula_android")
    }

    /** Simulate a full match. Returns `Match` JSON. */
    external fun playMatch(homeJson: String, awayJson: String, seed: Long): String

    /** Run the first half; returns a `HalfTimeSnapshot` JSON to resume from. */
    external fun playFirstHalf(homeJson: String, awayJson: String, seed: Long): String

    /** Resume from a snapshot and finish the match. Returns `Match` JSON. */
    external fun playSecondHalf(snapshotJson: String, homeJson: String, awayJson: String): String

    /** RNG-free pre-match projection (possession + pressure). Returns JSON. */
    external fun projectMatch(homeJson: String, awayJson: String): String

    /** Run a full double round-robin. `teamsJson` is a JSON array. Returns `SeasonRecord` JSON. */
    external fun runSeason(teamsJson: String, seed: Long, name: String): String

    /** Deterministic per-match seed from a season seed + fixture index. */
    external fun deriveMatchSeed(seasonSeed: Long, fixtureIdx: Int): Long
}
