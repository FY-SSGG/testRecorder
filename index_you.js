import dotenv from 'dotenv';
dotenv.config();
import https from 'https';
import axios from "axios";
import fs from 'fs';
import moment from 'moment-timezone';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { complexSendMessage } from './index_tgnotice.js';

moment.tz.setDefault('Asia/Shanghai');
const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

const dir = process.env.DOWNLOADDIR;
const RCLONEDIR = process.env.RCLONEDIR;
const DANMUFC = process.env.DANMUFC;
const CONFIG = process.env.CONFIG;
const YDA_KEYS = process.env.YDA_KEYS.split(',');
const YDA_URL = process.env.YDA_URL;

let currentkey = 0;
let YDA_KEY = YDA_KEYS[0];


const configLog = CONFIG + '/config.json';
const runningLog = CONFIG + '/running.json';
const logFile = CONFIG + '/log.json';

// 队列，用于录制完成后的文件处理事件
let isRcloneRunning = false;
const queue = [];

// 队列，用于写出状态
let isExchange = false;
const queueExchange = [];

// 队列，用于过滤重复
const queueChannelId = [];

//调试用，autoRecorder：默认是否录制。status：标识运行状态。isStreamlink：手动设置是否录制。
/* const event = {
    channelId: 'UC1opHUrw8rvnsadT-iGp7Cg',
    channelName: 'MinatoAqua',
    definition: 'best',
    autoRecorder: true,
    isStreamlink: true,
    beforeScheduledStartTime: null,
    beforeVideoId: null,
    status: null,
}
main(event); */

//防止重复运行
function isMainRunning(event) {
    if (!queueChannelId.includes(event.channelId)) {
        queueChannelId.push(event.channelId);
        main(event);
    } else {
        console.log(`'${event.channelName}' 已在队列中`)
    }
}

