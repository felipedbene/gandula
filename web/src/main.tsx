import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";

// TEMP: smoke test for C2. Remove when C3 wires real UI.
if (import.meta.env.DEV) {
  void (async () => {
    try {
      const { clearSeason, loadSeason, saveSeason } = await import("./persistence");
      const { SAMPLE_TEAMS } = await import("./teams");
      const wasm = await import("./wasm/gandula_wasm.js");
      await wasm.default();  // init — idempotent, fine if App also calls

      await clearSeason();
      if ((await loadSeason()) !== null) {
        console.error("[persistence smoke] FAIL: loadSeason after clear returned non-null");
        return;
      }

      const teams = SAMPLE_TEAMS.slice(0, 2);
      const record = wasm.run_season(teams, BigInt(42), "Smoke Test League");

      const mock = {
        schemaVersion: 1 as const,
        savedAt: new Date().toISOString(),
        seed: BigInt(42),
        controlledTeamId: teams[0].id,
        currentRoundIdx: 0,
        record,
      };
      await saveSeason(mock);

      const loaded = await loadSeason();
      if (loaded === null) {
        console.error("[persistence smoke] FAIL: loadSeason after save returned null");
        return;
      }

      // BigInt-safe stringify for round-trip comparison.
      const stringify = (v: unknown) =>
        JSON.stringify(v, (_k, val) =>
          typeof val === "bigint" ? `bigint:${val.toString()}` : val
        );
      if (stringify(mock) !== stringify(loaded)) {
        console.error("[persistence smoke] FAIL: round-trip mismatch", { mock, loaded });
        return;
      }

      console.log("[persistence smoke] OK");
    } catch (e) {
      console.error("[persistence smoke] FAIL:", e);
    }
  })();
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
