import builtins from "builtin-modules";
import esbuild from "esbuild";
import esbuildSvelte from "esbuild-svelte";
import fsUtil from "fs";
import pathUtil from "path";
import process from "process";
import sveltePreprocess from "svelte-preprocess";

const banner = `/*
THIS IS A GENERATED/BUNDLED FILE BY ESBUILD
if you want to view the source, please visit the github repository of this plugin
*/
`;
const prod = process.argv[2] === "production";

function debounce(delay, func) {
	let timeoutId;

	return (...args) => {
		clearTimeout(timeoutId);
		timeoutId = setTimeout(() => func(...args), delay);
	};
}

// 这里会多次使用esbuild进行编译，防止多次同时复制
let hasCopied = false;
function copyFile(src, dest) {
	if (hasCopied) {
		hasCopied = false;
		// 跳过偶数次复制
		return;
	}
	hasCopied = true;
	fsUtil.copyFile(src, dest, (err) => {
		const formattedTime = new Date().toLocaleTimeString("en-US", {
			hour12: false,
			hour: "2-digit",
			minute: "2-digit",
			second: "2-digit",
		});
		if (err) {
			console.error(`Error copying ${src}:`, err, `  - ${formattedTime}`);
		} else {
			console.log(`Copied ${src} to ${dest}`, `  - ${formattedTime}`);
		}
	});
}

const copyFileDebounced = debounce(1000, copyFile);

const filesToCopy = ["./assets/styles.css", "./assets/manifest.json"];
// 监听特定文件的变化
filesToCopy.forEach((file) => {
	fsUtil.watch(file, (eventType, filename) => {
		if (eventType === "change") {
			copyFileDebounced(file, `./${filename}`);
		}
	});
});

// for the first time `pnpm dev`
if (!prod) {
	filesToCopy.forEach((file) => {
		const destination = `./${pathUtil.basename(file)}`;
		copyFile(file, destination);
		// 避免被这个变量影响，导致偶数文件无法复制
		hasCopied = false;
	});
}

const esbuildConfig = (outdir) => ({
	banner: {
		js: banner,
	},
	entryPoints: {
		main: "src/main.ts",
		"cs-search-worker": "src/web-worker/search-worker-server.ts",
	},
	bundle: true,
	minify: true,
	external: [
		"obsidian",
		"electron",
		"@codemirror/autocomplete",
		"@codemirror/collab",
		"@codemirror/commands",
		"@codemirror/language",
		"@codemirror/lint",
		"@codemirror/search",
		"@codemirror/state",
		"@codemirror/view",
		"@lezer/common",
		"@lezer/highlight",
		"@lezer/lr",
		...builtins,
		// 不打包测试文件夹
		"tests/*",
	],
	format: "cjs",
	platform: "node",
	target: "es2018",
	logLevel: "info",
	sourcemap: prod ? false : "inline",
	treeShaking: true,
	outdir: outdir,
	define: {
		// need nested quotation mark
		// "process.env.NODE_ENV": prod ? '"production"' : '"development"',
		"process.env.NODE_ENV": `'${process.argv[2]}'`,
	},

	plugins: [
		esbuildSvelte({
			compilerOptions: { css: true },
			preprocess: sveltePreprocess(),
		}),
	],
});

const devContext = await esbuild.context(esbuildConfig("./"));
const releaseContext = await esbuild.context(esbuildConfig("dist"));

if (prod) {
	await releaseContext.rebuild();
	process.exit(0);
} else {
	await devContext.watch();
}
