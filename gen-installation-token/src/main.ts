import { Buffer } from "node:buffer";

import { getInput, info, setFailed, setOutput, setSecret } from "@actions/core";
import { getOctokit } from "@actions/github";
import { createAppAuth } from "@octokit/auth-app";
import { request } from "@octokit/request";
import isBase64 from "is-base64";

async function run(): Promise<void> {
  try {
    const appId = getInput("app_id", { required: true });
    const privateKeyInput = getInput("private_key", { required: true });
    const privateKey = isBase64(privateKeyInput)
      ? Buffer.from(privateKeyInput, "base64").toString("utf8")
      : privateKeyInput;
    const repository = getInput("repository");
    const githubApiUrlInput = getInput("github_api_url");
    const githubApiUrl = new URL(githubApiUrlInput);

    const installationToken = await fetch({
      appId,
      privateKey,
      githubApiUrl,
      repository,
    });

    setSecret(installationToken);
    setOutput("token", installationToken);
    info("Token generated successfully!");
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error.message);
    }
  }
}

async function fetch({
  appId,
  privateKey,
  githubApiUrl,
  repository,
}: Readonly<{
  appId: string;
  privateKey: string;
  githubApiUrl: URL;
  repository: string;
}>): Promise<string> {
  const app = createAppAuth({
    appId,
    privateKey,
    request: request.defaults({
      baseUrl: githubApiUrl
        .toString()
        // Remove optional trailing `/`.
        .replace(/\/$/, ""),
    }),
  });

  const authApp = await app({ type: "app" });
  const octokit = getOctokit(authApp.token);

  let installationId: number;
  const [owner, repo] = repository.split("/");

  if (!owner || !repo) {
    throw new Error("Invalid repository name.");
  }

  try {
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
}

run();
