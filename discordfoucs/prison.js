const { PermissionFlagsBits, EmbedBuilder } = require('discord.js');
const mysql = require('mysql2/promise');

const CONFIG = {
  DB: {
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: 'discord',     // كما طلبت
    timezone: 'Z',
    dateStrings: true,
  },

  PUNISHED_ROLE_ID:  '1440253511831912469',   // رول العقوبة
  PUNISH_CHANNEL_ID: '1439839657763274792',   // روم العقوبات

  STAFF_ROLES: [
    '1399597224299855954', // owner
    '1423355625278148679', // ceo
    '1422647291633991712', // head manager
    '1422647397615407174', // manager
    '1422647531338469488', // admin
    '1422647520873549855', // moderator
  ],

  TIMEZONE: 'Asia/Riyadh',
  LOCALE:   'ar-SA',
};

const pool = mysql.createPool(CONFIG.DB);

// -------------------------------------------------------------
// Helpers
// -------------------------------------------------------------
function fmt(date) {
  const d = new Date(date.replace(' ', 'T') + 'Z');
  return d.toLocaleString(CONFIG.LOCALE, {
    timeZone: CONFIG.TIMEZONE,
    hour12: false
  });
}

function nowSql() {
  const d = new Date();
  const f = (n) => String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${f(d.getUTCMonth()+1)}-${f(d.getUTCDate())} ${f(d.getUTCHours())}:${f(d.getUTCMinutes())}:${f(d.getUTCSeconds())}`;
}

function addSec(start, sec) {
  const d = new Date(start.replace(' ', 'T') + 'Z');
  d.setUTCSeconds(d.getUTCSeconds() + sec);
  const f = (n) => String(n).padStart(2,'0');
  return `${d.getUTCFullYear()}-${f(d.getUTCMonth()+1)}-${f(d.getUTCDate())} ${f(d.getUTCHours())}:${f(d.getUTCMinutes())}:${f(d.getUTCSeconds())}`;
}

// مدة العقوبات
function getDuration(prev) {
  const H = 3600;
  const D = 24 * H;
  switch (prev) {
    case 0: return 6 * H;
    case 1: return 1 * D;
    case 2: return 3 * D;
    case 3: return 7 * D;
    case 4: return 14 * D;
    case 5: return 30 * D;
    case 6: return 180 * D;
    default: return 365 * D;
  }
}

function human(sec) {
  const H = 3600;
  const D = 86400;
  if (sec < D) return `${Math.ceil(sec/H)} ساعة`;
  const d = Math.ceil(sec/D);
  if (d === 7) return "أسبوع";
  if (d === 14) return "أسبوعين";
  if (d === 30) return "شهر";
  if (d === 180) return "6 شهور";
  if (d === 365) return "سنة";
  return `${d} يوم`;
}

function eb(title, fields = [], desc = '') {
  const e = new EmbedBuilder()
    .setColor(0x2f3136)
    .setTitle(title)
    .setTimestamp();
  if (desc) e.setDescription(desc);
  if (fields.length) e.addFields(...fields);
  return e;
}

async function sendTo(client, id, embed) {
  const ch = await client.channels.fetch(id).catch(() => null);
  if (!ch) return;
  ch.send({ embeds: [embed] }).catch(() => {});
}

// -------------------------------------------------------------
// جهة انتهاء العقوبات
// -------------------------------------------------------------
async function expireOne(client, rec) {
  try {
    await pool.query(`
      UPDATE foucs_prison SET status='expired'
      WHERE id=? AND status='active'
    `, [rec.id]);

    const guild = await client.guilds.fetch(rec.guild_id).catch(() => null);
    if (!guild) return;

    const member = await guild.members.fetch(rec.user_id).catch(() => null);
    if (!member) return;

    // remove punish role
    if (member.roles.cache.has(CONFIG.PUNISHED_ROLE_ID)) {
      await member.roles.remove(CONFIG.PUNISHED_ROLE_ID).catch(()=>{});
    }

    // restore old roles
    if (rec.old_role_ids) {
      for (const r of rec.old_role_ids.split(',').filter(Boolean)) {
        const role = guild.roles.cache.get(r);
        if (role) await member.roles.add(role).catch(() => {});
      }
    }

    const out = eb("انتهاء عقوبة", [
      { name: "العضو", value: `<@${rec.user_id}>`, inline: true },
      { name: "الوقت", value: fmt(rec.end_at), inline: true },
    ]);

    await sendTo(client, CONFIG.PUNISH_CHANNEL_ID, out);

  } catch {}
}

async function sweep(client) {
  try {
    const [rows] = await pool.query(`
      SELECT * FROM foucs_prison
      WHERE status='active' AND end_at <= UTC_TIMESTAMP()
      LIMIT 25
    `);
    for (const rec of rows) {
      await expireOne(client, rec);
    }
  } catch {}
}

// -------------------------------------------------------------
// Validation
// -------------------------------------------------------------
async function canPunish(member) {
  return CONFIG.STAFF_ROLES.some(r => member.roles.cache.has(r));
}

// -------------------------------------------------------------
// Module export
// -------------------------------------------------------------
module.exports = (client) => {

  // Sweeper
  client.once("ready", () => {
    setInterval(() => sweep(client), 60_000);
  });

  client.on("messageCreate", async (message) => {
    if (!message.guild || message.author.bot) return;
    const content = message.content.trim();

    // أمر العقوبة
    if (content.startsWith("$عاقب")) {
      const target = message.mentions.members.first();
      const reason = content.split(" ").slice(2).join(" ").trim();

      if (!await canPunish(message.member)) {
        return message.reply("ما عندك صلاحية تعاقب.").catch(()=>{});
      }

      if (!target) return message.reply("منشن الشخص.").catch(()=>{});
      if (!reason) return message.reply("اكتب سبب.").catch(()=>{});

      // منع معاقبة شخص أعلى من البوت
      const bot = await message.guild.members.fetch(client.user.id);
      if (bot.roles.highest.position <= target.roles.highest.position)
        return message.reply("رتبة البوت أقل من العضو.").catch(()=>{});

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const [c] = await conn.query(`
          SELECT COUNT(*) AS c FROM foucs_prison
          WHERE guild_id=? AND user_id=?
        `, [message.guild.id, target.id]);

        const prev = Number(c[0].c || 0);
        const dur = getDuration(prev);

        const start = nowSql();
        const end   = addSec(start, dur);

        // Save old roles
        const oldRoles = target.roles.cache
          .filter(r => r.id !== message.guild.id && r.id !== CONFIG.PUNISHED_ROLE_ID)
          .map(r => r.id)
          .join(",");

        await conn.query(`
          INSERT INTO foucs_prison 
          (guild_id,user_id,user_tag,punisher_id,punisher_tag,reason,start_at,end_at,duration_seconds,old_role_ids,status)
          VALUES (?,?,?,?,?,?,?,?,?,?,'active')
        `, [
          message.guild.id,
          target.id,
          target.user.tag,
          message.author.id,
          message.author.tag,
          reason,
          start,
          end,
          dur,
          oldRoles
        ]);

        // Remove roles
        for (const r of target.roles.cache.values()) {
          if (r.id === message.guild.id) continue;
          await target.roles.remove(r).catch(()=>{});
        }

        // Add punish role
        await target.roles.add(CONFIG.PUNISHED_ROLE_ID).catch(()=>{});

        await conn.commit();

        const embed = eb("تمت العقوبة", [
          { name: "العضو", value: `<@${target.id}>`, inline:true },
          { name: "المنفذ", value: `<@${message.author.id}>`, inline:true },
          { name: "المدة", value: human(dur), inline:true },
          { name: "ينتهي", value: fmt(end), inline:true },
          { name: "السبب", value: reason }
        ]);

        message.channel.send({ embeds:[embed] }).catch(()=>{});
        sendTo(client, CONFIG.PUNISH_CHANNEL_ID);

      } catch (e) {
        await conn.rollback();
        message.reply("خطأ بالداتا بيس.").catch(()=>{});
      } finally {
        conn.release();
      }
    }

    // أمر باقي
    if (content.startsWith("$باقي")) {
      const target = message.mentions.members.first() || message.member;

      const [rows] = await pool.query(`
        SELECT * FROM foucs_prison
        WHERE guild_id=? AND user_id=? AND status='active'
        ORDER BY id DESC LIMIT 1
      `, [message.guild.id, target.id]);

      if (!rows.length)
        return message.reply("ما عنده عقوبة نشطة.");

      const rec = rows[0];
      const now = new Date();
      const end = new Date(rec.end_at.replace(" ", "T") + "Z");
      let diff = Math.ceil((end - now) / 1000);
      if (diff < 0) diff = 0;

      const embed = eb("الوقت المتبقي", [
        { name: "العضو", value: `<@${target.id}>`, inline:true },
        { name: "المتبقي", value: human(diff), inline:true },
        { name: "ينتهي", value: fmt(rec.end_at), inline:true },
      ]);

      message.channel.send({embeds:[embed]});
    }

    // أمر سامح
    if (content.startsWith("$سامح")) {
      const target = message.mentions.members.first();
      const reason = content.split(" ").slice(2).join(" ").trim();

      if (!await canPunish(message.member))
        return message.reply("ما عندك صلاحية.");

      if (!target) return message.reply("منشن.").catch(()=>{});
      if (!reason) return message.reply("اكتب سبب.").catch(()=>{});

      const conn = await pool.getConnection();
      try {
        await conn.beginTransaction();

        const [rows] = await conn.query(`
          SELECT * FROM foucs_prison
          WHERE guild_id=? AND user_id=? AND status='active'
          ORDER BY id DESC LIMIT 1 FOR UPDATE
        `, [message.guild.id, target.id]);

        if (!rows.length) {
          await conn.rollback();
          return message.reply("ما عنده عقوبة.");
        }

        const rec = rows[0];
        await conn.query(`
          UPDATE foucs_prison SET status='revoked'
          WHERE id=?
        `, [rec.id]);

        await conn.commit();

        // remove punish role
        await target.roles.remove(CONFIG.PUNISHED_ROLE_ID).catch(()=>{});

        // restore roles
        if (rec.old_role_ids) {
          for (const r of rec.old_role_ids.split(',').filter(Boolean)) {
            const role = message.guild.roles.cache.get(r);
            if (role) await target.roles.add(role).catch(()=>{});
          }
        }

        const embed = eb("تم السماح", [
          { name: "العضو", value:`<@${target.id}>` },
          { name: "السبب", value: reason }
        ]);

        message.channel.send({embeds:[embed]});
        sendTo(client, CONFIG.PUNISH_CHANNEL_ID);

      } catch (e) {
        await conn.rollback();
        message.reply("خطأ أثناء السماح.");
      } finally {
        conn.release();
      }
    }

  });
};
