import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildApp } from '../src/app.js';
import { loadConfig } from '../src/platform/config.js';
import type { Container } from '../src/platform/container.js';
import type { Db } from '../src/db/client.js';
import { MockAuthProvider } from '../src/adapters/mocks.js';
import { ContextService } from '../src/modules/context/service.js';
import { InMemoryContextStore } from './helpers/context-store.js';

const config = loadConfig({ ...process.env, NODE_ENV: 'test', LOG_LEVEL: 'silent' } as NodeJS.ProcessEnv);

const WS = 'w1';
const REPO = '11111111-1111-4111-8111-111111111111';
const AGENT = '22222222-2222-4222-8222-222222222222';
const SKILL = '33333333-3333-4333-8333-333333333333';
const NO_CLONE_REPO = '44444444-4444-4444-8444-444444444444';
const FOREIGN_REPO = '55555555-5555-4555-8555-555555555555';
const MARKER = 'UNIQUE-DOC-MARKER-7731';

let clone: string;
let store: InMemoryContextStore;
let app: FastifyInstance;

async function put(rel: string, text: string): Promise<void> {
  const full = join(clone, ...rel.split('/'));
  await mkdir(join(full, '..'), { recursive: true });
  await writeFile(full, text);
}

async function makeApp(): Promise<FastifyInstance> {
  return buildApp({
    config,
    db: {} as Db,
    overrides: { auth: new MockAuthProvider(), contextStore: store },
  });
}

const url = (p: string) => `/repos/${REPO}${p}`;

beforeEach(async () => {
  clone = await realpath(await mkdtemp(join(tmpdir(), 'ctx-routes-')));
  await put('docs/spec.md', `# Spec\n${MARKER}\n`);
  await put('docs/other.md', '# Other\nnothing here\n');
  await put('specs/a.md', '# A\n');
  await put('notes/outside.md', '# Outside\n');
  store = new InMemoryContextStore();
  store.addRepo(WS, REPO, clone);
  store.addRepo(WS, NO_CLONE_REPO, null);
  store.addRepo('w2', FOREIGN_REPO, clone);
  store.addAgent(WS, AGENT);
  store.addSkill(WS, SKILL);
  app = await makeApp();
});

afterEach(async () => {
  await app.close();
  await rm(clone, { recursive: true, force: true });
});

describe('context roots', () => {
  it('AC-CTX-03 saved roots used by next list', async () => {
    const put1 = await app.inject({ method: 'PUT', url: url('/context/roots'), payload: { roots: ['notes'] } });
    expect(put1.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: url('/context') });
    expect(list.json().files.map((f: { path: string }) => f.path)).toEqual(['notes/outside.md']);
    await app.inject({ method: 'PUT', url: url('/context/roots'), payload: { roots: ['notes'] } });
    expect(store.roots.size).toBe(1);
  });

  it('AC-CTX-04 bad root 422 keeps previous', async () => {
    store.setRoots(WS, REPO, ['docs']);
    for (const bad of ['/etc', '../x', 'a\\b', 'C:/x']) {
      const res = await app.inject({ method: 'PUT', url: url('/context/roots'), payload: { roots: ['specs', bad] } });
      expect(res.statusCode).toBe(422);
    }
    expect(store.rootsSaves).toBe(0);
    const got = await app.inject({ method: 'GET', url: url('/context/roots') });
    expect(got.json()).toEqual({ roots: ['docs'] });
  });

  it('AC-CTX-49 11 roots 422 nothing stored', async () => {
    const roots = Array.from({ length: 11 }, (_, i) => `r${i}`);
    const res = await app.inject({ method: 'PUT', url: url('/context/roots'), payload: { roots } });
    expect(res.statusCode).toBe(422);
    expect(store.rootsSaves).toBe(0);
    expect(store.roots.size).toBe(0);
  });

  it('AC-CTX-02 defaults via API', async () => {
    const res = await app.inject({ method: 'GET', url: url('/context/roots') });
    expect(res.json()).toEqual({ roots: ['specs', 'docs', 'insights'] });
  });

  it('AC-CTX-13 list returns effective roots', async () => {
    const res = await app.inject({ method: 'GET', url: url('/context') });
    expect(res.json().roots).toEqual(['specs', 'docs', 'insights']);
    store.setRoots(WS, REPO, ['notes']);
    const res2 = await app.inject({ method: 'GET', url: url('/context') });
    expect(res2.json().roots).toEqual(['notes']);
  });

  it('AC-CTX-42 missing root 200', async () => {
    store.setRoots(WS, REPO, ['nope', 'docs']);
    const res = await app.inject({ method: 'GET', url: url('/context') });
    expect(res.statusCode).toBe(200);
    expect(res.json().files.map((f: { path: string }) => f.path)).toEqual(['docs/other.md', 'docs/spec.md']);
  });
});

