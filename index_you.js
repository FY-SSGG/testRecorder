import dotenv from 'dotenv';
dotenv.config();
import https from 'https';
import axios from "axios";
import fs from 'fs';
import moment from 'moment-timezone';
import { spawn } from 'child_process';
import { promisify } from 'util';
import { tgmessage, tgphoto } from './index_tgnotice.js';

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

// 队列，用于存储后处理事件
let isRcloneRunning = false;
const queue = [];

// 队列，用于写出状态
let isExchange = false;
const queueExchange = [];

// 队列，用于过滤重复
const queueChannelId = [];

/* const event = {
    channelId: 'UC1opHUrw8rvnsadT-iGp7Cg',
    channelName: 'MinatoAqua',
    definition: 'best',
    isStreamlink: true,
    beforeScheduledStartTime: null,
    beforeVideoId: null,
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
    let thumbUrl = null

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


    //获取https数据
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
                    const regexImage = /videoOwnerRenderer.*?":"(https[^="]+)/;

                    const imageMatch = data.match(regexImage);
                    thumbUrl = imageMatch ? imageMatch[1] : '';

                    const match = data.match(regex);
                    resolve(match)
                });
            }).on('error', (error) => {
                reject;
                console.error(`[${moment().format()}]: ${error}`);
            });
        })
    }

    //判断是否开播,返回循环时间
    async function isLivingAsync(match) {
        //默认循环的时间，！要是小数，用来排除超长待机的通知
        const timeoutDefault = 2700.5;
        let timeout = timeoutDefault;

        if (match && match[1]) {
            const playerResponse = JSON.parse(match[1]);
            //console.log(playerResponse);
            const title = playerResponse.videoDetails.title
            const videoId = playerResponse.videoDetails.videoId
            const author = playerResponse.videoDetails.author
            const status = playerResponse.playabilityStatus.status

            event.name = author;
            event.videoId =videoId;

            event["isStreamlink"] = videoId !== event.beforeVideoId ? event.autoRecorder : event.isStreamlink

            const url = `https://www.youtube.com/channel/${channelId}`;
            const liveChannelUrl = `https://www.youtube.com/channel/${channelId}/live`;
            const liveVideoUrl = `https://www.youtube.com/watch?v=${videoId}`;
            const coverUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;

            if (event.status === "live" && !(videoId === event.beforeVideoId)) {
                tgmessage(`🔴 <b>${event.name}</b> <code>>></code> ${event.beforeVideoId}直播结束！`, null)
            };

            switch (status) {
                case "LIVE_STREAM_OFFLINE":
                    event["status"] = "upcoming";
                    const scheduledStartTime = playerResponse.playabilityStatus.liveStreamability.liveStreamabilityRenderer.offlineSlate.liveStreamOfflineSlateRenderer.scheduledStartTime;
                    const timeoutMath = timeMath(scheduledStartTime, timeout);

                    if (!(timeoutMath[0] === timeoutDefault) && (!(videoId === event.beforeVideoId) || !(scheduledStartTime === event.beforeScheduledStartTime))) {
                        event["beforeScheduledStartTime"] = scheduledStartTime;
                        
                        const starttime = moment.unix(scheduledStartTime).format('dddd, MMMM D, h:mm A (Z)')
                        let text = `<b>${author}</b> <code>>></code> 直播预告！ <b>${event.autoRecorder ? 'T' : 'F'}</b>\n时间 <code>:</code> <b>${starttime}</b>\n标题 <code>:</code> <i><a href="${liveChannelUrl}">${title}</a></i>`;
                        
                        tgphoto(coverUrl, text, timeoutMath[1] + 600);
                    }
                    timeout = timeoutMath[0];

                    break;
                case "OK":
                    
                    if (!(videoId === event.beforeVideoId && event.status === "live") && !event.isStreamlink) {
                        const isLive = playerResponse.videoDetails.isLive
                        event["status"] = "live";
                        tgphoto(coverUrl, `🟡 <b><a href="${url}">${author}</a></b> <code>>></code> ${isLive ? '直播开始！' : 'null！'}\n标题 <code>:</code> <i><a href="${liveVideoUrl}">${title}</a></i>`, null);
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
                        title: title,
                        plot: `${author}-${timeId}`,
                        year: timeId.substring(0, 4),
                        name: channelName,
                        thumb: thumbUrl,
                        cover: coverUrl
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
                tgmessage(`🔴 <b>${event.name}</b> <code>>></code> ${event.beforeVideoId}直播结束！`, null)
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

    //待机状态下循环周期判断
    function timeMath(scheduledStartTime, timeout) {

        let timeunix = moment().valueOf();
        //秒：seconds 小时：hours
        let differenceInSeconds = moment.unix(scheduledStartTime).diff(timeunix, 'seconds');

        //console.log(`sunix-${scheduledStartTime}`);
        //console.log(`nunix-${timeunix}`);
        //console.log(`dunix-${differenceInSeconds}`)

        if (differenceInSeconds >= 172800 - 600) {
            //[48h - 10min,) time
            return [timeout,differenceInSeconds];
        } else if (differenceInSeconds >= 86400 && differenceInSeconds < 172800 - 600) {
            //[24h,48h - 10min) time/3
            timeout = differenceInSeconds / 3;
            return [Math.ceil(timeout),differenceInSeconds];
        } else if (differenceInSeconds >= 3600 && differenceInSeconds < 86400) {
            //[1h,24h) time/2
            timeout = differenceInSeconds / 2;
            return [Math.ceil(timeout),differenceInSeconds];
        } else if (differenceInSeconds > 0 && differenceInSeconds < 3600) {
            //(0,1h) time
            timeout = differenceInSeconds;
            return [timeout,differenceInSeconds];
        } else if (differenceInSeconds >= -10800 && differenceInSeconds <= 0) {
            //[-3h,0] 60
            //console.log(`dunix-${differenceInSeconds}`)
            timeout = 60;
            return [timeout,differenceInSeconds];
        } else {
            //console.log(`dunix-${differenceInSeconds}`)
            //(,-3h) time
            return [timeout,differenceInSeconds];
        }
    }

    //下载
    async function StreamlinkAsync(coverUrl, liveVideoUrl, title, Path, url, definition, author, xmlPath) {

        let pid = null;
        tgphoto(coverUrl, `🟢 <b><a href="https://www.youtube.com/channel/${channelId}">${author}</a></b> <code>>></code> 录制开始！\n标题 <code>:</code> <i><a href="${liveVideoUrl}">${title}</a></i>`, 14400);
        //tgmessage(`🟢 <b>${author}</b> <code>>></code> 录制开始！`, 14400)
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
        tgmessage(`🔴 <b>${author}</b> <code>>></code> 录制结束！`, 14400)

    }

    //获取弹幕
    async function getChatMessages(videoId, videoStartTime, xmlPath) {
        let b = 0;
        let t = event.t ?? 40;
        const processedMessageIds = new Set();
        let nextPageToken = null;
        let interval = setInterval(async () => {
            //console.log('主循环b' + '"' + b + '"')
            let a = [0,0];
            if (event.pid) {
                //console.log('继续循环');
                if ( b === 0 || b >= t) {
                    a = await writeXml(videoId, nextPageToken, xmlPath)
                    //console.log(data)
                    //console.log(a)
                    //console.log(b+'_'+a[1]/1000+'_'+a[0])
                    if (a[0] > 43 && t > 1 + a[1]/1000) {
                        t--;
                    } else if(a[0] < 38 && t < 180){
                            t++;
                    }
                    //console.log('辅循环a' + '"' + a[0] + '"')
                    //console.log('时间回调t' + '"' + t + '"')
                    b = 0;
                }
                b++;
            } else {
                
                if (b > a[1]/1000) {
                    writeXml(videoId, nextPageToken, xmlPath)
                    event['t'] = t;
                }
                clearInterval(interval);
                delete event.liveChatId;
                //console.log('结束循环');
            }
            
          }, 1000);
    
        async function writeXml(videoId, PageToken, xmlPath) {
            let videoData
            if (!event['liveChatId']) {
                ydakeyLoadBalanced()
                await axios.get(`${YDA_URL}videos?part=snippet%2Cstatistics%2CliveStreamingDetails&id=${videoId}&key=${YDA_KEY}`, {
                    headers: { 'Accept': 'application/json' }
                })
                .then(response => { videoData = response.data.items[0] })
                .catch(error => { console.error(`[${moment().format()}]: ${error}`) });
                event['liveChatId'] = videoData.liveStreamingDetails.activeLiveChatId
            }
            
            //console.log(videoData)
            
            let data
            ydakeyLoadBalanced()
            let url = `${YDA_URL}liveChat/messages?liveChatId=${event.liveChatId}&part=id%2Csnippet%2CauthorDetails${PageToken?'&pageToken='+PageToken:''}&key=${YDA_KEY}`
            //console.log(url)
            await axios.get(url, {
                headers: { 'Accept': 'application/json' }
            })
            .then(response => { data = response.data })
            .catch(error => { console.error(`[${moment().format()}]: ${error}`) });
            let a = 0;
            if (data) {
                const messages = data.items;
                nextPageToken = data?.nextPageToken ?? null;
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
                        // 这里可以将聊天消息保存到数据库、文件等
                        //console.log(`保存消息：${message.snippet.displayMessage}`);
                        });
    
                    // 将这条消息的ID添加到已处理消息ID的Set中
                    processedMessageIds.add(message.id);
                }
                
            }
            //返回新增信息数、最小请求周期
            return [ a , data?.pollingIntervalMillis ?? 10000]
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

    // 设置要写入 NFO 文件的元数据
    const metadata = {
        title: rcloneEvent.title,
        plot: rcloneEvent.plot,
        year: rcloneEvent.year,
        name: rcloneEvent.name,
        thumb: rcloneEvent.thumb,
        cover: rcloneEvent.cover,
    };
    
    const coverUrl = await WriteNfo(videoId, metadata, nfoPath);

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
                    tgmessage(`🎊 <b>${rcloneEvent.name}</b> <code>>></code> 上传成功！`, null);
                    spawn('rm', ['-rf', `${folderPath}`]).on('close', code => console.log(`[    rm-exit  ]: ${code}`))
                } else {
                    tgmessage(`🚧 <b>${rcloneEvent.name}</b> <code>>></code> <b><i><u>上传失败！</u></i></b>`, null);
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
    async function WriteNfo(videoId, metadata, nfoPath) {
        let nfoContent;
        let coverUrl;
        if (YDA_KEY) {
            let channelData
            let videoData
            ydakeyLoadBalanced();
            await axios.get(`${YDA_URL}videos?part=snippet%2Cstatistics%2CliveStreamingDetails&id=${videoId}&key=${YDA_KEY}`, {
                    headers: { 'Accept': 'application/json' }
                })
                .then(response => { videoData = response.data.items[0] })
                .catch(error => { console.error(`[${moment().format()}]: ${error}`) });
            ydakeyLoadBalanced();
            await axios.get(`${YDA_URL}channels?part=snippet%2Cstatistics&id=${videoData.snippet.channelId}&key=${YDA_KEY}`, {
                    headers: { 'Accept': 'application/json' }
                })
                .then(response => { channelData = response.data.items[0] })
                .catch(error => { console.error(`[${moment().format()}]: ${error}`) });

            nfoContent = `<?xml version="1.0" encoding="UTF-8"?>
<movie>
    <title>${escapeXml(videoData.snippet.title)}</title>
    <userrating>${videoData.statistics.viewCount?(10*videoData.statistics.likeCount/videoData.statistics.viewCount).toFixed(2):''}</userrating>
    <plot>${escapeXml(videoData.snippet.description)}</plot>
    <description>${escapeXml(channelData.snippet.description)}</description>
    <mpaa>PG</mpaa>
    <genre>Live</genre>
    <genre>${videoData.snippet.defaultAudioLanguage}</genre>
    <genre>${channelData.snippet.customUrl}</genre>
    <country>${(channelData.snippet?.country || '').toUpperCase()}</country>
    <premiered>${moment(videoData.liveStreamingDetails.actualStartTime).format('YYYY-MM-DD')}</premiered>
    <director>${videoData.snippet.channelTitle}</director>
    <writer>${channelData.snippet.title}</writer>
    <actor>
        <name>${escapeXml(videoData.snippet.channelTitle)}</name>
        <type>Actor</type>
        <thumb>${channelData.snippet.thumbnails.high.url}</thumb>
    </actor>
    <viewCount>${videoData.statistics.viewCount}</viewCount>
    <likeCount>${videoData.statistics.likeCount}</likeCount>
    <scheduledStartTime>${videoData.liveStreamingDetails.scheduledStartTime}</scheduledStartTime>
    <actualStartTime>${videoData.liveStreamingDetails.actualStartTime}</actualStartTime>
    <actualEndTime>${videoData.liveStreamingDetails.actualEndTime}</actualEndTime>
    <subscriberCount>${channelData.statistics.subscriberCount}</subscriberCount>
    <thumb>${videoData.snippet.thumbnails.maxres.url}</thumb>
    <website>https://www.youtube.com/watch?v=${videoId}</website>
</movie>`;

            coverUrl = videoData.snippet.thumbnails.maxres.url;
        } else {
            nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<movie>
    <title>${metadata.title}</title>
    <plot>${metadata.plot}</plot>
    <year>${metadata.year}</year>
    <genre>Live</genre>
    <actor>
        <name>${metadata.name}</name>
        <type>Actor</type>
        <thumb>${metadata.thumb}</thumb>
    </actor>
    <cover>${metadata.cover}</cover>
    <website>https://www.youtube.com/watch?v=${videoId}</website>
</movie>`;

            coverUrl = metadata.cover;
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

//写日志
function Log(content) {
    fs.appendFile(logFile, JSON.stringify(content, null, 2) + '\n', (err) => {
        if (err) throw err;
        console.log('The match was appended to log.txt!');
    });
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

//xml格式化函数
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

//YouTube Data API负载均衡
function ydakeyLoadBalanced() {
    currentkey++;
    //console.log(currentkey);
    YDA_KEY = YDA_KEYS[Math.floor(currentkey/500) % YDA_KEYS.length];
}

export default isMainRunning;