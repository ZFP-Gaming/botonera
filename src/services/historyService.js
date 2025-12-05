function createHistoryService(maxHistory) {
  const history = [];

  function prune() {
    if (maxHistory <= 0) return;
    if (history.length > maxHistory) {
      history.length = maxHistory;
    }
  }

  function add(entry) {
    history.unshift(entry);
    prune();
  }

  function serialize(formatGuildForClient, defaultGuildId) {
    return history.map((entry) => {
      const guildId = entry.guildId || defaultGuildId;
      return {
        ...entry,
        guildId,
        guildName: entry.guildName || formatGuildForClient(guildId).name,
      };
    });
  }

  function getAll() {
    return history.slice();
  }

  return {
    add,
    serialize,
    getAll,
  };
}

module.exports = {
  createHistoryService,
};
