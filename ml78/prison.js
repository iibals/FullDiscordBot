const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const mysql = require('mysql2/promise');

const CONFIG = {
  DB: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    timezone: 'Z',
    dateStrings: true,
  },
  PUNISHED_ROLE_ID: '703427528219426826',
  REMOVED_ROLE_ID:  '703426909404659722',
  POLICE_ROLE_ID:   '841848177534959677',
  LOG_CHANNEL_ID:   '1258746947355934750',
  TIMEZONE:         'Asia/Riyadh',
  LOCALE:           'ar-SA',
};

const pool = mysql.createPool(CONFIG.DB);

function fmtUtcToRiyadh(date) {
  const d = (date instanceof Date) ? date : new Date(date.replace(' ', 'T') + 'Z');
  return d.toLocaleString(CONFIG.LOCALE, { timeZone: CONFIG.TIMEZONE, calendar: 'gregory', year: 'numeric', month: '2-digit', day: '2-digit' });
}
function nowUtcSql() {
  const d = new Date(); const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function addDaysUtcSql(startSql, days) {
  const d = new Date(startSql.replace(' ', 'T') + 'Z'); d.setUTCDate(d.getUTCDate() + days);
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth()+1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}`;
}
function diffDaysCeil(endSql, from = new Date()) {
  const end = new Date(endSql.replace(' ', 'T') + 'Z'); const oneDay = 1000 * 60 * 60 * 24;
  return Math.ceil((end - from) / oneDay);
}
function computePrisonDays(priorCount) {
  const tiers = [5, 10, 15, 20, 30, 40, 50, 60]; return priorCount >= 8 ? 60 : tiers[priorCount];
}

function eb(blueColor, title, fields = [], desc = '') {
  const e = new EmbedBuilder().setColor(blueColor).setTitle(title).setFooter({ text: 'ارسل $السجن لمعرفة كل اوامر السجن' }).setTimestamp(new Date());
  if (desc) e.setDescription(desc); if (fields.length) e.addFields(...fields); return e;
}
async function sendEmbedTo(channel, embed) { return channel.send({ embeds: [embed] }).catch(() => {}); }
async function sendLogEmbed(client, embed) { if (!CONFIG.LOG_CHANNEL_ID) return; const ch = await client.channels.fetch(CONFIG.LOG_CHANNEL_ID).catch(() => null); if (ch) await ch.send({ embeds: [embed] }).catch(() => {}); }

async function expireOne(client, rec, blueColor) {
  try {
    await pool.query(`UPDATE prison SET status='expired', updated_at=UTC_TIMESTAMP() WHERE id=? AND status='active'`, [rec.id]);
    const guild = client.guilds.cache.get(rec.guild_id) || await client.guilds.fetch(rec.guild_id).catch(()=>null);
    if (guild) {
      const member = await guild.members.fetch(rec.user_id).catch(()=>null);
      if (member) {
        if (rec.punished_role_id && member.roles.cache.has(rec.punished_role_id)) { await member.roles.remove(rec.punished_role_id, 'انتهاء مدة السجن').catch(()=>{}); }
        if (rec.removed_role_id) {
          const role = guild.roles.cache.get(rec.removed_role_id) || await guild.roles.fetch(rec.removed_role_id).catch(()=>null);
          if (role && !member.roles.cache.has(role.id)) { await member.roles.add(role.id, 'إعادة الرتبة بعد انتهاء السجن').catch(()=>{}); }
        }
      }
    }
    const log = eb(blueColor, 'انتهاء سجن').addFields(
      { name: 'المعاقَب', value: `<@${rec.user_id}>`, inline: true },
      { name: 'الانتهاء عند', value: `${fmtUtcToRiyadh(rec.end_at)}`, inline: true },
    );
    await sendLogEmbed(client, log);
  } catch {}
}
async function sweepExpired(client, blueColor) {
  try {
    const [rows] = await pool.query(
      `SELECT id, guild_id, user_id, punished_role_id, removed_role_id, end_at
       FROM prison WHERE status='active' AND end_at <= UTC_TIMESTAMP() ORDER BY id ASC LIMIT 50`
    );
    for (const rec of rows) { await expireOne(client, rec, blueColor); }
  } catch {}
}

async function validateAllForPunish(client, message, member, reason) {
  const problems = [];
  const guild = message.guild;
  const requesterIsPolice = message.member.roles.cache.has(CONFIG.POLICE_ROLE_ID);
  if (!requesterIsPolice) problems.push('امتلاك رتبة الشرطي');
  if (!member) problems.push('منشن عضو');
  if (!reason || !reason.trim()) problems.push('كتابة سبب واضح');
  const botMember = await guild.members.fetch(client.user.id);
  const botHasManage = botMember.permissions.has(PermissionFlagsBits.ManageRoles);
  if (!botHasManage) problems.push('صلاحية البوت: ManageRoles');
  const botTop = botMember.roles.highest?.position ?? 0;
  let targetTop = -1; if (member) targetTop = member.roles.highest?.position ?? 0;
  if (member && botTop <= targetTop) problems.push('رتبة البوت أعلى من العضو المستهدف');
  const punishedRole = guild.roles.cache.get(CONFIG.PUNISHED_ROLE_ID) || await guild.roles.fetch(CONFIG.PUNISHED_ROLE_ID).catch(()=>null);
  if (!punishedRole) problems.push('وجود رتبة السجن الصحيحة');
  if (punishedRole && punishedRole.position >= botTop) problems.push('رتبة السجن أسفل رتبة البوت');
  if (CONFIG.REMOVED_ROLE_ID) {
    const removedRole = guild.roles.cache.get(CONFIG.REMOVED_ROLE_ID) || await guild.roles.fetch(CONFIG.REMOVED_ROLE_ID).catch(()=>null);
    if (removedRole && removedRole.position >= botTop) problems.push('رتبة الإزالة أسفل رتبة البوت');
  }
  return { ok: problems.length === 0, problems };
}
async function validateAllForPardonOrErase(client, message, member, needReason, reasonStr) {
  const problems = [];
  const guild = message.guild;
  const requesterIsPolice = message.member.roles.cache.has(CONFIG.POLICE_ROLE_ID);
  if (!requesterIsPolice) problems.push('امتلاك رتبة الشرطي');
  if (!member) problems.push('منشن عضو');
  if (needReason && (!reasonStr || !reasonStr.trim())) problems.push('كتابة سبب واضح');
  const botMember = await guild.members.fetch(client.user.id);
  const botHasManage = botMember.permissions.has(PermissionFlagsBits.ManageRoles);
  if (!botHasManage) problems.push('صلاحية البوت: ManageRoles');
  if (member) {
    const botTop = botMember.roles.highest?.position ?? 0;
    const targetTop = member.roles.highest?.position ?? 0;
    if (botTop <= targetTop) problems.push('رتبة البوت أعلى من العضو المستهدف');
  }
  const punishedRole = guild.roles.cache.get(CONFIG.PUNISHED_ROLE_ID) || await guild.roles.fetch(CONFIG.PUNISHED_ROLE_ID).catch(()=>null);
  if (!punishedRole) problems.push('وجود رتبة السجن الصحيحة');
  if (punishedRole) {
    const botTop2 = (await guild.members.fetch(client.user.id)).roles.highest?.position ?? 0;
    if (punishedRole.position >= botTop2) problems.push('رتبة السجن أسفل رتبة البوت');
  }
  if (CONFIG.REMOVED_ROLE_ID) {
    const removedRole = guild.roles.cache.get(CONFIG.REMOVED_ROLE_ID) || await guild.roles.fetch(CONFIG.REMOVED_ROLE_ID).catch(()=>null);
    if (removedRole) {
      const botTop3 = (await guild.members.fetch(client.user.id)).roles.highest?.position ?? 0;
      if (removedRole.position >= botTop3) problems.push('رتبة الإزالة أسفل رتبة البوت');
    }
  }
  return { ok: problems.length === 0, problems };
}

module.exports = (client, { blueColor }) => {
  if (client.__PRISON_SYS_LOADED) {
    if (client.__PRISON_SYS_HANDLER) client.off('messageCreate', client.__PRISON_SYS_HANDLER);
    if (client.__PRISON_SWEEP_INTV) clearInterval(client.__PRISON_SWEEP_INTV);
  }
  client.__PRISON_SYS_LOADED = true;

  const startSweeper = () => {
    sweepExpired(client, blueColor);
    client.__PRISON_SWEEP_INTV = setInterval(() => sweepExpired(client, blueColor), 60_000);
  };
  if (client.readyAt) startSweeper(); else client.once('ready', startSweeper);

  const onMessage = async (message) => {
    let responded = false;
    const replyOnce = async (embed) => { responded = true; await sendEmbedTo(message.channel, embed); };

    try {
      if (message.author.bot || !message.guild) return;
      const content = message.content.trim();

      if (content === '$السجن') {
        const help = eb(blueColor, 'أوامر نظام السجن').addFields(
          { name: 'سجن عضو', value: '`$عاقب @member السبب`' },
          { name: 'المتبقي', value: '`$باقي [@member]`' },
          { name: 'المعاقَبون الآن', value: '`$معاقبين`' },
          { name: 'سجل العضو/العام', value: '`$سجل [@member]`' },
          { name: 'سماح (إلغاء نشط)', value: '`$سامح @member السبب`' },
          { name: 'تاريخ كامل', value: '`$تاريخ`' },
        );
        await replyOnce(help);
        return;
      }

      if (content.startsWith('$عاقب')) {
        const member = message.mentions.members.first();
        const reason = content.split(' ').slice(2).join(' ').trim();
        const v = await validateAllForPunish(client, message, member, reason);
        if (!v.ok) {
          const e = eb(blueColor, 'لا يمكن التنفيذ', [{ name: 'أكمل الشروط التالية', value: v.problems.map(s => `• ${s}`).join('\n') }]);
          await replyOnce(e);
          return;
        }

        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const guildId = message.guild.id;
          const userId = member.id;
          const appliedBy = message.author.id;
          const [prevRows] = await conn.query('SELECT id FROM prison WHERE guild_id = ? AND user_id = ? ORDER BY id DESC FOR UPDATE', [guildId, userId]);
          const priorCount = prevRows.length;
          const days = computePrisonDays(priorCount);
          const startAt = nowUtcSql();
          const endAt   = addDaysUtcSql(startAt, days);
          await conn.query(
            `INSERT INTO prison (guild_id, user_id, user_username, applied_by, applied_by_username, reason, start_at, end_at, punished_role_id, removed_role_id, status, created_at, updated_at)
             VALUES (?, ?, '', ?, '', ?, ?, ?, ?, ?, 'active', UTC_TIMESTAMP(), UTC_TIMESTAMP())`,
            [guildId, userId, appliedBy, reason, startAt, endAt, CONFIG.PUNISHED_ROLE_ID, CONFIG.REMOVED_ROLE_ID]
          );
          await conn.commit();

          try {
            if (CONFIG.REMOVED_ROLE_ID && member.roles.cache.has(CONFIG.REMOVED_ROLE_ID)) { await member.roles.remove(CONFIG.REMOVED_ROLE_ID, 'سجن: إزالة رتبة محددة'); }
            await member.roles.add(CONFIG.PUNISHED_ROLE_ID, 'سجن: إضافة رتبة السجن');
            const summary = eb(blueColor, 'تم سجن عضو', [
              { name: 'المعاقَب', value: `<@${member.id}>`, inline: true },
              { name: 'المنفّذ', value: `<@${message.author.id}>`, inline: true },
              { name: 'المدة', value: `**${days}** يوم`, inline: true },
              { name: 'ينتهي في', value: `${fmtUtcToRiyadh(endAt)}`, inline: true },
              { name: 'إجمالي العقوبات على العضو', value: `**${priorCount + 1}**`, inline: true },
              { name: 'السبب', value: reason, inline: false },
            ]);
            await sendLogEmbed(client, summary);
          } catch {
            await pool.query(
              `UPDATE prison SET status='revoked', updated_at=UTC_TIMESTAMP()
               WHERE guild_id=? AND user_id=? AND status='active' ORDER BY id DESC LIMIT 1`,
              [message.guild.id, member.id]
            );
            const e2 = eb(blueColor, 'فشل تطبيق الرتب', [{ name: 'الحالة', value: 'تم إلغاء السجن (revoked).' }]);
            await replyOnce(e2);
          }
        } catch (dbErr) {
          try { await conn.rollback(); } catch {}
          const e = eb(blueColor, 'خطأ قاعدة البيانات', [{ name: 'التفاصيل', value: dbErr.message }]);
          await replyOnce(e);
        } finally {
          conn.release();
        }
        return;
      }

      if (content.startsWith('$باقي')) {
        const target = message.mentions.members.first() || message.member;
        const guildId = message.guild.id;
        const userId  = target.id;
        const [rows] = await pool.query(
          `SELECT id, reason, start_at, end_at, punished_role_id, removed_role_id
           FROM prison WHERE guild_id = ? AND user_id = ? AND status='active'
           ORDER BY end_at DESC LIMIT 1`,
          [guildId, userId]
        );
        if (!rows.length) {
          const e = eb(blueColor, 'لا يوجد سجن نشط', [{ name: 'العضو', value: `<@${userId}>` }]);
          await replyOnce(e);
          return;
        }
        const rec = rows[0];
        const remaining = diffDaysCeil(rec.end_at, new Date());
        if (remaining > 0) {
          const info = eb(blueColor, 'المدة المتبقية', [
            { name: 'العضو', value: `<@${userId}>`, inline: true },
            { name: 'المتبقي', value: `**${remaining}** يوم`, inline: true },
            { name: 'ينتهي في', value: `${fmtUtcToRiyadh(rec.end_at)}`, inline: true },
            { name: 'السبب', value: rec.reason, inline: false },
          ]);
          await replyOnce(info);
        } else {
          await expireOne(client, {
            id: rec.id, guild_id: guildId, user_id: userId,
            punished_role_id: rec.punished_role_id || CONFIG.PUNISHED_ROLE_ID,
            removed_role_id: rec.removed_role_id || CONFIG.REMOVED_ROLE_ID,
            end_at: rec.end_at
          }, blueColor);
          const done = eb(blueColor, 'تم إنهاء السجن', [{ name: 'العضو', value: `<@${userId}>` }]);
          await replyOnce(done);
        }
        return;
      }

      if (content === '$معاقبين') {
        const guildId = message.guild.id;
        const [rows] = await pool.query(
          `SELECT user_id, end_at FROM prison
           WHERE guild_id=? AND status='active' ORDER BY end_at ASC LIMIT 200`,
          [guildId]
        );
        if (!rows.length) {
          const e = eb(blueColor, 'لا يوجد معاقَبون حاليًا');
          await replyOnce(e);
          return;
        }
        const lines = rows.map(r => `• <@${r.user_id}> — ينتهي: **${fmtUtcToRiyadh(r.end_at)}** — باقي: **${diffDaysCeil(r.end_at, new Date())}** يوم`);
        for (let i = 0; i < lines.length; i += 20) {
          const chunk = lines.slice(i, i + 20).join('\n');
          const embed = eb(blueColor, 'المعاقَبون حاليًا', [], chunk);
          await sendEmbedTo(message.channel, embed);
        }
        return;
      }

      if (content.startsWith('$سجل')) {
        const target = message.mentions.members.first();
        const guildId = message.guild.id;
        let rows;
        if (target) {
          [rows] = await pool.query(
            `SELECT id, user_id, applied_by, reason, start_at, end_at, status
             FROM prison WHERE guild_id=? AND user_id=? ORDER BY id DESC LIMIT 50`,
            [guildId, target.id]
          );
        } else {
          [rows] = await pool.query(
            `SELECT id, user_id, applied_by, reason, start_at, end_at, status
             FROM prison WHERE guild_id=? ORDER BY id DESC LIMIT 50`,
            [guildId]
          );
        }
        if (!rows.length) {
          const e = eb(blueColor, 'لا يوجد سجلات');
          await replyOnce(e);
          return;
        }
        let totalForUser = 0;
        if (target) {
          const [cnt] = await pool.query(`SELECT COUNT(*) AS c FROM prison WHERE guild_id=? AND user_id=?`, [guildId, target.id]);
          totalForUser = cnt?.[0]?.c || 0;
        }
        const now = new Date();
        const fields = rows.slice(0, 25).map((r, idx) => {
          const expiredNow = (new Date(r.end_at.replace(' ','T') + 'Z')) <= now;
          let statusLbl = r.status; if (r.status !== 'revoked' && expiredNow) statusLbl = 'expired';
          const statusTxt = statusLbl === 'active' ? '🔒 نشط' : statusLbl === 'expired' ? `✅ انتهت <@${r.user_id}>` : statusLbl === 'revoked' ? '🟡 مُسامح' : statusLbl;
          const name = `#${r.id} • ${idx+1}`;
          const value = [
            `المعاقَب: <@${r.user_id}>`,
            `المنفّذ: <@${r.applied_by}>`,
            `الحالة: **${statusTxt}**`,
            `البداية: ${fmtUtcToRiyadh(r.start_at)} | النهاية: ${fmtUtcToRiyadh(r.end_at)}`,
            `السبب: ${r.reason}`
          ].join('\n');
          return { name, value };
        });
        const title = target ? `سجل العقوبات — <@${target.id}>` : 'أحدث سجلات العقوبات';
        const embed = eb(blueColor, title).addFields(fields);
        if (target) embed.addFields({ name: 'إجمالي العقوبات لهذا العضو', value: `**${totalForUser}**` });
        await replyOnce(embed);
        return;
      }

      if (content.startsWith('$سامح')) {
        const member = message.mentions.members.first();
        const reason = content.replace(/^\$سامح\s+<@!?(\d+)>\s*/u, '').trim();
        const v = await validateAllForPardonOrErase(client, message, member, true, reason);
        if (!v.ok) {
          const e = eb(blueColor, 'لا يمكن التنفيذ', [{ name: 'أكمل الشروط التالية', value: v.problems.map(s => `• ${s}`).join('\n') }]);
          await replyOnce(e);
          return;
        }
        const guildId = message.guild.id;
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [actives] = await conn.query(
            `SELECT id, punished_role_id, removed_role_id
             FROM prison WHERE guild_id=? AND user_id=? AND status='active'
             ORDER BY id DESC LIMIT 1 FOR UPDATE`,
            [guildId, member.id]
          );
          if (!actives.length) {
            await conn.rollback();
            const e = eb(blueColor, 'لا يوجد سجن نشط', [{ name: 'العضو', value: `<@${member.id}>` }]);
            await replyOnce(e);
            return;
          }
          const rec = actives[0];
          await conn.query(`UPDATE prison SET status='revoked', updated_at=UTC_TIMESTAMP() WHERE id=?`, [rec.id]);
          await conn.commit();
          if (CONFIG.PUNISHED_ROLE_ID && member.roles.cache.has(CONFIG.PUNISHED_ROLE_ID)) { await member.roles.remove(CONFIG.PUNISHED_ROLE_ID, 'سماح: إلغاء السجن').catch(()=>{}); }
          const backId = rec.removed_role_id || CONFIG.REMOVED_ROLE_ID;
          if (backId) {
            const role = message.guild.roles.cache.get(backId) || await message.guild.roles.fetch(backId).catch(()=>null);
            if (role && !member.roles.cache.has(role.id)) { await member.roles.add(role.id, 'سماح: إعادة الرتبة').catch(()=>{}); }
          }
          const ok = eb(blueColor, 'تم السماح', [
            { name: 'العضو', value: `<@${member.id}>`, inline: true },
            { name: 'المنفّذ', value: `<@${message.author.id}>`, inline: true },
            { name: 'سبب السماح', value: reason, inline: false },
          ]);
          await sendLogEmbed(client, ok);
        } catch (e) {
          try { await conn.rollback(); } catch {}
          const err = eb(blueColor, 'تعذّر السماح الآن');
          await replyOnce(err);
        } finally {
          conn.release();
        }
        return;
      }

      if (content.startsWith('$محي')) {
        const member = message.mentions.members.first();
        const v = await validateAllForPardonOrErase(client, message, member, false, null);
        if (!v.ok) {
          const e = eb(blueColor, 'لا يمكن التنفيذ', [{ name: 'أكمل الشروط التالية', value: v.problems.map(s => `• ${s}`).join('\n') }]);
          await replyOnce(e);
          return;
        }
        const guildId = message.guild.id;
        const conn = await pool.getConnection();
        try {
          await conn.beginTransaction();
          const [actives] = await conn.query(
            `SELECT id, punished_role_id, removed_role_id
             FROM prison WHERE guild_id=? AND user_id=? AND status='active'
             ORDER BY id DESC LIMIT 1 FOR UPDATE`,
            [guildId, member.id]
          );
          if (!actives.length) {
            await conn.rollback();
            const e = eb(blueColor, 'لا يوجد سجن نشط', [{ name: 'العضو', value: `<@${member.id}>` }]);
            await replyOnce(e);
            return;
          }
          const rec = actives[0];
          if (CONFIG.PUNISHED_ROLE_ID && member.roles.cache.has(CONFIG.PUNISHED_ROLE_ID)) { await member.roles.remove(CONFIG.PUNISHED_ROLE_ID, 'محي: إزالة رتبة السجن').catch(()=>{}); }
          const backId = rec.removed_role_id || CONFIG.REMOVED_ROLE_ID;
          if (backId) {
            const role = message.guild.roles.cache.get(backId) || await message.guild.roles.fetch(backId).catch(()=>null);
            if (role && !member.roles.cache.has(role.id)) { await member.roles.add(role.id, 'محي: إعادة الرتبة').catch(()=>{}); }
          }
          await conn.query(`DELETE FROM prison WHERE id=?`, [rec.id]);
          await conn.commit();
          const ok = eb(blueColor, 'تم محو العقوبة النشطة', [
            { name: 'العضو', value: `<@${member.id}>`, inline: true },
            { name: 'المنفّذ', value: `<@${message.author.id}>`, inline: true },
          ]);
          await sendLogEmbed(client, ok);
        } catch (e) {
          try { await conn.rollback(); } catch {}
          const err = eb(blueColor, 'تعذّر محو العقوبة الآن');
          await replyOnce(err);
        } finally {
          conn.release();
        }
        return;
      }

      if (content === '$تاريخ') {
        const guildId = message.guild.id;
        const [rows] = await pool.query(
          `SELECT id, user_id, applied_by, reason, start_at, end_at, status
           FROM prison WHERE guild_id=? ORDER BY id DESC LIMIT 300`,
          [guildId]
        );
        if (!rows.length) { await replyOnce(eb(blueColor, 'لا يوجد أي سجلات حتى الآن')); return; }
        const counts = new Map(); rows.forEach(r => counts.set(r.user_id, (counts.get(r.user_id) || 0) + 1));
        const summaryLines = [...counts.entries()].map(([uid, c]) => `• <@${uid}> — **${c}**`);
        const now = new Date();
        for (let i = 0; i < rows.length; i += 12) {
          const slice = rows.slice(i, i + 12);
          const fields = slice.map((r) => {
            const expiredNow = (new Date(r.end_at.replace(' ','T') + 'Z')) <= now;
            let statusLbl = r.status; if (r.status !== 'revoked' && expiredNow) statusLbl = 'expired';
            const statusTxt = statusLbl === 'active' ? '🔒 نشط' : statusLbl === 'expired' ? `✅ انتهت <@${r.user_id}>` : statusLbl === 'revoked' ? '🟡 مُسامح' : statusLbl;
            return { name: `#${r.id}`, value: [
              `المعاقَب: <@${r.user_id}>`,
              `المنفّذ: <@${r.applied_by}>`,
              `الحالة: **${statusTxt}**`,
              `البداية: ${fmtUtcToRiyadh(r.start_at)} | النهاية: ${fmtUtcToRiyadh(r.end_at)}`,
              `السبب: ${r.reason}`
            ].join('\n') };
          });
          await sendEmbedTo(message.channel, eb(blueColor, 'تفاصيل السجل (الأحدث أولاً)').addFields(fields));
        }
        for (let i = 0; i < summaryLines.length; i += 25) {
          const chunk = summaryLines.slice(i, i + 25).join('\n');
          await sendEmbedTo(message.channel, eb(blueColor, 'ملخص إجمالي — عدد العقوبات لكل عضو', [], chunk));
        }
        return;
      }

    } catch {
      if (!responded) {
        const e = eb(blueColor, 'خطأ غير متوقّع', [{ name: 'تحقق من الشروط الأساسية', value: [
          '• امتلاك رتبة الشرطي عند الأوامر الإدارية',
          '• منشن عضو مستهدف بشكل صحيح',
          '• كتابة سبب واضح عند الحاجة',
          '• صلاحية البوت ManageRoles',
          '• رتبة البوت أعلى من العضو',
          '• رتبة السجن أسفل رتبة البوت ووجودها',
        ].join('\n') }]);
        try { await sendEmbedTo(message.channel, e); } catch {}
      }
    }
  };

  client.__PRISON_SYS_HANDLER = onMessage;
  client.on('messageCreate', client.__PRISON_SYS_HANDLER);
};
