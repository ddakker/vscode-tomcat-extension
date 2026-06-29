// lib/instances.js — 인스턴스 파생/검증/마이그레이션 순수 로직 (VS Code 비의존, 단위 테스트 대상)
'use strict';

const path = require('path');

/**
 * 서버 1개의 정적 설정을 파생한다.
 *  - 포트 미지정 시 HTTP 포트(port) 기준 자동 계산
 *  - javaHome/catalinaHome/javaOpts 미지정 시 공통(common) 값으로 폴백
 *  - catalinaBase/warDir/confDir 는 name 과 ws 에서 파생
 * @param {{name:string, port:number, debugPort?:number, redirectPort?:number,
 *          javaHome?:string, catalinaHome?:string, javaOpts?:string}} server
 * @param {{catalinaHome?:string, javaHome?:string, javaOpts?:string, contextPath?:string}} common
 * @param {string} ws 워크스페이스 루트 절대경로
 */
function makeInstanceConfig(server, common = {}, ws = '') {
  const off = server.port - 8080;
  const base = path.join(ws, '.vscode', 'tomcat', server.name);
  const contextPath = common.contextPath || '/';
  const warTop = contextPath.replace(/^\//, '') || 'ROOT';
  return {
    name:         server.name,
    port:         server.port,
    debugPort:    server.debugPort    ?? (5005 + off),
    redirectPort: server.redirectPort ?? (8443 + off),
    catalinaHome: server.catalinaHome ?? common.catalinaHome ?? '',
    javaHome:     server.javaHome     ?? common.javaHome ?? '',
    javaOpts:     server.javaOpts     ?? common.javaOpts ?? '',
    contextPath,
    catalinaBase: base,
    // 배포 디렉토리(docBase)는 모든 인스턴스가 공유한다 → 인스턴스 이름과 무관한 단일 경로
    warDir:       path.join(ws, '.vscode', 'tomcat', 'webapp', warTop),
    confDir:      path.join(base, 'conf'),
  };
}

/**
 * 빈/비배열이면 기본 인스턴스 1개로 폴백.
 */
function normalizeServers(servers) {
  if (Array.isArray(servers) && servers.length > 0) return servers;
  return [{ name: 'default', port: 8080 }];
}

/**
 * 이름 중복 + 파생 후 effective 포트(http/debug/redirect) 충돌을 검사한다.
 * @returns {string[]} 경고 메시지 목록 (비어 있으면 충돌 없음)
 */
function findServerConflicts(servers, common = {}, ws = '') {
  const warnings = [];
  const seenNames = new Set();
  const portOwner = new Map(); // effective port → "name(kind)"

  for (const s of servers) {
    if (!s || typeof s.name !== 'string' || !s.name.trim()) {
      warnings.push('이름이 비어 있는 서버 설정이 있습니다.');
      continue;
    }
    if (typeof s.port !== 'number') {
      warnings.push(`서버 "${s.name}"에 port(숫자)가 없습니다.`);
      continue;
    }
    if (seenNames.has(s.name)) {
      warnings.push(`서버 이름 중복: "${s.name}" (catalinaBase 충돌)`);
      continue;
    }
    seenNames.add(s.name);

    const cfg = makeInstanceConfig(s, common, ws);
    for (const [kind, p] of [['http', cfg.port], ['debug', cfg.debugPort], ['redirect', cfg.redirectPort]]) {
      if (portOwner.has(p)) {
        warnings.push(`포트 충돌: "${s.name}"의 ${kind} 포트 ${p}가 ${portOwner.get(p)}와(과) 겹칩니다.`);
      } else {
        portOwner.set(p, `"${s.name}"의 ${kind}`);
      }
    }
  }
  return warnings;
}

/**
 * 평면(flat) 설정 → servers[0] 엔트리 생성.
 *  - manualPortConfig 가 켜져 있으면 debug/redirect 포트를 명시적으로 보존
 * @param {{port?:number, debugPort?:number, redirectPort?:number, manualPortConfig?:boolean}} flat
 */
function flatToServerEntry(flat = {}) {
  const name = (flat.name && typeof flat.name === 'string' && flat.name.trim()) ? flat.name.trim() : 'default';
  const entry = { name, port: typeof flat.port === 'number' ? flat.port : 8080 };
  if (flat.manualPortConfig) {
    if (typeof flat.debugPort === 'number')    entry.debugPort = flat.debugPort;
    if (typeof flat.redirectPort === 'number') entry.redirectPort = flat.redirectPort;
  }
  return entry;
}

module.exports = {
  makeInstanceConfig,
  normalizeServers,
  findServerConflicts,
  flatToServerEntry,
};
