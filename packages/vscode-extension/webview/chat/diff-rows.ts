/**
 * DOM-free rows of the diff preview under a file-changing tool call: omp's
 * numbered diff (`+5|text`, `-7|text`, ` 8|text`, `@@` hunk headers, blank gap
 * rows) or whole text shown as added/removed (a written or deleted file).
 */
import { type ToolStatus, str, toolSubject } from "./activity";

export type DiffRowKind = "add" | "del" | "context" | "gap";

export interface DiffRow {
	kind: DiffRowKind;
	/** Line number in the new file (added/context rows) or the old one (removed rows); absent in gaps and unnumbered diffs. */
	line?: number;
	text: string;
}

/** File tools whose finished rows show their changes. */
const CHANGE_TOOLS: Record<string, true> = { edit: true, write: true, notebook: true, ast_edit: true };

export function isChangeTool(name: string): boolean {
	return CHANGE_TOOLS[name.toLowerCase()] === true;
}

const NUMBERED_ROW = /^([+\- ])(\d+)\|(.*)$/;
const KINDS: Record<string, DiffRowKind> = { "+": "add", "-": "del", " ": "context" };

/** Rows of a diff; hunk headers and blank rows become single gaps, never leading or trailing. */
export function diffRows(diff: string | undefined): DiffRow[] {
	const rows: DiffRow[] = [];
	const gap = () => {
		if (rows.length > 0 && rows[rows.length - 1].kind !== "gap") rows.push({ kind: "gap", text: "" });
	};
	for (const raw of (diff ?? "").split("\n")) {
		const numbered = NUMBERED_ROW.exec(raw);
		if (numbered) {
			rows.push({ kind: KINDS[numbered[1]], line: Number(numbered[2]), text: numbered[3] });
		} else if (raw.trim() === "" || raw.startsWith("@@")) {
			gap();
		} else if (raw.startsWith("+++ ") || raw.startsWith("--- ")) {
			continue;
		} else {
			// A plain unified diff row, unnumbered.
			rows.push({ kind: KINDS[raw[0]] ?? "context", text: KINDS[raw[0]] ? raw.slice(1) : raw });
		}
	}
	if (rows.length > 0 && rows[rows.length - 1].kind === "gap") rows.pop();
	return rows;
}

/** Every line of `text` as an added or removed row, numbered from 1. */
function textRows(kind: "add" | "del", text: string): DiffRow[] {
	return text
		.replace(/\n+$/, "")
		.split("\n")
		.map((line, index) => ({ kind, line: index + 1, text: line }));
}

/**
 * The rows previewing a file change, or `undefined` when there is nothing to show:
 * the result's diff; else the text of a deleted or created file; else, for a finished
 * `write` to a workspace file, the content it wrote.
 */
export function changePreview(
	tool: string,
	args: Record<string, unknown>,
	details: unknown,
	status: ToolStatus,
): DiffRow[] | undefined {
	if (!isChangeTool(tool) || status === "error") return undefined;
	const result = details && typeof details === "object" ? (details as Record<string, unknown>) : {};
	const diff = str(result.diff);
	let rows: DiffRow[] = [];
	if (diff) rows = diffRows(diff);
	else if (result.op === "delete" && typeof result.oldText === "string") rows = textRows("del", result.oldText);
	else if (result.op === "create" && typeof result.newText === "string") rows = textRows("add", result.newText);
	else if (tool.toLowerCase() === "write" && status === "done" && toolSubject(tool, args)?.path) {
		const content = str(args.content);
		if (content) rows = textRows("add", content);
	}
	return rows.length > 0 ? rows : undefined;
}
