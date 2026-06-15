import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, before, test } from "node:test";

const tempDir = await mkdtemp(path.join(tmpdir(), "mocker-test-"));
const rulesFile = path.join(tempDir, "rules.json");
process.env.RULES_FILE = rulesFile;

const { app } = await import("../server.js");

let server;
let baseUrl;

before(async () => {
  await writeFile(rulesFile, "[]");
  server = app.listen(0);
  await new Promise((resolve) => server.once("listening", resolve));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  await new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
  await rm(tempDir, { recursive: true, force: true });
});

test("saves a rule and serves it from the mock endpoint", async () => {
  const createResponse = await fetch(`${baseUrl}/api/rules`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      method: "GET",
      sourceUrl: "https://api.example.test/users/42",
      pathname: "/users/42",
      status: 202,
      body: { ok: true }
    })
  });

  assert.equal(createResponse.status, 201);

  const mockResponse = await fetch(`${baseUrl}/mock/users/42`);
  assert.equal(mockResponse.status, 202);
  assert.equal(mockResponse.headers.get("x-mocker-hit"), "true");
  assert.deepEqual(await mockResponse.json(), { ok: true });
});

test("does not use GET rules for non-GET requests", async () => {
  const response = await fetch(`${baseUrl}/mock/users/42`, { method: "POST" });

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), {
    error: "No mock rule found",
    method: "POST",
    path: "/users/42"
  });
});

test("returns a 400 for invalid proxy targets", async () => {
  const response = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent("file:///etc/passwd")}`);

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "Proxy target must use http or https." });
});

test("forwards non-GET proxy requests when only a GET rule exists", async () => {
  const upstream = app.listen(0);
  await new Promise((resolve) => upstream.once("listening", resolve));
  const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/upstream`;

  try {
    const createResponse = await fetch(`${baseUrl}/api/rules`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        method: "GET",
        sourceUrl: upstreamUrl,
        pathname: "/upstream",
        body: { mocked: true }
      })
    });
    assert.equal(createResponse.status, 201);

    const proxyResponse = await fetch(`${baseUrl}/proxy?url=${encodeURIComponent(upstreamUrl)}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ forwarded: true })
    });

    assert.equal(proxyResponse.status, 404);
    assert.equal(proxyResponse.headers.get("x-mocker-hit"), "false");
  } finally {
    await new Promise((resolve, reject) => {
      upstream.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
