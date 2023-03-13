import dotenv from 'dotenv';
dotenv.config();
import fs from "fs";
import { promisify } from 'util';
//import {fork} from 'child_process';
import mainAsync from './index_you.js';

const readFileAsync = promisify(fs.readFile);

const CONFIG = process.env.CONFIG;
const configLog = CONFIG + '/config.json'
const runningLog = CONFIG + '/running.json'
const pidLog = CONFIG + '/pid.json'

// 记录任务是否正在运行中
let running = false;

//初始化running.json、pid.json
try {
    fs.writeFileSync(runningLog, JSON.stringify({ "channelIds": [] }));
    fs.fsyncSync(fs.openSync(runningLog, 'r'));
    fs.writeFileSync(pidLog, JSON.stringify({ "pids": [] }));
    fs.fsyncSync(fs.openSync(pidLog, 'r'));
    //console.log('初始化running.json');
} catch (err) {
    console.error(err);
}


//读取config.json，录制判别
start();

//监听文件变动
fs.watch(configLog, () => {
    if (!running) { // 如果没有任务正在运行中
        running = true; // 标记任务正在运行中
        start().then(() => {
            running = false; // 任务完成后重置标记
        }).catch(err => {
            console.error(err);
            running = false; // 出错时也要重置标记
        });
    }
});

async function start() {
    try {
        let youtubers;
        try {
            const configData = await readFileAsync(configLog, 'utf-8');
            youtubers = JSON.parse(configData).youtubers;
        } catch (err) {
            if (err instanceof SyntaxError) {
                console.error(`config.json解析错误：\n`, err.message);
            } else {
                console.error(err);
            }
        }

        let runningData = fs.readFileSync(runningLog);
        let runningJson = JSON.parse(runningData);

        // 判断哪些 youtubers 已经被移除了
        let removedYoutubers = runningJson.channelIds.filter(c => !youtubers.some(y => y.channelId === c.channelId));
        for (const youtuber of removedYoutubers) {
            console.log(`${youtuber.channelId}-已移除`);
            runningJson.channelIds = runningJson.channelIds.filter(c => c.channelId !== youtuber.channelId);
        }

        for (const youtuber of youtubers) {

            //console.log(!runningJson.channelIds.some(c => c.channelId === youtuber.channelId));
            if (!runningJson.channelIds.some(c => c.channelId === youtuber.channelId)) {

                console.log(`${youtuber.channelName}-开始监听`);
                runningJson.channelIds = [...runningJson.channelIds, { channelId: youtuber.channelId }];
                // Object.assign(runningJson.channelIds, { channelId: youtuber.channelId });

                setTimeout(() => {
                    const event = {
                        channelId: youtuber.channelId,
                        channelName: youtuber.channelName,
                        isStreamlink: true,
                        beforeScheduledStartTime: null,
                        beforeVideoId: null,
                    }
                    mainAsync(event);
                    /* const childProcess = fork('./app.js');
                    childProcess.send({ channelId: youtuber.channelId, channelName: youtuber.channelName }); */
                }, Math.random() * 5000); // 随机延时 0 到 5000 毫秒

            } else {
                console.log(`正在监听-${youtuber.channelName}`);
            }
        }

        const fd = fs.openSync(runningLog, 'w');
        //写入runningjson
        fs.writeFileSync(fd, JSON.stringify(runningJson));
        // 刷新文件到磁盘
        fs.fsyncSync(fd);
        // 关闭文件句柄
        fs.closeSync(fd);

    } catch (err) {
        console.error(err);
    }
}