//主函数
async function main(event) {
    const channelId = event.channelId;
    const channelName = event.channelName;
    const definition = event.definition;
    //const autoRecorder = event.autoRecorder;

    const match = await getHttps(channelId);
    let timeout = await isLivingAsync(match);
    
    exchange()
    //delete event.name;
    delete event.videoId;
    delete event.pid;

    //判断是否循环调用
    setTimeout(async () => {
        event["definition"] = isChannelIdInConfigSync(channelId)
        if (event.definition) {
            main(event);
        } else {
            //移除数组中的对象
            const index = queueChannelId.indexOf(channelId);
            if (index !== -1) {
                queueChannelId.splice(index, 1);
            }

            delete event.definition;
            exchange()
        }
    }, timeout * 1000);


    /**
     * 通过https获取对应频道直播页面源码
     * 返回值为直播间对应的源码
     * @param channelId 频道id
     */
    function getHttps(channelId) {
        return new Promise((resolve, reject) => {
            const liveUrl = `https://www.youtube.com/channel/${channelId}/live`;
            https.get(liveUrl, (response) => {
                let data = '';
                response.on('data', (chunk) => {
                    data += chunk;
                });

                response.on('end', () => {
                    const regex = /ytInitialPlayerResponse\s*=\s*({.*});/;
                    const match = data.match(regex);
                    resolve(match)
                });
            }).on('error', (error) => {
                reject;
                console.error(`[${moment().format()}]: ${error}`);
            });
        })
    }

    /**
     * 通多https数据判断直播间状态
     * 函数返回值为循环获取https数据的周期
     * 
     * 状态包含无信息、待机、直播中以及未知状态
     * 函数中设置了默认循环获取https数据周期为2700.5秒
     * 设置为小数是为了判断默认值未改变，所有更改的时间皆为整数
     * 当状态为待机时，将视时间调整周期用于防止过多的发送https请求
     * 当状态为直播时，将周期设置为5秒用以防止主播网络波动造成断流
     * 其他情况不对周期进行更改
     * 返回值时会判断周期大于等于默认值时会将其乘以一个1以内的随机值
     * 小于默认值时不做改变
     */
    async function isLivingAsync(match) {
        //默认循环的时间，！要是小数，用来排除超长待机的通知
        const timeoutDefault = 2700.5;
        let timeout = timeoutDefault;

        if (match && match[1]) {
            const playerResponse = JSON.parse(match[1]);
            //console.log(playerResponse);
            const title = playerResponse.videoDetails.title;
            const videoId = playerResponse.videoDetails.videoId;
            const author = playerResponse.videoDetails.author;
            const status = playerResponse.playabilityStatus.status;

            const values = playerResponse.videoDetails.thumbnail.thumbnails;
            const coverUrl = values[values.length - 1].url;

            event.name = author;
            event.videoId =videoId;

            event["isStreamlink"] = videoId !== event.beforeVideoId ? event.autoRecorder : event.isStreamlink

            const url = `https://www.youtube.com/channel/${channelId}`;
            const liveChannelUrl = `https://www.youtube.com/channel/${channelId}/live`;
            const liveVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;

            if (event.status === "live" && !(videoId === event.beforeVideoId)) {
                tgnotice(event.beforeVideoId,"liveend",null,null,null)
            };

            switch (status) {
                case "LIVE_STREAM_OFFLINE":
                    event["status"] = "upcoming";
                    const scheduledStartTime = playerResponse.playabilityStatus.liveStreamability.liveStreamabilityRenderer.offlineSlate.liveStreamOfflineSlateRenderer.scheduledStartTime;
                    const timeoutMath = timeMath(scheduledStartTime, timeout);

                    if (!(timeoutMath[0] === timeoutDefault) && (!(videoId === event.beforeVideoId) || !(scheduledStartTime === event.beforeScheduledStartTime))) {
                        event["beforeScheduledStartTime"] = scheduledStartTime;
                        
                        const starttime = moment.unix(scheduledStartTime).format('(z) dddd, MMMM D, h:mm A');
                        let text = `<tg-spoiler>~—~—~—</tg-spoiler><b>LIVE-MESSAGE</b><tg-spoiler>—~—~—~</tg-spoiler>\n<b>${author}</b> <code>>></code> 直播预告！ <b>${event.autoRecorder ? 'T' : 'F'}</b>\n时间 <code>:</code> <b>${starttime}</b>\n标题 <code>:</code> <i><a href="${liveChannelUrl}">${title}</a></i>`;
                        tgnotice(videoId, "plan", text, timeoutMath[1], coverUrl)
                    }
                    timeout = timeoutMath[0];

                    break;
                case "OK":
                    
                    if (!(videoId === event.beforeVideoId && event.status === "live") && !event.isStreamlink) {
                        const isLive = playerResponse.videoDetails.isLive
                        event["status"] = "live";

                        let text = `🟡 <b><a href="${url}">${author}</a></b> <code>>></code> ${isLive ? '直播开始！' : 'null！'}\n标题 <code>:</code> <i><a href="${liveVideoUrl}">${title}</a></i>`
                        tgnotice(videoId, "livestart", text, null, null)
                    }

                    if (event.isStreamlink) {
                    
                    const timeId = moment().format('YYYYMMDD_HHmmssSSS')
                    const folderPath = dir + '/' + channelName + '/' + timeId;
                    fs.mkdirSync(folderPath, { recursive: true })

                    const partialPath = moment().format('YYYY_MM')
                    const rclonePath = RCLONEDIR + '/' + channelName + '/' + partialPath + '/' + timeId;

                    const filename = timeId + '-' + channelName
                    const flvPath = folderPath + '/' + filename + '.flv'
                    const aacPath = folderPath + '/' + filename + '.aac'
                    const jpgPath = folderPath + '/' + filename + '.jpg'
                    const nfoPath = folderPath + '/' + filename + '.nfo'
                    const xmlPath = folderPath + '/' + filename + '.xml'
                    const assPath = folderPath + '/' + filename + '.ass'

                    //下载
                    await StreamlinkAsync(coverUrl, liveVideoUrl, title, flvPath, liveChannelUrl, definition, author, xmlPath)

                    //排队上传
                    const rcloneEvent = {
                        beforePath: flvPath,
                        afterPath: aacPath,
                        folderPath: folderPath,
                        rclonePath: rclonePath,
                        nfoPath: nfoPath,
                        jpgPath: jpgPath,
                        xmlPath: xmlPath,
                        assPath: assPath,
                        definition: definition,
                        videoId: videoId,
                        coverUrl:coverUrl
                    }
                    runbash(rcloneEvent)

                    timeout = 5;

                    } else {
                        if (event.autoRecorder) console.log(`${channelName} 手动停止，跳过本场直播\n`);
                    }

                    break;
                default:
                    Log({ playabilityStatus: playerResponse.playabilityStatus, videoDetails: playerResponse.videoDetails })
                    console.log(`岁月静好\n`)
                    break;
            }
            event["beforeVideoId"] = videoId;

        } else {
            if (event.status === "live") {
                tgnotice(event.beforeVideoId, "liveend", null, null, null)
            };
            event["status"] = null;
            event["beforeScheduledStartTime"] = null;
            event["beforeVideoId"] = null;
            event["VideoId"] = null;
            event["isStreamlink"] = event.autoRecorder;
            //console.log(`${channelName} 没有直播信息\n`);
        }

        timeout = timeout >= timeoutDefault ? Math.ceil(Math.random() * timeout) : timeout;
        return timeout;
    }

    //判断是否循环调用，返回录播清晰度
    function isChannelIdInConfigSync(channelId) {
        let definition;
        try {
            const configData = fs.readFileSync(configLog);
            const configJson = JSON.parse(configData);
            let youtuber = configJson.youtubers.find(item => item.channelId === channelId);
            definition = youtuber ? youtuber.definition || 'best' : '';
            event["autoRecorder"] = youtuber ? youtuber.autoRecorder : '';

            if (definition) {
                const runningData = fs.readFileSync(runningLog);
                const runningJson = JSON.parse(runningData);
                event["isStreamlink"] = runningJson[channelId].isStreamlink;
            }
        } catch (error) {
            console.error(`[${moment().format()}]: ${error}`);
        }
        
        return definition;
    }

    /**
     * 待机状态下循环周期判断
     * @param scheduledStartTime 预计开播时间
     * @param timeout 循环周期
     * @returns {[number,number]}
     * @retval [ 循环周期, 剩余开播时间 ]
     * @retval timeout = [48h - 10min,)：timeout
     * [24h,48h - 10min)：剩余开播时间/3
     * [1h,24h)：剩余开播时间/2
     * (0,1h)：剩余开播时间
     * [-3h,0]：60
     * (,-3h)：timeout
     */
    function timeMath(scheduledStartTime, timeout) {

        let timeunix = moment().valueOf();
        //秒：seconds 小时：hours
        let differenceInSeconds = moment.unix(scheduledStartTime).diff(timeunix, 'seconds');

        //console.log(`sunix-${scheduledStartTime}`);
        //console.log(`nunix-${timeunix}`);
        //console.log(`dunix-${differenceInSeconds}`)

        if (differenceInSeconds >= 172800 - 600) {
            return [timeout,differenceInSeconds];
        } else if (differenceInSeconds >= 86400 && differenceInSeconds < 172800 - 600) {
            timeout = differenceInSeconds / 3;
            return [Math.ceil(timeout),differenceInSeconds];
        } else if (differenceInSeconds >= 3600 && differenceInSeconds < 86400) {
            timeout = differenceInSeconds / 2;
            return [Math.ceil(timeout),differenceInSeconds];
        } else if (differenceInSeconds > 0 && differenceInSeconds < 3600) {
            timeout = differenceInSeconds;
            return [timeout,differenceInSeconds];
        } else if (differenceInSeconds >= -10800 && differenceInSeconds <= 0) {
            timeout = 60;
            return [timeout,differenceInSeconds];
        } else {
            return [timeout,differenceInSeconds];
        }
    }

    //下载
    async function StreamlinkAsync(coverUrl, liveVideoUrl, title, Path, url, definition, author, xmlPath) {

        let pid = null;
        let text = `🟢 <b><a href="https://www.youtube.com/channel/${channelId}">${author}</a></b> <code>>></code> 录制开始！\n标题 <code>:</code> <i><a href="${liveVideoUrl}">${title}</a></i>`
        tgnotice(event.videoId, "recorderstart", text, null, null);
        
        const videoStartTime = new Date().getTime();
        const result = spawn('streamlink', ['--hls-live-restart', '--loglevel', 'warning', '-o', `${Path}`, `${url}`, definition]);
        pid = result.pid;
        event.pid = pid;
        
        getChatMessages(event.videoId, videoStartTime, xmlPath)
        exchange()

        await new Promise((resolve, reject) => {
            result.on('exit', (code, signal) => {
                if (code === 0) {
                    console.log(`视频已下载到：${Path}`);
                    resolve();
                } else if (code === 130) {
                    event["isStreamlink"] = false;
                    console.log(`（手动）视频地址：${Path}`);
                    resolve();
                } else if (code === 1) {
                    console.error(`（超时？）视频地址：${Path}`);
                    resolve();
                } else {
                    reject(`code:${code}\nsignal:${signal}`);
                }
            });
        });
        event.pid = null;
        text = `🔴 <b>${author}</b> <code>>></code> 录制结束！`
        tgnotice(event.videoId, "recorderend", text, null, null)
    }

    //获取弹幕
    async function getChatMessages(videoId, videoStartTime, xmlPath) {
        let b = 0;
        let t = event.t ?? 30;
        const processedMessageIds = new Set();
        //let nextPageToken = null;

        let [msgCount, elapsed, PageToken] = [0, 0, null];
        let interval = setInterval(async () => {
            //console.log('主循环b' + '"' + b + '"')
            //console.log('时间回调t' + '"' + t + '"')
            //b每秒一跳，b=0或b>t时b=0,这是一个负反馈动态调节调用api的周期
            //setInterval的优势是不会因为函数运行暂停循环，他会按时间定时重复调用函数
            if (event.pid) {
                //console.log('继续循环');
                if ( b === 0 || b >= t) {
                    [msgCount, elapsed, PageToken] = await writeXml(videoId, PageToken, xmlPath)
                    //console.log(b + '_' + elapsed / 1000 + '_' + msgCount )
                    if (msgCount > 43 && t > 1 + elapsed/1000) {
                        t--;
                    } else if(msgCount < 38 && t < 180){
                            t++;
                    }
                    b = 0;
                }
                b++;
            } else {
                
                if (b > elapsed/1000) {
                    writeXml(videoId, PageToken, xmlPath)
                    event['t'] = t;
                }
                clearInterval(interval);
                delete event.liveChatId;
                //console.log('结束循环');
            }
            
          }, 1000);

        /**
         * 写弹幕源文件
         * @param videoId 视频id
         * @param PageToken 获取这次评论的PageToken
         * @param xmlPath 弹幕源文件路径
         * @returns {Promise<[number,number,any]>}
         * @retval [ 新增信息数, 最小请求周期, 下一次评论的PageToken ]
         */
        async function writeXml(videoId, PageToken, xmlPath) {

            //获取chatid
            if (!event['liveChatId']) {
                let videoData = await axiosGet("videos", videoId)
                event['liveChatId'] = videoData.liveStreamingDetails.activeLiveChatId
            }
        
            let messagesData = await axiosGet("messages", videoId, null, event.liveChatId, PageToken)

            let a = 0;
            let nextPageToken = null;
            if (messagesData) {
                const messages = messagesData.items;
                nextPageToken = messagesData?.nextPageToken ?? null;
                for (const message of messages) {
                    // 如果这条消息的ID已经被处理过了，就跳过
                    if (processedMessageIds.has(message.id)) {
                        continue;
                    }
                    a++;
                    const chatMessageTime = new Date(message.snippet.publishedAt).getTime();
                    const diffmessageTime = chatMessageTime - videoStartTime;
                    const colors = message.authorDetails.isChatOwner ? '16772431' : message.authorDetails.isChatModerator ? '14893055' : message.authorDetails.isChatSponsor ? '5816798' : '16777215'
                    let text = `<d p="${diffmessageTime/1000},${message.authorDetails.isChatOwner ? '5' : '1'},25,${colors},${chatMessageTime},0,${message.authorDetails.channelId},0" user="${message.authorDetails.displayName}">${escapeXml(message.snippet.displayMessage.replace(/:([^:]+):/g, '[$1]'))}</d>\n`
                    fs.appendFile(xmlPath, text , (err) => {
                        if (err) throw err;
                        //console.log(`保存消息：${message.snippet.displayMessage}`);
                        });
    
                    // 将这条消息的ID添加到已处理消息ID的Set中
                    processedMessageIds.add(message.id);
                }
                
            }
            return [ a , messagesData?.pollingIntervalMillis ?? 10000 , nextPageToken]
        }
    }

    //向running.json传递当前状态参数
    function exchange() {
        const exchangeEvent = {
            channelId: event.channelId,
            channelName: event.channelName,
            definition: event.definition ?? null,
            autoRecorder: event.autoRecorder,
            name: event.name ?? '',
            videoId: event.videoId ?? '',
            pid: event.pid ?? '',
            isStreamlink: event.isStreamlink
        }
        runExchange(exchangeEvent)
    }

}

