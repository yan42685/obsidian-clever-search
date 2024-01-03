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
	const mockHandler = jest.fn(
		() =>
			new Promise<void>((resolve) => {
				setTimeout(resolve, 10); // simulate a 10ms delay in handler (async flush)
			}),
	);

	const identifier = (req: Request) => req.caller + req.query;

	beforeEach(() => {
		jest.useFakeTimers();
		bufferSet = new BufferSet(mockHandler, identifier, 3);
		jest.clearAllMocks();
	});

	afterEach(() => {
		jest.useRealTimers();
	});

	test("add or flush should not interfere with ongoing flush", () => {
		bufferSet.add({ caller: "caller1", query: "query1" });
		bufferSet.add({ caller: "caller2", query: "query2" });
		bufferSet.add({ caller: "caller3", query: "query3" }); // should trigger flush

		// start the async flush
		jest.advanceTimersByTime(5); // halfway through the flush

		// add more while flushing
		bufferSet.add({ caller: "caller4", query: "query4" });
		bufferSet.add({ caller: "caller5", query: "query5" });

		// complete the flush
		jest.advanceTimersByTime(5);

		// first flush should be called with the first three requests
		expect(mockHandler).toHaveBeenCalledWith([
			{ caller: "caller1", query: "query1" },
			{ caller: "caller2", query: "query2" },
			{ caller: "caller3", query: "query3" },
		]);

		// call flush explicitly to handle remaining elements
		bufferSet.flush();
		jest.advanceTimersByTime(10); // Complete the flush

		// second flush should be called with the next two requests
		expect(mockHandler).toHaveBeenCalledWith([
			{ caller: "caller4", query: "query4" },
			{ caller: "caller5", query: "query5" },
		]);

		expect(mockHandler).toHaveBeenCalledTimes(2);
	});
});
