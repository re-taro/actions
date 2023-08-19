import { Buffer } from "node:buffer";
import {
  getInput,
  getState,
  info,
  setFailed,
  setOutput,
  setSecret,
} from "@actions/core";
import axios from "axios";
import isBase64 from "is-base64";
import { fetch } from "./fetch";

let token: string;

async function run(): Promise<void> {
  // eslint-disable-next-line no-extra-boolean-cast
  if (!!getState("isPost")) {
    gen();
  } else {
    post();
  }
}

async function gen(): Promise<void> {
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
      githubApiUrl,
      privateKey,
      repository,
    });

    token = installationToken;
    setSecret(installationToken);
    setOutput("token", installationToken);
    info("Token generated successfully!");
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

async function post(): Promise<void> {
  try {
    const GITHUB_API_URL = getInput("github_api_url");
    const headers = {
      Accept: "application/vnd.github+json",
      "X-GitHub-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
    };
    axios.delete(`${GITHUB_API_URL}/installation/token`, { headers });
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

run();
