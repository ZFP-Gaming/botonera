function formatUserForClient(user) {
  const discriminator =
    (user.discriminator || user.discriminator === 0) && user.discriminator !== '0'
      ? user.discriminator
      : user.discriminator === 0
        ? '0'
        : null;
  return {
    id: user.id,
    username: user.username,
    globalName: user.global_name || user.globalName || null,
    discriminator,
    avatar: user.avatar,
  };
}

function formatGuildForClient(id, client) {
  const guild = client?.guilds?.cache?.get?.(id);
  return { id, name: guild?.name || id, icon: guild?.icon || null };
}

module.exports = {
  formatUserForClient,
  formatGuildForClient,
};