describe('context list and preview', () => {
  it('AC-CTX-08 no content in list', async () => {
    const res = await app.inject({ method: 'GET', url: url('/context') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.files.length).toBe(3);
    for (const f of body.files) expect(Object.keys(f).sort()).toEqual(['path', 'size', 'updated_at']);
    expect(res.body).not.toContain(MARKER);
  });

  it('AC-CTX-09 q filters', async () => {
    const byContent = await app.inject({ method: 'GET', url: url(`/context?q=${MARKER.toLowerCase()}`) });
    expect(byContent.json().files.map((f: { path: string }) => f.path)).toEqual(['docs/spec.md']);
    const byPath = await app.inject({ method: 'GET', url: url('/context?q=OTHER') });
    expect(byPath.json().files.map((f: { path: string }) => f.path)).toEqual(['docs/other.md']);
  });

  it('AC-CTX-31 search on redacted text', async () => {
    await put('docs/secret.md', 'token AKIAABCDEFGHIJKLMNOP\n');
    const raw = await app.inject({ method: 'GET', url: url('/context?q=AKIAABCDEFGHIJKLMNOP') });
    expect(raw.json().files).toEqual([]);
    const red = await app.inject({ method: 'GET', url: url('/context?q=%5Bredacted%5D') });
    expect(red.json().files.map((f: { path: string }) => f.path)).toEqual(['docs/secret.md']);
  });

  it('AC-CTX-50 q>200 422', async () => {
    const res = await app.inject({ method: 'GET', url: url(`/context?q=${'a'.repeat(201)}`) });
    expect(res.statusCode).toBe(422);
    const ok = await app.inject({ method: 'GET', url: url(`/context?q=${'a'.repeat(200)}`) });
    expect(ok.statusCode).toBe(200);
  });

  it('AC-CTX-10 preview', async () => {
    const res = await app.inject({ method: 'GET', url: url('/context/file?path=./docs//spec.md') });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.path).toBe('docs/spec.md');
    expect(body.content).toContain(MARKER);
    expect(body.truncated).toBe(false);
    expect(typeof body.size).toBe('number');
  });

  it('AC-CTX-11 undiscovered 404 no read', async () => {
    const readDoc = vi.fn();
    const service = new ContextService({ contextStore: store } as unknown as Container, { readDoc });
    await expect(service.preview(WS, REPO, 'notes/outside.md')).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.preview(WS, REPO, 'docs/nope.md')).rejects.toMatchObject({ statusCode: 404 });
    expect(readDoc).not.toHaveBeenCalled();
    const res = await app.inject({ method: 'GET', url: url('/context/file?path=notes/outside.md') });
    expect(res.statusCode).toBe(404);
  });

  it('AC-CTX-39 409 not cloned', async () => {
    const list = await app.inject({ method: 'GET', url: `/repos/${NO_CLONE_REPO}/context` });
    expect(list.statusCode).toBe(409);
    expect(list.json().error.code).toBe('REPO_NOT_CLONED');
    const file = await app.inject({ method: 'GET', url: `/repos/${NO_CLONE_REPO}/context/file?path=docs/a.md` });
    expect(file.statusCode).toBe(409);
  });

  it('AC-CTX-76 malformed 422 no read', async () => {
    const readDoc = vi.fn();
    const walk = vi.fn();
    const service = new ContextService({ contextStore: store } as unknown as Container, { readDoc, walk });
    for (const bad of ['/etc/passwd', '../x.md', 'docs\\a.md', 'C:/a.md', 'docs/\u0000.md', '']) {
      await expect(service.preview(WS, REPO, bad)).rejects.toMatchObject({ statusCode: 422 });
    }
    expect(readDoc).not.toHaveBeenCalled();
    expect(walk).not.toHaveBeenCalled();
    const res = await app.inject({ method: 'GET', url: url('/context/file?path=../x.md') });
    expect(res.statusCode).toBe(422);
  });

  it('AC-CTX-51 no write/reindex route', async () => {
    const probes: [string, string][] = [
      ['POST', url('/context')],
      ['PUT', url('/context')],
      ['PATCH', url('/context')],
      ['DELETE', url('/context')],
      ['POST', url('/context/reindex')],
      ['POST', url('/context/file')],
      ['PUT', url('/context/file')],
      ['DELETE', url('/context/file')],
    ];
    for (const [method, u] of probes) {
      const res = await app.inject({ method: method as 'POST', url: u, payload: {} });
      expect(res.statusCode, `${method} ${u}`).toBe(404);
    }
  });

  it('AC-CTX-30 foreign workspace 404 (unit)', async () => {
    const service = new ContextService({ contextStore: store } as unknown as Container);
    await expect(service.getRoots(WS, FOREIGN_REPO)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.list(WS, FOREIGN_REPO)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.attach('w2', 'agent', AGENT, FOREIGN_REPO, 'docs/spec.md')).rejects.toMatchObject({
      statusCode: 404,
    });
    const res = await app.inject({ method: 'GET', url: `/repos/${FOREIGN_REPO}/context` });
    expect(res.statusCode).toBe(404);
  });

  it('503 CONTEXT_UNAVAILABLE for a null store (TA11)', async () => {
    // T6b: the container now falls back to the Drizzle repository, so only a
    // service built on a null store reaches this path.
    const service = new ContextService({ contextStore: null } as unknown as Container);
    await expect(service.getRoots(WS, REPO)).rejects.toMatchObject({
      statusCode: 503,
      code: 'CONTEXT_UNAVAILABLE',
    });
  });
});