//处理上传相关事件
function runbash(rcloneEvent) {
    if (isRcloneRunning) {
        queue.push(rcloneEvent);
    } else {
        handleBash(rcloneEvent);
    }
}

// 处理上传事件函数
async function handleBash(rcloneEvent) {

    // 标记 Rclone 进程正在运行
    isRcloneRunning = true;

    const beforePath = rcloneEvent.beforePath;
    const afterPath = rcloneEvent.afterPath;
    const folderPath = rcloneEvent.folderPath;
    const rclonePath = rcloneEvent.rclonePath;
    const nfoPath = rcloneEvent.nfoPath;
    const jpgPath = rcloneEvent.jpgPath;
    const xmlPath = rcloneEvent.xmlPath;
    const assPath = rcloneEvent.assPath;
    const videoId = rcloneEvent.videoId;
    const definition = rcloneEvent.definition;
    let coverUrl = rcloneEvent.coverUrl;
    
    coverUrl = await WriteNfo(videoId, coverUrl, nfoPath);

    const danmucl = spawn(DANMUFC, ["-o", "ass", `${assPath}`, "-i", "xml", `${xmlPath}`, "-b", "REPEAT", "--ignore-warnings"]);
    danmucl.on("close", code=> console.log(`[danmucl-exit ]: ${code}`));
    
    await GetImage(coverUrl, jpgPath)

    Ffmpeg(beforePath, afterPath)
        .then(() => Rclone(folderPath, rclonePath, definition))
        .then(() => {
            const ls = spawn('rclone', ['ls', `${rclonePath}/`], { stdio: ['ignore', 'pipe', 'pipe'] });
            const wc = spawn('wc', ['-l'], { stdio: ['pipe', 'pipe', 'ignore'] });
            ls.stdout.pipe(wc.stdin);

            wc.stdout.on('data', (data) => {
                //console.log('data received:', data);
                const stdout = data.toString().trim();
                //console.log(Number(stdout));
                let a = definition === 'worst' ? 4 : 6;
                if (a === Number(stdout)) {

                    tgnotice(videoId, "rclonetrue", null, null, coverUrl)

                    spawn('rm', ['-rf', `${folderPath}`]).on('close', code => console.log(`[    rm-exit  ]: ${code}`))
                } else {
                    tgnotice(videoId, "rclonefalse", null, null, coverUrl)
                };
            });

            wc.on('close', code => {
                console.log(`[    wc-exit  ]: ${code}`)
                if (queue.length > 0) {
                    console.log("处理下一事件")
                    const nextBash = queue.shift();
                    //console.error(nextBash)
                    handleBash(nextBash);
                } else {
                    isRcloneRunning = false;
                }
            })

        });

    //写nfo
    async function WriteNfo(videoId, coverUrl, nfoPath) {
        let nfoContent;
        
        if (YDA_KEY) {
            let channelData
            let videoData
            videoData = await axiosGet("videos", videoId);
            channelData = await axiosGet("channels", videoId, videoData.snippet.channelId);

            coverUrl = Object.values(videoData.snippet.thumbnails)[Object.values(videoData.snippet.thumbnails).length - 1].url;
            let thumbUrl = Object.values(channelData.snippet.thumbnails)[Object.values(channelData.snippet.thumbnails).length - 1].url; 
            nfoContent = `<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>${escapeXml(videoData.snippet?.title)}</title>
    <userrating>${videoData.statistics?.viewCount ? ( 10 * videoData.statistics.likeCount / videoData.statistics.viewCount ).toFixed(2) : ''}</userrating>
    <plot>${escapeXml(videoData.snippet?.description)}</plot>
    <description>${escapeXml(channelData.snippet?.description)}</description>
    <mpaa>PG</mpaa>
    <genre>Live</genre>
    <genre>${videoData.snippet?.defaultAudioLanguage}</genre>
    <genre>${channelData.snippet?.customUrl}</genre>
    <country>${(channelData.snippet?.country || '').toUpperCase()}</country>
    <premiered>${moment(videoData.liveStreamingDetails?.actualStartTime).format('YYYY-MM-DD')}</premiered>
    <director>${escapeXml(videoData.snippet?.channelTitle)}</director>
    <writer>${escapeXml(channelData.snippet?.title)}</writer>
    <actor>
        <name>${escapeXml(videoData.snippet?.channelTitle)}</name>
        <type>Actor</type>
        <thumb>${thumbUrl}</thumb>
    </actor>
    <viewCount>${videoData.statistics?.viewCount}</viewCount>
    <likeCount>${videoData.statistics?.likeCount}</likeCount>
    <scheduledStartTime>${videoData.liveStreamingDetails?.scheduledStartTime}</scheduledStartTime>
    <actualStartTime>${videoData.liveStreamingDetails?.actualStartTime}</actualStartTime>
    <actualEndTime>${videoData.liveStreamingDetails?.actualEndTime}</actualEndTime>
    <subscriberCount>${channelData.statistics?.subscriberCount}</subscriberCount>
    <thumb>${coverUrl}</thumb>
    <website>https://www.youtube.com/watch?v=${videoId}</website>
</movie>`;
            
        }

        fs.writeFile(`${nfoPath}`, nfoContent, function(err) {
            if (err) throw err;
            console.log('NFO file saved!');
        });
        return coverUrl
    }

    //获取封面
    function GetImage(imageUrl, jpgPath) {
        const file = fs.createWriteStream(jpgPath);

        https.get(imageUrl, function(response) {
            response.pipe(file);
            console.log('Image downloaded!');
        }).on('error', function(error) {
            console.error('Error downloading image:', error);
        });
    }

    //转码-->aac
    function Ffmpeg(beforePath, afterPath) {
        return new Promise((resolve, reject) => {

            const ffmpeg = spawn('ffmpeg', ['-v', '24', '-i', `${beforePath}`, '-vn', '-acodec', 'copy', `${afterPath}`]);
            ffmpeg.stderr.on('data', data => console.log(`[ffmpeg-stderr]: ${data}`))
            ffmpeg.stdout.on('data', data => console.log(`[ffmpeg-stderr]: ${data}`))
            ffmpeg.on('close', code => {
                console.log(`[ffmpeg-exit  ]: ${code}`)
                resolve()
            })
            ffmpeg.on('error', error => {
                console.log(`[ffmpeg-error ]: ${error}`)
                reject()
            })
        })
    }

    //上传
    function Rclone(folderPath, rclonePath, definition) {
        return new Promise((resolve, reject) => {
            if (definition === 'worst') {
                const rclone = spawn('rclone', ['copy', `${folderPath}/`, `${rclonePath}/`, '--min-size', '1b', '--exclude', '*.flv', '--exclude', '*.xml', '--onedrive-chunk-size', '25600k', '-q']);
                rclone.stderr.on('data', data => console.log(`[rclone-stderr]: ${data}`))
                rclone.stdout.on('data', data => console.log(`[rclone-stderr]: ${data}`))
                rclone.on('close', code => {
                    console.log(`[rclone-exit  ]: ${code}`)
                    resolve()
                })
                rclone.on('error', error => {
                    console.log(`[rclone-error ]: ${error}`)
                    reject()
                })
            } else {
                const rclone = spawn('rclone', ['copy', `${folderPath}/`, `${rclonePath}/`, '--min-size', '1b', '--onedrive-chunk-size', '25600k', '-q']);
                rclone.stderr.on('data', data => console.log(`[rclone-stderr]: ${data}`))
                rclone.stdout.on('data', data => console.log(`[rclone-stderr]: ${data}`))
                rclone.on('close', code => {
                    console.log(`[rclone-exit  ]: ${code}`)
                    resolve()
                })
                rclone.on('error', error => {
                    console.log(`[rclone-error ]: ${error}`)
                    reject()
                })
            }
            
        })
    }
    
}

