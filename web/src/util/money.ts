/**
 * Format an integer money amount using the pt-BR locale convention —
 * dot thousands separator, no decimal places (the Brasileirão Imaginário
 * deals in whole moedas). Single source of truth so finale Card, history
 * list, and the running header all render the same shape.
 *
 * Negative inputs come through with the locale's leading minus sign; UI
 * code prefers to render sign + absolute value explicitly (so it can
 * pair signs with semantic colour), but this helper does not enforce
 * that — pass `Math.abs(n)` when you're managing the sign yourself.
 */
export function formatMoney(n: number): string {
  return n.toLocaleString("pt-BR");
}
