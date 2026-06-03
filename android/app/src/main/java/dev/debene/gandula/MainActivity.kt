package dev.debene.gandula

import android.os.Bundle
import android.widget.ArrayAdapter
import android.widget.Button
import android.widget.EditText
import android.widget.Spinner
import android.widget.TextView
import androidx.appcompat.app.AppCompatActivity
import org.json.JSONObject

/**
 * Minimal "kick a match" screen, proving the native engine runs on-device.
 *
 * Loads the sample teams bundled in `assets/teams/`, lets you pick home/away and
 * a seed, then calls [NativeEngine.playMatch] and renders the minute-by-minute
 * feed exactly like the CLI does. Each `MatchEvent` already carries a rendered
 * `text` string (Brazilian-Portuguese narration), so the UI just prints
 * `minute' text` — no need to mirror the engine's event taxonomy in Kotlin.
 */
class MainActivity : AppCompatActivity() {

    /** A bundled team: its display name and the raw JSON we hand to the engine. */
    private data class Team(val name: String, val json: String)

    private lateinit var teams: List<Team>

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        teams = loadTeams()
        val names = teams.map { it.name }

        val home = findViewById<Spinner>(R.id.homeSpinner)
        val away = findViewById<Spinner>(R.id.awaySpinner)
        val seed = findViewById<EditText>(R.id.seedInput)
        val play = findViewById<Button>(R.id.playButton)
        val feed = findViewById<TextView>(R.id.feed)

        val adapter = ArrayAdapter(this, android.R.layout.simple_spinner_dropdown_item, names)
        home.adapter = adapter
        away.adapter = adapter
        if (teams.size > 1) away.setSelection(1)

        play.setOnClickListener {
            val h = teams[home.selectedItemPosition]
            val a = teams[away.selectedItemPosition]
            val s = seed.text.toString().toLongOrNull() ?: 1998L
            feed.text = try {
                renderMatch(NativeEngine.playMatch(h.json, a.json, s), h.name, a.name, s)
            } catch (e: Throwable) {
                "Engine error: ${e.message}"
            }
        }
    }

    /** Read every `*.json` under `assets/teams/`, keyed by the JSON `name` field. */
    private fun loadTeams(): List<Team> {
        val dir = "teams"
        val files = assets.list(dir)?.filter { it.endsWith(".json") }?.sorted() ?: emptyList()
        return files.map { file ->
            val json = assets.open("$dir/$file").bufferedReader().use { it.readText() }
            val name = runCatching { JSONObject(json).getString("name") }.getOrDefault(file)
            Team(name, json)
        }
    }

    /** Turn a `Match` JSON string into the scrolling minute-by-minute feed. */
    private fun renderMatch(matchJson: String, homeName: String, awayName: String, seed: Long): String {
        val match = JSONObject(matchJson)
        val result = match.getJSONObject("result")
        val hg = result.getInt("home_goals")
        val ag = result.getInt("away_goals")

        val sb = StringBuilder()
        sb.append("=== $homeName $hg x $ag $awayName (semente $seed) ===\n\n")
        val events = match.getJSONArray("events")
        for (i in 0 until events.length()) {
            val ev = events.getJSONObject(i)
            sb.append("${ev.getInt("minute")}' ${ev.getString("text")}\n")
        }
        return sb.toString()
    }
}
