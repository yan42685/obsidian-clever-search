import {
	buildCoverageLexicalV2RuntimeSourceEntries,
} from 'src/services/search/coverage-lexical/v2/runtime';

describe('coverage lexical v2 runtime source builder', () => {
	test('builds exact-match runtime source entries with body-local best-window evidence', () => {
		const entries = buildCoverageLexicalV2RuntimeSourceEntries(['ai', '省考'], [
			{
				docId: 7,
				path: 'notes/AI提供数值策划设计.md',
				fieldTerms: {
					basenameTerms: ['ai'],
					bodyTerms: ['ai', '省考', '设计'],
				},
				bodyTokenSequence: ['设计', 'ai', '省考', '设计'],
			},
			{
				docId: 8,
				path: 'notes/省考总结.md',
				fieldTerms: {
					bodyTerms: ['省考', '总结'],
				},
				bodyTokenSequence: ['省考', '总结'],
			},
		]);

		expect(entries).toEqual([
			{
				docId: 7,
				path: 'notes/AI提供数值策划设计.md',
				stableDeterministicKey: 'notes/AI提供数值策划设计.md',
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
						normalizedText: '省考',
						surfaceGroupIndex: 1,
						surfaceKind: 'han',
						strongestField: 'body',
						corroboratedFields: [],
						matchQuality: 'exact',
					},
				],
				bestWindow: {
					matchedUnitKeys: ['0:ai', '1:省考'],
					windowWidth: 2,
					averageDistance: 1,
					preservesSurfaceOrder: true,
				},
			},
			{
				docId: 8,
				path: 'notes/省考总结.md',
				stableDeterministicKey: 'notes/省考总结.md',
				sourceKind: 'body',
				matchedPrimaryUnits: [
					{
						normalizedText: '省考',
						surfaceGroupIndex: 1,
						surfaceKind: 'han',
						strongestField: 'body',
						corroboratedFields: [],
						matchQuality: 'exact',
					},
				],
				bestWindow: {
					matchedUnitKeys: ['1:省考'],
					windowWidth: 1,
					averageDistance: 0,
					preservesSurfaceOrder: true,
				},
			},
		]);
	});
});
