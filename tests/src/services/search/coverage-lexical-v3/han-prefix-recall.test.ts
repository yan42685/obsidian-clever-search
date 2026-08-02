// @ts-nocheck
import type { IndexedDocument } from "src/globals/search-types";
import { buildResidentBase } from "src/services/search/coverage-lexical-v3/build";
import { analyzeQuery } from "src/services/search/coverage-lexical-v3/query";
import {
	lookupQueryUnitFamilies,
	recallCandidateDocs,
} from "src/services/search/coverage-lexical-v3/recall";
import {
	buildPackingProfile,
	comparePackingProfiles,
} from "src/services/search/coverage-lexical-v3/ranking";

function createDocument(
	overrides: Partial<IndexedDocument> &
		Pick<IndexedDocument, "path" | "basename" | "folder">,
): IndexedDocument {
	return {
		path: overrides.path,
		basename: overrides.basename,
		folder: overrides.folder,
		content: overrides.content,
		aliases: overrides.aliases,
		tags: overrides.tags,
		headings: overrides.headings,
		generation: overrides.generation ?? 1,
	};
}

describe("coverage lexical v3 Han prefix recall", () => {
	it("recalls Han prefix-only matches for longer Han families", () => {
		const documents = [
			createDocument({
				path: "pkm-zh/books/电子技术入门.md",
				basename: "电子技术入门",
				folder: "pkm-zh/books",
				headings: "电子技术入门",
				content:
					"电子技术入门讲基础电路、常见元件、信号路径和实验安全，不是游戏设计技巧摘录。",
				aliases: "电子技术 电路 入门",
				tags: "电子技术 电路 入门",
			}),
			createDocument({
				path: "pkm-zh/books/游戏设计技巧摘录.md",
				basename: "游戏设计技巧摘录",
				folder: "pkm-zh/books",
				headings: "游戏设计技巧",
				content:
					"这页主要摘录电子游戏设计技巧、关卡技巧、玩家技能反馈和战斗技巧，不是电子技术教材。",
				aliases: "游戏设计 技巧 摘录",
				tags: "游戏设计 技巧",
			}),
		];
		const base = buildResidentBase(documents);
		const queryAnalysis = analyzeQuery("电子技");
		const unitFamilyMatches = lookupQueryUnitFamilies(base, queryAnalysis);
		const candidateDocs = recallCandidateDocs(base, queryAnalysis, unitFamilyMatches);

		expect(candidateDocs).not.toHaveLength(0);

		const rankedPaths = candidateDocs
			.map((candidateRecall) => {
				const profile = buildPackingProfile(
					base,
					queryAnalysis,
					candidateRecall,
					unitFamilyMatches,
				);
				console.log("han-prefix profile", {
					path: profile.path,
					candidateRecall,
					realizedFamilies: profile.realizedFamilies,
					coverageGate: profile.coverageGate,
					strongestContainer: profile.strongestContainer,
					secondStrongestContainer: profile.secondStrongestContainer,
					hanSurfaceCompletionGroups: profile.hanSurfaceCompletionGroups,
					hanRescueAssessments: profile.hanRescueAssessments,
				});
				return profile;
			})
			.sort(comparePackingProfiles)
			.map((candidate) => candidate.path);

		expect(rankedPaths[0]).toBe("pkm-zh/books/电子技术入门.md");
	});
});
