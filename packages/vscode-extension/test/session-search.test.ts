import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { SessionSearch } from "../src/sessions/session-search";

const dirs: string[] = [];

afterEach(async () => {
	await Promise.all(dirs.splice(0).map(dir => fs.rm(dir, { recursive: true, force: true })));
});

async function tempDir(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-vscode-search-"));
	dirs.push(dir);
	return dir;
}

const user = (text: string) => ({ type: "message", message: { role: "user", content: [{ type: "text", text }] } });
const assistant = (stopReason: string | undefined, ...content: unknown[]) => ({
	type: "message",
	message: { role: "assistant", stopReason, content },
});
const toolResult = (text: string) => ({
	type: "message",
	message: { role: "toolResult", toolName: "bash", content: [{ type: "text", text }] },
});

async function writeSession(dir: string, name: string, entries: unknown[]): Promise<string> {
	const file = path.join(dir, `${name}.jsonl`);
	const lines = [{ type: "title", title: "" }, { type: "session", id: name }, ...entries];
	await fs.writeFile(file, `${lines.map(line => JSON.stringify(line)).join("\n")}\n`);
	return file;
}

describe("session search", () => {
	it("finds a final answer but ignores metadata, prompts, reasoning, tool activity and summaries", async () => {
		const dir = await tempDir();
		const file = await writeSession(dir, "a", [
			{ type: "title_change", title: "despliegue" },
			user("revisa kubernetes"),
			assistant(
				"toolUse",
				{ type: "text", text: "Comprobaré el contenedor" },
				{ type: "toolCall", name: "bash", arguments: { command: "kubectl get pods -n pagos" } },
			),
			toolResult("Error: ImagePullBackOff for registry.unicaja/api:1.4"),
			{ type: "compaction", summary: "La incidencia fue escalada" },
			assistant(
				"stop",
				{ type: "thinking", thinking: "maybe the readiness probe" },
				{ type: "text", text: "El pod falla al descargar la imagen" },
			),
		]);
		const search = new SessionSearch();

		const hits = await search.search([dir], "descargar");
		expect(hits.map(hit => hit.path)).toEqual([file]);
		const snippet = hits[0]!.snippet!;
		expect(snippet.text.slice(...snippet.ranges[0]!)).toBe("descargar");
		for (const query of [
			"despliegue",
			"kubernetes",
			"contenedor",
			"pagos",
			"ImagePullBackOff",
			"escalada",
			"readiness",
		]) {
			expect(await search.search([dir], query)).toEqual([]);
		}
	});

	it("excludes progress text and incomplete turns from the results", async () => {
		const dir = await tempDir();
		const paused = assistant("stop", { type: "text", text: "analizando" });
		const file = await writeSession(dir, "a", [
			{ ...paused, message: { ...paused.message, stopDetails: { type: "pause_turn" } } },
			assistant("aborted", { type: "text", text: "interrumpido" }),
			assistant("stop", { type: "text", text: "investigación" }, { type: "toolCall", name: "bash", arguments: {} }),
			assistant(
				"stop",
				{ type: "text", text: "revisando", textSignature: '{"v":1,"id":"msg_1","phase":"commentary"}' },
				{ type: "text", text: "resuelto", textSignature: '{"v":1,"id":"msg_2","phase":"final_answer"}' },
			),
		]);
		const search = new SessionSearch();

		expect((await search.search([dir], "resuelto")).map(hit => hit.path)).toEqual([file]);
		for (const query of ["analizando", "interrumpido", "investigación", "revisando"]) {
			expect(await search.search([dir], query)).toEqual([]);
		}
	});

	it("ignores case and accents and finds terms across final answers, including legacy replies", async () => {
		const dir = await tempDir();
		const file = await writeSession(dir, "a", [
			assistant(undefined, { type: "text", text: "Falla la canción" }),
			assistant("stop", { type: "text", text: "Revisa el Códec de audio" }),
		]);
		await writeSession(dir, "b", [assistant("stop", { type: "text", text: "cancion sin más" })]);
		const search = new SessionSearch();

		expect((await search.search([dir], "CANCION codec")).map(hit => hit.path)).toEqual([file]);
		const [hit] = await search.search([dir], "codec");
		// The snippet keeps the original text; the range marks the accented word.
		expect(hit!.snippet!.text.slice(...hit!.snippet!.ranges[0]!)).toBe("Códec");
	});

	it("matches words one edit away only for terms no final answer contains as typed", async () => {
		const dir = await tempDir();
		const file = await writeSession(dir, "a", [
			user("kubernetis"),
			assistant("stop", { type: "text", text: "configura el kubernetes ingress" }),
		]);
		await writeSession(dir, "b", [assistant("stop", { type: "text", text: "el ingres de la semana" })]);
		const search = new SessionSearch();

		const typo = await search.search([dir], "kubernetis");
		expect(typo.map(hit => hit.path)).toEqual([file]);
		expect(typo[0]!.fuzzy).toBe(true);
		// "ingress" exists as typed, so "ingres" does not widen to it (and vice versa).
		expect((await search.search([dir], "ingress")).map(hit => hit.path)).toEqual([file]);
	});

	it("ranks a session that has the full phrase above one that has the terms in different answers", async () => {
		const dir = await tempDir();
		const split = await writeSession(dir, "a", [
			assistant("stop", { type: "text", text: "Clear the cache" }),
			assistant("stop", { type: "text", text: "Retry after a timeout" }),
		]);
		const phrase = await writeSession(dir, "b", [assistant("stop", { type: "text", text: "Fix the cache timeout" })]);
		const hits = await new SessionSearch().search([dir], "cache timeout");

		expect(hits.map(hit => hit.path)).toEqual([phrase, split]);
	});

	it("sees what a running session appended since the last search", async () => {
		const dir = await tempDir();
		const file = await writeSession(dir, "a", [user("primera pregunta")]);
		const search = new SessionSearch();
		expect(await search.search([dir], "zanahoria")).toEqual([]);

		await fs.appendFile(file, `${JSON.stringify(assistant("stop", { type: "text", text: "una zanahoria" }))}\n`);

		expect((await search.search([dir], "zanahoria")).map(hit => hit.path)).toEqual([file]);
	});
});