//处理写出相关事件
function runExchange(exchangeEvent) {
    if (isExchange) {
        queueExchange.push(exchangeEvent);
    } else {
        handleExchange(exchangeEvent);
    }
}

// 处理写出事件函数
async function handleExchange(exchangeEvent) {

    // 标记进程正在运行
    isExchange = true;
    try {
        const data = await readFileAsync(runningLog, "utf-8");
        let json = JSON.parse(data);

        if (exchangeEvent.definition) {
            const nowevent={
                channelName: exchangeEvent.channelName,
                definition: exchangeEvent.definition,
                autoRecorder: exchangeEvent.autoRecorder,
                name: exchangeEvent.name,
                videoId: exchangeEvent.videoId,
                pid: exchangeEvent.pid,
                isStreamlink: exchangeEvent.isStreamlink
            }
            
            //参数发生改变则写入running.json
            if (JSON.stringify(json[exchangeEvent.channelId])!==JSON.stringify(nowevent)) {

                json[exchangeEvent.channelId]={
                    channelName: exchangeEvent.channelName,
                    definition: exchangeEvent.definition,
                    autoRecorder: exchangeEvent.autoRecorder,
                    name: exchangeEvent.name,
                    videoId: exchangeEvent.videoId,
                    pid: exchangeEvent.pid,
                    isStreamlink: exchangeEvent.isStreamlink
                }
            
                await writeFileAsync(runningLog,JSON.stringify(json, null, 2));
            }
        } else {
            delete json[exchangeEvent.channelId]
            await writeFileAsync(runningLog,JSON.stringify(json, null, 2));
            console.log(`${exchangeEvent.channelName}:stop`);
        }

    } catch (error) {
        console.log('exchange:' + error)
    }

    if (queueExchange.length > 0) {
        const nextExchange = queueExchange.shift();
        handleExchange(nextExchange);
    } else {
        isExchange = false;
    }

}

