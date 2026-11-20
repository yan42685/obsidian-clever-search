// mock external module "jieba-wasm/pkg/web/jieba_rs_wasm", use `moduleNameMapper` in tests/config/jest/jest.config.js
module.exports = {
  cut_for_search: jest.fn().mockImplementation((text) => {
    return ["mocked", "word", "list"];
  }),
  init: jest.fn().mockImplementation((any) => {})
};
