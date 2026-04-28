require("reflect-metadata");

const { TextDecoder, TextEncoder } = require("util");

if (!global.TextEncoder) {
	global.TextEncoder = TextEncoder;
}

if (!global.TextDecoder) {
	global.TextDecoder = TextDecoder;
}

if (!global.alert) {
	global.alert = jest.fn();
}

jest.mock(
	"electron",
	() => ({
		app: {
			getPath: () => "mockedPath",
		},
		remote: {
			app: {
				getPath: () => "mockedPath",
			},
		},
	}),
	{ virtual: true },
);

global.require = (moduleName) => {
	if (moduleName === "electron") {
		return {
			app: {
				getPath: () => "mockedPath",
			},
			remote: {
				app: {
					getPath: () => "mockedPath",
				},
			},
		};
	}

	throw new Error(`Module '${moduleName}' is not mocked in jest-setup.js`);
};
