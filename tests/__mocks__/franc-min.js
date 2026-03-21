function countAsciiLetters(text) {
	return (text.match(/[A-Za-z]/g) ?? []).length;
}

function countNonAscii(text) {
	return (text.match(/[^\x00-\x7F]/g) ?? []).length;
}

function franc(text) {
	const asciiLetters = countAsciiLetters(text);
	const nonAscii = countNonAscii(text);
	return asciiLetters >= nonAscii ? "eng" : "cmn";
}

module.exports = {
	franc,
};
