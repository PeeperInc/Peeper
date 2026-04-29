function compareDealerHands(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.bust && b.bust) return 0;
  if (a.bust) return -1;
  if (b.bust) return 1;
  if (a.blackjack && !b.blackjack) return 1;
  if (!a.blackjack && b.blackjack) return -1;
  if (a.total === b.total) return 0;
  return a.total > b.total ? 1 : -1;
}

function comparePvpHands(a, b) {
  if (!a && !b) return 0;
  if (!a) return -1;
  if (!b) return 1;
  if (a.bust && b.bust) return 0;
  if (a.bust) return -1;
  if (b.bust) return 1;
  if (a.total === b.total) return 0;
  return a.total > b.total ? 1 : -1;
}

module.exports = {
  compareDealerHands,
  comparePvpHands,
};
