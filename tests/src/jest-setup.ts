// this file will run before each test
// because of the option setupFilesAfterEnv: ["<rootDir>/tests/src/jest-setup.ts"] in jest.config.js
import { jest } from "@jest/globals";
import "reflect-metadata";
import { TextDecoder, TextEncoder } from "util";
global.jest = jest;
global.TextEncoder = TextEncoder as typeof global.TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

// Mock the require function
// @ts-ignore
global.require = (moduleName) => {
  // mock require("electron")
  if (moduleName === 'electron') {
    return {
      app: {
        getPath: () => 'mockedPath',
      },
      remote: {
        app: {
          getPath: () => 'mockedPath',
        },
      },
    };
  }

  throw new Error(`Module '${moduleName}' is not mocked in jest-setup.ts`);
};