/**
 * tg通知前置处理
 * @param videoid 视频id
 * @param key 状态plan/livestart/liveend/recorderstart/recorderend/rclonetrue/rclonefalse
 * @param text 需要发送的消息
 * @param timeout null或者延迟 单位:s
 * @param coverUrl 图片Url
 */
async function tgnotice(videoId, key, text, timeout, coverUrl) {
    switch (key) {
        case "liveend":
        case "rclonetrue":
        case "rclonefalse":
            const videoData = await axiosGet("videos", videoId)
            const values = Object.values(videoData.snippet.thumbnails)

            coverUrl ||= values[values.length - 1].url;

            if (key === "liveend") text = `🔴 <b><a href="https://www.youtube.com/channel/${videoData.snippet.channelId}">${videoData.snippet.channelTitle}</a></b> <code>>></code> 直播结束！\n标题 <code>:</code> <i><a href="https://www.youtube.com/watch?v=${videoId}">${videoData.snippet.title}</a></i>\n时间 <code>:</code> <b>${moment(videoData.liveStreamingDetails.actualStartTime).format('(z)YYYY/MM/DD (HH:mm:ss')} --> ${moment(videoData.liveStreamingDetails.actualEndTime).format('HH:mm:ss)')}</b>`;
            if (key === "rclonetrue") text = `🎊 <b><a href="https://www.youtube.com/channel/${videoData.snippet.channelId}">${videoData.snippet.channelTitle}</a></b> <code>>></code> 上传成功！\n标题 <code>:</code> <i><a href="https://www.youtube.com/watch?v=${videoId}">${videoData.snippet.title}</a></i>\n时间 <code>:</code> <b>${moment(videoData.liveStreamingDetails.actualStartTime).format('(z)YYYY/MM/DD (HH:mm:ss')} --> ${videoData.liveStreamingDetails?.actualEndTime ? moment(videoData.liveStreamingDetails.actualEndTime).format('HH:mm:ss)') : moment().format('HH:mm:ss) -->')}</b>`;
            if (key === "rclonefalse") text = `🚧 <b><a href="https://www.youtube.com/channel/${videoData.snippet.channelId}">${videoData.snippet.channelTitle}</a></b> <code>>></code> 上传失败！\n标题 <code>:</code> <i><a href="https://www.youtube.com/watch?v=${videoId}">${videoData.snippet.title}</a></i>\n时间 <code>:</code> <b>${moment(videoData.liveStreamingDetails.actualStartTime).format('(z)YYYY/MM/DD (HH:mm:ss')} --> ${videoData.liveStreamingDetails?.actualEndTime ? moment(videoData.liveStreamingDetails.actualEndTime).format('HH:mm:ss)') : moment().format('HH:mm:ss) -->')}</b>`;
            
            if (key === "rclonefalse"||key === "rclonetrue") key = "rclone";

            break;
        default:
            break;
    }
    complexSendMessage(videoId, key, text, timeout, coverUrl)

}

