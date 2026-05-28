import Card from "../srcl/Card";

type SupportViewProps = {
  onBack: () => void;
};

/**
 * Quiet support / "buy me a coffee" page. Reachable from the NewSeasonForm
 * (the universal entry point — every fresh visitor lands here, and every
 * returning visitor who clears their save bounces back too). External
 * links open in a new tab so the in-progress career state (if any) on
 * a returning tab doesn't get blown away.
 *
 * No tracking, no metrics, no analytics on this page either — same
 * privacy posture as the rest of the app.
 */
export default function SupportView({ onBack }: SupportViewProps) {
  return (
    <>
      <p className="campeonato-header muted">APOIAR O PROJETO</p>

      <Card title="GANDULA">
        <p>
          Gandula é um projeto pessoal — uma carta de amor aos simuladores
          de futebol em texto dos anos 90 (Elifoot, principalmente).
        </p>
        <p>
          Sem ads, sem tracking, sem servidor: tudo roda direto no seu
          navegador, e o código é aberto.
        </p>
        <p>
          Se está curtindo a experiência e quer ajudar a manter o projeto
          rolando, qualquer apoio é bem-vindo. Tudo vai pra manter as luzes
          acesas e a motivação alta pra novos features.
        </p>

        <div className="form-actions form-actions--pair">
          <a
            href="https://ko-fi.com/felipedebene"
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
          >
            [ KO-FI ]
          </a>
          <a
            href="https://github.com/felipedbene/gandula"
            target="_blank"
            rel="noopener noreferrer"
            className="btn"
          >
            [ GITHUB ]
          </a>
        </div>
      </Card>

      <div className="form-actions">
        <button type="button" className="btn" onClick={onBack}>
          [ VOLTAR ]
        </button>
      </div>
    </>
  );
}
