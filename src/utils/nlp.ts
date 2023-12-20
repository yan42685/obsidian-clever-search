import { franc } from "franc-min";
import { LanguageEnum } from "src/entities/language-enum";

export type LanguageProportionsResult = {
	mainLanguage: LanguageEnum;
	mainProportion: string;
	details: Record<LanguageEnum, string>;
};

type ISOLanguageCode = "und" | "eng" | "cmn";

// map ISO 639-3 language code to LanguageEnum
const isoToEnum: Record<ISOLanguageCode, LanguageEnum> = {
	["eng"]: LanguageEnum.en,
	["cmn"]: LanguageEnum.zh,
	["und"]: LanguageEnum.other,
};

// calculate the proportion of main language
export function detectLanguage(textArray: string[]): LanguageProportionsResult {
	const languageCounts: Record<LanguageEnum, number> = {
		[LanguageEnum.en]: 0,
		[LanguageEnum.zh]: 0,
		[LanguageEnum.other]: 0,
	};

	let totalLength = 0;
	for (const text of textArray) {
		let langCode = franc(text, { only: Object.keys(isoToEnum) });
		langCode = Object.keys(isoToEnum).includes(langCode) ? langCode : "und";
		const language: LanguageEnum = isoToEnum[langCode as ISOLanguageCode];

		const length = text.length;
		totalLength += length;
		languageCounts[language] += length;
	}
	// find the main language
	let mainLanguage = LanguageEnum.other;
	let maxProportion = 0;
	const details: Record<string, string> = {};

	// calculate proportions
	Object.keys(languageCounts).forEach((language) => {
		const lang = language as LanguageEnum;
		const proportion =
			((languageCounts[lang] / totalLength) * 100).toFixed(2) + "%";
		details[lang] = proportion;

		if (languageCounts[lang] > maxProportion) {
			maxProportion = languageCounts[lang];
			mainLanguage = lang;
		}
	});

	return {
		mainLanguage: mainLanguage,
		mainProportion: details[mainLanguage],
		details: details
	};
}

// print the result
export function printLanguageProportions(result: LanguageProportionsResult) {
	console.log(
		`Main Language: ${result.mainLanguage}, Main Proportion: ${result.mainProportion}`,
	);
	console.log("Details:");
	for (const [language, proportion] of Object.entries(result.details)) {
		console.log(`${language}: ${proportion}`);
	}
	console.log("");
}