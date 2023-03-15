import dotenv from 'dotenv';
dotenv.config();
import https from 'https';
import fs from 'fs';
import moment from 'moment-timezone';
import { spawn } from 'child_process';
//import { promisify } from 'util';
import { tgmessage, tgphoto } from './index_tgnotice.js';

moment.tz.setDefault('Asia/Shanghai');

const dir = process.env.DOWNLOADDIR;
const RCLONEDIR = process.env.RCLONEDIR;
const CONFIG = process.env.CONFIG;

const configLog = CONFIG + '/config.json'
const pidLog = CONFIG + '/pid.json'
const logFile = CONFIG + '/log.json'
const FORMAT = 'best';

// 队列，用于存储事件
const queue = [];
// 是否有 FFmpeg 进程正在运行
let isRcloneRunning = false;

/* process.on('message', (message) => {
    const { channelId, channelName } = message;
    mainAsync(channelId, channelName);
}); */


/* const event = {
    channelId: 'UC1opHUrw8rvnsadT-iGp7Cg',
    channelName: 'MinatoAqua',
    isStreamlink: true,
    beforeScheduledStartTime: null,
    beforeVideoId: null,
}
mainAsync(event); */

async function mainAsync(event) {

    const channelId = event.channelId
    const channelName = event.channelName
    let isStreamlink = event.isStreamlink
    let beforeScheduledStartTime = event.beforeScheduledStartTime
    let beforeVideoId = event.beforeVideoId

    let thumbUrl = null

    try {
        // 获取 https 数据
        const match = await getHttps(channelId);
        // 判断是否开播
        let timeout = await isLivingAsync(match, channelId, channelName, FORMAT, dir);

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
                        isStreamlink: isStreamlink,
                        beforeScheduledStartTime: beforeScheduledStartTime,
                        beforeVideoId: beforeVideoId,
                    }
                    mainAsync(newevent);

                } else {
                    console.log(`${channelName}:stop`);
                }
            }, timeout * 1000);

        } else {
            console.log(`${channelName}:stop`);
        }
    } catch (error) {
        console.log(error);
    }

    //获取https数据（异步函数
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

    //判断是否开播（同步函数
    async function isLivingAsync(match, channelId, channelName, FORMAT, dir) {
        //默认5分钟获取一次
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
                        const websiteUrl = 'https://www.youtube.com/watch?v=' + videoId;

                        const filePath = dir + '/' + channelName + '/' + timeId;
                        const filename = timeId + '-' + channelName

                        //const tsPath = filePath + '/' + filename + '.ts'
                        const flvPath = filePath + '/' + filename + '.flv'
                        const aacPath = filePath + '/' + filename + '.aac'
                        const jpgPath = filePath + '/' + filename + '.jpg'
                        const nfoPath = filePath + '/' + filename + '.nfo'

                        const rclonePath = RCLONEDIR + '/' + channelName + '/' + timeId

                        fs.mkdirSync(filePath, { recursive: true })

                        //下载封面
                        await GetImage(coverUrl, jpgPath)

                        //下载
                        await StreamlinkAsync(flvPath, liveUrl, FORMAT, author)

                        const rcloneEvent = {
                            beforePath: flvPath,
                            afterPath: aacPath,
                            filePath: filePath,
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
                            /* Ffmpeg(flvPath, aacPath)
                                .then(() => Rclone(filePath, rclonePath))
                                .then(() => spawn('rm', ['-rf', `${filePath}`]).on('close', code => console.log(`[    rm-exit  ]: ${code}\n`)));

                            // 设置要写入 NFO 文件的元数据
                            const metadata = {
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
                            };
                            WriteNfo(metadata, nfoPath) */

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

    //下载
    async function StreamlinkAsync(Path, url, FORMAT, author) {
        try {


            let pid = null;
            tgmessage(`🟢 <b>${author}</b> <code>>></code> 录制开始！`, '')
            const result = spawn('streamlink', ['--hls-live-restart', '--loglevel', 'warning', '-o', `${Path}`, `${url}`, FORMAT]);
            pid = result.pid;
            try {

                let beforePidData = fs.readFileSync(pidLog, { encoding: 'utf8' });
                let beforePidJson = JSON.parse(beforePidData);

                beforePidJson.pids = [...beforePidJson.pids, { pid: pid, name: author, channelId: channelId }];

                const fdb = fs.openSync(pidLog, 'w');
                fs.writeFileSync(pidLog, JSON.stringify(beforePidJson));
                fs.fsyncSync(fdb);
                fs.closeSync(fdb);
            } catch (error) {
                console.error(`写入pid:${error}`);
            }
            //显示pid
            console.log(`streamlink pid: ${pid} ${author}\n`);

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
                const AfterPidData = fs.readFileSync(pidLog, { encoding: 'utf8' });
                const AfterPidJson = JSON.parse(AfterPidData).pids;

                const fda = fs.openSync(pidLog, 'w');
                // 过滤掉当前 pid
                const filteredPids = AfterPidJson.filter(p => p.pid !== pid);
                fs.writeFileSync(pidLog, JSON.stringify({ pids: filteredPids }), { encoding: 'utf8' });
                fs.fsyncSync(fda);
                fs.closeSync(fda);
            } catch (error) {
                console.error(`删除pid:${error}`);
            }
        } catch (error) {
            console.error(error)
        }

    }

    //写日志
    function Log(content) {
        //写日志
        fs.appendFile(logFile, JSON.stringify(content, null, 2) + '\n', (err) => {
            if (err) throw err;
            console.log('The match was appended to log.txt!');
        });

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
        handleBash(rcloneEvent);
    }
}

