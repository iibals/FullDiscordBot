// ./scripts/time-alarm.js
// discord.js v14 — Pomodoro notifications only (no role/permission edits)

const { EmbedBuilder } = require('discord.js');

module.exports = (client, { blueColor }) => {
  const GUILD_ID           = '1399596680822915124';
  const NOTIFY_CHANNEL_ID  = '1399596681271574659';   // notify channel
  const ALERT_ROLE_ID      = '1399668268083449926';   // role to mention
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

  // 25 focus / 5 break (on the wall clock)
  const phaseOf = (minute) => (minute % 30) < 25 ? 'focus' : 'break';

  // event minutes: 20 / 25 / 29 / 0
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

  // helpers
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  // send embed to notify channel
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

  // cleanup notify channel before break ends
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

  // loop
  const fired = new Set(); // `${dateKey}-${H}-${m}-${event}`

  async function tick(guild) {
    const t = nowParts();

    const ev = eventAtMinute(t.m);
    if (ev) {
      const key = `${t.dateKey}-${t.H}-${t.m}-${ev}`;
      if (!fired.has(key)) {
        fired.add(key);

        if (ev === 'break-1-left') {
          await cleanupAlertsNow(guild);
        }

        await sendEmbed(guild, ev, t);
      }
    }

    // daily reset of dedupe keys
    if (t.H === 0 && t.m === 1 && t.s < 5) {
      fired.clear();
    }
  }

  // bootstrap
  const run = async () => {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;

    // start ticking (no role/permission editing anywhere)
    await tick(guild);
    setInterval(() => tick(guild).catch(()=>{}), 10_000);
  };

  if (client.readyAt) run();
  else client.once('ready', run);
};
