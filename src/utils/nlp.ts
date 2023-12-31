import { franc } from "franc-min";
import { LanguageEnum } from "src/globals/enums";

/**
 * this module need to be loaded in the subprocess or should not be used at all
 * because the package size of "franc-min" is nearly 180kb
 */

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

export class TextAnalyzer {
	static detectLanguage(input: string | string[]): LanguageProportionsResult {
		const strArray = typeof input === "string" ? [input] : input;

		const languageCounts: Record<LanguageEnum, number> = {
			[LanguageEnum.en]: 0,
			[LanguageEnum.zh]: 0,
			[LanguageEnum.other]: 0,
		};

		let totalLength = 0;
		for (const text of strArray) {
			let langCode = franc(text, { only: Object.keys(isoToEnum) });
			langCode = Object.keys(isoToEnum).includes(langCode)
				? langCode
				: "und";
			const language: LanguageEnum =
				isoToEnum[langCode as ISOLanguageCode];

			const length = text.length;
			totalLength += length;
			languageCounts[language] += length;
		}
		let mainLanguage = LanguageEnum.other;
		let maxProportion = 0;
		const details: Record<string, string> = {};

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
			details: details,
		};
	}

	static printLanguageProportion(result: LanguageProportionsResult) {
		console.log(
			`Main Language: ${result.mainLanguage}, Main Proportion: ${result.mainProportion}`,
		);
		console.log("Details:");
		for (const [language, proportion] of Object.entries(result.details)) {
			console.log(`${language}: ${proportion}`);
		}
		console.log("");
	}

}
