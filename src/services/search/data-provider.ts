import { App, TFile, Vault, parseFrontMatterAliases } from "obsidian";
import type { IndexedDocument } from "src/globals/search-types";
import { logger } from "src/utils/logger";
import { MyLib } from "src/utils/my-lib";
import { container } from "tsyringe";
import { PluginSetting } from "../obsidian/setting";
import { Tokenizer } from "./tokenizer";

const testDocuments: IndexedDocument[] = [
	{
		path: "/also/head.md",
		basename: "camera",
		aliases: "well",
		content:
			"Scientist want police could degree write community stop. Worker growth threat sign address alone. Computer her benefit. During executive yet benefit.",
	},
	{
		path: "/may/throw.md",
		basename: "cover",
		aliases: "yard country",
		content:
			"Section write allow end issue treat country argue. Yard through probably could rise. Paper almost task free travel hour. Guess second responsibility person. Born employee tree of natural follow whole shoulder. Rest nice military.",
	},
	{
		path: "/cost/director.md",
		basename: "music",
		aliases: "spring wish",
		content:
			"Turn well animal see most father. Lawyer apply customer officer. All candidate financial culture card. Century into degree out read.",
	},
	{
		path: "/whom/simply.md",
		basename: "health",
		aliases: "step",
		content:
			"Number federal bag sometimes effort. According kid mean others debate seem. Ever only truth. Family popular family ability. Establish north American along as carry gun send. Already interesting whatever source teacher nice bit.",
	},
	{
		path: "/provide/once.md",
		basename: "collection",
		aliases: "eight material",
		content:
			"Attack eat open serious. Involve because weight when attack hope. Cut top others nor dark. Reduce entire yourself lay yet.",
	},
	{
		path: "/within/operation.md",
		basename: "thank",
		aliases: "society bad visit",
		content:
			"Nature thank article me adult lose. Method such film similar. Six mouth different poor avoid. Nature mission everyone not. Democrat hour organization market me common lay provide. Describe mission war get fire.",
	},
	{
		path: "/decade/only.md",
		basename: "turn",
		aliases: "of language kitchen",
		content:
			"War tree man develop defense. Detail boy player poor everybody important sign. Trip color reality give week growth officer. Population product have group run example start.",
	},
	{
		path: "/personal/idea.md",
		basename: "agree",
		aliases: "fish military",
		content:
			"Ten sister down left. Smile benefit mission bill poor. Team weight this eye fall. Grow note nearly no. Leg pretty last child. Manage from appear hope.",
	},
	{
		path: "/white/cup.md",
		basename: "clearly",
		aliases: "both",
		content:
			"Contain candidate official listen. Give reason across industry. Area like fact state true. Place affect here resource left its expect. Finally there agency attorney probably might history. Work probably catch environment college game.",
	},
	{
		path: "/fine/education.md",
		basename: "service",
		aliases: "owner modern",
		content:
			"Yard science total who arrive culture break. Give model whose these general with various. Head a possible book. Test up field score.",
	},
	{
		path: "/official/finish.md",
		basename: "child",
		aliases: "I",
		content:
			"Media behavior those tough able yes time stay. Own hundred discussion seat eight cost century face. Film can yes suddenly yes where. Each improve food ask.",
	},
	{
		path: "/establish/add.md",
		basename: "southern",
		aliases: "soldier personal",
		content:
			"Expect admit ground. Call scene arrive table. Image something model woman management near its. Camera meeting manager power debate.",
	},
];
export class DataProvider {
	private readonly tokenizer = container.resolve(Tokenizer);
	private readonly vault = container.resolve(Vault);
	private readonly app = container.resolve(App);

	async generateAllIndexedDocuments(): Promise<IndexedDocument[]> {
		const filesToIndex = await new FileRetriever().getFilesToBeIndexed();
		// MyLib.countFileByExtensions(filesToIndex);
		logger.debug(`${filesToIndex.length} files need to be indexed.`);
		// TODO: remove this line
		// files = files.slice(0, 100);
		return Promise.all(
			filesToIndex.map(async (file) => {
				const metadata = this.app.metadataCache.getFileCache(file);
				return {
					path: file.path,
					basename: file.basename,
					aliases: (
						parseFrontMatterAliases(metadata?.frontmatter) || []
					).join(""),
					content: await this.vault.cachedRead(file),
				};
			}),
		);
	}
}

class FileRetriever {
	private readonly vault: Vault = container.resolve(Vault);
	// @monitorDecorator
	async getFilesToBeIndexed(): Promise<TFile[]> {
		// TODO: compare mtime and then filter
		// get all files cached by obsidian
		const files = this.vault.getFiles();
		logger.warn(`files count: ${files.length}`);
		MyLib.countFileByExtensions(files);
		return files.filter(this.isFileIndexable);
	}

	private isFileIndexable(file: TFile): boolean {
		// logger.debug(`${file.path} -- ${file.extension}`);

		// return this.isExtensionValid(file);
		
		return false;
	}
	private isExtensionValid(file: TFile): boolean {
		const setting = container.resolve(PluginSetting);

		const userExtensionsProcessed = setting.excludeExtensions.map((ext) =>
			ext.includes(".") ? ext.substring(ext.lastIndexOf(".")) : ext,
		);
		const extensionBlackSet = new Set([
			...DEFAULT_BLACKLIST_EXTENSION,
			...userExtensionsProcessed,
		]);
		return !extensionBlackSet.has(file.extension);
	}
}

const DEFAULT_BLACKLIST_EXTENSION = [
	".zip",
	".rar",
	".7z",
	".tar",
	".gz",
	".bz2",
	".xz",
	".lz",
	".lzma",
	".tgz",
];
