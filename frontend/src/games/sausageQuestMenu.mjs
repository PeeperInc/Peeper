export function orderSausageQuestGames(games, sausageQuest, tab) {
  const base = games.filter(game => tab === 'free' ? game.energy === 0 && game.id !== 'sausage' : game.energy > 0 || game.id === 'sausage');
  if (tab === 'free') return base;
  const quest = games.find(game => game.id === 'sausage');
  if (!quest) return base;
  const ordered = base.filter(game => game.id !== 'sausage');
  if (sausageQuest?.remainingToday > 0) return [quest, ...ordered];
  const sniperIndex = ordered.findIndex(game => game.id === 'sniper');
  ordered.splice(sniperIndex < 0 ? ordered.length : sniperIndex + 1, 0, quest);
  return ordered;
}
