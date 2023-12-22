import { jest } from "@jest/globals";
import { LanguageEnum } from "src/globals/language-enum";
import { textAnalyzer } from "src/utils/nlp";

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

// 模拟 console.log
const logSpy = jest.spyOn(console, "log").mockImplementation(() => {});

describe("NLP functions", () => {
	afterEach(() => {
		// 清除 console.log 的模拟调用信息
		logSpy.mockClear();
	});

	afterAll(() => {
		// 恢复 console.log
		logSpy.mockRestore();
	});

	describe("detectLanguage function", () => {
		it("should detect the correct main language and proportions", () => {
			// 测试 detectLanguage 函数的逻辑
			const expectedResults = [
				{
					mainLanguage: LanguageEnum.en,
					mainProportion: "89.47%",
					details: {
						[LanguageEnum.en]: "89.47%",
						[LanguageEnum.zh]: "10.53%",
						[LanguageEnum.other]: "0.00%",
					},
				},
				{
					mainLanguage: LanguageEnum.en,
					mainProportion: "90.20%",
					details: {
						[LanguageEnum.en]: "90.20%",
						[LanguageEnum.zh]: "9.80%",
						[LanguageEnum.other]: "0.00%",
					},
				},
				{
					mainLanguage: LanguageEnum.en,
					mainProportion: "53.57%",
					details: {
						[LanguageEnum.en]: "53.57%",
						[LanguageEnum.zh]: "46.43%",
						[LanguageEnum.other]: "0.00%",
					},
				},
			];

			testArrays.forEach((array, index) => {
				const result = textAnalyzer.detectLanguage(array);
				expect(result).toEqual(expectedResults[index]);
			});
		});
	});

	describe("printLanguageProportions function", () => {
		it("should print language proportions correctly", () => {
			const result = {
				mainLanguage: LanguageEnum.en,
				mainProportion: "50%",
				details: {
					[LanguageEnum.en]: "50%",
					[LanguageEnum.zh]: "50%",
					[LanguageEnum.other]: "0%",
				},
			};
			textAnalyzer.printLanguageProportion(result);

			// 验证 console.log 是否被调用
			expect(logSpy).toHaveBeenCalledWith(
				expect.stringContaining(
					"Main Language: English, Main Proportion: 50%",
				),
			);
		});
	});
});