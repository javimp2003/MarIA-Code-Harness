/**
 * Search the final answers in a session file.
 *
 * Each file is read whole once and kept as folded text (see search-text.ts)
 * until it changes on disk (size or mtime), so typing a query costs a scan of
 * memory, not of the disk. Every term of the query must appear somewhere in a
 * session's answers. A term found in no answer also matches words one or two
 * edits away from it.
 */
import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { SessionSearchHit } from "../protocol";
import { finalAnswerBlocks, foldText, parseQuery, termRanges } from "../search-text";
import type { SessionLine } from "./session-store";

interface Segment {
	text: string;
	folded: string;
}

interface SessionDoc {
	segments: Segment[];
	/** Distinct folded words, built the first time a fuzzy term needs them. */
	words?: Set<string>;
}

interface CacheEntry {
	size: number;
	mtimeMs: number;
	doc: Promise<SessionDoc>;
}

/** Characters of context kept before the first match of a snippet, and its whole length. */
const SNIPPET_BEFORE = 24;
const SNIPPET_LENGTH = 180;
/** Fuzzy matching only for terms at least this long (shorter ones match too much). */
const FUZZY_MIN_LENGTH = 4;
const WORD = /[\p{L}\p{N}_]{3,40}/gu;
/** The index is dropped this long after the last search (reading it again takes a fraction of a second). */
const IDLE_DROP_MS = 5 * 60 * 1000;

export class SessionSearch {
	#cache = new Map<string, CacheEntry>();
	#idle: NodeJS.Timeout | undefined;

	/**
	 * Sessions of `dirs` whose final answers contain every term of `query`, best
	 * first, with a snippet of the answer text where most terms were found.
	 */
	async search(dirs: readonly string[], query: string): Promise<SessionSearchHit[]> {
		const terms = parseQuery(query);
		if (terms.length === 0) return [];
		const docs = await this.#load(dirs);
		clearTimeout(this.#idle);
		this.#idle = setTimeout(() => this.#cache.clear(), IDLE_DROP_MS);
		this.#idle.unref?.();
		const exact = new Set(
			terms.filter(term => docs.some(([, doc]) => doc.segments.some(s => s.folded.includes(term)))),
		);
		const hits: SessionSearchHit[] = [];
		for (const [file, doc] of docs) {
			// Per term: the folded strings that count as it in this session.
			const variants: string[][] = [];
			for (const term of terms) {
				if (exact.has(term)) variants.push(doc.segments.some(s => s.folded.includes(term)) ? [term] : []);
				else variants.push(fuzzyWords(doc, term));
			}
			if (variants.some(found => found.length === 0)) continue;
			hits.push(
				scoreSession(
					file,
					doc,
					terms,
					variants,
					terms.some(term => !exact.has(term)),
				),
			);
		}
		return hits.sort((a, b) => b.score - a.score);
	}

	/** Documents of every session file in `dirs`, read again when they changed; forgets files that are gone. */
	async #load(dirs: readonly string[]): Promise<[string, SessionDoc][]> {
		const files = (
			await Promise.all(
				[...new Set(dirs)].map(async dir => {
					const names = await fs.readdir(dir).catch(() => [] as string[]);
					return names.filter(name => name.endsWith(".jsonl")).map(name => path.join(dir, name));
				}),
			)
		).flat();
		const listed = new Set(files);
		for (const file of this.#cache.keys()) {
			if (!listed.has(file) && dirs.includes(path.dirname(file))) this.#cache.delete(file);
		}
		const docs = await Promise.all(
			files.map(async (file): Promise<[string, SessionDoc] | undefined> => {
				const stat = await fs.stat(file).catch(() => undefined);
				if (!stat) {
					this.#cache.delete(file);
					return undefined;
				}
				let entry = this.#cache.get(file);
				if (!entry || entry.size !== stat.size || entry.mtimeMs !== stat.mtimeMs) {
					entry = { size: stat.size, mtimeMs: stat.mtimeMs, doc: readDoc(file) };
					this.#cache.set(file, entry);
				}
				try {
					return [file, await entry.doc];
				} catch {
					// Unreadable now (deleted or locked mid-read): try again on the next search.
					this.#cache.delete(file);
					return undefined;
				}
			}),
		);
		return docs.filter(doc => doc !== undefined);
	}
}

