// ./scripts/time-alarm.js
// discord.js v14 — Pomodoro عبر تعديل "صلاحية التحدّث" على رول Member (بدون Server Mute)
// - أثناء التركيز: إزالة صلاحية Speak من رول Member (ميوت جماعي بالرول)
// - أثناء البريك: إضافة صلاحية Speak للرول
// - قناة/قنوات اسمها بالضبط "talk room" تُعطي Speak للرول كـ Override (تبقى مفتوحة دائماً)
// - تنبيهات Embedded مع منشن رول التنبيه
// - تنظيف التنبيهات قبل نهاية البريك (عند الدقيقة 29 من كل نصف ساعة)

const { ChannelType, PermissionFlagsBits, PermissionsBitField, EmbedBuilder } = require('discord.js');

module.exports = (client, { blueColor }) => {
  const GUILD_ID           = '1399596680822915124';
  const MEMBER_ROLE_ID     = '1399668268083449926';   // رول Member
  const NOTIFY_CHANNEL_ID  = '1399596681271574659';   // قناة التنبيهات
  const ALERT_ROLE_ID      = '1399668268083449926';   // رول يُمنشن للتنبيه
  const RIYADH_TZ          = 'Asia/Riyadh';

  // ----- time utils -----
  const fmtFull = new Intl.DateTimeFormat('ar-SA', {
    timeZone: RIYADH_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit',
    year: 'numeric', month: '2-digit', day: '2-digit', hour12: true
  });
  const fmtHM = new Intl.DateTimeFormat('ar-SA', {
    timeZone: RIYADH_TZ, hour: '2-digit', minute: '2-digit', hour12: true
  });

  function nowParts() {
    const d = new Date();
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: RIYADH_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit',
      year:'numeric', month:'2-digit', day:'2-digit', hour12:false
    }).formatToParts(d);
    const o = Object.fromEntries(s.map(p => [p.type, p.value]));
    return {
      y:o.year, M:o.month, d:o.day,
      H:+o.hour, m:+o.minute, s:+o.second,
      dateKey:`${o.year}-${o.month}-${o.day}`,
      nowLabel: fmtFull.format(d),
    };
  }

  // 25 تركيز / 5 بريك (جدار الساعة)
  const phaseOf = (minute) => (minute % 30) < 25 ? 'focus' : 'break';

  // نقاط الأحداث: 20 (باقي 5) / 25 (بريك يبدأ) / 29 (باقي دقيقة) / 0 (تركيز يبدأ)
  function eventAtMinute(minute) {
    const mod = minute % 30;
    if (mod === 20) return 'focus-5-left';
    if (mod === 25) return 'break-start';
    if (mod === 29) return 'break-1-left';
    if (mod === 0)  return 'focus-start';
    return null;
  }

  function nextSwitchLabel(H, m) {
    const points = [0, 25, 30, 55]; // 00/25/30/55
    const cur = m % 60;
    let nextMin = points.find(p => p > cur);
    let hour = H;
    if (nextMin === undefined) { nextMin = 0; hour = (H + 1) % 24; }
    const now = new Date();
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: RIYADH_TZ }));
    tzNow.setHours(hour, nextMin, 0, 0);
    return fmtHM.format(tzNow);
  }

  // ----- helpers -----
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // baseline: نزيل Speak من @everyone (التحكم عبر Member فقط)
  async function ensureBaselineEveryone(guild) {
    const everyone = guild.roles.everyone;
    if (!everyone) return;
    const hasSpeak = everyone.permissions.has(PermissionFlagsBits.Speak);
    if (hasSpeak) {
      const next = new PermissionsBitField(everyone.permissions).remove(PermissionFlagsBits.Speak);
      await everyone.setPermissions(next, 'Pomodoro baseline: remove Speak from @everyone').catch(()=>{});
    }
  }

  // تعديل صلاحية Speak على "رول Member" فقط (بدون Server Mute)
  async function setMemberSpeak(guild, allow) {
    const role = guild.roles.cache.get(MEMBER_ROLE_ID) || await guild.roles.fetch(MEMBER_ROLE_ID).catch(() => null);
    if (!role) return;

    const hasSpeak = role.permissions.has(PermissionFlagsBits.Speak);
    if (allow && !hasSpeak) {
      const next = new PermissionsBitField(role.permissions).add(PermissionFlagsBits.Speak);
      await role.setPermissions(next, 'Pomodoro: break (Speak ON)').catch(()=>{});
    } else if (!allow && hasSpeak) {
      const next = new PermissionsBitField(role.permissions).remove(PermissionFlagsBits.Speak);
      await role.setPermissions(next, 'Pomodoro: focus (Speak OFF)').catch(()=>{});
    }
  }

  // استثناء دائم لقنوات "talk room": تعطي Speak لرول Member
  async function ensureTalkRoomsOverride(guild) {
    const channels = guild.channels.cache.size ? guild.channels.cache : await guild.channels.fetch();
    for (const ch of channels.values()) {
      if (ch.type === ChannelType.GuildVoice && ch.name.toLowerCase() === 'talk room') {
        await ch.permissionOverwrites.edit(MEMBER_ROLE_ID, { Speak: true }).catch(()=>{});
      }
    }
  }

  // إرسال تنبيه (مع منشن رول التنبيه)
  async function sendEmbed(guild, type, t) {
    const ch = guild.channels.cache.get(NOTIFY_CHANNEL_ID) || await guild.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null);
    if (!ch) return;

    const phase = phaseOf(t.m);
    const nextLbl = nextSwitchLabel(t.H, t.m);
    let title = '', desc = '';

    if (type === 'focus-5-left')  { title = '⏳ باقي 5 دقائق على نهاية التركيز'; desc = 'استعد للبريك القصير ☕️'; }
    if (type === 'break-start')   { title = '☕️ بدأ البريك (5 دقائق)';           desc = 'خذ نفسًا، موية، حركة خفيفة.'; }
    if (type === 'break-1-left')  { title = '⏰ باقي دقيقة وتنتهي البريك';        desc = 'ارجع لمكانك ✍️ جاهزين للتركيز.'; }
    if (type === 'focus-start')   { title = '🎯 بدأ وقت التركيز (25 دقيقة)';      desc = 'هدوء في غرف الدراسة. `talk room` مفتوح دائماً.'; }

    const embed = new EmbedBuilder()
      .setColor(blueColor)
      .setTitle(title)
      .setDescription(desc)
      .addFields(
        { name: 'المرحلة الحالية', value: phase === 'break' ? '☕️ **بريك**' : '🎯 **تركيز**', inline: true },
        { name: 'السويتش القادم', value: `**${nextLbl}**`, inline: true },
        { name: 'الآن (الرياض)', value: `**${t.nowLabel}**`, inline: false },
      )
      .setTimestamp(new Date());

    await ch.send({
      content: `<@&${ALERT_ROLE_ID}>`,
      allowedMentions: { roles: [ALERT_ROLE_ID] },
      embeds: [embed]
    }).catch(()=>{});
  }

  // تنظيف التنبيهات قبل نهاية البريك
  async function cleanupAlertsNow(guild) {
    const ch = guild.channels.cache.get(NOTIFY_CHANNEL_ID) || await guild.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null);
    if (!ch || !ch.isTextBased()) return;
    try {
      let loops = 0;
      while (loops < 10) {
        const msgs = await ch.messages.fetch({ limit: 100 }).catch(()=>null);
        if (!msgs || msgs.size === 0) break;
        const deletable = msgs.filter(m =>
          !m.pinned &&
          (Date.now() - m.createdTimestamp) < 14*24*60*60*1000
        );
        if (deletable.size === 0) break;

        await ch.bulkDelete(deletable, true).catch(()=>{});
        loops++;
        await sleep(650);
        if (msgs.size < 100) break;
      }
      await ch.send('🧹 تم حذف التنبيهات السابقة').catch(()=>{});
    } catch {}
  }

  // ----- loop -----
  const fired = new Set(); // `${dateKey}-${H}-${m}-${event}`

  async function tick(guild) {
    const t = nowParts();
    const phase = phaseOf(t.m);

    // اضبط صلاحية Speak على رول Member حسب المرحلة (دائمًا)
    await setMemberSpeak(guild, phase === 'break');

    // أحداث محكومة بالدقيقة
    const ev = eventAtMinute(t.m);
    if (ev) {
      const key = `${t.dateKey}-${t.H}-${t.m}-${ev}`;
      if (!fired.has(key)) {
        fired.add(key);

        // تحكّم فوري بالرول عند نقاط التحوّل
        if (ev === 'break-start') {
          // بداية البريك: اسمح بالتحدث فوراً
          await setMemberSpeak(guild, true);
        } else if (ev === 'focus-start') {
          // بداية التركيز: امنع التحدث فوراً
          await setMemberSpeak(guild, false);
        } else if (ev === 'break-1-left') {
          // قبل نهاية البريك بدقيقة: نظّف التنبيهات أولاً
          await cleanupAlertsNow(guild);
        }

        // أرسل التنبيه (مع منشن الرول)
        await sendEmbed(guild, ev, t);
      }
    }

    // ثبّت Override لقنوات talk room كل 10 دقائق تقريبًا
    if (t.m % 10 === 0 && t.s < 10) {
      await ensureTalkRoomsOverride(guild);
    }

    // تنظيف مفاتيح يومي
    if (t.H === 0 && t.m === 1 && t.s < 5) {
      fired.clear();
    }
  }

  // ----- bootstrap -----
  const run = async () => {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;

    const me = await guild.members.fetch(client.user.id);
    if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
      console.warn('[pomodoro] Missing ManageRoles (cannot toggle Speak on Member role)');
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageChannels)) {
      console.warn('[pomodoro] Missing ManageChannels (talk room override may fail)');
    }
    if (!me.permissions.has(PermissionFlagsBits.ManageMessages)) {
      console.warn('[pomodoro] Missing ManageMessages (cleanup may fail)');
    }

    // أساسيات
    await ensureBaselineEveryone(guild);
    await ensureTalkRoomsOverride(guild);

    // طبّق الحالة فورًا ثم ابدأ التكرار
    await tick(guild);
    setInterval(() => tick(guild).catch(()=>{}), 10_000);
  };

  if (client.readyAt) run();
  else client.once('ready', run);
};
