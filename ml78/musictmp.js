module.exports = (client) => {
    const musicChannelId = '1296284789296336966';
    
    async function deleteMessages() {
        const channel = await client.channels.fetch(musicChannelId);
        
        const messages1 = await channel.messages.fetch({ limit: 10 });
        for (const msg of messages1.values()) {
            await msg.delete().catch(console.error);
            await new Promise(res => setTimeout(res, 300)); 
        }


        await new Promise(resolve => setTimeout(resolve, 10000));

        const messages2 = await channel.messages.fetch({ limit: 10 });
        for (const msg of messages2.values()) {
            await msg.delete().catch(console.error);
            await new Promise(res => setTimeout(res, 300));
        }
    }
    
    client.once("ready", () => {
        setInterval(deleteMessages, 10 * 60 * 1000);
    
    deleteMessages();
    });
};