// Designated implementation target for the next lexical backend.
//
// Rules:
// - keep this engine code-wise independent from passage-file-search-engine.ts
// - do not import legacy scorer / verifier / comparator logic here
// - shared neutral utilities are fine; inherited ranking logic is not
//
// The automation loop should treat this file as the default mechanism-level
// implementation target, while passage-lexical-ranker.ts remains the smaller
// tuning / orchestration surface.

export {};
