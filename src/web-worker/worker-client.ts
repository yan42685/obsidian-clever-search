const worker = new Worker("./main.js");

// 发送数据到 Worker
const dataToShare = "hello";
worker.postMessage(dataToShare);

// 接收来自 Worker 的消息
worker.addEventListener('message', (event) => {
    console.log('Received from worker:', event.data);
});