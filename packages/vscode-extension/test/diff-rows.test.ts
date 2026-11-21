import { describe, expect, it } from "bun:test";
import { changePreview, diffRows } from "../webview/chat/diff-rows";

describe("diffRows", () => {
	it("numbers added, removed, and context rows of omp's diff", () => {
		expect(diffRows("@@ -1,3 +1,3 @@\n 1|a\n-2|b\n+2|B\n 3|c")).toEqual([
			{ kind: "context", line: 1, text: "a" },
			{ kind: "del", line: 2, text: "b" },
			{ kind: "add", line: 2, text: "B" },
			{ kind: "context", line: 3, text: "c" },
		]);
	});

	it("turns blank rows and hunk headers into single gaps, never leading or trailing", () => {
		const rows = diffRows("\n 1|a\n\n@@\n 9|b\n+10|c\n\n");
		expect(rows.map(row => row.kind)).toEqual(["context", "gap", "context", "add"]);
	});

	it("keeps `|` inside the line text and skips file headers", () => {
		expect(diffRows("--- a\n+++ b\n+4|x | y")).toEqual([{ kind: "add", line: 4, text: "x | y" }]);
	});

	it("reads a plain unified diff without line numbers", () => {
		expect(diffRows("-old\n+new\n same")).toEqual([
			{ kind: "del", text: "old" },
			{ kind: "add", text: "new" },
			{ kind: "context", text: "same" },
		]);
	});
});

describe("changePreview", () => {
	it("previews the diff of a finished edit", () => {
		const rows = changePreview("edit", { path: "a.ts" }, { diff: "-1|a\n+1|b" }, "done");
		expect(rows?.map(row => row.kind)).toEqual(["del", "add"]);
	});

	it("shows a deleted file's text as removed lines", () => {
		expect(changePreview("edit", { path: "a.ts" }, { diff: "", op: "delete", oldText: "x\ny\n" }, "done")).toEqual([
			{ kind: "del", line: 1, text: "x" },
			{ kind: "del", line: 2, text: "y" },
		]);
	});

	it("shows what a finished write put in a workspace file, but not before it ends or in an internal URI", () => {
		const args = { path: "a.ts", content: "one\ntwo\n" };
		expect(changePreview("write", args, {}, "done")).toEqual([
			{ kind: "add", line: 1, text: "one" },
			{ kind: "add", line: 2, text: "two" },
		]);
		expect(changePreview("write", args, undefined, "running")).toBeUndefined();
		expect(changePreview("write", { path: "xd://propose", content: "plan" }, {}, "done")).toBeUndefined();
	});

	it("shows nothing for a failed edit or a tool that does not change files", () => {
		expect(changePreview("edit", { path: "a.ts" }, { diff: "-1|a\n+1|b" }, "error")).toBeUndefined();
		expect(changePreview("read", { path: "a.ts" }, { diff: "-1|a" }, "done")).toBeUndefined();
	});
});
