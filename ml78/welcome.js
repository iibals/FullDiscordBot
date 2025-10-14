const { EmbedBuilder, PermissionsBitField} = require('discord.js');

module.exports = (client, { blueColor }) => {
  const WELCOME_CHANNEL_ID = '700129628936732783';
  const AUTO_ROLE_ID       = '633234046599823361';

  const pad = (n) => String(n).padStart(2, '0');
  const fmt = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

  client.on('guildMemberAdd', async (member) => {
    let channel = member.guild.channels.cache.get(WELCOME_CHANNEL_ID);
    if (!channel) {
      try { channel = await member.guild.channels.fetch(WELCOME_CHANNEL_ID); }
      catch { return; }
    }

    let roleAssigned = false;
    try {
      const role = member.guild.roles.cache.get(AUTO_ROLE_ID) || await member.guild.roles.fetch(AUTO_ROLE_ID);
      if (role) {
        if (
          member.guild.members.me.permissions.has(PermissionsBitField.Flags.ManageRoles) &&
          role.position < member.guild.members.me.roles.highest.position
        ) {
          await member.roles.add(role, 'Auto assign on join');
          roleAssigned = true;
        }
      }
    } catch (err) {
    }

    let flags = [];
    try {
      const u = await member.user.fetch();
      flags = u.flags?.toArray?.() || [];
    } catch (_) {}

    const createdAt = member.user.createdAt;
    const joinedAt  = member.joinedAt ?? new Date();
    const ageDays   = Math.max(0, Math.floor((Date.now() - createdAt.getTime()) / 86400000));

    const roles = member.roles.cache
      .filter(r => r.id !== member.guild.id)
      .sort((a, b) => b.position - a.position);
    const rolesList = roles.size ? roles.map(r => `<@&${r.id}>`).slice(0, 20).join(' ') : '—';

    const embed = new EmbedBuilder()
      .setColor(blueColor)
      .setTitle(`Welcome, ${member.user.username}! 🎉`)
      .setDescription(
        `${member} Welcome to **${member.guild.name}**!\n`
      )
      .addFields(
        {
          name: '👤 Account',
          value:
            `Tag: **${member.user.tag}**\n` +
            `ID: \`${member.id}\``,
          inline: true
        },
        {
          name: '📅 Timestamps',
          value:
            `Created: ${fmt(createdAt)}\n` +
            `Joined:  ${fmt(joinedAt)}\n` +
            `Account Age Days: ${ageDays}`,
          inline: true
        },
        {
          name: 'Badges',
          value: `${flags.length ? flags.map(f => `\`${f}\``).join(', ') : 'None'}`,
          inline: true
        },
      )
      .setFooter({
        text: roleAssigned
          ? `New Member role has been assigned\nTotal Server Members: ${member.guild.memberCount}.`
          : `Auto-role not assigned\nTotal Server Members: ${member.guild.memberCount}.\n`
      })
      .setTimestamp();

    await channel.send({
      content: `Welcome ${member}!`,
      embeds: [embed],
    }).catch(() => {});
  });
};
