// // tokenWorker.js
import { logger } from 'src/utils/logger';
import { encoding_for_model } from 'tiktoken';

export function testTikToken() {
    const enc = encoding_for_model('gpt-3.5-turbo');
    const encoded = enc.encode("hello world");
    logger.info(`encoded ${encoded}`);
    const decoded = new TextDecoder().decode(enc.decode(encoded));
    logger.info(`decoded ${decoded}`);

//     {
//       originalString: inputString,
//       encodedTokens: encoded,
//       decodedString: decoded,
//     };

//     enc.free();
    return "this is a test";
}
