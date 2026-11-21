/** The prompt that asks MarIA Code to update itself (update-prompt.md) from the popup that announces a newer release. */
import { compile } from "@oh-my-pi/pi-utils/prompt";
import template from "./update-prompt.md" with { type: "text" };
import { RELEASES_REPO, type ReleaseInfo } from "./update-check";

const render = compile(template.replace(/\n+$/, ""));

/** Where and how the extension is installed; the agent reads it to update the right copy. */
export interface InstallEnvironment {
	installedVersion: string;
	platform: string;
	arch: string;
	appName: string;
	codeCli: string;
	extensionPath: string;
	globalStoragePath: string;
}

export function updatePrompt(release: ReleaseInfo, environment: InstallEnvironment): string {
	return render({
		...environment,
		repo: RELEASES_REPO,
		tag: release.tag,
		latestVersion: release.extensionVersion,
		releaseUrl: release.url,
	});
}
