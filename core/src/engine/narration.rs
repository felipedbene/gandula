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

use crate::domain::NearMissKind;
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

// ─── Penalty — awarded (referee points to the spot) ────────────────────────
// Late and tied/losing situations get their own register; otherwise default.
pub(crate) fn narrate_penalty_awarded(
    ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    taker: &str,
) -> String {
    if ctx.is_late() && ctx.score_diff <= 0 {
        // 85'+ and tied or trailing — every clock-tick matters
        return match rng.range_u32(0, 2) {
            0 => format!("{minute}' PÊNALTI! Decisivo, no fim! {taker} vai pra cobrança..."),
            _ => format!("{minute}' PÊNALTI NO FIM! Tudo nas mãos de {taker}..."),
        };
    }
    match rng.range_u32(0, 3) {
        0 => format!("{minute}' Pênalti! O árbitro aponta para a marca. {taker} pega a bola..."),
        1 => format!("{minute}' PÊNALTI! {taker} se prepara para a cobrança..."),
        _ => format!("{minute}' É pênalti! {taker} ajeita a bola na marca da cal..."),
    }
}

// ─── Penalty — missed (saved or off target, merged at the data layer) ───────
// Three of the four phrasings frame a save; one frames "off target" — keeps
// the saved-penalty drama density above generic-save narration without forcing
// the data variant to branch.
pub(crate) fn narrate_penalty_missed(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    taker: &str,
    keeper: &str,
) -> String {
    match rng.range_u32(0, 4) {
        0 => format!("{minute}' PEGOU! {keeper} defende o pênalti de {taker}!"),
        1 => format!("{minute}' QUE DEFESA! {keeper} voa e agarra a cobrança de {taker}!"),
        2 => format!("{minute}' {taker} bate fraco... {keeper} pega sem dificuldade."),
        _ => format!("{minute}' PRA FORA! {taker} manda por cima do gol!"),
    }
}

// ─── Penalty — scored (emitted as a Goal kind, but narrated as a penalty) ──
// Late equalizer / late winner remain salient; default register leans on the
// "balança a rede da marca da cal" register specific to penalties.
pub(crate) fn narrate_penalty_scored(
    ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    team: &str,
    taker: &str,
) -> String {
    if ctx.is_late() && ctx.score_diff == 0 {
        return match rng.range_u32(0, 2) {
            0 => format!("{minute}' GOOOL DE PÊNALTI! {taker} empata pro {team} no fim!"),
            _ => format!("{minute}' É EMPATE! {taker} converte a cobrança nos acréscimos!"),
        };
    }
    if ctx.is_late() && ctx.score_diff == 1 {
        return match rng.range_u32(0, 2) {
            0 => format!("{minute}' GOOOL DE PÊNALTI! {taker} desempata pro {team}!"),
            _ => format!("{minute}' {taker} bate firme da marca da cal! {team} VIRA NO FIM!"),
        };
    }
    match rng.range_u32(0, 3) {
        0 => format!("{minute}' GOOOL! {taker} converte o pênalti pro {team}!"),
        1 => format!("{minute}' BALANÇA A REDE! {taker} bate firme no canto. Gol de {team}!"),
        _ => format!("{minute}' {taker} cobra com categoria! Gol de pênalti pro {team}!"),
    }
}

// ─── Near-miss — post / crossbar / just wide ────────────────────────────────
// Lower-stakes drama. Promoted from what would otherwise have been a wide
// shot; tone leans into the frustration/relief beat ("Na trave!", "QUASE!").
pub(crate) fn narrate_near_miss(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    shooter: &str,
    kind: NearMissKind,
) -> String {
    match kind {
        NearMissKind::Post => match rng.range_u32(0, 3) {
            0 => format!("{minute}' NA TRAVE! {shooter} carimbou o poste!"),
            1 => format!("{minute}' QUE ISSO! {shooter} bate firme e a bola explode na trave!"),
            _ => format!("{minute}' NA MADEIRA! {shooter} acerta o pé da trave!"),
        },
        NearMissKind::Crossbar => match rng.range_u32(0, 3) {
            0 => format!("{minute}' NO TRAVESSÃO! {shooter} bate por cima e a bola volta!"),
            1 => format!("{minute}' QUASE! {shooter} acerta o travessão e a bola sai!"),
            _ => format!("{minute}' {shooter} chuta e a bola explode no travessão!"),
        },
        NearMissKind::JustWide => match rng.range_u32(0, 3) {
            0 => format!("{minute}' QUASE! {shooter} chuta rente à trave!"),
            1 => format!("{minute}' Passou raspando! {shooter} quase marca!"),
            _ => format!("{minute}' {shooter} chuta com perigo... passou perto demais!"),
        },
    }
}

// ─── Substitution ───────────────────────────────────────────────────────────
pub(crate) fn narrate_substitution(
    _ctx: &NarrationContext,
    rng: &mut MatchRng,
    minute: u16,
    team: &str,
    off: &str,
    on: &str,
) -> String {
    match rng.range_u32(0, 4) {
        0 => format!("{minute}' Substituição no {team}: sai {off}, entra {on}."),
        1 => format!("{minute}' Mexe o {team}: sai {off}, entra {on}."),
        2 => format!("{minute}' {team} mexe: {off} dá lugar a {on}."),
        _ => format!("{minute}' O técnico tira {off} e coloca {on} no {team}."),
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