describe('context attachments', () => {
  const docs = (prefix: string, id: string, repo = REPO) => `/${prefix}/${id}/context-docs?repo_id=${repo}`;
  const attach = (path: string, prefix = 'agents', id = AGENT) =>
    app.inject({ method: 'POST', url: docs(prefix, id), payload: { path } });

  it('AC-CTX-14 attach agent', async () => {
    const res = await attach('docs/spec.md');
    expect(res.statusCode).toBe(201);
    expect(res.json()).toMatchObject({ repo_id: REPO, path: 'docs/spec.md', order: 0, status: 'ok' });
    const list = await app.inject({ method: 'GET', url: docs('agents', AGENT) });
    expect(list.json().map((a: { path: string }) => a.path)).toEqual(['docs/spec.md']);
  });

  it('AC-CTX-55 attach skill', async () => {
    const res = await attach('docs/spec.md', 'skills', SKILL);
    expect(res.statusCode).toBe(201);
    const list = await app.inject({ method: 'GET', url: docs('skills', SKILL) });
    expect(list.json()).toHaveLength(1);
    const agentList = await app.inject({ method: 'GET', url: docs('agents', AGENT) });
    expect(agentList.json()).toEqual([]);
  });

  it('AC-CTX-15 detach one row', async () => {
    const a = (await attach('docs/spec.md')).json();
    await attach('docs/other.md');
    const del = await app.inject({ method: 'DELETE', url: `/agents/${AGENT}/context-docs/${a.id}` });
    expect(del.statusCode).toBe(200);
    const list = await app.inject({ method: 'GET', url: docs('agents', AGENT) });
    expect(list.json().map((x: { path: string }) => x.path)).toEqual(['docs/other.md']);
    const again = await app.inject({ method: 'DELETE', url: `/agents/${AGENT}/context-docs/${a.id}` });
    expect(again.statusCode).toBe(404);
  });

  it('AC-CTX-57 stored normalized', async () => {
    const res = await attach('./docs//spec.md');
    expect(res.statusCode).toBe(201);
    expect(res.json().path).toBe('docs/spec.md');
    expect(store.rows[0]!.path).toBe('docs/spec.md');
    expect((await attach('Docs/spec.md')).statusCode).toBe(422);
  });

  it('AC-CTX-58 re-attach idempotent', async () => {
    const first = await attach('docs/spec.md');
    const second = await attach('docs/spec.md');
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(200);
    expect(second.json().id).toBe(first.json().id);
    expect(store.rows).toHaveLength(1);
  });

  it('AC-CTX-17 undiscovered 422', async () => {
    const outside = await attach('notes/outside.md');
    expect(outside.statusCode).toBe(422);
    const gone = await attach('docs/gone.md');
    expect(gone.statusCode).toBe(422);
    const bad = await attach('../x.md');
    expect(bad.statusCode).toBe(422);
    expect(store.rows).toHaveLength(0);
    const uncloned = await app.inject({
      method: 'POST',
      url: docs('agents', AGENT, NO_CLONE_REPO),
      payload: { path: 'docs/spec.md' },
    });
    expect(uncloned.statusCode).toBe(422);
    expect(uncloned.json().error.details.reason).toBe('repo not cloned');
  });

  it('AC-CTX-18 11th 422', async () => {
    for (let i = 0; i < 10; i++) await put(`docs/n${i}.md`, `# ${i}\n`);
    for (let i = 0; i < 10; i++) expect((await attach(`docs/n${i}.md`)).statusCode).toBe(201);
    const eleventh = await attach('docs/spec.md');
    expect(eleventh.statusCode).toBe(422);
    expect(store.rows).toHaveLength(10);
    // re-attaching an existing one is still idempotent at the limit
    expect((await attach('docs/n0.md')).statusCode).toBe(200);
    // the limit is per owner
    expect((await attach('docs/spec.md', 'skills', SKILL)).statusCode).toBe(201);
  });

  it('AC-CTX-61 attach reads no content', async () => {
    const readDoc = vi.fn();
    const service = new ContextService({ contextStore: store } as unknown as Container, { readDoc });
    await service.attach(WS, 'agent', AGENT, REPO, 'docs/spec.md');
    expect(readDoc).not.toHaveBeenCalled();
  });

  it('AC-CTX-69 store write shape ids+path+order', async () => {
    await attach('docs/spec.md');
    await attach('docs/other.md');
    expect(store.inserts[0]).toEqual({
      workspaceId: WS,
      owner: 'agent',
      ownerId: AGENT,
      repoId: REPO,
      path: 'docs/spec.md',
    });
    expect(store.rows.map((r) => r.order)).toEqual([0, 1]);
    expect(JSON.stringify(store.rows)).not.toContain(MARKER);
  });

  it('AC-CTX-43 AC-CTX-60 status outside_roots/missing', async () => {
    await attach('docs/spec.md');
    await attach('docs/other.md');
    await rm(join(clone, 'docs', 'other.md'));
    let list = (await app.inject({ method: 'GET', url: docs('agents', AGENT) })).json();
    expect(list.map((a: { path: string; status: string }) => [a.path, a.status])).toEqual([
      ['docs/spec.md', 'ok'],
      ['docs/other.md', 'missing'],
    ]);
    store.setRoots(WS, REPO, ['specs']);
    list = (await app.inject({ method: 'GET', url: docs('agents', AGENT) })).json();
    expect(list.map((a: { status: string }) => a.status)).toEqual(['outside_roots', 'outside_roots']);
  });

  it('AC-CTX-30 foreign workspace 404 (unit)', async () => {
    const service = new ContextService({ contextStore: store } as unknown as Container);
    await expect(service.listAttachments('w2', 'agent', AGENT, REPO)).rejects.toMatchObject({ statusCode: 404 });
    await expect(service.attach(WS, 'agent', AGENT, FOREIGN_REPO, 'docs/spec.md')).rejects.toMatchObject({
      statusCode: 404,
    });
    const created = await service.attach(WS, 'agent', AGENT, REPO, 'docs/spec.md');
    await expect(service.detach('w2', 'agent', AGENT, created.attachment.id)).rejects.toMatchObject({
      statusCode: 404,
    });
    expect(store.rows).toHaveLength(1);
  });
});
