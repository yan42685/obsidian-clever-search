import { printLanguageProportions, recognizeMainLanguage } from "./utils/nlp";

// 定义测试字符串数组
const testArrays = [
	[
		"This is the first test sentence. It is written in English.",
		"这是第一句测试语句。",
		"It's definitely in English.",
	],
	[
		"This text is mostly in English but it has some 中文 characters.",
		"Here is some more English text.",
		"这里有一些中文字符。",
	],
	[
		"这是主要的中文文本，但它有一些English words.",
		"这里还有更多的中文。",
		"Here is an English sentence to mix things up.",
	],
];
export function testOnLoad() {
	testArrays.forEach((array) => {
		const result = recognizeMainLanguage(array);
		printLanguageProportions(result);
	});
}