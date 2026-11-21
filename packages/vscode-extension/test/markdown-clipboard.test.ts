import { describe, expect, it } from "bun:test";
import { markdownClipboard } from "../webview/chat/markdown";

describe("markdownClipboard", () => {
	it("pastes bold, code and links as formatting in rich targets", () => {
		const { html } = markdownClipboard("Some **bold** `x` and [docs](https://a.dev/b)");
		expect(html).toContain("<strong>bold</strong>");
		expect(html).toContain("<code>x</code>");
		expect(html).toContain('<a href="https://a.dev/b">docs</a>');
	});

	it("leaves no markdown markers in the plain text", () => {
		const source = "# Title\n\nSome **bold**, *italic*, ~~old~~ and `code` with [a link](https://a.dev).";
		expect(markdownClipboard(source).text).toBe(
			"Title\n\nSome bold, italic, old and code with a link (https://a.dev).",
		);
	});

	it("keeps list structure, nested lists and task marks as text", () => {
		const source = "1. one\n2. **two**\n   - inner\n   - inner 2\n\n- [x] done\n- [ ] todo";
		expect(markdownClipboard(source).text).toBe("1. one\n2. two\n   - inner\n   - inner 2\n\n- [x] done\n- [ ] todo");
	});

	it("keeps fenced code verbatim and unescapes entities", () => {
		const source = 'Use a < b && c:\n\n```ts\nconst x = a < b && "c";\n```';
		expect(markdownClipboard(source).text).toBe('Use a < b && c:\n\nconst x = a < b && "c";');
	});

	it("separates table cells with tabs so a spreadsheet splits them", () => {
		expect(markdownClipboard("| a | b |\n|---|---|\n| **1** | 2 |").text).toBe("a\tb\n1\t2");
	});

	it("shows raw HTML in the source as text, never as markup", () => {
		expect(markdownClipboard("<b>x</b>").html).not.toContain("<b>");
	});
});
