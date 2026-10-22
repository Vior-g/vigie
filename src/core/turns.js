/*
 * Règles de tours des fiches de boss.
 * Une règle : { from, to, every, parity, text, level }
 *   - from  : premier tour concerné (défaut 1)
 *   - to    : dernier tour concerné (optionnel)
 *   - every : périodicité à partir de `from` (défaut 1 = chaque tour)
 *   - parity: 'pair' | 'impair' (optionnel)
 *   - level : 'info' | 'alerte' | 'danger' (style d'affichage)
 */
(function (root) {
  'use strict';

  function applies(rule, turn) {
    const from = rule.from ?? 1;
    const every = rule.every ?? 1;
    if (turn < from) return false;
    if (rule.to != null && turn > rule.to) return false;
    if ((turn - from) % every !== 0) return false;
    if (rule.parity === 'pair' && turn % 2 !== 0) return false;
    if (rule.parity === 'impair' && turn % 2 !== 1) return false;
    return true;
  }

  function rulesFor(boss, turn) {
    return (boss && boss.tours ? boss.tours : []).filter((r) => applies(r, turn));
  }

  const api = { applies, rulesFor };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.TurnRules = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
