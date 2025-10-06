const { Client, GatewayIntentBits, PermissionFlagsBits} = require('discord.js');
require('dotenv').config();
const { EmbedBuilder } = require('discord.js');

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildModeration,
        GatewayIntentBits.GuildEmojisAndStickers,
        GatewayIntentBits.GuildIntegrations,
        GatewayIntentBits.GuildWebhooks,
        GatewayIntentBits.GuildInvites,
        GatewayIntentBits.GuildVoiceStates,
        GatewayIntentBits.GuildPresences,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.GuildMessageReactions,
        GatewayIntentBits.GuildMessageTyping,
        GatewayIntentBits.DirectMessages,
        GatewayIntentBits.DirectMessageReactions,
        GatewayIntentBits.DirectMessageTyping,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildScheduledEvents,
        GatewayIntentBits.AutoModerationConfiguration,
        GatewayIntentBits.AutoModerationExecution
    ]
});
//---------------------------------------------
const admin = 237171492452958218;
const blueColor = '#0009ff';
// ml78 Files
require('./ml78/welcome')(client, { blueColor });
require("./ml78/musictmp")(client);
require("./ml78/colorsrole")(client);
require('./ml78/prison')(client, { blueColor });
require('./ml78/ai.js')(client);
require('./ml78/logs.js')(client);

// BOYS SERVER 
require("./boys/colorsrole")(client);
require('./boys/welcome')(client, { blueColor });
require('./boys/ai.js')(client);
// FOUCS SERVER 
require('./discordfoucs/main.js')(client);
require('./discordfoucs/timeralarm.js')(client, { blueColor });
require('./discordfoucs/logs.js')(client);
// General Tasks 
require("./general/clearmsgs")(client);
require('./general/userinfo.js')(client, { blueColor });

client.once("ready", () => {

  console.log("Bot Started at " + new Date().toLocaleString("en-us", {

    month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: true, timezone: "Asia/Riyadh"
  }))

});


client.login(process.env.BOT_TOKEN);