// 添加事件到队列中
function addBashToQueue(rcloneEvent) {
    queue.push(rcloneEvent);
    console.log(queue)
}


// 处理事件函数
function handleBash(rcloneEvent) {


    // 标记 Rclone 进程正在运行
    isRcloneRunning = true;

    const beforePath = rcloneEvent.beforePath;
    const afterPath = rcloneEvent.afterPath;
    const filePath = rcloneEvent.filePath;
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
    WriteNfo(metadata, nfoPath);
    Ffmpeg(beforePath, afterPath)
        .then(() => Rclone(filePath, rclonePath))
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
                    spawn('rm', ['-rf', `${filePath}`]).on('close', code => console.log(`[    rm-exit  ]: ${code}`))
                } else {
                    tgnotice(`🚧 <b>${rcloneEvent.name}</b> <code>>></code> <b><i><u>上传失败！</u></i></b>`, '');
                };
            });

            wc.on('close', code => {
                console.log(`[    wc-exit  ]: ${code}`)
                if (queue.length > 0) {
                    console.log("处理下一事件")
                    const nextBash = queue.shift();
                    console.log(nextBash)
                    handleBash(nextBash);
                } else {
                    isRcloneRunning = false;
                }
            })

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
function WriteNfo(metadata, nfoPath) {

    // 生成 NFO 文件的内容
    const nfoContent = `<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>
<movie>
    <title>${metadata.titles}</title>
    <plot>${metadata.plot}</plot>
    <year>${metadata.year}</year>
    <genre>${metadata.genre}</genre>
    <cast>
        <actor>
        <name>${metadata.name}</name>
        <type>Actor</type>
        <thumb>${metadata.thumb}</thumb>
        </actor>
    </cast>
    <episodedetails>
        <season>${metadata.year}</season>
        <episode>${metadata.data}</episode>
        <title>${metadata.title}</title>
        <premiered>${metadata.premiered}</premiered>
        <videoid>${metadata.videoId}</videoid>
    </episodedetails>
    <poster>${metadata.cover}</poster>
    <cover>${metadata.cover}</cover>
    <website>${metadata.website}</website>
</movie>`;

    // 将 NFO 文件内容写入文件
    fs.writeFile(`${nfoPath}`, nfoContent, function(err) {
        if (err) throw err;
        console.log('NFO file saved!');
    });
}

export default mainAsync;