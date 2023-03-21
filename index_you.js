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
const CONFIG = process.env.CONFIG;
const YDA_KEY = process.env.YDA_KEY;
const YDA_URL = process.env.YDA_URL;

const configLog = CONFIG + '/config.json';
const pidLog = CONFIG + '/pid.json';
const logFile = CONFIG + '/log.json';

// 队列，用于存储后处理事件
const queue = [];
// 是否有 FFmpeg 进程正在运行
let isRcloneRunning = false;

// 队列，用于存储事件
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
        queueChannelId.push(event.channelId)
            //console.log(queueChannelId)
        main(event)
    } else {
        console.log('已在队列中')
    }

}

//主函数
async function main(event) {

    const channelId = event.channelId
    const channelName = event.channelName
    const definition = event.definition
    let isStreamlink = event.isStreamlink
    let beforeScheduledStartTime = event.beforeScheduledStartTime
    let beforeVideoId = event.beforeVideoId

    let thumbUrl = null

    try {

        const match = await getHttps(channelId);

        let timeout = await isLivingAsync(match, channelId, channelName, definition, dir);

        //判断是否循环调用（同步函数
        if (isChannelIdInConfigSync(channelId)) {
            //console.log(`${channelName}--Loading-->>${timeout}\n`);
            //console.log(`${isStreamlink}-${beforeScheduledStartTime}-${beforeVideoId}\n`)
            setTimeout(() => {
                //再次判断防止浪费
                if (isChannelIdInConfigSync(channelId)) {
                    const newevent = {
                        channelId: channelId,
                        channelName: channelName,
                        definition: definition,
                        isStreamlink: isStreamlink,
                        beforeScheduledStartTime: beforeScheduledStartTime,
                        beforeVideoId: beforeVideoId,
                    }
                    main(newevent);

                } else {
                    //移除数组中的对象
                    const index = queueChannelId.indexOf(channelId);
                    if (index !== -1) {
                        queueChannelId.splice(index, 1);
                    }
                    console.log(`${channelName}:stop`);
                }
            }, timeout * 1000);

        } else {
            const index = queueChannelId.indexOf(channelId);
            if (index !== -1) {
                queueChannelId.splice(index, 1);
            }


            console.log(`${channelName}:stop`);
        }
    } catch (error) {
        console.log(error);
    }

    //获取https数据
    function getHttps(channelId) {
        return new Promise((resolve, reject) => {
            const liveUrl = 'https://www.youtube.com/channel/' + channelId + '/live';
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
                    //console.log(thumbUrl);

                    const match = data.match(regex);
                    resolve(match)
                });
            }).on('error', (error) => {
                reject;
                console.error(error);
            });
        })
    }

    //判断是否开播
    async function isLivingAsync(match, channelId, channelName, definition, dir) {
        //默认45分钟获取一次
        let timeout = 2700;

        if (match && match[1]) {
            const playerResponse = JSON.parse(match[1]);
            //console.log(playerResponse);
            const title = playerResponse.videoDetails.title
            const videoId = playerResponse.videoDetails.videoId
            const author = playerResponse.videoDetails.author
            const status = playerResponse.playabilityStatus.status
                /* console.log(`Live:${videoId}-${beforeVideoId}-${isStreamlink}`)
                console.log(!(videoId === beforeVideoId))
                console.log(isStreamlink)
                console.log(!(videoId === beforeVideoId) || isStreamlink) */
            if (!(videoId === beforeVideoId) || isStreamlink) {
                isStreamlink = true;

                const url = 'https://www.youtube.com/channel/' + channelId;
                const liveUrl = 'https://www.youtube.com/channel/' + channelId + '/live';
                const coverUrl = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
                switch (status) {
                    case "LIVE_STREAM_OFFLINE":
                        //待机室开始时间

                        const scheduledStartTime = playerResponse.playabilityStatus.liveStreamability.liveStreamabilityRenderer.offlineSlate.liveStreamOfflineSlateRenderer.scheduledStartTime

                        const starttime = moment.unix(scheduledStartTime).format('dddd, MMMM D, h:mm A (Z)')

                        timeout = timeMath(scheduledStartTime)
                        if (!(timeout === 3600.5) && (!(videoId === beforeVideoId) || !(scheduledStartTime === beforeScheduledStartTime))) {
                            beforeScheduledStartTime = scheduledStartTime;
                            let text = `<b>${author}</b> <code>>></code> 直播预告！\n时间 <code>:</code> <b>${starttime}</b>\n标题 <code>:</code> <i><a href="${liveUrl}">${title}</a></i>`;
                            tgphoto(coverUrl, text);

                            //console.log(author + '开始时间：' + starttime)
                        }
                        //Log({ playabilityStatus: playerResponse.playabilityStatus, videoDetails: playerResponse.videoDetails })
                        break;
                    case "OK":

                        const isLive = playerResponse.videoDetails.isLive
                        tgphoto(coverUrl, `🟡 <b><a href="${url}">${author}</a></b> <code>>></code> ${isLive ? '直播开始！' : 'null！'}\n标题 <code>:</code> <i><a href="${liveUrl}">${title}</a></i>`);
                        console.log(isLive ? `${author} 正在直播` : `${author} 没播\n`)

                        const timeId = moment().format('YYYYMMDD_HHmmssSSS')
                        const partialPath = moment().format('YYYY/MM')

                        const websiteUrl = 'https://www.youtube.com/watch?v=' + videoId;

                        const folderPath = dir + '/' + channelName + '/' + partialPath + '/' + timeId;
                        const filename = timeId + '-' + channelName

                        //const tsPath = filePath + '/' + filename + '.ts'
                        const flvPath = folderPath + '/' + filename + '.flv'
                        const aacPath = folderPath + '/' + filename + '.aac'
                        const jpgPath = folderPath + '/' + filename + '.jpg'
                        const nfoPath = folderPath + '/' + filename + '.nfo'

                        const rclonePath = RCLONEDIR + '/' + channelName + '/' + partialPath + '/' + timeId;

                        fs.mkdirSync(folderPath, { recursive: true })

                        //下载
                        await StreamlinkAsync(flvPath, liveUrl, definition, author)

                        //下载封面
                        await GetImage(coverUrl, jpgPath)

                        const rcloneEvent = {
                            beforePath: flvPath,
                            afterPath: aacPath,
                            folderPath: folderPath,
                            rclonePath: rclonePath,
                            nfoPath: nfoPath,
                            titles: channelName,
                            plot: `${author}-${timeId}`,
                            year: timeId.substring(0, 4),
                            data: timeId.substring(4, 8),
                            videoId: videoId,
                            title: title,
                            premiered: timeId,
                            genre: 'Live',
                            name: channelName,
                            thumb: thumbUrl,
                            cover: coverUrl,
                            website: websiteUrl
                        }
                        runbash(rcloneEvent)

                        //Log({ playabilityStatus: playerResponse.playabilityStatus, videoDetails: playerResponse.videoDetails })
                        timeout = 5;
                        break;

                    default:
                        Log({ playabilityStatus: playerResponse.playabilityStatus, videoDetails: playerResponse.videoDetails })
                        console.log(`岁月静好\n`)

                        break;
                }
                beforeVideoId = videoId;
            } else {
                console.log(`${channelName} 手动停止，跳过本场直播\n`)
            }
        } else {

            beforeScheduledStartTime = null;
            beforeVideoId = null;
            isStreamlink = true;
            //console.log(`${channelName} 没有直播信息\n`);
        }

        return timeout;
    }

    //判断是否循环调用（同步
    function isChannelIdInConfigSync(channelId) {
        const data = fs.readFileSync(configLog);
        const config = JSON.parse(data);
        const channelIds = config.youtubers.map(youtuber => youtuber.channelId);
        return channelIds.includes(channelId);
    }

    //待机状态下循环周期判断
    function timeMath(scheduledStartTime) {

        let timeout = 60;

        let timeunix = moment().valueOf();
        //秒：seconds 小时：hours
        let differenceInSeconds = moment.unix(scheduledStartTime).diff(timeunix, 'seconds');

        //console.log(`sunix-${scheduledStartTime}`);
        //console.log(`nunix-${timeunix}`);
        //console.log(`dunix-${differenceInSeconds}`)

        if (differenceInSeconds >= 259200) {
            //[72,) 1
            timeout = 3600.5;
            return timeout;
        } else if (differenceInSeconds >= 86400 && differenceInSeconds < 259200) {
            //[24,72) 8
            timeout = 28800;
            return timeout;
        } else if (differenceInSeconds >= 3600 && differenceInSeconds < 86400) {
            //[1,24) time/3
            timeout = differenceInSeconds / 3;
            return Math.ceil(timeout);
        } else if (differenceInSeconds >= 0 && differenceInSeconds < 3600) {
            //[0,1) time
            timeout = differenceInSeconds;
            return timeout;
        } else {
            //默认60秒
            //console.log(`dunix-${differenceInSeconds}`)
            return timeout;
        }
    }

    //下载
    async function StreamlinkAsync(Path, url, definition, author) {
        try {


            let pid = null;
            tgmessage(`🟢 <b>${author}</b> <code>>></code> 录制开始！`, '')
            const result = spawn('streamlink', ['--hls-live-restart', '--loglevel', 'warning', '-o', `${Path}`, `${url}`, definition]);
            pid = result.pid;
            try {
                const beforePidData = await readFileAsync(pidLog, 'utf-8');
                let beforePidJson = JSON.parse(beforePidData);
                // 写入当前 pid
                beforePidJson.pids = [...beforePidJson.pids, { pid: pid, name: author, channelId: channelId }];
                await writeFileAsync(pidLog, JSON.stringify(beforePidJson, null, 2));

            } catch (error) {
                console.error(`写入pid:${error}`);
            }
            //显示pid
            //console.log(`streamlink pid: ${pid} ${author}\n`);

            await new Promise((resolve, reject) => {
                result.on('exit', (code, signal) => {
                    if (code === 0) {
                        console.log(`视频已下载到：${Path}`);
                        resolve();
                    } else if (code === 130) {
                        isStreamlink = false;
                        console.error(`（手动）视频地址：${Path}`);
                        resolve();
                    } else if (code === 1) {
                        console.error(`（超时？）视频地址：${Path}`);
                        resolve();
                    } else {
                        /* console.error(`streamlink failed with code ${code}`);
                        console.error(`streamlink failed with signal ${signal}`); */
                        reject(`code:${code}\nsignal:${signal}`);
                    }
                });
            });
            tgmessage(`🔴 <b>${author}</b> <code>>></code> 录制结束！`, '')

            try {
                const AfterPidData = await readFileAsync(pidLog, 'utf-8');
                let AfterPidJson = JSON.parse(AfterPidData);
                // 过滤掉当前 pid
                AfterPidJson.pids = AfterPidJson.pids.filter(p => p.pid !== pid);
                await writeFileAsync(pidLog, JSON.stringify(AfterPidJson, null, 2));

            } catch (error) {
                console.error(`删除pid:${error}`);
            }
        } catch (error) {
            console.error(error)
        }

    }

}

