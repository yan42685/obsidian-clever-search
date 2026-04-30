jest.mock("src/utils/my-lib", () => ({
  isDevEnvironment: false,
}));

import {
  beginHybridProfile,
  endHybridProfile,
  profileHybridStage,
} from "src/services/search/hybrid/hybrid-profiler";

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("hybrid-profiler", () => {
  afterEach(() => {
    endHybridProfile();
  });

  test("profileHybridStage survives the active profile ending while async work is pending", async () => {
    const deferred = createDeferred<string>();
    beginHybridProfile("test-profile");

    const profiled = profileHybridStage(
      "index.embed_batch",
      async () => await deferred.promise,
    );
    endHybridProfile();
    deferred.resolve("done");

    await expect(profiled).resolves.toBe("done");
  });
});
