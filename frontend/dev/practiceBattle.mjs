import combat from "@peeper/frontier-combat";
import content from "../../backend/frontier/content.json";
// Isolated practice uses the same action rules. No accounts or real rewards.
export function practiceBattle() {
  const f = combat.reset({}, Date.now() / 1000),
    receipts = new Map();
  const b = {
    name: "Mirewake",
    cycle: 1,
    hp: content.siege.maxHp,
    max_hp: content.siege.maxHp,
    phase: "open",
    contribution: 0,
    actions: 0,
    payout: 0,
    earnedCoins: 0,
  };
  function load() {
    const now = Date.now() / 1000,
      outcome = combat.advance(f, b, now);
    return Promise.resolve({
      serverTime: now,
      boss: { ...b },
      fighter: {
        ...f,
        ...outcome,
        attack: combat.attack(f, b, now),
        combatVersion: combat.VERSION,
      },
    });
  }
  async function hit(kind, key, options = {}) {
    if (receipts.has(key))
      return { ...(await load()), ...receipts.get(key), duplicate: true };
    await load();
    const now = Date.now() / 1000,
      at = Math.max(now - combat.GRACE, Math.min(now, options.at ?? now));
    const result = combat.input(f, b, kind, at, options.direction);
    if (result.error) throw { message: result.error, status: result.status };
    if (result.damage) {
      b.hp -= result.damage;
      b.contribution += result.damage;
      b.actions++;
      b.earnedCoins = Math.floor(b.contribution / 40) * 3;
      if (!b.hp) {
        b.phase = "defeated";
        b.payout = b.earnedCoins;
      }
    }
    receipts.set(key, result);
    return { ...(await load()), ...result };
  }
  return { load, hit };
}
