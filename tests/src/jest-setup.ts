// this file will run before each test
// because of the option setupFilesAfterEnv: ["<rootDir>/tests/src/jest-setup.ts"] in jest.config.js
import { jest } from "@jest/globals";
import "reflect-metadata";
global.jest = jest;

