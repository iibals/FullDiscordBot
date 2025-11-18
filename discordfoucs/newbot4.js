require('dotenv').config({ path: '/srv/discord-bot/.env' });
const { Client, GatewayIntentBits, Partials, ChannelType, Collection } = require('discord.js');

const TOKEN        = process.env.BOT_TOKEN5;
const WORKER_INDEX = 4;
const WORKER_TOTAL = 5;

const GUILD_ID = '1399596680822915124';
const EXCLUDED_CHANNEL_IDS = new Set(['1399596681271574661','1422645358864896124']);
const TALK_KEYWORD = 'talk';

const TICK_MS = 1000;
const MAX_PER_TICK = 10;
const SLEEP_429_MS = 3000;
const RIYADH_TZ = 'Asia/Riyadh';

if (!TOKEN) { console.error('[POMO-MUTER] BOT_TOKENx missing'); process.exit(1); }
if (!(WORKER_TOTAL > 0) || WORKER_INDEX < 0 || WORKER_INDEX >= WORKER_TOTAL) { console.error('[POMO-MUTER] invalid WORKER_INDEX/TOTAL'); process.exit(1); }

const client = new Client({
  intents: [GatewayIntentBits.Guilds,GatewayIntentBits.GuildVoiceStates,GatewayIntentBits.GuildMembers],
  partials: [Partials.Channel]
});
const log = (...a) => console.log(`[POMO-MUTER ${WORKER_INDEX}/${WORKER_TOTAL}]`, ...a);

const fmtFull = new Intl.DateTimeFormat('en-GB',{ timeZone: RIYADH_TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false });

