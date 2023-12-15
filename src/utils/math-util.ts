export class MathUtil {
	static minInSet(set: Set<number>) {
		let minInSet = Number.MAX_VALUE;
		for (const num of set) {
			if (num < minInSet) {
				minInSet = num;
			}
		}
		return minInSet;
	}
}