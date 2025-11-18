const { EmbedBuilder } = require('discord.js');

module.exports = (client) => {
  const GUILD_ID = '1399596680822915124';
  const NOTIFY_CHANNEL_ID = '1399596681271574659';
  const ALERT_ROLE_ID = '1399668268083449926';
  const RIYADH_TZ = 'Asia/Riyadh';

  const fmtHM = new Intl.DateTimeFormat('en-GB', {
    timeZone: RIYADH_TZ, hour: '2-digit', minute: '2-digit', hour12: true
  });

  function nowParts() {
    const d = new Date();
    const s = new Intl.DateTimeFormat('en-GB', {
      timeZone: RIYADH_TZ, hour: '2-digit', minute: '2-digit', second: '2-digit',
      year:'numeric', month:'2-digit', day:'2-digit', hour12:false
    }).formatToParts(d);
    const o = Object.fromEntries(s.map(p => [p.type, p.value]));
    return { H:+o.hour, m:+o.minute, s:+o.second, dateKey:`${o.year}-${o.month}-${o.day}` };
  }

  const phaseOf = (minute) => (minute % 30) < 25 ? 'focus' : 'break';

  function eventAtMinute(minute) {
    const mod = minute % 30;
    if (mod === 25) return 'break-start';
    if (mod === 0)  return 'focus-start';
    return null;
  }

  function nextSwitchLabel(H, m) {
    const points = [0, 25, 30, 55];
    const cur = m % 60;
    let nextMin = points.find(p => p > cur);
    let hour = H;
    if (nextMin === undefined) { nextMin = 0; hour = (H + 1) % 24; }
    const now = new Date();
    const tzNow = new Date(now.toLocaleString('en-US', { timeZone: RIYADH_TZ }));
    tzNow.setHours(hour, nextMin, 0, 0);
    return fmtHM.format(tzNow);
  }

  async function cleanupChannelMessages(guild) {
    const ch = guild.channels.cache.get(NOTIFY_CHANNEL_ID) || await guild.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null);
    if (!ch || !ch.isTextBased()) return null;
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
        await new Promise(r=>setTimeout(r,650));
        if (msgs.size < 100) break;
      }
      // نرسل رسالة الحذف هنا، وبعدها مباشرةً (في tick) بنرسل تنبيه التركيز
      await ch.send('🧹 تم حذف التنبيهات السابقة').catch(()=>{});
      return ch;
    } catch { return null; }
  }

  async function sendEmbed(guild, type, t) {
    const ch = guild.channels.cache.get(NOTIFY_CHANNEL_ID) || await guild.channels.fetch(NOTIFY_CHANNEL_ID).catch(() => null);
    if (!ch) return;
    const phase = phaseOf(t.m);
    const nextLbl = nextSwitchLabel(t.H, t.m);
    let title = '', desc = '';
    if (type === 'break-start') { title = '☕️ بدأ البريك (5 دقائق)'; desc = 'خذ نفسًا، موية، حركة خفيفة.'; }
    if (type === 'focus-start') { title = '🎯 بدأ وقت التركيز (25 دقيقة)'; desc = 'هدوء في غرف الدراسة. `talk room` مفتوح دائماً.'; }

    const embed = new EmbedBuilder()
      .setColor(0x1f8b4c)
      .setTitle(title)
      .setDescription(desc)
      .addFields(
        { name: 'المرحلة الحالية', value: phase === 'break' ? '☕️ **بريك**' : '🎯 **تركيز**', inline: true },
        { name: 'السويتش القادم', value: `**${nextLbl}**`, inline: true },
      )
      .setTimestamp(new Date());

    await ch.send({
      content: `<@&${ALERT_ROLE_ID}>`,
      allowedMentions: { roles: [ALERT_ROLE_ID] },
      embeds: [embed]
    }).catch(()=>{});
  }

  const fired = new Set();

  async function tick(guild) {
    const t = nowParts();
    const ev = eventAtMinute(t.m);
    if (ev) {
      const key = `${t.dateKey}-${t.H}-${t.m}-${ev}`;
      if (!fired.has(key)) {
        fired.add(key);
        if (ev === 'focus-start') {
          await cleanupChannelMessages(guild);   // 1) حذف
          await sendEmbed(guild, ev, t);         // 2) إرسال تنبيه التركيز بعد رسالة الحذف
        } else {
          await sendEmbed(guild, ev, t);         // البريك يرسل مباشرة
        }
      }
    }
    if (t.H === 0 && t.m === 1 && t.s < 5) fired.clear();
  }

  const run = async () => {
    const guild = await client.guilds.fetch(GUILD_ID).catch(() => null);
    if (!guild) return;
    await tick(guild);
    setInterval(() => tick(guild).catch(()=>{}), 10_000);
  };

  if (client.readyAt) run();
  else client.once('ready', run);
};
