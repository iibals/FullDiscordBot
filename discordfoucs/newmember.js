const path = require('path');
const {
  PermissionFlagsBits,
  ChannelType,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  PermissionsBitField,
  EmbedBuilder,
} = require('discord.js');

module.exports = (client) => {
  const GUILD_ID        = '1399596680822915124';
  const ADMIN_ID        = '237171492452958218';
  const MEMBER_ROLE_ID  = '1399668268083449926';

  const IMAGE_PATH = path.resolve(__dirname, 'assets', 'browse.png');

  const GENDER_ROLES = {
    male:   '1422605527862743040',
    female: '1422605529267699864',
  };

  const SPEC_ROLES = {
    eng:               '1422634115588690098',
    medicine:          '1422634118109335703',
    managemtn:         '1422634120609136711',
    'Computer Science':'1422634122760814692',
    busniss:           '1422634125008830598',
    accounting:        '1422634127567356024',
    markting:          '1422634129777885316',
    law:               '1422634132780875878',
    Islamic:           '1440244208316452865',
    architecture:      '1422634135494594590',
    design:            '1422634138187464766',
    nursing:           '1422634140255391915',
    pharamcy:          '1422634142281236510',
    physics:           '1422634144160288889',
    chemitry:          '1422634146957758617',
    math:              '1422634148895526934',
    languages:         '1422634151374356490',
  };

  const SPEC_META = {
    eng:                 { en: 'Engineering',       ar: 'الهندسة' },
    medicine:            { en: 'Medicine',          ar: 'الطب' },
    managemtn:           { en: 'Management',        ar: 'الإدارة' },
    'Computer Science':  { en: 'Computer Science',  ar: 'علوم الحاسب' },
    busniss:             { en: 'Business',          ar: 'الأعمال' },
    accounting:          { en: 'Accounting',        ar: 'المحاسبة' },
    markting:            { en: 'Marketing',         ar: 'التسويق' },
    law:                 { en: 'Law',               ar: 'القانون' },
    Islamic:             { en: 'Islamic',           ar: 'شريعة' },
    architecture:        { en: 'Architecture',      ar: 'العمارة' },
    design:              { en: 'Design',            ar: 'التصميم' },
    nursing:             { en: 'Nursing',           ar: 'التمريض' },
    pharamcy:            { en: 'Pharmacy',          ar: 'الصيدلة' },
    physics:             { en: 'Physics',           ar: 'الفيزياء' },
    chemitry:            { en: 'Chemistry',         ar: 'الكيمياء' },
    math:                { en: 'Mathematics',       ar: 'الرياضيات' },
    languages:           { en: 'Languages',         ar: 'اللغات' },
  };

  const genderOptions = [
    { label: 'Male | ذكر',   value: 'male',   description: 'اختر: ذكر'   },
    { label: 'Female | أنثى', value: 'female', description: 'اختر: أنثى' },
  ];

  const specOptions = [
    ...Object.keys(SPEC_ROLES).map((key) => {
      const meta = SPEC_META[key] || { en: key, ar: key };
      return { label: `${meta.en} | ${meta.ar}`, value: key, description: `تخصص: ${meta.ar}` };
    }),
    { label: 'None of above | غير موجود ضمن القائمة', value: 'none', description: 'تواصل لإضافة تخصصك' },
  ];

  if (client._onboardingHandler) return;
  client._onboardingHandler = true;

  client.on('guildMemberAdd', async (member) => {
    try {
      if (member.guild.id !== GUILD_ID) return;

      const me = member.guild.members.me;
      if (!me.permissions.has([
        PermissionsBitField.Flags.ManageChannels,
        PermissionsBitField.Flags.ManageRoles,
        PermissionsBitField.Flags.SendMessages,
        PermissionsBitField.Flags.ViewChannel,
        PermissionsBitField.Flags.ReadMessageHistory,
        PermissionsBitField.Flags.EmbedLinks,
        PermissionsBitField.Flags.AttachFiles,
      ])) return;

      await member.roles.add(MEMBER_ROLE_ID).catch(() => {});

      let parent = member.guild.channels.cache.find(
        (c) => c.type === ChannelType.GuildCategory && c.name === 'Private Onboarding'
      );
      if (!parent) {
        parent = await member.guild.channels.create({
          name: 'Private Onboarding',
          type: ChannelType.GuildCategory,
          permissionOverwrites: [
            { id: member.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
            {
              id: client.user.id,
              allow: [
                PermissionFlagsBits.ViewChannel,
                PermissionFlagsBits.ManageChannels,
                PermissionFlagsBits.SendMessages,
                PermissionFlagsBits.ReadMessageHistory,
                PermissionFlagsBits.EmbedLinks,
                PermissionFlagsBits.AttachFiles,
              ],
            },
          ],
        });
      }

      const safe = (s) => s.toLowerCase().replace(/[^a-z0-9-]+/gi, '-').slice(0, 32) || 'member';

      const ch = await member.guild.channels.create({
        name: safe(member.user.username),
        type: ChannelType.GuildText,
        permissionOverwrites: [
          { id: member.guild.id, deny: [PermissionFlagsBits.ViewChannel] },
          {
            id: member.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
            ],
          },
          {
            id: client.user.id,
            allow: [
              PermissionFlagsBits.ViewChannel,
              PermissionFlagsBits.SendMessages,
              PermissionFlagsBits.ReadMessageHistory,
              PermissionFlagsBits.ManageChannels,
              PermissionFlagsBits.EmbedLinks,
              PermissionFlagsBits.AttachFiles,
            ],
          },
        ],
        reason: 'Private onboarding room',
      });

      await ch.setParent(parent.id, { lockPermissions: false }).catch(() => {});
      try { await ch.setPosition(0); } catch {}

      try {
        const imgEmbed = new EmbedBuilder()
          .setColor(0x1f8b4c)
          .setTitle('رتّب القنوات قبل البداية')
          .setDescription([
            'لو القنوات كثيرة وما تخصّ تخصصك، تقدر تُخفيها وتظهر بس قنوات تخصصك.',
            'من القائمة الجانبية افتح **Browse Channels** وسو إظهار/إخفاء اللي يناسبك.',
            'اختياري وتقدر تعدّل لاحقًا.'
          ].join('\n'))
          .setImage('attachment://browse.png');

        await ch.send({
          content: `${member}`,
          embeds: [imgEmbed],
          files: [{ attachment: IMAGE_PATH, name: 'browse.png' }],
          allowedMentions: { users: [member.id] },
        });
      } catch {}

      const genderRow = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId(`onb:gender:${member.id}`)
          .setPlaceholder('انت رجل ولا أنثى؟')
          .setMinValues(1)
          .setMaxValues(1)
          .addOptions(genderOptions)
      );

      await ch.send({
        content: `${member} انت رجل ولا أنثى؟ **الاختيار الخاطئ يعرضك للمحاسبة**`,
        components: [genderRow],
        allowedMentions: { users: [member.id] },
      });
    } catch {}
  });

  client.on('interactionCreate', async (interaction) => {
    try {
      if (!interaction.isStringSelectMenu()) return;
      if (interaction.guildId !== GUILD_ID) return;

      const [ns, kind, targetId] = (interaction.customId || '').split(':');
      if (ns !== 'onb') return;

      if (interaction.user.id !== targetId) {
        return interaction.reply({ content: 'هذا الاختيار ليس لك.', ephemeral: true }).catch(() => {});
      }

      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!member) return;

      const clearComponents = async () => {
        try { await interaction.message.edit({ components: [] }); } catch {}
      };

      if (kind === 'gender') {
        const choice = interaction.values?.[0];
        const roleId = GENDER_ROLES[choice];
        await clearComponents();

        if (roleId) {
          const otherId = choice === 'male' ? GENDER_ROLES.female : GENDER_ROLES.male;
          if (otherId && member.roles.cache.has(otherId)) {
            await member.roles.remove(otherId).catch(() => {});
          }
          await member.roles.add(roleId).catch(() => {});
        }

        await interaction.reply({ content: `تم تعيين الجنس: **${choice}**.` }).catch(() => {});

        const specRow = new ActionRowBuilder().addComponents(
          new StringSelectMenuBuilder()
            .setCustomId(`onb:spec:${member.id}`)
            .setPlaceholder('وش التخصص حقك؟ (Arabic/English)')
            .setMinValues(1)
            .setMaxValues(1)
            .addOptions(specOptions)
        );

        await interaction.channel.send({
          content: `${member} اختر تخصصك من القائمة:`,
          components: [specRow],
          allowedMentions: { users: [member.id] },
        });
      }

      if (kind === 'spec') {
        const choice = interaction.values?.[0];
        await clearComponents();

        if (choice === 'none') {
          await interaction.reply({
            content: `ما لقينا تخصصك. ${interaction.user} تواصل مع <@${ADMIN_ID}> لإضافته.`,
          }).catch(() => {});
          await interaction.channel.send({
            content: `حياك الله ${member} 🤝\nتم تسجيل الجنس بنجاح. بالنسبة للتخصص، تواصل مع الإدارة لإضافته.\nسيتم حذف الغرفة بعد 20 ثانية.`,
          }).catch(() => {});
          setTimeout(() => { interaction.channel?.delete('Onboarding - no spec').catch(() => {}); }, 20000);
          return;
        }

        const roleId = SPEC_ROLES[choice];
        if (roleId) {
          const allSpecIds = Object.values(SPEC_ROLES);
          const hasAny = member.roles.cache.filter((r) => allSpecIds.includes(r.id));
          if (hasAny.size) await member.roles.remove(hasAny).catch(() => {});
          await member.roles.add(roleId).catch(() => {});
        }

        await interaction.reply({ content: `تم تعيين تخصصك: **${choice}**.` }).catch(() => {});
        await interaction.channel.send({
          content: `حياك الله ${member} 🤝\nتم تعيين الجنس والتخصص بنجاح. بالتوفيق!\nسيتم حذف الغرفة بعد 20 ثانية.`,
        }).catch(() => {});
        setTimeout(() => { interaction.channel?.delete('Onboarding completed').catch(() => {}); }, 20000);
      }
    } catch {}
  });
};
