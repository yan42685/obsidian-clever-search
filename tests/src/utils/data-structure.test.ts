import { BufferSet, Collections } from "src/utils/data-structure";

describe("Collections", () => {
	test("minInSet returns the minimum value in a set", () => {
		const numbers = new Set([3, 1, 4, 1, 5, 9]);
		const min = Collections.minInSet(numbers);
		expect(min).toBe(1);
	});
});

type Request = {
	caller: string;
	query: string;
};

describe("BufferSet", () => {
	let bufferSet: BufferSet<Request>;
	const mockHandler = jest.fn(() => {
		return new Promise<void>((resolve) => {
			// Simulate a 10ms delay in handler (async flush)
			setTimeout(resolve, 10);
		});
	});

	const identifier = (req: Request) => req.caller + req.query;

	beforeEach(() => {
		jest.useFakeTimers();
		bufferSet = new BufferSet(mockHandler, identifier, 3);
		jest.clearAllMocks();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	test("add or flush should not interfere with ongoing flush", async () => {
		bufferSet.add({ caller: "caller1", query: "query1" });
		bufferSet.add({ caller: "caller2", query: "query2" });
		bufferSet.add({ caller: "caller3", query: "query3" }); // should trigger flush

		// halfway through the flush
		jest.advanceTimersByTime(5);

		// add more while flushing
		bufferSet.add({ caller: "caller4", query: "query4" });
		bufferSet.add({ caller: "caller5", query: "query5" });
		bufferSet.forceFlush(); // won't be called at once but will be called later

		// complete first flush
		jest.advanceTimersByTime(5);

		// first flush should be called with the first three requests
		expect(mockHandler).toHaveBeenCalledWith([
			{ caller: "caller1", query: "query1" },
			{ caller: "caller2", query: "query2" },
			{ caller: "caller3", query: "query3" },
		]);

		// ensure the mock handler is resolved
		await mockHandler.mock.results[0].value;

		// Now that the first flush is done, we call flush again to process the remaining elements
		jest.advanceTimersByTime(10);
		await mockHandler.mock.results[1].value;

		// second flush should have been called with the remaining elements
		expect(mockHandler).toHaveBeenCalledWith([
			{ caller: "caller4", query: "query4" },
			{ caller: "caller5", query: "query5" },
		]);
	});
});
