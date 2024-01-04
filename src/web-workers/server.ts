import { logger } from "src/utils/logger";
import { testTikToken } from "./tiktoken-server";

// self.addEventListener('message', (event) => {
//     // 接收主线程数据
//     logger.debug("abc:" + event.data);
//     console.log(event.data);
//     console.log('Received from main thread:', event.data);

//     // 处理数据并发送回主线程
//     self.postMessage('Processed data');
// });

self.addEventListener("message", (event) => {
	if (event.data === "tikToken") {
		// logger.debug("received tiktoken request from main thread");
		self.postMessage("tikToken server: " + testTikToken());
	} else {
		logger.debug("message isn't for tiktoken")
	}
});

// 用来避免tsc报错
// export { };
