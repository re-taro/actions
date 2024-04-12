import * as cp from "node:child_process";
import * as path from "node:path";
import * as process from "node:process";

import axios from "axios";
import { afterAll, beforeAll, expect, it } from "vitest";

beforeAll(() => {
	const np = process.execPath;
	const ip = path.join(__dirname, "..", "lib", "index.cjs");
	cp.spawnSync(np, [ip], { stdio: "inherit" });
});

it("works", async () => {
	const { data } = await axios.get("http://localhost:41230/");

	expect(data).toEqual({ ok: true });
});

it("can save and load", async () => {
	await axios.put(
		"http://localhost:41230/v8/artifacts/123",
		// eslint-disable-next-line node/prefer-global/buffer
		Buffer.from("meow"),
		{
			headers: {
				"Content-Type": "application/octet-stream",
			},
		},
	);
	const { data } = await axios.get("http://localhost:41230/v8/artifacts/123", {
		responseType: "arraybuffer",
	});

	// eslint-disable-next-line node/prefer-global/buffer
	expect(Buffer.from(data).toString()).toBe("meow");
});

afterAll(async () => {
	await axios.delete("http://localhost:41230/self");
});
