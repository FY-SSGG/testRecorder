import dotenv from 'dotenv';
dotenv.config();
import TelegramBot from 'node-telegram-bot-api';

const TG_TOKEN = process.env.TG_TOKEN;
const CHAT_IDS = process.env.CHAT_IDS;
const TG_TIMEOUTDELETE = process.env.TG_TIMEOUTDELETE;

const bot = new TelegramBot(TG_TOKEN, {
    polling: false
})

/**
 * 发送带图片信息
 * @param text 需要发送的消息
 * @param timeout null或者延迟 单位:s
 */
function tgmessage(text, timeout) {

    const chatIds = CHAT_IDS.split(',');

    chatIds.forEach((chatId) => {
        bot.sendMessage(chatId, text, { parse_mode: "HTML", disable_web_page_preview: true })
            .then(message => {
                console.log(`Message sent:\n${message.text}\n`);
                deleteMessage(message, timeout ?? TG_TIMEOUTDELETE);
            })
            .catch((error) => {
                console.error('TG_Error:', error);
            })
    });

}

/**
 * 发送带图片信息
 * @param url 需要发送的图片地址
 * @param text 需要发送的消息
 * @param timeout null或者延迟 单位:s
 */
function tgphoto(url, text, timeout) {

    const chatIds = CHAT_IDS.split(',');

    chatIds.forEach((chatId) => {
        bot.sendPhoto(chatId, url, { caption: text, parse_mode: "HTML" })
            .then(message => {
                console.log(`pMessage sent:\n${message.caption}\n`);
                deleteMessage(message, timeout ?? TG_TIMEOUTDELETE);
            })
            .catch((error) => {
                console.error('TG_Error:', error);
            })
    });

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

export { tgmessage, tgphoto };