//处理事件
function runbash(rcloneEvent) {
    // 检查当前是否有 FFmpeg 进程正在运行
    if (isRcloneRunning) {
        // 如果有，将事件添加到队列中
        addBashToQueue(rcloneEvent);
    } else {
        // 如果没有，立即处理事件
        //console.error(rcloneEvent)
        handleBash(rcloneEvent);
    }
}

// 添加事件到队列中
function addBashToQueue(rcloneEvent) {
    queue.push(rcloneEvent);
    //console.error(queue)
}

// 处理事件函数
function handleBash(rcloneEvent) {

    // 标记 Rclone 进程正在运行
    isRcloneRunning = true;

    const beforePath = rcloneEvent.beforePath;
    const afterPath = rcloneEvent.afterPath;
    const folderPath = rcloneEvent.folderPath;
    const rclonePath = rcloneEvent.rclonePath;
    const nfoPath = rcloneEvent.nfoPath;
    // 设置要写入 NFO 文件的元数据
    const metadata = {
        titles: rcloneEvent.titles,
        plot: rcloneEvent.plot,
        year: rcloneEvent.year,
        data: rcloneEvent.data,
        videoId: rcloneEvent.videoId,
        title: rcloneEvent.title,
        premiered: rcloneEvent.premiered,
        genre: rcloneEvent.genre,
        name: rcloneEvent.name,
        thumb: rcloneEvent.thumb,
        cover: rcloneEvent.cover,
        website: rcloneEvent.website,
    };

    WriteNfo(rcloneEvent.videoId, metadata, nfoPath);

    Ffmpeg(beforePath, afterPath)
        .then(() => Rclone(folderPath, rclonePath))
        .then(() => {
            const ls = spawn('rclone', ['ls', `${rclonePath}/`], { stdio: ['ignore', 'pipe', 'pipe'] });
            const wc = spawn('wc', ['-l'], { stdio: ['pipe', 'pipe', 'ignore'] });
            ls.stdout.pipe(wc.stdin);

            wc.stdout.on('data', (data) => {
                //console.log('data received:', data);
                const stdout = data.toString().trim();
                //console.log(Number(stdout));

                if (Number(stdout) === 4) {
                    tgmessage(`🎊 <b>${rcloneEvent.name}</b> <code>>></code> 上传成功！`, '');
                    spawn('rm', ['-rf', `${folderPath}`]).on('close', code => console.log(`[    rm-exit  ]: ${code}`))
                } else {
                    tgnotice(`🚧 <b>${rcloneEvent.name}</b> <code>>></code> <b><i><u>上传失败！</u></i></b>`, '');
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
function Rclone(filePath, rclonePath) {
    return new Promise((resolve, reject) => {
        const rclone = spawn('rclone', ['copy', `${filePath}/`, `${rclonePath}/`, '--min-size', '1b', '--onedrive-chunk-size', '25600k', '-q']);
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
    })
}

//写nfo
async function WriteNfo(video_id, metadata, nfoPath) {
    let nfoContent;
    if (YDA_KEY) {
        let channelData
        let videoData
        await axios.get(`${YDA_URL}videos?part=snippet%2Cstatistics%2CliveStreamingDetails&id=${video_id}&key=${YDA_KEY}`, {
                headers: {
                    'Accept': 'application/json'
                }
            })
            .then(response => {
                videoData = response.data.items[0]
            })
            .catch(error => {
                console.error(error);
            });
        await axios.get(`${YDA_URL}channels?part=snippet%2Cstatistics&id=${videoData.snippet.channelId}&key=${YDA_KEY}`, {
                headers: {
                    'Accept': 'application/json'
                }
            }).then(response => {
                channelData = response.data.items[0]
            })
            .catch(error => {
                console.error(error);
            });
        nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<movie>
    <title>${videoData.snippet.title}</title>
    <userrating>${videoData.statistics.viewCount?(10*videoData.statistics.likeCount/videoData.statistics.viewCount).toFixed(2):''}</userrating>
    <viewCount>${videoData.statistics.viewCount}</viewCount>
    <likeCount>${videoData.statistics.likeCount}</likeCount>
    <plot>${escapeXml(videoData.snippet.description)}</plot>
    <description>${escapeXml(channelData.snippet.description)}</description>
    <mpaa>PG</mpaa>
    <genre>Live</genre>
    <genre>${channelData.snippet.country}</genre>
    <genre>${channelData.snippet.customUrl}</genre>
    <premiered>${moment(videoData.liveStreamingDetails.actualStartTime).format('YYYY-MM-DD')}</premiered>
    <scheduledStartTime>${videoData.liveStreamingDetails.scheduledStartTime}</scheduledStartTime>
    <actualStartTime>${videoData.liveStreamingDetails.actualStartTime}</actualStartTime>
    <actualEndTime>${videoData.liveStreamingDetails.actualEndTime}</actualEndTime>
    <director>${videoData.snippet.channelTitle}</director>
    <writer>${channelData.snippet.title}</writer>
    <actor>
        <name>${channelData.snippet.title}</name>
        <subscriberCount>${channelData.statistics.subscriberCount}</subscriberCount>
        <type>Actor</type>
        <thumb>${channelData.snippet.thumbnails.high.url}</thumb>
    </actor>
    <thumb>${videoData.snippet.thumbnails.maxres.url}</thumb>
    <website>https://www.youtube.com/watch?v=${video_id}</website>
</movie>`;
    } else {
        // 生成 NFO 文件的内容
        nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<movie>
    <title>${metadata.title}</title>
    <plot>${metadata.plot}</plot>
    <year>${metadata.year}</year>
    <genre>${metadata.genre}</genre>
    <actor>
        <name>${metadata.name}</name>
        <type>Actor</type>
        <thumb>${metadata.thumb}</thumb>
    </actor>
    <poster>${metadata.cover}</poster>
    <cover>${metadata.cover}</cover>
    <website>${metadata.website}</website>
</movie>`;
    }


    // 将 NFO 文件内容写入文件
    fs.writeFile(`${nfoPath}`, nfoContent, function(err) {
        if (err) throw err;
        console.log('NFO file saved!');
    });
}

//写日志
function Log(content) {
    //写日志
    fs.appendFile(logFile, JSON.stringify(content, null, 2) + '\n', (err) => {
        if (err) throw err;
        console.log('The match was appended to log.txt!');
    });

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



export default isMainRunning;