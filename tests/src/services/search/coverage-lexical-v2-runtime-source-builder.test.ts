import {
	buildCoverageLexicalV2RuntimeSourceEntries,
} from 'src/services/search/coverage-lexical/v2/runtime';

describe('coverage lexical v2 runtime source builder', () => {
	test('builds exact-match runtime source entries with body-local best-window evidence', () => {
		const entries = buildCoverageLexicalV2RuntimeSourceEntries(['ai', 'exam'], [
			{
				docId: 7,
				path: 'notes/ai-planning.md',
				fieldTerms: {
					basenameTerms: ['ai'],
					bodyTerms: ['ai', 'exam', 'design'],
				},
				bodyTokenSequence: ['design', 'ai', 'exam', 'design'],
			},
			{
				docId: 8,
				path: 'notes/exam-summary.md',
				fieldTerms: {
					bodyTerms: ['exam', 'summary'],
				},
				bodyTokenSequence: ['exam', 'summary'],
			},
		]);

		expect(entries).toEqual([
			{
				docId: 7,
				path: 'notes/ai-planning.md',
				stableDeterministicKey: 'notes/ai-planning.md',
				sourceKind: 'metadata',
				matchedPrimaryUnits: [
					{
						normalizedText: 'ai',
						surfaceGroupIndex: 0,
						surfaceKind: 'latin',
						strongestField: 'basename',
						corroboratedFields: ['body'],
						matchQuality: 'exact',
					},
					{
						normalizedText: 'exam',
						surfaceGroupIndex: 1,
						surfaceKind: 'latin',
						strongestField: 'body',
						corroboratedFields: [],
						matchQuality: 'exact',
					},
				],
				bestWindow: {
					field: 'body',
					matchedUnitKeys: ['0:ai', '1:exam'],
					windowWidth: 2,
					averageDistance: 1,
					preservesSurfaceOrder: true,
				},
			},
			{
				docId: 8,
				path: 'notes/exam-summary.md',
				stableDeterministicKey: 'notes/exam-summary.md',
				sourceKind: 'body',
				matchedPrimaryUnits: [
					{
						normalizedText: 'exam',
						surfaceGroupIndex: 1,
						surfaceKind: 'latin',
						strongestField: 'body',
						corroboratedFields: [],
						matchQuality: 'exact',
					},
				],
				bestWindow: {
					field: 'body',
					matchedUnitKeys: ['1:exam'],
					windowWidth: 1,
					averageDistance: 0,
					preservesSurfaceOrder: true,
				},
			},
		]);
	});

	test('prefers tighter heading-local exact windows over wider body-local windows', () => {
		const entries = buildCoverageLexicalV2RuntimeSourceEntries(['deploy', 'check'], [
			{
				docId: 9,
				path: 'notes/deploy-check.md',
				fieldTerms: {
					headingsTerms: ['deploy', 'check'],
					bodyTerms: ['deploy', 'check'],
				},
				headingsTokenSequence: ['deploy', 'check'],
				bodyTokenSequence: ['deploy', 'many', 'prep', 'steps', 'check'],
			},
		]);

		expect(entries[0]).toMatchObject({
			docId: 9,
			bestWindow: {
				field: 'headings',
				matchedUnitKeys: ['0:deploy', '1:check'],
				windowWidth: 2,
				averageDistance: 1,
				preservesSurfaceOrder: true,
			},
		});
	});
});
