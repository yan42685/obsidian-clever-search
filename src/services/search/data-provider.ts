import type { IndexedDocument } from "src/globals/search-types";
import { container } from "tsyringe";
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
	getIndexedDocuments(): IndexedDocument[] {
		return testDocuments;
	}
}
