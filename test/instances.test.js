// test/instances.test.js — lib/instances.js 순수 함수 단위 테스트 (node --test)
'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');

const {
  makeInstanceConfig, normalizeServers, findServerConflicts, flatToServerEntry,
} = require('../lib/instances');

const WS = path.join('/ws');

// ── makeInstanceConfig ──────────────────────────────────────
test('포트 미지정 시 HTTP 포트 기준 자동 파생', () => {
  const c = makeInstanceConfig({ name: 'a', port: 8080 }, {}, WS);
  assert.equal(c.debugPort, 5005);
  assert.equal(c.redirectPort, 8443);
});

test('오프셋 포트 파생 (port 8081 → debug 5006, redirect 8444)', () => {
  const c = makeInstanceConfig({ name: 'b', port: 8081 }, {}, WS);
  assert.equal(c.debugPort, 5006);
  assert.equal(c.redirectPort, 8444);
});

test('명시한 debug/redirect 포트는 그대로 사용', () => {
  const c = makeInstanceConfig({ name: 'c', port: 9000, debugPort: 6000, redirectPort: 9443 }, {}, WS);
  assert.equal(c.debugPort, 6000);
  assert.equal(c.redirectPort, 9443);
});

test('javaHome/catalinaHome/javaOpts 미지정 시 공통값 폴백', () => {
  const common = { catalinaHome: '/opt/tomcat', javaHome: '/opt/jdk', javaOpts: '-Xmx1g' };
  const c = makeInstanceConfig({ name: 'a', port: 8080 }, common, WS);
  assert.equal(c.catalinaHome, '/opt/tomcat');
  assert.equal(c.javaHome, '/opt/jdk');
  assert.equal(c.javaOpts, '-Xmx1g');
});

test('인스턴스 오버라이드가 공통값을 이긴다', () => {
  const common = { catalinaHome: '/opt/tomcat9', javaHome: '/opt/jdk8' };
  const c = makeInstanceConfig({ name: 'a', port: 8080, catalinaHome: '/opt/tomcat10', javaHome: '/opt/jdk17' }, common, WS);
  assert.equal(c.catalinaHome, '/opt/tomcat10');
  assert.equal(c.javaHome, '/opt/jdk17');
});

test('catalinaBase/confDir 는 인스턴스별, warDir(docBase) 는 공유 단일 경로', () => {
  const c = makeInstanceConfig({ name: 'prod', port: 8080 }, { contextPath: '/' }, WS);
  assert.equal(c.catalinaBase, path.join(WS, '.vscode', 'tomcat', 'prod'));
  assert.equal(c.confDir, path.join(WS, '.vscode', 'tomcat', 'prod', 'conf'));
  // docBase 는 인스턴스 이름과 무관하게 공유
  assert.equal(c.warDir, path.join(WS, '.vscode', 'tomcat', 'webapp', 'ROOT'));
});

test('warDir(docBase)는 인스턴스가 달라도 동일 (공유)', () => {
  const a = makeInstanceConfig({ name: 'a', port: 8080 }, { contextPath: '/' }, WS);
  const b = makeInstanceConfig({ name: 'b', port: 8081 }, { contextPath: '/' }, WS);
  assert.equal(a.warDir, b.warDir);
});

test('contextPath /myapp → warDir webapp/myapp', () => {
  const c = makeInstanceConfig({ name: 'a', port: 8080 }, { contextPath: '/myapp' }, WS);
  assert.equal(c.warDir, path.join(WS, '.vscode', 'tomcat', 'webapp', 'myapp'));
});

// ── normalizeServers ────────────────────────────────────────
test('빈 배열 → default 1개로 폴백', () => {
  assert.deepEqual(normalizeServers([]), [{ name: 'default', port: 8080 }]);
});

test('비배열 → default 폴백', () => {
  assert.deepEqual(normalizeServers(undefined), [{ name: 'default', port: 8080 }]);
});

test('값이 있으면 그대로 반환', () => {
  const s = [{ name: 'a', port: 8080 }, { name: 'b', port: 8081 }];
  assert.equal(normalizeServers(s), s);
});

// ── findServerConflicts ─────────────────────────────────────
test('충돌 없으면 빈 배열', () => {
  const w = findServerConflicts([{ name: 'a', port: 8080 }, { name: 'b', port: 8081 }], {}, WS);
  assert.deepEqual(w, []);
});

test('이름 중복 감지', () => {
  const w = findServerConflicts([{ name: 'a', port: 8080 }, { name: 'a', port: 8081 }], {}, WS);
  assert.equal(w.length, 1);
  assert.match(w[0], /이름 중복/);
});

test('HTTP 포트 중복 감지', () => {
  const w = findServerConflicts([{ name: 'a', port: 8080 }, { name: 'b', port: 8080 }], {}, WS);
  assert.ok(w.some(m => /포트 충돌/.test(m)));
});

test('파생된 debug 포트 충돌 감지 (명시 debug가 다른 인스턴스 파생 debug와 겹침)', () => {
  // a: port 8080 → debug 5005.  b: port 9000, debugPort 5005 (명시) → a와 충돌
  const w = findServerConflicts([{ name: 'a', port: 8080 }, { name: 'b', port: 9000, debugPort: 5005 }], {}, WS);
  assert.ok(w.some(m => /포트 충돌/.test(m) && /5005/.test(m)));
});

test('이름 없는 항목 경고', () => {
  const w = findServerConflicts([{ port: 8080 }], {}, WS);
  assert.ok(w.some(m => /이름이 비어/.test(m)));
});

// ── flatToServerEntry ───────────────────────────────────────
test('평면 → default 엔트리 (manualPortConfig off → 포트만)', () => {
  assert.deepEqual(flatToServerEntry({ port: 8090, manualPortConfig: false }), { name: 'default', port: 8090 });
});

test('manualPortConfig on → debug/redirect 보존', () => {
  const e = flatToServerEntry({ port: 8090, debugPort: 5099, redirectPort: 8499, manualPortConfig: true });
  assert.deepEqual(e, { name: 'default', port: 8090, debugPort: 5099, redirectPort: 8499 });
});

test('port 없으면 8080 기본', () => {
  assert.deepEqual(flatToServerEntry({}), { name: 'default', port: 8080 });
});
