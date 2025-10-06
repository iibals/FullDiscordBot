module.exports = (client) => {
  const CHANNEL_ID = '1420016092428107786';
  const OLLAMA_URL = 'http://127.0.0.1:11434';
  const MODEL = 'qwen2.5:7b-instruct';
  const THREADS = Math.max(2, require('os').cpus().length - 1);

  async function askOllamaStream(prompt, onDelta) {
    const res = await fetch(`${OLLAMA_URL}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        stream: true,
        keep_alive: '30m',
        messages: [
          { role: 'system', content: ' لاتتكلم اي لغة ثانية غير العربية رد بدون ايموجي  انت سعودي اسمك بندر بوت تكلم لهجة سعودية دايم بدون ماتخبط وركز بالكلام رد مختصر وسريع وواضح.' },
          { role: 'user',   content: prompt }
        ],
        options: {
          num_predict: 160,
          num_ctx: 1024,
          temperature: 0.4,
          num_thread: THREADS
        }
      })
    });
    if (!res.ok || !res.body) throw new Error('ollama stream failed');

    const reader  = res.body.getReader();
    const decoder = new TextDecoder();
    let acc = '';
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buf += decoder.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() || '';

      for (let line of lines) {
        line = line.trim();
        if (!line) continue;
        if (line.startsWith('data:')) line = line.slice(5).trim();

        let obj;
        try { obj = JSON.parse(line); } catch { continue; }
        if (obj.done) continue;

        const delta = (typeof obj.response === 'string')
          ? obj.response
          : (obj.message && typeof obj.message.content === 'string')
            ? obj.message.content
            : '';

        if (!delta) continue;

        acc += delta;
        await onDelta(acc);
      }
    }

    if (buf.trim()) {
      let line = buf.trim();
      if (line.startsWith('data:')) line = line.slice(5).trim();
      try {
        const obj = JSON.parse(line);
        const delta = (typeof obj.response === 'string')
          ? obj.response
          : (obj.message && typeof obj.message.content === 'string')
            ? obj.message.content
            : '';
        if (delta) {
          acc += delta;
          await onDelta(acc);
        }
      } catch {}
    }

    return acc.trim();
  }

  function split1900(s) {
    return s.match(/[\s\S]{1,1900}/g) || [''];
  }

  client.on('messageCreate', async (m) => {
    try {
      if (m.author.bot) return;
      if (m.channelId !== CHANNEL_ID) return;
      const q = m.content?.trim();
      if (!q) return;

      const msg = await m.reply(' يتم معالجة الرد ( الطلبات الطويلة تأخذ وقت اطول ) لان ماعندي كرت شاشه ارد بالمعالج خلها على ربك يارجال');

      let lastEdit = 0;
      const full = await askOllamaStream(q, async (text) => {
        const now = Date.now();
        if (now - lastEdit < 150) return;
        lastEdit = now;
        try { await msg.edit(text.slice(0, 1900)); } catch {}
      });

      const parts = split1900(full);
      if (parts.length) {
        try { await msg.edit(parts[0] || '\u200B'); } catch {}
        for (let i = 1; i < parts.length; i++) {
          await m.reply(parts[i]);
        }
      }
    } catch {
      try { await m.reply('تعذر الرد الآن.'); } catch {}
    }
  });
};
