import type { IndexedDocument } from "src/globals/search-types";
import { container } from "tsyringe";
import { Tokenizer } from "./tokenizer";

const testDocuments: IndexedDocument[] = [
	{
		path: "/documents/doc1",
		basename: "document1.txt",
		aliases: "document one, text file",
		content: "This is the content of document 1.",
	},
	{
		path: "/documents/doc2",
		basename: "document2.txt",
		aliases: "document two, text document",
		content: "Here is the content of document 2.",
	},
	{
		path: "/documents/doc3",
		basename: "document3.txt",
		aliases: "document three, text file",
		content: "Document 3 contains important information.",
	},
	{
		path: "/documents/doc4",
		basename: "document4.txt",
		aliases: "document four, text file",
		content: "The content of document 4 is confidential.",
	},
	{
		path: "/documents/doc5",
		basename: "document5.txt",
		aliases: "document five, text file",
		content: "Document 5 is related to project management.",
	},
	{
		path: "/documents/doc6",
		basename: "document6.txt",
		aliases: "document six, text file",
		content: "This is a sample document with some text content.",
	},
	{
		path: "/documents/doc7",
		basename: "document7.txt",
		aliases: "document seven, text file",
		content: "Document 7 contains data and statistics.",
	},
	{
		path: "/documents/doc8",
		basename: "document8.txt",
		aliases: "document eight, text file",
		content: "The final document in the list is document 8.",
	},
];

export class DataProvider {
    private readonly tokenizer = container.resolve(Tokenizer);
	getIndexedDocuments(): IndexedDocument[] {
		return testDocuments;
	}
}
