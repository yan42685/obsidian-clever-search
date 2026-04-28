module.exports = {
	Notice: class Notice {
		constructor(_message, _timeout) {}
		setText(_message) {}
		hide() {}
	},
	AbstractInputSuggest: class AbstractInputSuggest {
		constructor(app, inputEl) {
			this.app = app;
			this.inputEl = inputEl;
		}
		close() {}
		open() {}
		setInstructions(_instructions) {}
	},
	moment: {
		locale() {
			return "en";
		},
	},
};
