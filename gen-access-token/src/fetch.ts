import { getOctokit } from "@actions/github";
import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";

export const fetch = async ({
  appId,
  githubApiUrl,
  privateKey,
  repository,
}: Readonly<{
  appId: string;
  githubApiUrl: URL;
  privateKey: string;
  repository: string;
}>): Promise<string> => {
  const app = createAppAuth({
    appId,
    privateKey,
    request: request.defaults({
      baseUrl: githubApiUrl.toString().replace(/\/$/, ""),
    }),
  });

  const authApp = await app({ type: "app" });
  const octokit = getOctokit(authApp.token);

  let installationId: number;

  const [owner, repo] = repository.split("/");

  try {
    if (!owner || !repo) {
      throw new Error("Invalid repository.");
    }
    ({
      data: { id: installationId },
    } = await octokit.rest.apps.getRepoInstallation({ owner, repo }));
  } catch (error: unknown) {
    throw new Error(
      "Could not get repo installation. Is the app installed on this repo?",
      { cause: error },
    );
  }

  try {
    const { data: installation } =
      await octokit.rest.apps.createInstallationAccessToken({
        installation_id: installationId,
      });
    return installation.token;
  } catch (error: unknown) {
    throw new Error("Could not create installation access token.", {
      cause: error,
    });
  }
};
