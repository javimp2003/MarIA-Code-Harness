/**
 * Markdown → HTML for assistant text. Raw HTML in the source is escaped, links
 * carry their target in `data-href` (never `href`) so the delegated click
 * handler decides between `openExternal` and `openFile`, and fenced code gets a
 * copy button.
 */
import { Marked, type Tokens } from "marked";
import { highlightCode } from "./highlight";

const ESCAPES: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(text: string): string {
	return text.replace(/[&<>"']/g, ch => ESCAPES[ch] ?? ch);
}

const SOURCE_EXTENSIONS =
	"ts|tsx|js|jsx|mjs|cjs|json|jsonc|md|mdx|py|rs|go|java|kt|c|h|cc|cpp|hpp|cs|rb|php|swift|css|scss|less|html|vue|svelte|yml|yaml|toml|ini|sh|bash|zsh|txt|sql|xml|lock|proto|gradle|lua|zig|dart|ex|exs";
const FILE_WITH_KNOWN_EXT = new RegExp(`^[\\w@~./-]+\\.(?:${SOURCE_EXTENSIONS})(?::\\d+(?:-\\d+)?)?$`);
const PATH_WITH_SLASH = /^(?:~|\.{1,2})?\/?[\w@.-]+(?:\/[\w@.-]+)+\.\w{1,10}(?::\d+(?:-\d+)?)?$/;

/** Heuristic for inline code that names a file (`src/app.ts`, `README.md:12`, `local://plan.md`). */
export function looksLikeFilePath(text: string): boolean {
	if (text.length > 200 || /\s/.test(text)) return false;
	if (/^local:\/\/\S+$/.test(text)) return true;
	if (/^[a-z]+:\/\//i.test(text)) return false;
	return FILE_WITH_KNOWN_EXT.test(text) || PATH_WITH_SLASH.test(text);
}

function codeBlock(text: string, lang: string | undefined): string {
	const language = (lang ?? "").trim().split(/\s+/)[0] ?? "";
	const source = text.replace(/\n$/, "");
	const code = highlightCode(source, language.toLowerCase()) ?? escapeHtml(source);
	return (
		`<div class="code-block"><div class="code-header"><span class="code-lang">${escapeHtml(language)}</span>` +
		`<button type="button" class="copy-btn" data-tooltip="Copy" aria-label="Copy"></button></div>` +
		`<pre><code class="hljs">${code}</code></pre></div>`
	);
}

const marked = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		html({ text }: Tokens.HTML | Tokens.Tag): string {
			return escapeHtml(text);
		},
		code({ text, lang }: Tokens.Code): string {
			return codeBlock(text, lang);
		},
		codespan({ text }: Tokens.Codespan): string {
			if (looksLikeFilePath(text)) {
				return `<code class="file-link" data-file="${escapeHtml(text)}" tabindex="0">${escapeHtml(text)}</code>`;
			}
			return `<code>${escapeHtml(text)}</code>`;
		},
		link({ href, title, tokens }: Tokens.Link): string {
			const label = this.parser.parseInline(tokens);
			return `<a data-href="${escapeHtml(href)}" tabindex="0" data-tooltip="${escapeHtml(title || href)}">${label}</a>`;
		},
		image({ href, text }: Tokens.Image): string {
			return `<a data-href="${escapeHtml(href)}" tabindex="0" data-tooltip="${escapeHtml(href)}">${escapeHtml(text || href)}</a>`;
		},
	},
});

export function renderMarkdown(source: string): string {
	return marked.parse(source, { async: false });
}

/** Standard HTML for the clipboard: links keep their `href` and code its `<pre>`, with none of the webview's buttons or click targets. */
const clipboardHtml = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		html({ text }: Tokens.HTML | Tokens.Tag): string {
			return escapeHtml(text);
		},
	},
});

/** Every block ends with its own blank line; `markdownClipboard` trims the last. */
const clipboardText = new Marked({
	gfm: true,
	breaks: false,
	renderer: {
		space: () => "",
		hr: () => "---\n\n",
		html: ({ text }: Tokens.HTML | Tokens.Tag) => text,
		code: ({ text }: Tokens.Code) => `${text.replace(/\n$/, "")}\n\n`,
		codespan: ({ text }: Tokens.Codespan) => unescapeHtml(text),
		text(token: Tokens.Text | Tokens.Escape) {
			return "tokens" in token && token.tokens ? this.parser.parseInline(token.tokens) : unescapeHtml(token.text);
		},
		paragraph(token: Tokens.Paragraph) {
			return `${this.parser.parseInline(token.tokens)}\n\n`;
		},
		heading(token: Tokens.Heading) {
			return `${this.parser.parseInline(token.tokens)}\n\n`;
		},
		blockquote(token: Tokens.Blockquote) {
			return `${this.parser.parse(token.tokens).trimEnd().replace(/^/gm, "> ")}\n\n`;
		},
		list(token: Tokens.List) {
			const first = typeof token.start === "number" ? token.start : 1;
			const items = token.items.map((item, index) => {
				const marker = token.ordered ? `${first + index}. ` : "- ";
				return marker + this.listitem(item).replace(/\n/g, `\n${" ".repeat(marker.length)}`);
			});
			return `${items.join("\n")}\n\n`;
		},
		listitem(item: Tokens.ListItem) {
			const check = item.task ? (item.checked ? "[x] " : "[ ] ") : "";
			const blocks = item.tokens.map(token =>
				token.type === "text"
					? this.parser.parseInline((token as Tokens.Text).tokens ?? [token])
					: this.parser.parse([token]).trimEnd(),
			);
			return check + blocks.join("\n");
		},
		table(token: Tokens.Table) {
			const row = (cells: Tokens.TableCell[]) => cells.map(cell => this.parser.parseInline(cell.tokens)).join("\t");
			return `${[row(token.header), ...token.rows.map(row)].join("\n")}\n\n`;
		},
		strong(token: Tokens.Strong) {
			return this.parser.parseInline(token.tokens);
		},
		em(token: Tokens.Em) {
			return this.parser.parseInline(token.tokens);
		},
		del(token: Tokens.Del) {
			return this.parser.parseInline(token.tokens);
		},
		br: () => "\n",
		link(token: Tokens.Link) {
			const label = this.parser.parseInline(token.tokens);
			return label === token.href ? label : `${label} (${token.href})`;
		},
		image: ({ href, text }: Tokens.Image) => text || href,
	},
});

function unescapeHtml(text: string): string {
	return text.replace(/&(amp|lt|gt|quot|#39);/g, (_, name: string) => UNESCAPES[name] ?? name);
}

const UNESCAPES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', "#39": "'" };

/**
 * What the copy button puts on the clipboard for an assistant reply: rich text
 * (`html`, pasted formatted into editors that take it) and `text` without the
 * markdown markers (bold asterisks, backticks, `#`), for plain-text targets.
 */
export function markdownClipboard(source: string): { html: string; text: string } {
	return {
		html: clipboardHtml.parse(source, { async: false }),
		text: clipboardText.parse(source, { async: false }).trimEnd(),
	};
}
