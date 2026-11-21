import { describe, expect, it } from "bun:test";
import { findNewerRelease, isNewerVersion, parseRelease } from "../src/update-check";

const release = {
	tag_name: "v18.9.1-custom.52",
	html_url: "https://github.com/javimp2003/MarIA-Code-Harness/releases/tag/v18.9.1-custom.52",
	name: "MarIA Code (omp 18.9.1 custom 52) + extensión VS Code 0.44.0",
	body: "**Extensión de VS Code 0.44.0**\n\n- cambios",
};

function answer(body: unknown, status = 200): typeof fetch {
	return (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
}

describe("parseRelease", () => {
	it("reads the extension version from the title, not the engine's", () => {
		expect(parseRelease(release)).toEqual({
			tag: "v18.9.1-custom.52",
			extensionVersion: "0.44.0",
			url: release.html_url,
		});
	});

	it("falls back to the notes' first line when the title does not name it", () => {
		expect(parseRelease({ ...release, name: "MarIA Code custom 52" })?.extensionVersion).toBe("0.44.0");
	});

	it("rejects a release that names no extension version", () => {
		expect(parseRelease({ ...release, name: "custom 52", body: "sin versión" })).toBeUndefined();
		expect(parseRelease({ message: "Not Found" })).toBeUndefined();
	});
});

describe("isNewerVersion", () => {
	it("compares numerically, not as text", () => {
		expect(isNewerVersion("0.44.0", "0.43.0")).toBe(true);
		expect(isNewerVersion("0.100.0", "0.99.9")).toBe(true);
		expect(isNewerVersion("1.0.0", "0.99.9")).toBe(true);
	});

	it("is false for the same or an older version", () => {
		expect(isNewerVersion("0.44.0", "0.44.0")).toBe(false);
		expect(isNewerVersion("0.43.0", "0.44.0")).toBe(false);
	});
});

describe("findNewerRelease", () => {
	it("offers the latest release when the installed extension is older", async () => {
		expect((await findNewerRelease("0.43.0", answer(release)))?.tag).toBe("v18.9.1-custom.52");
	});

	it("offers nothing when the installed extension is current or ahead", async () => {
		expect(await findNewerRelease("0.44.0", answer(release))).toBeUndefined();
		expect(await findNewerRelease("0.45.0", answer(release))).toBeUndefined();
	});

	it("surfaces a GitHub error instead of reporting no update", async () => {
		await expect(findNewerRelease("0.43.0", answer({ message: "rate limit" }, 403))).rejects.toThrow("403");
	});

	it("surfaces a latest release that cannot be compared", async () => {
		await expect(findNewerRelease("0.43.0", answer({ ...release, name: "x", body: "" }))).rejects.toThrow(
			"extension version",
		);
	});
});
