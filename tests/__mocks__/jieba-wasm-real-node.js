const nodeJieba = require("jieba-wasm/pkg/nodejs/jieba_rs_wasm");

module.exports = {
	__esModule: true,
	default: async () => nodeJieba.__wasm,
	cut_for_search: nodeJieba.cut_for_search,
};
