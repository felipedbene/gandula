# Fio C — Tela de rodada + 14 times (Brasileirão Imaginário 2026)

## Status

- ✅ **C0 — Performance baseline** (commit `714370a`)
- ✅ **C1 — Geração dos 14 times via fictionalize** (commits `03ea7db`, `de1f161`)
- ⏳ **C2 — Persistência no browser (IndexedDB)** — próximo
- ⏳ **C3 — UI da rodada** (Elifoot per-round advance)
- ⏳ **C4 — Seleção do time controlado** (entry point)

Pré-requisitos: Fio A (UI DOS, fases 1-9) e Fio B (gandula-fictionalize). Ambos
fechados antes do Fio C começar.

## Princípio do Fio C

Elifoot 98 vibe: quando o jogador avança rodada, mostrar resultados das
**outras partidas** da rodada também ("Palmeiras 2x2 Corinthians"), não só
"partida concluída em 47ms". Densidade narrativa da temporada — você não joga
tudo, mas o campeonato anda à sua volta.

## Decisões de produto (resolvidas)

1. **20 times → 14 times brasileiros.** O CSV do FC25 só tem 14 clubes
   verdadeiramente brasileiros (outros são marcados Brazilian por dono,
   tipo Real Madrid). Optamos por Brasileirão compacto em vez de inventar
   rosters faltantes.

2. **Modo Elifoot, não modo simulador.** Usuário escolhe UM time pra
   controlar, avança rodada por rodada, vê próximo confronto seu +
   resultados das outras partidas da rodada. Pausa entre rodadas. App vira
   "você é o técnico".

3. **C1-completo (com baseline perf).** Validamos engine antes de construir
   UI em cima. Resultado: 11.9ms pra 380 partidas (20 times), 0.95MB JSON.
   Pra 14 times serão ~182 partidas (~6ms nativo, ~30ms WASM esperado).
   Verde geral.

## C0 — Resultado do baseline

```
=== C0 baseline: 20-team double round-robin ===
Fixtures:           380
Matches simulated:  380
Total events:       7504
Avg events/match:   19.7
Max events/match:   33

Simulation time:    11.907ms      ← 12ms total
Serialization:      1.225ms
JSON size:          0.95 MB

Per-match cost:     0.03 ms
Per-round cost:     0.31 ms (10 matches)
Verdict: 🟢 GREEN — proceed to C1
```

Implicação: o engine NUNCA será o bottleneck do per-round UX. UI/UX e
IndexedDB serão.

Test integration em `core/tests/bench_20_teams.rs`, marcado `#[ignore]`.
Run: `cargo test --release -p gandula-core --test bench_20_teams -- --ignored --nocapture`.

## C1 — Brasileirão Imaginário 2026

Pipeline em `scripts/build-fictional-teams.sh`:

```
gandula-import-sofifa/output/teams/{14 picks}.json
  → gandula-fictionalize/input/
  → fictionalize.py --seed 1998
  → gandula-fictionalize/output/
  → gandula/assets/teams/fictional/
```

Seed `1998`. Idempotente — re-rodar com seed diferente reembaralha nomes.

**Mapping resultante (real → fictício):**

| Real | Fictício |
|------|----------|
| Atlético Mineiro | Paris Saint-Jorge |
| Bahia | Atlético Madri |
| Botafogo | Botafagonia |
| Corinthians | Sertão EC |
| Cruzeiro | Fluminato |
| Flamengo | Baviera FC |
| Fluminense | Fortalezense |
| Fortaleza | São Pedro FC |
| Grêmio | Imperial do Vale |
| Internacional | Boquita Juniors |
| Palmeiras | Mancesteres United |
| São Paulo | Juventina |
| Vasco da Gama | Almirante FC |
| Vitória | Real Madri |

Pool curado de 30 nomes em `gandula-fictionalize/pools/club_names.json`
intencionalmente mistura paródias europeias (Baviera FC, Boquita Juniors,
Mancesteres United, Real Madri, Atlético Madri) com brasileiros autênticos
(Botafagonia, Sertão EC, Imperial do Vale). Aceitamos o mix — "Brasileirão
Imaginário onde clubes europeus paródicos jogaram a divisão de base".

Player names são 100% brasileiros (Tarsílio Bittencourt, Quincas Oliveira,
Sócrates Ribeiro, etc).

## C2 — IndexedDB persistence (próximo)

**Objetivo:** estado da temporada salva no browser. Refresh não perde
progresso. "Nova temporada" como ação explícita.

**Decisões pendentes:**

1. **Schema.** O que persiste exatamente?
   - `SeasonRecord` inteiro? (380 partidas + event logs = 0.95MB, cabe)
   - Só `(league_meta, current_round_idx, controlled_team_id, seed)` +
     re-simula partidas passadas on-demand?
   - Híbrido: salva metadata + standings parciais, mas event logs só da
     "minha partida" mais recente?

2. **Múltiplas temporadas simultâneas?** Ou só uma "save slot"?

3. **Quando salvar?** Após cada rodada? Após cada partida do user? Manual?

4. **Library.** Browser IndexedDB API nua é verbose. Usar `idb` (~1KB
   wrapper) ou implementar handmade?

## C3 — UI da rodada (Elifoot per-round advance)

**Pendente.** Conceito:

- Tela "Minha temporada" — vê próxima partida sua + outras rodadas
- Botão "AVANÇAR" que joga **só sua rodada** (1 fixture sua + N-1 outras)
- Reuse do tick-by-tick reveal pra sua partida; outras aparecem como
  linha pronta (modo elifoot: "Palmeiras 2x2 Corinthians" no log de fundo)

## C4 — Seleção do time controlado

**Pendente.** Tela inicial: lista os 14 fictícios, você escolhe um pra
controlar. Sample teams (3 legacy) ficam disponíveis num modo "debug"
ou simplesmente convivem na lista.

## Fios futuros registrados (do Fio A)

- Build hash no footer (Vite plugin lendo hash do WASM)
- Manual halftime continue (espaço pra continuar reveal no minuto 45)
- Clock smooth via requestAnimationFrame em vez de minuto-a-minuto
- Clear primeiro tempo na transição pro segundo tempo
- Engine narration alignment com mockup (`Tarsílio (assist: Antônio)` —
  CUIDADO: muda contrato de determinismo byte-exato, quebra
  `core/tests/determinism.rs`)
- Refator `avgStrength` pra util compartilhado se SeasonView precisar
