self.addEventListener('message', (event) => {
    // 接收主线程数据
    console.log('Received from main thread:', event.data);

    // 处理数据并发送回主线程
    self.postMessage('Processed data');
});