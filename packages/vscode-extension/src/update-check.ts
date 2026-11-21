/**
 * Looks for a newer MarIA Code release than the installed extension: the latest
 * GitHub release of the repository names its extension version in its title
 * ("… + extensión VS Code 0.44.0") and in the first line of its notes.
 */

export const RELEASES_REPO = "javimp2003/MarIA-Code-Harness";
const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASES_REPO}/releases/latest`;
const REQUEST_TIMEOUT_MS = 10_000;

export interface ReleaseInfo {
	/** Git tag of the release (`v18.9.1-custom.52`). */
	tag: string;
	/** The extension version the release ships (`0.44.0`). */
	extensionVersion: string;
	url: string;
}

const EXTENSION_VERSION = /extensi[oó]n(?: de)? VS Code (\d+\.\d+\.\d+)/i;

/** The release in a GitHub release payload; undefined when it does not name an extension version. */
export function parseRelease(payload: unknown): ReleaseInfo | undefined {
	if (!payload || typeof payload !== "object") return undefined;
	const { tag_name: tag, html_url: url, name, body } = payload as Record<string, unknown>;
	if (typeof tag !== "string" || typeof url !== "string") return undefined;
	const version =
		(typeof name === "string" ? EXTENSION_VERSION.exec(name)?.[1] : undefined) ??
		(typeof body === "string" ? EXTENSION_VERSION.exec(body)?.[1] : undefined);
	return version ? { tag, extensionVersion: version, url } : undefined;
}

/** Whether `candidate` is a later `major.minor.patch` than `installed`. */
export function isNewerVersion(candidate: string, installed: string): boolean {
	const a = candidate.split(".").map(Number);
	const b = installed.split(".").map(Number);
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		const difference = (a[index] ?? 0) - (b[index] ?? 0);
		if (difference !== 0) return difference > 0;
	}
	return false;
}

/**
 * The latest release when it ships a later extension than `installed`, else
 * undefined. Throws when GitHub cannot be reached or answers with an error, or
 * when the latest release names no extension version.
 */
export async function findNewerRelease(
	installed: string,
	fetchJson: typeof fetch = fetch,
): Promise<ReleaseInfo | undefined> {
	const response = await fetchJson(LATEST_RELEASE_URL, {
		headers: { Accept: "application/vnd.github+json", "User-Agent": "maria-code-vscode" },
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
	});
	if (!response.ok) throw new Error(`GitHub answered ${response.status} for the latest release`);
	const release = parseRelease(await response.json());
	if (!release) throw new Error("the latest release does not name its VS Code extension version");
	return isNewerVersion(release.extensionVersion, installed) ? release : undefined;
}
