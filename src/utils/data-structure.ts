import type { Line, MatchedLine } from "src/globals/search-types";
import { logger } from "./logger";

export class Collections {
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

/**
 * A class that manages a set of buffered items. It automatically flushes the buffered items
 * to a handler function when a specified threshold is reached. If multiple items have the same
 * identifier, the older item will be replaced by the newer one.
 */
export class BufferSet<T> {
	private elementsMap: Map<string, T>;
	private handler: (elements: T[]) => Promise<void>;
	private identifier: (element: T) => string;
	private autoFlushThreshold: number;
	private isFlushing = false;
	private pendingFlushRequested = false;

	/**
	 * Creates an instance of BufferSet.
	 * @param handler The function to handle elements.
	 * @param identifier A function that provides a unique string identifier for each element.
	 * @param autoFlushThreshold The number of elements at which the BufferSet should automatically flush.
	 */
	constructor(
		handler: (elements: T[]) => Promise<void>,
		identifier: (element: T) => string,
		autoFlushThreshold: number,
	) {
		this.elementsMap = new Map();
		this.handler = handler;
		this.identifier = identifier;
		this.autoFlushThreshold = autoFlushThreshold;
	}

	/**
	 * Adds a new element to the buffer. If the buffer reaches the autoFlushThreshold, it triggers a flush.
	 * If an element with the same identifier already exists, it will be replaced by the new element.
	 * @param element The element to be added to the buffer.
	 */
	add(element: T): void {
		const id = this.identifier(element);
		this.elementsMap.set(id, element);

		if (this.elementsMap.size >= this.autoFlushThreshold) {
			this.flush();
		}
	}

	/**
	 * Flushes all buffered elements to the handler function and clears the buffer.
	 */
	async flush(): Promise<void> {
		if (this.isFlushing) {
			// A flush operation is already in progress, so we note that another flush is requested.
			this.pendingFlushRequested = true;
			return;
		}
		if (this.elementsMap.size === 0) {
			return;
		}
		this.isFlushing = true;

		const elementsToHandle = Array.from(this.elementsMap.values());
		this.elementsMap.clear();

		try {
			await this.handler(elementsToHandle);
			logger.debug("flushed");
		} finally {
			this.isFlushing = false;
			// check if a new flush was requested while we were flushing.
			if (this.pendingFlushRequested) {
				// reset the flag and call flush again.
				this.pendingFlushRequested = false;
				this.flush();
			}
		}
	}
}

export class BM25Calculator {
    private termFreqMap: Map<string, number>;
    private lines: Line[];
    private queryTerms: string[];
    private matchedTerms: string[];
    private totalLength: number;
    private avgDocLength: number;
    private k1: number;
    private b: number;
  
    constructor(lines: Line[], queryTerms: string[], matchedTerms: string[], k1 = 1.5, b = 0.75) {
        this.lines = lines;
        this.queryTerms = queryTerms;
        this.matchedTerms = matchedTerms;
        this.k1 = k1;
        this.b = b;
        this.termFreqMap = this.buildTermFreqMap();
        this.totalLength = this.calculateTotalLength();
        this.avgDocLength = this.totalLength / lines.length;
    }
  
    private buildTermFreqMap(): Map<string, number> {
        const termFreqMap = new Map<string, number>();
        this.lines.forEach((line) => {
            this.matchedTerms.forEach((term) => {
                if (line.text.toLowerCase().includes(term.toLowerCase())) {
                    termFreqMap.set(term, (termFreqMap.get(term) || 0) + 1);
                }
            });
        });
        return termFreqMap;
    }
  
    private calculateTotalLength(): number {
        return this.lines.reduce(
            (sum, line) => sum + line.text.split(" ").length,
            0,
        );
    }
  
    calculate(maxParsedLines: number): MatchedLine[] {
        const lineScores = this.lines.map((line) => {
            const { score, positions } = this.calculateBM25(line);
            return { line, score, positions };
        });

        const filteredLineScores = lineScores.filter(
            (entry) => entry.positions.size > 0,
        );

        filteredLineScores.sort((a, b) => b.score - a.score);

        return filteredLineScores.slice(0, maxParsedLines).map((entry) => ({
            text: entry.line.text,
            row: entry.line.row,
            positions: entry.positions,
        }));
    }

    private calculateBM25(line: Line): { score: number; positions: Set<number> } {
        let score = 0;
        const positions = new Set<number>();
        const docLength = line.text.split(" ").length;

        this.queryTerms.forEach((term) => {
            const freq = this.termFreqMap.get(term.toLowerCase()) || 0;
            const tf = (line.text.match(new RegExp(term, "gi")) || []).length;
            const idf = Math.log(1 + (this.lines.length - freq + 0.5) / (freq + 0.5));
            const termScore =
                idf *
                ((tf * (this.k1 + 1)) /
                    (tf + this.k1 * (1 - this.b + this.b * (docLength / this.avgDocLength))));

            score += termScore;

            // calculate term positions
            let match;
            const regex = new RegExp(term, "gi");
            while ((match = regex.exec(line.text)) !== null) {
                for (
                    let i = match.index;
                    i < match.index + match[0].length;
                    i++
                ) {
                    positions.add(i);
                }
            }
        });

        return { score, positions };
    }
}
