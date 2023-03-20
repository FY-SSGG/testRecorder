import dotenv from 'dotenv';
dotenv.config();
import fs from "fs";
import { promisify } from 'util';
//import {fork} from 'child_process';
import isMainRunning from './index_you.js';

const readFileAsync = promisify(fs.readFile);
const writeFileAsync = promisify(fs.writeFile);

const CONFIG = process.env.CONFIG;
const configLog = CONFIG + '/config.json'
const runningLog = CONFIG + '/running.json'
const pidLog = CONFIG + '/pid.json'

// 记录任务是否正在运行中
let running = false;

//初始化config.json、running.json、pid.json
if (!fs.existsSync(configLog)) {
    // 判断配置文件是否存在，不存在即创建
    fs.writeFileSync(configLog, JSON.stringify({ "youtubers": [] }, null, 2));
}

try {
    fs.writeFileSync(runningLog, JSON.stringify({ "channelIds": [] }, null, 2));
    fs.fsyncSync(fs.openSync(runningLog, 'r'));
    fs.writeFileSync(pidLog, JSON.stringify({ "pids": [] }, null, 2));
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
    console.log(`\n----------开始加载配置-----------`);
    try {
        let youtubers;
        let runningJson;
        try {
            const configData = await readFileAsync(configLog, 'utf-8');
            youtubers = JSON.parse(configData).youtubers;
            const runningData = await readFileAsync(runningLog, 'utf-8');
            runningJson = JSON.parse(runningData);
        } catch (err) {
            if (err instanceof SyntaxError) {
                console.error(`config.json解析错误：\n`, err.message);
            } else {
                console.error(err);
            }
        }

        /* let runningData = fs.readFileSync(runningLog);
        let runningJson = JSON.parse(runningData); */

        // 判断哪些 youtubers 已经被移除了
        let removedYoutubers = runningJson.channelIds.filter(c => !youtubers.some(y => y.channelId === c.channelId));
        for (const youtuber of removedYoutubers) {
            //console.log(`${youtuber.channelId}-已移除`);
            runningJson.channelIds = runningJson.channelIds.filter(c => c.channelId !== youtuber.channelId);
        }

        for (const youtuber of youtubers) {

            //console.log(!runningJson.channelIds.some(c => c.channelId === youtuber.channelId));
            if (!runningJson.channelIds.some(c => c.channelId === youtuber.channelId)) {

                console.log(`- '${youtuber.channelName}' 开始监听`);
                runningJson.channelIds = [...runningJson.channelIds, { channelName: youtuber.channelName, channelId: youtuber.channelId }];
                // Object.assign(runningJson.channelIds, { channelId: youtuber.channelId });

                setTimeout(() => {
                    const event = {
                        channelId: youtuber.channelId,
                        channelName: youtuber.channelName,
                        definition: youtuber.definition,
                        isStreamlink: true,
                        beforeScheduledStartTime: null,
                        beforeVideoId: null,
                    }
                    isMainRunning(event);
                    /* const childProcess = fork('./app.js');
                    childProcess.send({ channelId: youtuber.channelId, channelName: youtuber.channelName }); */
                }, Math.random() * 5000); // 随机延时 0 到 5000 毫秒

            } else {
                console.log(`- '${youtuber.channelName}' 正在监听`);
            }
        }
        await writeFileAsync(runningLog, JSON.stringify(runningJson, null, 2));
        /*  const fd = fs.openSync(runningLog, 'w');
         //写入runningjson
         fs.writeFileSync(fd, JSON.stringify(runningJson, null, 2));
         // 刷新文件到磁盘
         fs.fsyncSync(fd);
         // 关闭文件句柄
         fs.closeSync(fd); */
        console.log(`\n----------配置加载完毕----------`);
    } catch (err) {
        console.error(err);
    }
}