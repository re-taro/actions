import { createSign } from "crypto";
import {
  debug,
  getInput,
  getState,
  info,
  setFailed,
  setOutput,
  setSecret,
} from "@actions/core";
import axios from "axios";
import type { AxiosInstance } from "axios";

const APP_ID = getInput("app_id", { required: true });
const PRIVATE_KEY = getInput("private_key", { required: true });
const GITHUB_API_URL = getInput("github_api_url");
const GITHUB_REPOSITORY = getInput("repository");

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
    const now = Math.floor(Date.now() / 1000);
    const iat = now - 60;
    const exp = now + 3 * 60;
    const header = getJwtHeader();
    const payload = JSON.stringify({ iss: APP_ID, iat, exp });
    const jwt = `${header}.${base64url(Buffer.from(payload))}.${await sign(
      `${header}.${payload}`,
      PRIVATE_KEY,
    )}`;
    setSecret(payload);
    setSecret(jwt);
    const installationId = await getInstallationId(jwt, GITHUB_REPOSITORY);
    const accessToken = await getAccessToken(
      jwt,
      installationId,
      GITHUB_REPOSITORY,
    );
    setSecret(accessToken);
    setOutput("token", accessToken);
    token = accessToken;
    info("Token generated successfully.");
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

async function post(): Promise<void> {
  try {
    const headers = {
      Accept: "application/vnd.github+json",
      "X-Github-Api-Version": "2022-11-28",
      Authorization: `Bearer ${token}`,
    };
    axios.delete(`${GITHUB_API_URL}/installation/token`, { headers });
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

function getGithubClient(jwt: string): AxiosInstance {
  return axios.create({
    baseURL: GITHUB_API_URL,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${jwt}`,
      "X-Github-Api-Version": "2022-11-28",
    },
  });
}

async function getAccessToken(
  jwt: string,
  installationId: number,
  repository: string,
): Promise<string> {
  const requestBody = {
    repositories: [repository],
  };
  const client = getGithubClient(jwt);
  const { data } = await client
    .post(`/app/installations/${installationId}/access_tokens`, requestBody)
    .catch(handleAxiosError("Unable to get access token"));

  if (!data) {
    info(`Unable to get access token.`);
  }

  return data.token;
}

async function getInstallationId(
  jwt: string,
  repository: string,
): Promise<number> {
  const client = getGithubClient(jwt);
  const { data } = await client
    .get(`/repos/${repository}/installation`)
    .catch(handleAxiosError("Unable to get installation ID"));

  if (!data) {
    info(`Unable to get installation ID.`);
  }

  return data.id;
}

function getJwtHeader(): string {
  const header = {
    alg: "RS256",
    typ: "JWT",
  };

  return base64url(Buffer.from(JSON.stringify(header)));
}

async function sign(data: string, privateKey: string): Promise<string> {
  const sign = createSign("RSA-SHA256");
  sign.update(data);
  const privateKeyBuffer = Buffer.from(privateKey, "utf-8");
  const signature = sign.sign(privateKeyBuffer);

  return base64url(signature);
}

function base64url(input: Buffer): string {
  return (
    input
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      // eslint-disable-next-line redos/no-vulnerable
      .replace(/=+$/, "")
  );
}

run();

function handleAxiosError(message: string): (err: any) => never {
  return (err) => {
    if (err.response) {
      const data = JSON.stringify(err.response.data);
      debug(
        `Response status ${err.response.status}: ${err.response.statusText}`,
      );
      debug(`Response headers: ${JSON.stringify(err.response.headers)}`);
      debug(`Response data: ${data}`);
      throw new Error(`${message}: ${err.message}`, { cause: err });
    }
    throw err;
  };
}
