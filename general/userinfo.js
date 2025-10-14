const { EmbedBuilder } = require('discord.js');

module.exports = (client, { blueColor }) => {
  client.on('messageCreate', async (message) => {
    if (message.author.bot || !message.guild) return;
    const content = message.content.trim();
    if (!content.startsWith('$info')) return;

    const member = message.mentions.members.first();
    if (!member) return;

    try {
      await Promise.allSettled([member.fetch(true), member.user.fetch(true)]);
    } catch {}
    const user = member.user;

    const rolesArr = member.roles.cache
      .filter(r => r.id !== message.guild.id)
      .sort((a, b) => b.position - a.position)
      .map(r => r.toString());

    const avatarURL = user.displayAvatarURL({ size: 1024, extension: 'png', forceStatic: false });
    const bannerURL = user.bannerURL({ size: 1024, extension: 'png' });

    const created = user.createdTimestamp
      ? `<t:${Math.floor(user.createdTimestamp / 1000)}:F> • <t:${Math.floor(user.createdTimestamp / 1000)}:R>`
      : '—';
    const joined = member.joinedTimestamp
      ? `<t:${Math.floor(member.joinedTimestamp / 1000)}:F> • <t:${Math.floor(member.joinedTimestamp / 1000)}:R>`
      : '—';
    const boosted = member.premiumSince
      ? `<t:${Math.floor(member.premiumSince.getTime() / 1000)}:F> • <t:${Math.floor(member.premiumSince.getTime() / 1000)}:R>`
      : '—';
    const timeoutUntil = member.communicationDisabledUntilTimestamp
      ? `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:F> • <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`
      : '—';

    const status = member.presence?.status || 'offline';
    const platforms = member.presence?.clientStatus
      ? Object.keys(member.presence.clientStatus).join(', ')
      : '—';
    const activities = member.presence?.activities?.map(a => {
      const types = ['Playing', 'Streaming', 'Listening', 'Watching', 'Custom', 'Competing'];
      const t = types[a.type] ?? String(a.type);
      const parts = [t, a.name, a.state, a.details].filter(Boolean);
      return parts.join(' — ');
    }).join('\n') || '—';

    let flagsStr = '—';
    try {
      const flags = await user.fetchFlags();
      const arr = flags?.toArray();
      if (arr?.length) flagsStr = arr.join(', ');
    } catch {}

    const embed = new EmbedBuilder()
      .setColor(blueColor)
      .setAuthor({ name: user.tag ?? user.username, iconURL: avatarURL })
      .setTitle(`$info ${member.user.username}`)
      .setThumbnail(avatarURL)
      .addFields(
        { name: 'ID', value: user.id, inline: true },
        { name: 'Username', value: user.username ?? '—', inline: true },
        { name: 'Global Name', value: user.globalName ?? '—', inline: true },
        { name: 'Nickname', value: member.nickname ?? '—', inline: true },
        { name: 'Bot', value: String(user.bot), inline: true },
        { name: 'System', value: String(Boolean(user.system)), inline: true },
        { name: 'Account Created', value: created },
        { name: 'Joined Server', value: joined },
        { name: 'Boosting Since', value: boosted, inline: true },
        { name: 'Accent Color', value: typeof user.accentColor === 'number' ? `#${user.accentColor.toString(16).padStart(6, '0').toUpperCase()}` : '—', inline: true },
        { name: 'Avatar', value: avatarURL },
        { name: 'Banner', value: bannerURL || '—' },
        { name: 'Badges', value: flagsStr },
        { name: 'Status', value: status, inline: true },
        { name: 'Platforms', value: platforms, inline: true },
        { name: 'Activities', value: activities }
      );

    if (bannerURL) embed.setImage(bannerURL);

    if (member.voice?.channel) {
      embed.addFields({
        name: 'Voice',
        value: `Channel: ${member.voice.channel}\nMute: ${Boolean(member.voice.serverMute || member.voice.selfMute)} • Deaf: ${Boolean(member.voice.serverDeaf || member.voice.selfDeaf)} • Video: ${Boolean(member.voice.selfVideo)}`
      });
    } else {
      embed.addFields({ name: 'Voice', value: '—' });
    }

    embed.addFields(
      { name: 'Timeout Until', value: timeoutUntil, inline: true },
      { name: 'Pending', value: String(Boolean(member.pending)), inline: true }
    );

    if (rolesArr.length) {
      const chunks = [];
      let buf = '';
      for (const r of rolesArr) {
        if ((buf + (buf ? ', ' : '') + r).length > 1000) {
          chunks.push(buf);
          buf = r;
        } else {
          buf += (buf ? ', ' : '') + r;
        }
      }
      if (buf) chunks.push(buf);
      chunks.forEach((v, i) => embed.addFields({ name: `Roles (${i + 1}/${chunks.length})`, value: v }));
      embed.addFields(
        { name: 'Highest Role', value: member.roles.highest?.toString() ?? '—', inline: true },
        { name: 'Role Count', value: String(rolesArr.length), inline: true }
      );
    } else {
      embed.addFields({ name: 'Roles', value: '—' });
    }

    await message.channel.send({ embeds: [embed] }).catch(() => {});
  });
};
