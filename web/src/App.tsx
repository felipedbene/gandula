import { useEffect, useState } from "react";
import init from "./wasm/gandula_wasm.js";
import CardDouble from "./srcl/CardDouble";
import { Footer } from "./components/Footer";
import { MatchView } from "./components/MatchView";
import { SeasonView } from "./components/SeasonView";

type Tab = "match" | "season";

export function App() {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<Tab>("match");
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string>("pronto");

  useEffect(() => {
    init()
      .then(() => setReady(true))
      .catch((e: unknown) =>
        setError(`Falha ao carregar o engine WASM: ${String(e)}`)
      );
  }, []);

  if (error) {
    return (
      <div className="crt">
        <main className="app">
          <h1>Gandula</h1>
          <pre className="error">{error}</pre>
        </main>
      </div>
    );
  }

  if (!ready) {
    return (
      <div className="crt">
        <main className="app">
          <h1>Gandula</h1>
          <p className="muted">Carregando engine…</p>
        </main>
      </div>
    );
  }

  return (
    <div className="crt">
      <main className="app">
        <CardDouble title={<span className="standings-hi">GANDULA</span>} titleRight="v0.5">
          <p className="muted">Simulador de futebol em texto</p>
          <nav className="tabs">
            <button
              className={tab === "match" ? "tab active" : "tab"}
              onClick={() => setTab("match")}
            >
              [ PARTIDA ]
            </button>
            <button
              className={tab === "season" ? "tab active" : "tab"}
              onClick={() => setTab("season")}
            >
              [ TEMPORADA ]
            </button>
          </nav>
        </CardDouble>
        <section className="content">
          {tab === "match" ? (
            <MatchView onStatus={setStatus} />
          ) : (
            <SeasonView onStatus={setStatus} />
          )}
        </section>
        <Footer status={status} />
      </main>
    </div>
  );
}
