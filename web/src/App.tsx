import { useEffect, useState } from "react";
import init from "./wasm/gandula_wasm.js";
import CardDouble from "./srcl/CardDouble";
import { Footer } from "./components/Footer";
import { SeasonView } from "./components/SeasonView";

export function App() {
  const [ready, setReady] = useState(false);
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
        </CardDouble>
        <section className="content">
          <SeasonView onStatus={setStatus} />
        </section>
        <Footer status={status} />
      </main>
    </div>
  );
}
