import dotenv from 'dotenv';
dotenv.config();
import TelegramBot from 'node-telegram-bot-api';

const TG_TOKEN = process.env.TG_TOKEN;
const CHAT_IDS = process.env.CHAT_IDS;
const TG_TIMEOUTDELETE = process.env.TG_TIMEOUTDELETE;

const bot = new TelegramBot(TG_TOKEN, {
    polling: false
})

const chatIds = CHAT_IDS.split(',');



const a={};

async function complexSendMessage(videoid,type,text,timeout,photoUrl) {
    await Promise.all(chatIds.map(async (chatId) => {
        a[chatId] = a?.[chatId] ?? {};
        a[chatId][videoid] = a[chatId]?.[videoid] ?? {};
      
        try {
            if (a[chatId][videoid][type]) {
                await bot.deleteMessage(chatId, `${a[chatId][videoid][type]}`);
            }
        
            const messageId = photoUrl 
            ? await tgphoto(chatId, photoUrl, text, timeout) 
            : await tgmessage(chatId, text, timeout);
        
            a[chatId][videoid][type] = messageId;
        
            if (type === "end") {
                const { start, stop } = a[chatId]?.[videoid] ?? {};
                if (start) await bot.deleteMessage(chatId, `${start}`);
                if (stop) await bot.deleteMessage(chatId, `${stop}`);
                delete a[chatId]?.[videoid];
              }
        } catch (error) {
          console.error('TG_Error:', error);
        }
      }));
}

/**
 * 发送带图片信息
 * @param chatId 发送对象的ID
 * @param text 需要发送的消息
 * @param timeout null或者延迟 单位:s
 */
async function tgmessage(chatId, text, timeout) {
    try {
        const message = await bot.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true });
        console.log(`Message sent:\n${message.text}\n`);
        deleteMessage(message, timeout ?? TG_TIMEOUTDELETE);
        return message.message_id
    } catch (error) {
        //console.error('TG_Error:', error);
        throw error;
    }
}

/**
 * 发送带图片信息
 * @param chatId 发送对象的ID
 * @param url 需要发送的图片地址
 * @param text 需要发送的消息
 * @param timeout null或者延迟 单位:s
 */
async function tgphoto(chatId, url, text, timeout) {
    try {
        const message = await bot.sendPhoto(chatId, url, { caption: text, parse_mode: "HTML" });
        console.log(`pMessage sent:\n${message.caption}\n`);
        deleteMessage(message, timeout ?? TG_TIMEOUTDELETE);
        return message.message_id
    } catch (error) {
        //console.error('TG_Error:', error);
        throw error;
    }
}

/**
 * 延迟删除消息
 * @param msg 需要删除的消息
 * @param times 延迟 单位:s
 */
const deleteMessage = (msg, times) => {
    return setTimeout(async() => {
        try {
            await bot.deleteMessage(msg.chat.id, `${msg.message_id}`)
        } catch (error) {
            console.log(error.message);
        }
    }, times * 1000)
}

export { complexSendMessage };