/** Final answer blocks of one session file, in file order. */
async function readDoc(file: string): Promise<SessionDoc> {
	const segments: Segment[] = [];
	for (const line of (await fs.readFile(file, "utf8")).split("\n")) {
		if (!line.trim()) continue;
		let entry: SessionLine | null;
		try {
			entry = JSON.parse(line);
		} catch {
			// A line still being written by a running session; the next read gets it whole.
			continue;
		}
		if (entry?.type !== "message" || entry.message?.role !== "assistant") continue;
		for (const block of finalAnswerBlocks(entry.message)) {
			const text = block.text.trim();
			if (text) segments.push({ text, folded: foldText(text) });
		}
	}
	return { segments };
}

/** Words of the session one or two edits away from `term` (none for phrases and short terms). */
function fuzzyWords(doc: SessionDoc, term: string): string[] {
	if (term.length < FUZZY_MIN_LENGTH || term.includes(" ")) return [];
	if (!doc.words) {
		doc.words = new Set();
		for (const segment of doc.segments) for (const [word] of segment.folded.matchAll(WORD)) doc.words.add(word);
	}
	const limit = term.length >= 8 ? 2 : 1;
	const found: string[] = [];
	for (const word of doc.words) {
		if (Math.abs(word.length - term.length) <= limit && editDistance(term, word, limit) <= limit) found.push(word);
	}
	return found;
}

/**
 * Optimal-string-alignment distance between `a` and `b` (insertions, deletions,
 * substitutions and swaps of neighbours), or `limit + 1` once it must exceed `limit`.
 */
function editDistance(a: string, b: string, limit: number): number {
	let before: number[] = Array.from({ length: b.length + 1 }, () => 0);
	let previous = Array.from({ length: b.length + 1 }, (_, index) => index);
	for (let i = 1; i <= a.length; i++) {
		const current = [i];
		let best = i;
		for (let j = 1; j <= b.length; j++) {
			const cost = a[i - 1] === b[j - 1] ? 0 : 1;
			let value = Math.min(previous[j]! + 1, current[j - 1]! + 1, previous[j - 1]! + cost);
			if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1])
				value = Math.min(value, before[j - 2]! + 1);
			current.push(value);
			best = Math.min(best, value);
		}
		if (best > limit) return limit + 1;
		before = previous;
		previous = current;
	}
	return previous[b.length]!;
}

/**
 * Score of a matching session, how many blocks matched, and a snippet from
 * the block holding the most terms.
 */
function scoreSession(
	file: string,
	doc: SessionDoc,
	terms: readonly string[],
	variants: readonly string[][],
	fuzzy: boolean,
): SessionSearchHit {
	const all = variants.flat();
	const phrase = terms.join(" ");
	const exactPhrase = terms.length > 1 && doc.segments.some(segment => segment.folded.includes(phrase));
	let count = 0;
	let snippetSegment: Segment | undefined;
	let snippetRank = -1;
	for (const segment of doc.segments) {
		const present = variants.filter(found => found.some(variant => segment.folded.includes(variant))).length;
		if (present === 0) continue;
		count++;
		if (present > snippetRank) {
			snippetRank = present;
			snippetSegment = segment;
		}
	}
	return {
		path: file,
		score: Number(exactPhrase),
		count,
		fuzzy,
		snippet: snippetSegment && snippet(snippetSegment, all),
	};
}

/**
 * A window of the segment around its first match, with runs of whitespace
 * collapsed and `…` where it was cut; `ranges` are the matches inside it.
 */
function snippet(segment: Segment, terms: readonly string[]): SessionSearchHit["snippet"] {
	const matches = termRanges(segment.folded, terms);
	const first = matches[0]?.[0] ?? 0;
	let start = Math.max(0, first - SNIPPET_BEFORE);
	// Start at a word boundary when one is near.
	if (start > 0) {
		const space = segment.text.indexOf(" ", start);
		if (space >= 0 && space < first) start = space + 1;
	}
	const end = Math.min(segment.text.length, start + SNIPPET_LENGTH);
	let text = start > 0 ? "…" : "";
	const ranges: [number, number][] = [];
	let range = 0;
	let open: number | undefined;
	let lastSpace = false;
	for (let index = start; index < end; index++) {
		while (range < matches.length && matches[range]![1] <= index) range++;
		const inMatch = range < matches.length && matches[range]![0] <= index;
		if (open !== undefined && !inMatch) {
			ranges.push([open, text.length]);
			open = undefined;
		}
		const char = segment.text[index]!;
		const space = /\s/.test(char);
		if (space && lastSpace && !inMatch) continue;
		if (inMatch && open === undefined) open = text.length;
		text += space ? " " : char;
		lastSpace = space;
	}
	if (open !== undefined) ranges.push([open, text.length]);
	if (end < segment.text.length) text += "…";
	return { text, ranges };
}

/** One search index for the whole extension host: every chat view shares what was read. */
export const sessionSearch = new SessionSearch();