function nowParts(){
  const d=new Date();
  const parts=new Intl.DateTimeFormat('en-GB',{ timeZone:RIYADH_TZ, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit', hour12:false }).formatToParts(d);
  const o=Object.fromEntries(parts.map(p=>[p.type,p.value]));
  return { y:o.year,M:o.month,d:o.day,H:+o.hour,m:+o.minute,s:+o.second,dateKey:`${o.year}-${o.month}-${o.day}`,nowLabel:fmtFull.format(d) };
}
const phaseOf=(minute)=> (minute%30)<25 ? 'focus':'break';
const minuteEvent=(minute)=>{ const mod=minute%30; if(mod===25) return 'break-start'; if(mod===0) return 'focus-start'; return null; };
const getPhaseNow=()=> phaseOf(nowParts().m);

function hashId(id){ let h=2166136261>>>0; for(let i=0;i<id.length;i++){ h^=id.charCodeAt(i); h=Math.imul(h,16777619);} return h>>>0; }
function isMine(userId){ return WORKER_TOTAL===1 ? true : (hashId(userId)%WORKER_TOTAL)===WORKER_INDEX; }

let queue=[]; let tickHandle=null; let pausedUntil=0;

function enqueue(job){ if(!isMine(job.userId)) return; const idx=queue.findIndex(j=>j.userId===job.userId); if(idx>=0) queue.splice(idx,1); queue.push(job); }

async function doOne(guild,job){
  try{
    const ch=guild.channels.cache.get(job.channelId)||await guild.channels.fetch(job.channelId).catch(()=>null);
    if(!ch||(ch.type!==ChannelType.GuildVoice&&ch.type!==ChannelType.GuildStageVoice)) return 'skip-nochannel';
    const m=ch.members.get(job.userId)||await guild.members.fetch(job.userId).catch(()=>null);
    if(!m||!m.voice?.channel) return 'skip-left';
    if(ch.type===ChannelType.GuildStageVoice){
      if(job.kind==='mute'){ if(m.voice?.suppress===true) return 'already-audience'; await m.voice.setSuppressed(true,'pomodoro focus'); return 'suppressed'; }
      else { if(m.voice?.suppress===false) return 'already-speaker'; await m.voice.setSuppressed(false,'pomodoro break'); return 'unsuppressed'; }
    } else {
      if(job.kind==='mute'){ if(m.voice.serverMute) return 'already-muted'; await m.voice.setMute(true,'pomodoro focus'); return 'muted'; }
      else { if(!m.voice.serverMute) return 'already-unmuted'; await m.voice.setMute(false,'pomodoro break'); return 'unmuted'; }
    }
  }catch(e){
    if(e?.status===429||String(e?.message||'').toLowerCase().includes('rate')){ pausedUntil=Date.now()+SLEEP_429_MS; return 'rate'; }
    if(e?.code===50013) return 'perm';
    return `error:${e?.message||e}`;
  }
}

async function processBatch(guild){
  if(Date.now()<pausedUntil) return;
  const batch=queue.splice(0,MAX_PER_TICK);
  let done=0,ok=0,skipped=0,rate=0,perm=0,err=0;
  for(const job of batch){
    const res=await doOne(guild,job);
    done++;
    if(['muted','unmuted','suppressed','unsuppressed'].includes(res)) ok++;
    else if(String(res).startsWith('already')||String(res).startsWith('skip')) skipped++;
    else if(res==='rate'){ rate++; enqueue(job); await new Promise(r=>setTimeout(r,SLEEP_429_MS)); }
    else if(res==='perm') perm++;
    else { err++; log('warn',res); }
  }
  if(done) log(`batch: done=${done} ok=${ok} skipped=${skipped} rate=${rate} perm=${perm} err=${err} | left=${queue.length}`);
}

function startTicker(guild){ if(!tickHandle){ tickHandle=setInterval(()=>processBatch(guild).catch(()=>{}),TICK_MS); log(`rate: ${MAX_PER_TICK}/s`); } }

function isExcludedChannel(ch){ if(!ch) return false; if(EXCLUDED_CHANNEL_IDS.has(ch.id)) return true; return String(ch.name||'').toLowerCase().includes(TALK_KEYWORD); }

async function collectTargets(guild,kind){
  const chans=guild.channels.cache.size?guild.channels.cache:await guild.channels.fetch();
  const list=[];
  for(const ch of chans.values()){
    if(ch.type!==ChannelType.GuildVoice&&ch.type!==ChannelType.GuildStageVoice) continue;
    const skipThisChannel=(kind==='mute')&&isExcludedChannel(ch);
    for(const m of (ch.members instanceof Collection?ch.members.values():[])){
      if(!isMine(m.id)) continue;
      if(kind==='mute'&&skipThisChannel) continue;
      list.push({ userId:m.id, channelId:ch.id });
    }
  }
  return list;
}

async function mass(kind){
  const guild=await client.guilds.fetch(GUILD_ID).catch(()=>null);
  if(!guild) return log('error: cannot fetch guild');
  const targets=await collectTargets(guild,kind);
  log(`collect: ${targets.length} targets (kind=${kind})`);
  if(!targets.length) return;
  queue=[]; targets.forEach(t=>enqueue({ ...t, kind }));
  startTicker(guild);
}

client.on('voiceStateUpdate',(oldState,newState)=>{
  try{
    const mode=getPhaseNow();
    const joined=!oldState.channelId&&newState.channelId;
    const moved =oldState.channelId&&newState.channelId&&oldState.channelId!==newState.channelId;
    if(!(joined||moved)) return;
    const dest=newState.channel; if(!dest) return;
    if(mode==='break'){ enqueue({ userId:newState.id, channelId:dest.id, kind:'unmute' }); return; }
    if(mode==='focus'){ if(isExcludedChannel(dest)) return; enqueue({ userId:newState.id, channelId:dest.id, kind:'mute' }); }
  }catch{}
});

let currentMode='idle';
const fired=new Set();
async function clockTick(){
  const t=nowParts();
  currentMode=phaseOf(t.m);
  const ev=minuteEvent(t.m);
  if(ev){
    const key=`${t.dateKey}-${t.H}-${t.m}-${ev}`;
    if(!fired.has(key)){
      fired.add(key);
      if(ev==='focus-start'){ currentMode='focus'; log(`tick: ${t.nowLabel} -> focus-start`); await mass('mute'); }
      else if(ev==='break-start'){ currentMode='break'; log(`tick: ${t.nowLabel} -> break-start`); await mass('unmute'); }
    }
  }
  if(t.H===0&&t.m===1&&t.s<5) fired.clear();
}

client.once('ready', async ()=>{
  log(`ready as ${client.user.tag}`);
  const guild = await client.guilds.fetch(GUILD_ID).catch(()=>null);
  if (guild) startTicker(guild);              // ←ـــــــ مهم: شغّل الـticker من أول ما يشتغل البوت
  await clockTick();
  setInterval(()=>clockTick().catch(()=>{}),10000);
  log('timer started (Asia/Riyadh).');
});

client.on('error',e=>console.error(`[POMO-MUTER ${WORKER_INDEX}] CLIENT ERROR:`,e?.message||e));
client.on('shardError',e=>console.error(`[POMO-MUTER ${WORKER_INDEX}] SHARD ERROR:`,e?.message||e));
client.on('warn',m=>console.warn(`[POMO-MUTER ${WORKER_INDEX}] WARN:`,m));
client.login(TOKEN).catch(e=>{ console.error(`[POMO-MUTER ${WORKER_INDEX}] LOGIN FAILED:`,e?.message||e); process.exit(1); });
