// // tokenWorker.js
// import { encoding_for_model } from 'tiktoken';
// import { parentPort } from 'worker_threads';

// parentPort?.on('message', async (inputString) => {
//   try {
//     const enc = encoding_for_model('gpt-3.5-turbo');
//     const encoded = enc.encode(inputString);
//     const decoded = new TextDecoder().decode(enc.decode(encoded));

//     parentPort?.postMessage({
//       originalString: inputString,
//       encodedTokens: encoded,
//       decodedString: decoded,
//     });

//     enc.free();
//   } catch (error) {
//     parentPort?.postMessage({ error: error.message });
//   }
// });
export function testTikToken() {
    return "this is a test";
}
