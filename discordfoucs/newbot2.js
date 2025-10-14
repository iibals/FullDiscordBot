
require('dotenv').config({ path: '/srv/discord-bot/.env' });

const {
  Client, GatewayIntentBits, Partials,
  ChannelType, Collection
} = require('discord.js');

const TOKEN   = process.env.BOT_TOKEN3; 
const GUILD_ID = '1399596680822915124';

const TICK_MS      = 1000;  
const MAX_PER_TICK = 6;     
const SLEEP_429_MS = 3000; 

const RIYADH_TZ = 'Asia/Riyadh';

if (!TOKEN) {
  console.error('[POMO-MUTER] BOT_TOKEN1 missing (.env or PM2 env)');
  process.exit(1);
}

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates, 
    GatewayIntentBits.GuildMembers,    
  ],
  partials: [Partials.Channel, Partials.Message],
});

const log = (...a) => console.log('[POMO-MUTER]', ...a);

let queue = [];   
let tickHandle = null;
let pausedUntil = 0;


let currentMode = 'idle'; 


const fmtFull = new Intl.DateTimeFormat('en-GB', {
  timeZone: RIYADH_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
});

function nowParts() {
  const d = new Date();
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: RIYADH_TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).formatToParts(d);
  const o = Object.fromEntries(parts.map(p => [p.type, p.value]));
  return {
    y:o.year, M:o.month, d:o.day,
    H:+o.hour, m:+o.minute, s:+o.second,
    dateKey:`${o.year}-${o.month}-${o.day}`,
    nowLabel: fmtFull.format(d),
  };
}

const phaseOf = (minute) => (minute % 30) < 25 ? 'focus' : 'break';

function eventAtMinute(minute) {
  const mod = minute % 30;
  if (mod === 20) return 'focus-5-left';
  if (mod === 25) return 'break-start';  
  if (mod === 29) return 'break-1-left'; 
  if (mod === 0)  return 'focus-start'; 
  return null;
}

// ---- queue utils ----
function enqueue(job) {
  // coalesce: keep the latest command per userId
  const idx = queue.findIndex(j => j.userId === job.userId);
  if (idx >= 0) queue.splice(idx, 1);
  queue.push(job);
}

async function collectTargets(guild) {
  const chans = guild.channels.cache.size ? guild.channels.cache : await guild.channels.fetch();
  const list = [];
  for (const ch of chans.values()) {
    if (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice) continue;
    for (const m of (ch.members instanceof Collection ? ch.members.values() : [])) {
      list.push({ userId: m.id, channelId: ch.id });
    }
  }
  return list;
}

async function doOne(guild, job) {
  try {
    const ch = guild.channels.cache.get(job.channelId)
           || await guild.channels.fetch(job.channelId).catch(() => null);
    if (!ch || (ch.type !== ChannelType.GuildVoice && ch.type !== ChannelType.GuildStageVoice)) {
      return 'skip-nochannel';
    }

    let m = ch.members.get(job.userId) || await guild.members.fetch(job.userId).catch(() => null);
    if (!m || !m.voice?.channel) return 'skip-left';

    if (job.kind === 'mute') {
      if (m.voice.serverMute) return 'already-muted';
      await m.voice.setMute(true, 'pomodoro focus');
      return 'muted';
    } else {
      if (!m.voice.serverMute) return 'already-unmuted';
      await m.voice.setMute(false, 'pomodoro break');
      return 'unmuted';
    }
  } catch (e) {
    if (e?.status === 429 || String(e?.message||'').toLowerCase().includes('rate')) {
      pausedUntil = Date.now() + SLEEP_429_MS;
      return 'rate';
    }
    if (e?.code === 50013) return 'perm'; // Missing Permissions / role position
    return `error:${e?.message || e}`;
  }
}

async function processBatch(guild) {
  if (Date.now() < pausedUntil) return;

  const batch = queue.splice(0, MAX_PER_TICK);
  let done=0, ok=0, skipped=0, rate=0, perm=0, err=0;

  for (const job of batch) {
    const res = await doOne(guild, job);
    done++;
    if (res==='muted'||res==='unmuted') ok++;
    else if (String(res).startsWith('already') || String(res).startsWith('skip')) skipped++;
    else if (res==='rate') { rate++; enqueue(job); await new Promise(r=>setTimeout(r,SLEEP_429_MS)); }
    else if (res==='perm') perm++;
    else { err++; log('warn', res); }
  }

  log(`batch: done=${done} ok=${ok} skipped=${skipped} rate=${rate} perm=${perm} err=${err} | left=${queue.length}`);
  if (queue.length === 0) log('queue empty.');
}

function startTicker(guild) {
  if (!tickHandle) {
    tickHandle = setInterval(() => processBatch(guild).catch(()=>{}), TICK_MS);
    log(`rate: ${MAX_PER_TICK}/every ${TICK_MS}ms (~${(MAX_PER_TICK*1000/TICK_MS).toFixed(1)}/sec)`);
  }
}

async function mass(kind) {
  const guild = await client.guilds.fetch(GUILD_ID).catch(()=>null);
  if (!guild) return log('error: cannot fetch guild');

  const targets = await collectTargets(guild);
  log(`collect: ${targets.length} targets (kind=${kind})`);
  if (!targets.length) return;

  queue = [];
  targets.forEach(t => enqueue({ ...t, kind }));

  log(`mass ${kind.toUpperCase()}: queued=${queue.length}`);
  startTicker(guild);
}

client.on('voiceStateUpdate', (oldState, newState) => {
  try {
    if (currentMode !== 'focus') return;
    if (!oldState.channelId && newState.channelId && !newState.serverMute) {
      enqueue({ userId: newState.id, channelId: newState.channelId, kind: 'mute' });
    }
  } catch {}
});

const fired = new Set(); 

async function clockTick() {
  const t = nowParts();
  currentMode = phaseOf(t.m);

  const ev = eventAtMinute(t.m);
  if (ev) {
    const key = `${t.dateKey}-${t.H}-${t.m}-${ev}`;
    if (!fired.has(key)) {
      fired.add(key);

      if (ev === 'focus-start') {
        currentMode = 'focus';
        log(`tick: ${t.nowLabel} -> focus-start`);
        await mass('mute');
      } else if (ev === 'break-start') {
        currentMode = 'break';
        log(`tick: ${t.nowLabel} -> break-start`);
        await mass('unmute');
      }
    }
  }

  if (t.H === 0 && t.m === 1 && t.s < 5) {
    fired.clear();
  }
}

client.once('ready', async () => {
  log(`ready as ${client.user.tag}`);
  await clockTick();
  setInterval(() => clockTick().catch(()=>{}), 10_000);
  log('timer started (Asia/Riyadh).');
});

client.on('error', e => console.error('[POMO-MUTER] CLIENT ERROR:', e?.message || e));
client.on('shardError', e => console.error('[POMO-MUTER] SHARD ERROR:', e?.message || e));
client.on('warn', m => console.warn('[POMO-MUTER] WARN:', m));

client.login(TOKEN).catch(e => {
  console.error('[POMO-MUTER] LOGIN FAILED:', e?.message || e);
  process.exit(1);
});
