//! Broadcaster-style narration with templated phrasings.
//!
//! Each event variant has a small bank of Portuguese phrasings; selection is
//! driven by a [`NarrationContext`] plus the match RNG so the output is
//! deterministic for a given seed. The tone is short, punchy, transmissão de
//! rádio — diminutive forms ("pra fora"), no headlines.
//!
//! Context use is intentionally narrow in this first cut: only `minute` and
//! `score_diff` are read. Later layers (player traits, momentum, cumulative
//! match narrative) extend the context — this module's API stays the same.
//!
//! All RNG draws come from the shared `MatchRng`. That means adding/removing
//! a phrasing variant shifts downstream draws and changes byte output for any
//! given seed — that's fine; the determinism contract is "same seed twice =
//! same output," not "same seed across versions."

use crate::rng::MatchRng;

/// Per-event context for phrasing selection.
///
/// `score_diff` is from the perspective of the side the event happens to:
/// `+N` means that side is leading by N goals at the moment the event fires;
/// `-N` means trailing. For goal events, build the context *after* the score
/// increment so a `score_diff == 0` flag genuinely means "this goal just
/// equalized."
pub(crate) struct NarrationContext {
    pub minute: u16,
    pub score_diff: i8,
}

impl NarrationContext {
    /// Late in the match (85'+). Tunable threshold — bumped here would
    /// cascade through every "late equalizer" / "late winner" check.
    pub fn is_late(&self) -> bool {
        self.minute >= 85
    }
}

// ─── Shot — wide ────────────────────────────────────────────────────────────
pub(crate) fn narrate_shot_wide(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    shooter: &str,
) -> String {
    match rng.range_u32(0, 3) {
        0 => format!("{minute}' {shooter} arrisca de longe... pra fora!"),
        1 => format!("{minute}' {shooter} chuta forte... passou ao lado!"),
        _ => format!("{minute}' {shooter} tenta e isola a bola!"),
    }
}

// ─── Shot — on target, saved ────────────────────────────────────────────────
// Includes the dramatic-save register so "big save" near-miss energy is here,
// not a separate event type (per the engine map: on-target-saved is already
// what carries that beat).
pub(crate) fn narrate_shot_saved(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    shooter: &str,
    keeper: &str,
) -> String {
    match rng.range_u32(0, 4) {
        0 => format!("{minute}' {shooter} chuta no gol... defendeu {keeper}!"),
        1 => format!("{minute}' Que defesa! {keeper} pega o chute de {shooter}!"),
        2 => format!("{minute}' {shooter} pega firme... e {keeper} mostra reflexo!"),
        _ => format!("{minute}' Susto! {keeper} segura o chute de {shooter}."),
    }
}

// ─── Goal ───────────────────────────────────────────────────────────────────
// Branches into late-game variants (85'+) when the goal either ties the score
// or gives the lead, since those moments dominate broadcaster register.
// Default-register variants are split by assist presence to keep the prose
// natural (no "passe de None" or other interpolation seams).
pub(crate) fn narrate_goal(
    ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    team: &str,
    scorer: &str,
    assist: Option<&str>,
) -> String {
    if ctx.is_late() && ctx.score_diff == 0 {
        // 85'+ equalizer
        return match rng.range_u32(0, 2) {
            0 => format!("{minute}' GOOOOL no fim! {scorer} salva o {team}!"),
            _ => format!("{minute}' É EMPATE! {scorer} marca pro {team} nos acréscimos!"),
        };
    }
    if ctx.is_late() && ctx.score_diff == 1 {
        // 85'+ go-ahead goal (just took the lead by one)
        return match rng.range_u32(0, 2) {
            0 => format!("{minute}' GOOOL DE {team}! {scorer} desempata no fim!"),
            _ => format!("{minute}' {scorer} marca no apagar das luzes pro {team}!"),
        };
    }

    match assist {
        Some(a) => match rng.range_u32(0, 3) {
            0 => format!("{minute}' GOOOL do {team}! {scorer} aproveita o passe de {a}!"),
            1 => format!("{minute}' É DO {team}! {a} encontra {scorer}, que não perdoa!"),
            _ => format!("{minute}' {scorer} marca pro {team}! Assistência de {a}."),
        },
        None => match rng.range_u32(0, 3) {
            0 => format!("{minute}' GOOOL do {team}! {scorer} balança a rede!"),
            1 => format!("{minute}' É DO {team}! {scorer} acerta o cantinho!"),
            _ => format!("{minute}' {scorer} marca pro {team}! Pegou sozinho."),
        },
    }
}

// ─── Foul ───────────────────────────────────────────────────────────────────
pub(crate) fn narrate_foul(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    offender: &str,
    victim: &str,
) -> String {
    match rng.range_u32(0, 3) {
        0 => format!("{minute}' Falta de {offender} em {victim}."),
        1 => format!("{minute}' Entrada dura de {offender} sobre {victim}."),
        _ => format!("{minute}' {offender} derruba {victim}. Falta marcada."),
    }
}

// ─── Yellow card ────────────────────────────────────────────────────────────
pub(crate) fn narrate_yellow(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    offender: &str,
) -> String {
    match rng.range_u32(0, 2) {
        0 => format!("{minute}' Cartão amarelo para {offender}."),
        _ => format!("{minute}' Amarelo! {offender} entra no relatório."),
    }
}

// ─── Red card ───────────────────────────────────────────────────────────────
pub(crate) fn narrate_red(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    offender: &str,
) -> String {
    match rng.range_u32(0, 2) {
        0 => format!("{minute}' VERMELHO! {offender} expulso de campo!"),
        _ => format!("{minute}' EXPULSÃO! {offender} deixa o jogo direto!"),
    }
}

// ─── Substitution ───────────────────────────────────────────────────────────
// Commit 1 ships 2 phrasings (satisfies the "every existing event gets ≥1
// variant" rule). Commit 3 expands this to 3–4 when the near-miss work lands.
pub(crate) fn narrate_substitution(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    team: &str,
    off: &str,
    on: &str,
) -> String {
    match rng.range_u32(0, 2) {
        0 => format!("{minute}' Substituição no {team}: sai {off}, entra {on}."),
        _ => format!("{minute}' Mexe o {team}: sai {off}, entra {on}."),
    }
}

// ─── Half-time / Full-time ──────────────────────────────────────────────────
// Both whistles get variants for ceremony — the existing single phrasing is
// fine but reads as boilerplate after a few matches.
pub(crate) fn narrate_half_time(
    rng: &mut MatchRng,
    home: &str,
    home_goals: u8,
    away: &str,
    away_goals: u8,
) -> String {
    match rng.range_u32(0, 2) {
        0 => format!("45' Fim do primeiro tempo. {home} {home_goals}x{away_goals} {away}."),
        _ => format!("45' Apito! Fim de primeira etapa: {home} {home_goals}x{away_goals} {away}."),
    }
}

pub(crate) fn narrate_full_time(
    rng: &mut MatchRng,
    minute: u16,
    home: &str,
    home_goals: u8,
    away: &str,
    away_goals: u8,
) -> String {
    match rng.range_u32(0, 2) {
        0 => format!("{minute}' Fim de jogo. {home} {home_goals}x{away_goals} {away}."),
        _ => format!("{minute}' Apito final! {home} {home_goals}x{away_goals} {away}."),
    }
}
