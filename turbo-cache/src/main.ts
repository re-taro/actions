import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  openSync,
  statSync,
} from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  debug,
  exportVariable as exportVariable$,
  getInput,
  info,
  setFailed,
} from "@actions/core";
import type { AxiosInstance } from "axios";
import axios from "axios";
import Fastify from "fastify";
import { Env } from "lazy-strict-env";
import waitOn from "wait-on";
import { z } from "zod";

const serverPort = 41_230;
const serverLogFile = "/tmp/turbogha.log";
const cacheVersion = "turbogha_v2";
const cachePrefix = getInput("cache-prefix") || "turbogha_";
const getCacheKey = (hash: string): string => `${cachePrefix}${hash}`;

const handleAxiosError =
  (message: string): ((err: any) => never) =>
  (err) => {
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

async function run(): Promise<void> {
  if (process.argv[2] === "--server") {
    return server();
  }
  if (process.argv[2] === "--self-test") {
    return saveCache(
      { log: console },
      "self-test",
      4,
      "",
      Readable.from([Buffer.from("meow")], { objectMode: false }),
    );
  }

  return launchServer();
}

async function launchServer(): Promise<void> {
  try {
    // Launch a detached child process to run the server
    // See: https://nodejs.org/docs/latest-v16.x/api/child_process.html#optionsdetacheda
    const out = openSync(serverLogFile, "a");
    const err = openSync(serverLogFile, "a");
    const child = spawn(
      parseArgv(process.argv[0]),
      [parseArgv(process.argv[1]), "--server"],
      {
        detached: true,
        stdio: ["ignore", out, err],
      },
    );
    child.unref();
    info(`Cache version: ${cacheVersion}`);
    info(`Cache prefix: ${cachePrefix}`);
    info(`Launched child process: ${child.pid}`);
    info(`Server log file: ${serverLogFile}`);

    await waitOn({
      resources: [`http-get://localhost:${serverPort}`],
      timeout: 10_000,
    });
    info("Server is now up and running.");

    info("The following environment variables are exported:");
    function exportVariable(name: string, value: string): void {
      exportVariable$(name, value);
      info(`  ${name}=${value}`);
    }
    exportVariable("TURBOGHA_PORT", `${serverPort}`);
    exportVariable("TURBO_API", `http://localhost:${serverPort}`);
    exportVariable("TURBO_TOKEN", "turbogha");
    exportVariable("TURBO_TEAM", "turbogha");
  } catch (error) {
    if (error instanceof Error) setFailed(error.message);
  }
}

async function server(): Promise<void> {
  const fastify = Fastify({
    logger: true,
  });

  fastify.get("/", async () => ({ ok: true }));

  fastify.delete("/self", async () => {
    setTimeout(() => process.exit(0), 100);

    return { ok: true };
  });

  fastify.addContentTypeParser(
    "application/octet-stream",
    (_req, _payload, done) => {
      done(null);
    },
  );

  fastify.put("/v8/artifacts/:hash", async (request) => {
    const hash = (request.params as { hash: string }).hash;
    request.log.info(`Received artifact for ${hash}`);
    await saveCache(
      request,
      hash,
      +(request.headers["content-length"] ?? 0),
      String(request.headers["x-artifact-tag"] ?? ""),
      request.raw,
    );

    return { ok: true };
  });

  fastify.get("/v8/artifacts/:hash", async (request, reply) => {
    const hash = (request.params as { hash: string }).hash;
    request.log.info(`Requested artifact for ${hash}`);
    const result = await getCache(request, hash);
    if (result === null) {
      reply.code(404);

      return { ok: false };
    }
    const [size, stream, artifactTag] = result;
    if (size) {
      reply.header("Content-Length", size);
    }
    reply.header("Content-Type", "application/octet-stream");
    if (artifactTag) {
      reply.header("x-artifact-tag", artifactTag);
    }

    return reply.send(stream);
  });
  await fastify.listen({ port: serverPort });
}

const env = Env(
  z.object({
    ACTIONS_RUNTIME_TOKEN: z.string(),
    ACTIONS_CACHE_URL: z.string(),
  }),
);

const getCacheClient = (): AxiosInstance =>
  axios.create({
    baseURL: `${env.ACTIONS_CACHE_URL.replace(/\/$/, "")}/_apis/artifactcache`,
    headers: {
      Authorization: `Bearer ${env.ACTIONS_RUNTIME_TOKEN}`,
      Accept: "application/json;api-version=6.0-preview.1",
    },
  });

interface RequestContext {
  log: {
    info: (message: string) => void;
  };
}

async function saveCache(
  ctx: RequestContext,
  hash: string,
  size: number,
  tag: string,
  stream: Readable,
): Promise<void> {
  if (!env.valid) {
    ctx.log.info(
      "Using filesystem cache because cache API env vars are not set",
    );
    await pipeline(stream, createWriteStream(`/tmp/${hash}.tg.bin`));

    return;
  }
  const client = getCacheClient();
  const { data } = await client
    .post("/caches", {
      key: getCacheKey(hash) + (tag ? `#${tag}` : ""),
      version: cacheVersion,
    })
    .catch(handleAxiosError("Unable to reserve cache"));
  const id = data.cacheId;
  if (!id) {
    throw new Error(
      `Unable to reserve cache (received: ${JSON.stringify(data)})`,
    );
  }
  ctx.log.info(`Reserved cache ${id}`);
  await client
    .patch(`/caches/${id}`, stream, {
      headers: {
        "Content-Length": size,
        "Content-Type": "application/octet-stream",
        "Content-Range": `bytes 0-${size - 1}/*`,
      },
    })
    .catch(handleAxiosError("Unable to upload cache"));
  await client
    .post(`/caches/${id}`, { size })
    .catch(handleAxiosError("Unable to commit cache"));
  ctx.log.info(`Saved cache ${id} for ${hash} (${size} bytes)`);
}

async function getCache(
  ctx: RequestContext,
  hash: string,
): Promise<[number | undefined, Readable, string | undefined] | null> {
  if (!env.valid) {
    const path = `/tmp/${hash}.tg.bin`;
    if (!existsSync(path)) return null;
    const size = statSync(path).size;

    return [size, createReadStream(path), undefined];
  }
  const client = getCacheClient();
  const cacheKey = getCacheKey(hash);
  const { data, status } = await client
    .get("/caches", {
      params: {
        keys: cacheKey,
        version: cacheVersion,
      },
      validateStatus: (s) => s < 500,
    })
    .catch(handleAxiosError("Unable to query cache"));
  ctx.log.info(`Cache lookup for ${cacheKey}: ${status}`);
  if (!data) {
    ctx.log.info("Cache lookup did not return data");

    return null;
  }
  const [foundCacheKey, artifactTag] = String(data.cacheKey).split("#");
  if (foundCacheKey !== cacheKey) {
    ctx.log.info(`Cache key mismatch: ${foundCacheKey} !== ${cacheKey}`);

    return null;
  }
  const resp = await axios.get(data.archiveLocation, {
    responseType: "stream",
  });
  const size = +(resp.headers["content-length"] || 0);

  return [size, resp.data, artifactTag];
}

run();

function parseArgv(arg: string | undefined) {
  if (!arg || typeof arg !== "string") {
    throw new Error("Argument is required");
  }

  return arg;
}
