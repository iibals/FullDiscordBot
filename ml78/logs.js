
const {
  AuditLogEvent,
  EmbedBuilder,
  PermissionFlagsBits,
} = require('discord.js');

module.exports = (client) => {
  const TARGET_GUILD_ID = '466588124387082240';
  const LOG_CHANNEL_ID  = '1258746947355934750'; 

  const MOVE_EXCLUDE_TO = new Set([
    '1041467063388098660',
    '1060124475036799057',
    ]);

  const seenAuditIds = new Map(); 
  const SEEN_TTL_MS = 60_000;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  const inTarget = (g) => g && g.id === TARGET_GUILD_ID;

  function pruneSeen() {
    const now = Date.now();
    for (const [id, ts] of seenAuditIds.entries()) {
      if (now - ts > SEEN_TTL_MS) seenAuditIds.delete(id);
    }
  }
  setInterval(pruneSeen, 30_000);

  async function sendEmbed(guild, embed) {
    try {
      if (!inTarget(guild)) return;
      const ch = guild.channels.cache.get(LOG_CHANNEL_ID) || await guild.channels.fetch(LOG_CHANNEL_ID).catch(() => null);
      if (!ch) return;
      await ch.send({ embeds: [embed] }).catch(() => {});
    } catch {}
  }

  function eb({ title, target, executor, reason, fields = [] }) {
    const e = new EmbedBuilder()
      .setTitle(title)
      .addFields(
        { name: 'المستهدف', value: target, inline: true },
        { name: 'المنفّذ', value: executor || 'غير معروف', inline: true },
      )
      .setTimestamp(new Date());
    if (reason) e.addFields({ name: 'السبب', value: `${reason}`.slice(0, 1024) });
    if (fields.length) e.addFields(...fields);
    return e;
  }

  async function fetchAuditOnce(guild, type, targetId, { matchChangeKey, expectedNewValue, maxAgeMs = 20_000, allowNoTarget = false } = {}) {
    const me = await guild.members.fetch(client.user.id).catch(() => null);
    if (!me || !me.permissions.has(PermissionFlagsBits.ViewAuditLog)) return null;

    const logs = await guild.fetchAuditLogs({ type, limit: 6 }).catch(() => null);
    if (!logs) return null;

    const now = Date.now();
    for (const [, entry] of logs.entries) {
      if (!entry) continue;
      if (now - entry.createdTimestamp > maxAgeMs) continue;
      if (seenAuditIds.has(entry.id)) continue;

      if (!allowNoTarget) {
        if (!entry.target || entry.target.id !== targetId) continue;
      } else {
        if (entry.target && entry.target.id !== targetId) continue; 
      }

      if (matchChangeKey) {
        const changes = entry.changes ?? [];
        const hit = changes.find(c =>
          (c.key === matchChangeKey) &&
          (expectedNewValue === undefined || c.new === expectedNewValue)
        );
        if (!hit) continue;
      }

      return entry;
    }
    return null;
  }

  async function fetchAuditQuick(guild, type, targetId, opts = {}) {
    const tries = [0, 600, 1200];
    for (const t of tries) {
      if (t) await sleep(t);
      const e = await fetchAuditOnce(guild, type, targetId, opts);
      if (e) return e;
    }
    return null;
  }

  client.on('guildBanAdd', async (ban) => {
    try {
      const { guild, user } = ban;
      if (!inTarget(guild)) return;

      const entry = await fetchAuditQuick(guild, AuditLogEvent.MemberBanAdd, user.id, { maxAgeMs: 30_000 });
      if (entry && seenAuditIds.has(entry.id)) return;
      if (entry) seenAuditIds.set(entry.id, Date.now());

      const executor = entry?.executor ? `<@${entry.executor.id}> (${entry.executor.tag})` : 'غير معروف';
      const reason = entry?.reason || '—';

      const embed = eb({
        title: '⛔️ تم حظر عضو (Ban)',
        target: `<@${user.id}> (${user.tag})`,
        executor,
        reason,
      });
      await sendEmbed(guild, embed);
    } catch {}
  });

  client.on('guildMemberRemove', async (member) => {
    try {
      const guild = member.guild;
      if (!inTarget(guild)) return;

      const entry = await fetchAuditQuick(guild, AuditLogEvent.MemberKick, member.id, { maxAgeMs: 30_000 });
      if (!entry) return;

      if (seenAuditIds.has(entry.id)) return;
      seenAuditIds.set(entry.id, Date.now());

      const executor = entry.executor ? `<@${entry.executor.id}> (${entry.executor.tag})` : 'غير معروف';
      const reason = entry.reason || '—';

      const embed = eb({
        title: '👢 تم طرد عضو (Kick)',
        target: `<@${member.id}> (${member.user?.tag ?? member.id})`,
        executor,
        reason,
      });
      await sendEmbed(guild, embed);
    } catch {}
  });

  client.on('voiceStateUpdate', async (oldState, newState) => {
    try {
      const guild = newState.guild || oldState.guild;
      const member = newState.member || oldState.member;
      if (!inTarget(guild) || !member) return;

      if (oldState.serverMute !== newState.serverMute) {
        const muted = newState.serverMute === true;

        const entry = await fetchAuditQuick(
          guild,
          AuditLogEvent.MemberUpdate,
          member.id,
          { matchChangeKey: 'mute', expectedNewValue: muted, maxAgeMs: 20_000 }
        );
        if (!entry) return;

        if (seenAuditIds.has(entry.id)) return;
        seenAuditIds.set(entry.id, Date.now());

        const executor = entry.executor ? `<@${entry.executor.id}> (${entry.executor.tag})` : 'غير معروف';
        const reason = entry.reason || '—';

        const embed = eb({
          title: muted ? 'Server Mute' : 'Server Unmute',
          target: `<@${member.id}> (${member.user?.tag ?? member.id})`,
          executor,
          reason,
          fields: [{ name: 'القناة', value: `${newState.channel?.name ?? oldState.channel?.name ?? '—'}`, inline: true }],
        });
        await sendEmbed(guild, embed);
      }

      if (oldState.serverDeaf !== newState.serverDeaf) {
        const deafed = newState.serverDeaf === true;

        const entry = await fetchAuditQuick(
          guild,
          AuditLogEvent.MemberUpdate,
          member.id,
          { matchChangeKey: 'deaf', expectedNewValue: deafed, maxAgeMs: 20_000 }
        );
        if (!entry) return;

        if (seenAuditIds.has(entry.id)) return;
        seenAuditIds.set(entry.id, Date.now());

        const executor = entry.executor ? `<@${entry.executor.id}> (${entry.executor.tag})` : 'غير معروف';
        const reason = entry.reason || '—';

        const embed = eb({
          title: deafed ? 'Server Deafen' : 'Server Undeafen',
          target: `<@${member.id}> (${member.user?.tag ?? member.id})`,
          executor,
          reason,
          fields: [{ name: 'القناة', value: `${newState.channel?.name ?? oldState.channel?.name ?? '—'}`, inline: true }],
        });
        await sendEmbed(guild, embed);
      }

      if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
        if (MOVE_EXCLUDE_TO.has(newState.channelId)) return;

        let entry = await fetchAuditQuick(guild, AuditLogEvent.MemberMove, member.id, { maxAgeMs: 20_000, allowNoTarget: true });

        if (!entry) {
          const me = await guild.members.fetch(client.user.id).catch(() => null);
          if (me && me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
            const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberMove, limit: 3 }).catch(() => null);
            if (logs) {
              const now = Date.now();
              for (const [, e] of logs.entries) {
                const age = now - e.createdTimestamp;
                if (age <= 2000 && !seenAuditIds.has(e.id) && e.extra && e.extra.count === 1) {
                  entry = e; break;
                }
              }
            }
          }
        }

        if (!entry) return;
        if (seenAuditIds.has(entry.id)) return;
        seenAuditIds.set(entry.id, Date.now());

        const executor = entry.executor ? `<@${entry.executor.id}> (${entry.executor.tag})` : 'غير معروف';
        const reason = entry.reason || '—';

        const embed = eb({
          title: '(Move)',
          target: `<@${member.id}> (${member.user?.tag ?? member.id})`,
          executor,
          reason,
          fields: [
            { name: 'من', value: `${oldState.channel?.name ?? '—'}`, inline: true },
            { name: 'إلى', value: `${newState.channel?.name ?? '—'}`, inline: true },
          ],
        });
        await sendEmbed(guild, embed);
      }

      if (oldState.channelId && !newState.channelId) {
        let entry = await fetchAuditQuick(guild, AuditLogEvent.MemberDisconnect, member.id, { maxAgeMs: 20_000, allowNoTarget: true });

        if (!entry) {
          const me = await guild.members.fetch(client.user.id).catch(() => null);
          if (me && me.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
            const logs = await guild.fetchAuditLogs({ type: AuditLogEvent.MemberDisconnect, limit: 3 }).catch(() => null);
            if (logs) {
              const now = Date.now();
              for (const [, e] of logs.entries) {
                const age = now - e.createdTimestamp;
                if (age <= 2000 && !seenAuditIds.has(e.id) && e.extra && e.extra.count === 1) {
                  entry = e; break;
                }
              }
            }
          }
        }

        if (!entry) return;
        if (seenAuditIds.has(entry.id)) return;
        seenAuditIds.set(entry.id, Date.now());

        const executor = entry.executor ? `<@${entry.executor.id}> (${entry.executor.tag})` : 'غير معروف';
        const reason = entry.reason || '—';

        const embed = eb({
          title: '(Disconnect)',
          target: `<@${member.id}> (${member.user?.tag ?? member.id})`,
          executor,
          reason,
          fields: [{ name: 'من القناة', value: `${oldState.channel?.name ?? '—'}`, inline: true }],
        });
        await sendEmbed(guild, embed);
      }
    } catch {}
  });
};