/**
 * YouTube Data API负载均衡
 * 每请求500次切换一个api key
 * 通过api获取相关信息并返回
 * @param key 状态videos/channels/messages
 * @param videoId 视频id
 * @param channelId 频道id
 * @param liveChatId 聊天室id
 * @param PageToken 评论PageToken
 */
async function axiosGet(key, videoId, channelId, liveChatId, PageToken) {
    currentkey++;
    YDA_KEY = YDA_KEYS[Math.floor(currentkey/500) % YDA_KEYS.length];

    let videoData;
    let channelData;
    let messagesData;

    switch (key) {
        case "videos":
            await axios.get(`${YDA_URL}videos?part=snippet%2Cstatistics%2CliveStreamingDetails&id=${videoId}&key=${YDA_KEY}`, {
                headers: { 'Accept': 'application/json' }
            })
            .then(response => { videoData = response.data.items[0] })
            .catch(error => { console.error(`[${moment().format()}](videos): ${error}`) });
            break;
        case "channels":
            await axios.get(`${YDA_URL}channels?part=snippet%2Cstatistics&id=${channelId}&key=${YDA_KEY}`, {
                headers: { 'Accept': 'application/json' }
            })
            .then(response => { channelData = response.data.items[0] })
            .catch(error => { console.error(`[${moment().format()}](channels): ${error}`) });
            break;
        case "messages":
            await axios.get(`${YDA_URL}liveChat/messages?liveChatId=${liveChatId}&part=id%2Csnippet%2CauthorDetails${PageToken ? '&pageToken=' + PageToken : ''}&key=${YDA_KEY}`, {
                headers: { 'Accept': 'application/json' }
            })
            .then(response => { messagesData = response.data })
            .catch(error => { console.error(`[${moment().format()}](messages): ${error}`) });
            break;
        default:
            break;
    }

    return videoData || channelData || messagesData
}

/**
 * 将信息格式化为xml适应的信息
 */
function escapeXml(unsafe) {

    return unsafe.replace(/[<>&'"]/g, function(c) {
        switch (c) {
            case '<':
                return '&lt;';
            case '>':
                return '&gt;';
            case '&':
                return '&amp;';
            case '\'':
                return '&apos;';
            case '"':
                return '&quot;';
        }
    });
}

/**
 * 获取https信息错误时写日志
 * @param content 信息格式化json输出
 */ 
function Log(content) {
    fs.appendFile(logFile, JSON.stringify(content, null, 2) + '\n', (err) => {
        if (err) throw err;
        console.log('The match was appended to log.txt!');
    });
}

export default isMainRunning;