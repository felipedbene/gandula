# Fio C — Tela de rodada + 20 times

Status: **AGUARDANDO DECISÕES DE PRODUTO** (não começou).

Pré-requisito fechado: Fio A (UI DOS, fases 1-9) e Fio B (gandula-fictionalize).

## Princípio do Fio C

Elifoot 98 vibe: quando o jogador avança rodada, mostrar resultados das **outras
partidas** da rodada também ("Palmeiras 2x2 Corinthians"), não só
"partida concluída em 47ms". Densidade narrativa da temporada — você não joga
tudo, mas o campeonato anda à sua volta.

## Decisões de produto pendentes (responder antes de planejar)

### 1. Quais 20 times?

- **3a — Top 20 mais fortes do FC25:** processados via `gandula-fictionalize`
  com seed determinístico. Pega os "elite" automaticamente.
- **3b — Curadoria manual:** abrir o `_mapping.json` gerado, escolher 20 a mão
  pra ter mix interessante (alguns top, alguns underdogs, alguns nomes
  divertidos do pool curado de 30).
- **3c — Sample teams + 17 fictícios:** manter Santos Imperial, Flamenguinho FC,
  Ipanema Atlético como âncoras + adicionar 17 do fictionalize pra completar.
  Tem vantagem de debug rápido (testes existentes continuam funcionando).

### 2. Modo de jogo

- **Modo simulador (atual):** usuário escolhe times, aperta JOGAR/RODAR, vê
  resultado. App é uma "calculadora de simulação".
- **Modo Elifoot:** usuário escolhe **UM time pra controlar**. Avança rodada por
  rodada, vê o próximo confronto seu + os resultados das outras partidas da
  rodada. Pausa entre rodadas. App vira "você é o técnico".

Modo Elifoot muda navegação, estado, UI inteira. Decisão fundadora.

### 3. Escopo da Fase C1

- **C1-mínimo:** só UI nova — tela de rodada lendo dados que já existem no
  `SeasonRecord` (que já tem fixtures + matches). Sem engine change.
- **C1-completo:** validar que engine suporta 20 times com performance OK,
  ajustar se necessário. Engine já é genérico no `core/`, mas nunca foi rodado
  com 20 — pode dar surpresa de tempo (20 times = 380 partidas, 90+ minutos
  de tick cada, ~34k tick iterations).

## Fios futuros registrados (do Fio A)

Atacar depois quando virem prioridade:

- Build hash no footer (Vite plugin lendo hash do WASM)
- Manual halftime continue (espaço pra continuar reveal no minuto 45)
- Clock smooth via requestAnimationFrame em vez de minuto-a-minuto
- Clear primeiro tempo na transição pro segundo tempo
- Engine narration alignment com mockup (`Tarsílio (assist: Antônio)` —
  CUIDADO: muda contrato de determinismo byte-exato, quebra
  `core/tests/determinism.rs`)
- Refator `avgStrength` pra util compartilhado se SeasonView precisar
