module.exports = (client) => {
  const { EmbedBuilder, PermissionFlagsBits, Collection } = require('discord.js');

  if (client._clearListenerRegistered) return;
  client._clearListenerRegistered = true;

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const BIG_CLEAR_COOLDOWN_MS = 5000; 
  if (!client._clearCooldown) client._clearCooldown = new Map(); 

  client.on('messageCreate', async (message) => {
    try {
      if (message.author.bot || !message.guild) return;

      const raw = message.content.trim();
      if (!raw.toLowerCase().startsWith('$clear')) return;

      // العدد: افتراضي 20، حد أقصى 100
      const parts = raw.split(/\s+/);
      let toDelete = 20;
      if (parts[1] && !isNaN(parseInt(parts[1], 10))) {
        toDelete = Math.max(1, Math.min(100, parseInt(parts[1], 10)));
      }

      // صلاحيات البوت
      const me = await message.guild.members.fetch(client.user.id);
      if (!me.permissions.has(PermissionFlagsBits.ManageMessages)) {
        const noPerm = new EmbedBuilder()
          .setTitle('⚠️ لا يمكن التنفيذ')
          .setColor('#ff4444')
          .setDescription('البوت يحتاج صلاحية **Manage Messages** في هذه القناة.')
          .setTimestamp();
        await message.channel.send({ embeds: [noPerm] });
        return;
      }

      // تهدئة فقط لطلبات 100 في نفس القناة
      if (toDelete === 100) {
        const key = message.channel.id;
        const last = client._clearCooldown.get(key) || 0;
        const now = Date.now();
        const diff = now - last;
        if (diff < BIG_CLEAR_COOLDOWN_MS) {
          await sleep(BIG_CLEAR_COOLDOWN_MS - diff);
        }
        client._clearCooldown.set(key, Date.now());
      }

      // رسالة تقدم مؤقتة
      const progressEmbed = new EmbedBuilder()
        .setTitle('⏳ جارٍ الحذف')
        .setColor('#0009ff')
        .setDescription(
          `سيتم حذف **${toDelete}** رسالة من هذه القناة الآن.\n` +
          (toDelete === 100
            ? `> عند تكرار \`$clear 100\` بسرعة سيتم تطبيق تهدئة قصيرة لتفادي حدود ديسكورد.`
            : `> يمكنك استخدام \`$clear <1-100>\` لتحديد العدد.`)
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${message.author.tag}`,
          iconURL: message.author.displayAvatarURL({ dynamic: true })
        });

      const progressMsg = await message.channel.send({ embeds: [progressEmbed] });

      // اجلب حتى 100 رسالة (الأحدث)
      const fetched = await message.channel.messages.fetch({ limit: 100 }).catch(() => null);
      if (!fetched || fetched.size === 0) {
        try { await message.delete().catch(()=>{}); } catch {}
        try { await progressMsg.delete().catch(()=>{}); } catch {}
        const summaryEmpty = new EmbedBuilder()
          .setTitle('Messages Cleaner')
          .setColor('#0009ff')
          .setDescription(
            `لم يتم العثور على رسائل قابلة للحذف.\n\n` +
            `**الاستخدام:**\n` +
            `• \`$clear\` يحذف آخر **20** رسالة.\n` +
            `• \`$clear <1-100>\` يحذف بعدد محدد حتى **100**.\n\n` +
            `**ملاحظة:** \`$clear 100\` المتكرر يفعّل تهدئة قصيرة في نفس القناة.`
          )
          .setTimestamp()
          .setFooter({
            text: `Requested by ${message.author.tag}`,
            iconURL: message.author.displayAvatarURL({ dynamic: true })
          });
        await message.channel.send({ embeds: [summaryEmpty] }).catch(()=>{});
        return;
      }

      const fourteenDaysMs = 14 * 24 * 60 * 60 * 1000;
      const nowMs = Date.now();
      let remaining = toDelete;
      let deletedCount = 0;

      const candidates = fetched.filter(msg =>
        msg.id !== message.id &&
        msg.id !== progressMsg.id &&
        !msg.pinned
      );

      if (remaining > 0) {
        const fresh = candidates.filter(m => (nowMs - m.createdTimestamp) < fourteenDaysMs);
        if (fresh.size > 0) {
          const freshArray = [...fresh.values()].slice(0, remaining);
          if (freshArray.length > 0) {
            const coll = new Collection();
            for (const m of freshArray) coll.set(m.id, m);
            const res = await message.channel.bulkDelete(coll).catch(() => null);
            const bulkDeleted = res ? res.size : 0;
            deletedCount += bulkDeleted;
            remaining -= bulkDeleted;
          }
        }
      }

      if (remaining > 0) {
        const oldies = candidates
          .filter(m => (nowMs - m.createdTimestamp) >= fourteenDaysMs)
          .first(remaining);
        for (const msg of oldies) {
          try {
            await msg.delete();
            deletedCount++;
            remaining--;
          } catch {}
          if (remaining <= 0) break;
          await sleep(100);
        }
      }

      try { await message.delete().catch(()=>{}); } catch {}
      try { await progressMsg.delete().catch(()=>{}); } catch {}

      const summary = new EmbedBuilder()
        .setTitle('Messages Cleaner')
        .setColor('#0009ff')
        .setDescription(
          `تم حذف **${deletedCount}** رسالة${deletedCount !== toDelete ? ` (من أصل ${toDelete})` : ''}.\n\n` +
          `**الاستخدام:**\n` +
          `• \`$clear\` يحذف آخر **20** رسالة\n` +
          `• \`$clear <1-100>\` يحذف بعدد محدد حتى **100**\n\n` +
          `**ملاحظات:**\n` +
          `•تستثنى الرسائل المثبتة\n` +
          `• الرسائل الأقدم من 14 يوم يتم حذفها **فرديًا** بينما الأحدث تُحذف **دفعة واحدة** لسرعة أعلى.\n` +
          `• عند تكرار \`$clear 100\` بسرعة في نفس القناة، يتم تطبيق تهدئة قصيرة لتفادي حدود ديسكورد`
        )
        .setTimestamp()
        .setFooter({
          text: `Requested by ${message.author.tag}`,
          iconURL: message.author.displayAvatarURL({ dynamic: true })
        });

      await message.channel.send({ embeds: [summary] }).catch(() => {});
    } catch (error) {
      const err = new EmbedBuilder()
        .setTitle('⚠️ فشل الحذف')
        .setColor('#ff4444')
        .setDescription('حدث خطأ أثناء التنفيذ. تأكد من الصلاحيات وحاول لاحقًا.')
        .setTimestamp();
      await message.channel.send({ embeds: [err] }).catch(() => {});
    }
  });
};
