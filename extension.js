// extension.js - Tomcat Auto Deploy VS Code Extension v2.0
'use strict';

const vscode  = require('vscode');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const { exec, spawn } = require('child_process');
const { promisify }   = require('util');

const execAsync = promisify(exec);

// ══════════════════════════════════════════════════════════
//  i18n
// ══════════════════════════════════════════════════════════
const isKo = vscode.env.language.startsWith('ko');

const messages = {
  // TreeView
  deployAll:          ['전체 배포',          'Deploy All'],
  serverRunning:      ['서버 실행 중',       'Server Running'],
  serverStopped:      ['서버 중지됨',        'Server Stopped'],
  port:               ['포트 {0}',          'Port {0}'],
  start:              ['시작',              'Start'],
  stop:               ['중지',              'Stop'],
  forceStop:          ['강제 중지',          'Force Stop'],
  restart:            ['재시작',             'Restart'],
  openBrowser:        ['브라우저 열기',       'Open Browser'],
  showOutput:         ['Console 로그',      'Console Log'],
  localhostLog:       ['Localhost 로그',     'Localhost Log'],
  openServerXml:      ['server.xml 열기',   'Open server.xml'],
  settings:           ['설정',              'Settings'],

  // Status bar - Tomcat
  tipStart:           ['Tomcat 시작',        'Start Tomcat'],
  textStarting:       ['Tomcat 기동중',      'Tomcat Starting'],
  tipStarting:        ['기동 중...',         'Starting...'],
  tipStop:            ['Tomcat 중지',        'Stop Tomcat'],
  textStopping:       ['Tomcat 중지중',      'Tomcat Stopping'],
  tipStopping:        ['중지 중...',         'Stopping...'],

  // Status bar - Deploy
  deployIdle:         ['Deploy 대기중',       'Deploy Idle'],
  deploying:          ['배포중: {0}',         'Deploying: {0}'],
  deployOk:           ['배포완료: {0}',       'Deployed: {0}'],
  deployErr:          ['배포실패: {0}',       'Deploy Failed: {0}'],

  // Dialog messages
  alreadyRunning:     ['Tomcat이 이미 실행 중입니다. 먼저 중지해주세요.',
                       'Tomcat is already running. Please stop it first.'],
  existingProcess:    ['이 CATALINA_BASE를 사용하는 Tomcat 프로세스가 이미 실행 중입니다. (PID: {0})',
                       'A Tomcat process using this CATALINA_BASE is already running. (PID: {0})'],
  forceKillAndStart:  ['강제 종료 후 시작',    'Force Kill & Start'],
  cancel:             ['취소',               'Cancel'],
  catalinaRequired:   ['CATALINA_HOME(catalinaHome) 설정이 필요합니다.',
                       'CATALINA_HOME (catalinaHome) must be configured.'],
  openSettings:       ['설정 열기',           'Open Settings'],
  httpPortInUse:      ['HTTP 포트 {0}이(가) 이미 사용 중입니다.',
                       'HTTP port {0} is already in use.'],
  debugPortInUse:     ['디버그(JPDA) 포트 {0}이(가) 이미 사용 중입니다.',
                       'Debug (JPDA) port {0} is already in use.'],
  portOwnerFound:     ['포트 {0} 사용 중인 프로세스:',
                       'Process using port {0}:'],
  portOwnerNotFound:  ['포트 {0}을(를) 사용하는 프로세스를 찾을 수 없습니다.',
                       'Could not find the process using port {0}.'],
  portKillSuccess:    ['PID {0} 프로세스를 종료했습니다.',
                       'Killed process PID {0}.'],
  portKillFail:       ['PID {0} 프로세스 종료 실패: {1}',
                       'Failed to kill process PID {0}: {1}'],
  btnKill:            ['⊘ Kill',              '⊘ Kill'],
  notRunning:         ['Tomcat이 실행 중이 아닙니다.',
                       'Tomcat is not running.'],
  orphanKilled:       ['Tomcat 프로세스를 강제 종료했습니다.',
                       'Tomcat process has been force killed.'],
  forceStopDone:      ['Tomcat을 강제 종료했습니다.',
                       'Tomcat has been force stopped.'],
  catalinaCheck:      ['catalinaHome 설정이 필요합니다. .vscode/settings.json을 확인하세요.',
                       'catalinaHome must be configured. Check .vscode/settings.json.'],
  devMode:            ['개발 모드',           'Dev Mode'],
  ready:              ['Tomcat Auto Deploy v0.0.1 준비됨 — 상태바에서 ▶/■ 클릭',
                       'Tomcat Auto Deploy v0.0.1 ready — click ▶/■ in status bar'],
  btnStart:           ['▶ 시작',             '▶ Start'],
  btnSettings:        ['⚙ 설정',             '⚙ Settings'],
  startupFailed:      ['Tomcat 기동 실패: {0}', 'Tomcat startup failed: {0}'],
  startupTimeout:     ['Tomcat 기동 타임아웃 (30초)', 'Tomcat startup timeout (30s)'],
  tomcatStarted:      ['✅ Tomcat 시작 완료 → http://localhost:{0}{1}',
                       '✅ Tomcat started → http://localhost:{0}{1}'],

  // Log messages
  logOrphanDetected:  ['[Orphan] 이전 세션의 Tomcat 프로세스 감지 (PID={0})',
                       '[Orphan] Previous session Tomcat process detected (PID={0})'],
  logCtxReload:       ['[Init] context.xml reloadable=false 로 변경 (JDWP HotSwap 사용)',
                       '[Init] context.xml changed to reloadable=false (JDWP HotSwap)'],
  logCtxCreated:      ['[Init] context.xml 생성',     '[Init] context.xml created'],
  logSrvCreated:      ['[Init] server.xml 생성',      '[Init] server.xml created'],
  logSrvUpdated:      ['[Init] server.xml 설정값 업데이트 (수동 편집 내용 보존)',
                       '[Init] server.xml settings updated (manual edits preserved)'],
  logFileCopied:      ['[Init] {0} 복사 완료',         '[Init] {0} copied'],
  logJpdaStart:       ['[Tomcat] JPDA 디버그 모드로 기동 (포트: {0})...',
                       '[Tomcat] Starting in JPDA debug mode (port: {0})...'],
  logExit:            ['[Tomcat] 종료 (code={0})',     '[Tomcat] Exited (code={0})'],
  logStarted:         ['[Tomcat] 기동 완료 → http://localhost:{0}{1}',
                       '[Tomcat] Started → http://localhost:{0}{1}'],
  logStartFailed:     ['[Tomcat] 기동 실패: {0}',      '[Tomcat] Startup failed: {0}'],
  logStopReq:         ['[Tomcat] 중지 요청...',        '[Tomcat] Stop requested...'],
  logOrphanKill:      ['[Tomcat] 고아 프로세스 강제 종료 (PID={0})',
                       '[Tomcat] Force killing orphan process (PID={0})'],
  logKillDone:        ['[Tomcat] 강제 종료 완료',       '[Tomcat] Force kill complete'],
  logSigterm:         ['[Tomcat] SIGTERM 전송',        '[Tomcat] SIGTERM sent'],
  logSigkill:         ['[Tomcat] 강제 SIGKILL 전송',   '[Tomcat] Force SIGKILL sent'],
  logStopDone:        ['[Tomcat] 중지 완료',           '[Tomcat] Stopped'],
  logForceStopReq:    ['[Tomcat] 강제 중지 요청...',    '[Tomcat] Force stop requested...'],
  logForceStop:       ['[Tomcat] 강제 종료 (PID={0})', '[Tomcat] Force killed (PID={0})'],
  logForceStopDone:   ['[Tomcat] 강제 중지 완료',       '[Tomcat] Force stop complete'],
  logExistingKill:    ['[Tomcat] 기존 프로세스 강제 종료 (PID={0})',
                       '[Tomcat] Force killed existing process (PID={0})'],
  logDepMvnResolve:   ['[의존성] Maven classpath 해석 중... ({0})',
                       '[Deps] Resolving Maven classpath... ({0})'],
  logDepMvnDone:      ['[의존성] Maven classpath 해석 완료 ({0}개 항목)',
                       '[Deps] Maven classpath resolved ({0} entries)'],
  logDepMvnFail:      ['[의존성] Maven classpath 파일 생성 실패',
                       '[Deps] Maven classpath file not generated'],
  logDepGradleResolve:['[의존성] Gradle classpath 해석 중... ({0})',
                       '[Deps] Resolving Gradle classpath... ({0})'],
  logDepGradleDone:   ['[의존성] Gradle classpath 해석 완료 ({0}개 항목)',
                       '[Deps] Gradle classpath resolved ({0} entries)'],
  logDepGradleFail:   ['[의존성] Gradle classpath 파일 생성 실패',
                       '[Deps] Gradle classpath file not generated'],
  logDepFailed:       ['[의존성] classpath 해석 실패: {0}',
                       '[Deps] Classpath resolution failed: {0}'],
  logDepInvalidated:  ['[의존성] classpath 캐시 무효화 — 다음 컴파일 시 재해석',
                       '[Deps] Classpath cache invalidated — will re-resolve on next compile'],
  logCompile:         ['[Java] 컴파일: {0}',           '[Java] Compiling: {0}'],
  logStderr:          ['[Java] stderr: {0}',           '[Java] stderr: {0}'],
  logHotSwapOk:       ['[HotSwap] ✔ {0} 재컴파일 → 적용 완료',
                       '[HotSwap] ✔ {0} recompiled → applied'],
  logHotSwapSkip:     ['[HotSwap] {0} 미로드 상태 — 다음 접근 시 반영',
                       '[HotSwap] {0} not loaded — will apply on next access'],
  logHotSwapFail:     ['[HotSwap] {0} 교체 실패 (구조 변경?) — {1}',
                       '[HotSwap] {0} swap failed (schema change?) — {1}'],
  logCompileFail:     ['[Java] 컴파일 실패:\n{0}',     '[Java] Compilation failed:\n{0}'],
  logSyncStart:       ['[Sync] 전체 동기화 시작...',    '[Sync] Full sync starting...'],
  logSyncClassCount:  ['[Sync] Java {0}개, class {1}개 — 불일치',
                       '[Sync] Java: {0}, classes: {1} — mismatch'],
  warnBuildFirst:     ['Java {0}개, class {1}개로 불일치합니다. {2} 빌드를 먼저 실행하세요.',
                       'Java: {0}, classes: {1} mismatch. Please run {2} build first.'],
  warnCommentedJava:  ['컴파일 후에도 Java {0}개, class {1}개로 불일치 — 주석 처리된 Java 파일이 있을 수 있습니다.',
                       'After compile, Java: {0}, classes: {1} mismatch — some Java files may have commented-out classes.'],
  logSyncMaven:       ['[Sync] Maven target/classes → WEB-INF/classes ({0}개 파일 복사)',
                       '[Sync] Maven target/classes → WEB-INF/classes ({0} files copied)'],
  logSyncMavenWarn:   ['[Sync] target/classes 없음 — javac로 직접 컴파일합니다',
                       '[Sync] target/classes not found — compiling with javac'],
  logSyncGradle:      ['[Sync] Gradle build/classes → WEB-INF/classes ({0}개 파일 복사)',
                       '[Sync] Gradle build/classes → WEB-INF/classes ({0} files copied)'],
  logSyncGradleWarn:  ['[Sync] build/classes 없음 — javac로 직접 컴파일합니다',
                       '[Sync] build/classes not found — compiling with javac'],
  logSyncCompiling:   ['[Sync] Java {0}개 파일 컴파일...',
                       '[Sync] Compiling {0} Java files...'],
  logSyncCompileDone: ['[Sync] Java 컴파일 완료 ({0}개)',
                       '[Sync] Java compilation complete ({0} files)'],
  logSyncCompileFail: ['[Sync] Java 컴파일 실패:\n{0}',
                       '[Sync] Java compilation failed:\n{0}'],
  logSyncJarFail:     ['[Sync] JAR 복사 실패: {0} → {1}',
                       '[Sync] JAR copy failed: {0} → {1}'],
  logSyncJarDone:     ['[Sync] 의존성 JAR → WEB-INF/lib ({0}개 복사, 총 {1}개)',
                       '[Sync] Dependency JARs → WEB-INF/lib ({0} copied, {1} total)'],
  logSyncWebContent:  ['[Sync] webContentRoot 전체 복사 ({0}개 파일)',
                       '[Sync] webContentRoot fully copied ({0} files)'],
  logSyncResource:    ['[Sync] resourceRoot → WEB-INF/classes ({0}개 파일)',
                       '[Sync] resourceRoot → WEB-INF/classes ({0} files)'],
  logSyncChanged:     ['[Sync]   ↳ {0}',               '[Sync]   ↳ {0}'],
  logSyncNoChange:    ['[Sync] 변경된 파일 없음',        '[Sync] No files changed'],
  logSyncDone:        ['[Sync] 전체 동기화 완료 (변경 {0}건)',
                       '[Sync] Full sync complete ({0} files changed)'],
  logSettingsCreated: ['[Init] .vscode/settings.json에 기본 설정 생성',
                       '[Init] Default settings created in .vscode/settings.json'],
  logLogWatch:        ['[Log] localhost 로그 감시 시작', '[Log] Localhost log watch started'],
  logActivated:       ['Tomcat Auto Deploy v0.0.1 활성화 (빌드: {0})',
                       'Tomcat Auto Deploy v0.0.1 activated (build: {0})'],

  // JDWP
  jdwpTimeout:        ['JDWP 타임아웃',              'JDWP timeout'],
  jdwpConnFail:       ['JDWP 연결 실패: {0}',        'JDWP connection failed: {0}'],
  jdwpHandshakeFail:  ['JDWP 핸드셰이크 실패',        'JDWP handshake failed'],
  jdwpError:          ['JDWP 에러 코드 {0}',         'JDWP error code {0}'],
};

/**
 * 현재 언어에 맞는 메시지를 반환. {0}, {1}, ... 를 args로 치환.
 */
function t(key, ...args) {
  const pair = messages[key];
  let text = pair ? pair[isKo ? 0 : 1] : key;
  for (let i = 0; i < args.length; i++) {
    text = text.replace(`{${i}}`, args[i]);
  }
  return text;
}

// ══════════════════════════════════════════════════════════
//  전역 상태
// ══════════════════════════════════════════════════════════
let outputChannel;
let localhostLogChannel;
let localhostLogWatcher;
let localhostLogOffset = 0;
let tomcatProcess = null;
let tomcatRunning = false;
let orphanPid     = null;
let sbTomcat;
let sbDeploy;
let cachedDepClasspath = null;

// ══════════════════════════════════════════════════════════
//  TreeView: 사이드바 Tomcat 서버 뷰
// ══════════════════════════════════════════════════════════
class TomcatTreeProvider {
  constructor() {
    this._onDidChangeTreeData = new vscode.EventEmitter();
    this.onDidChangeTreeData = this._onDidChangeTreeData.event;
  }

  refresh() { this._onDidChangeTreeData.fire(); }

  getTreeItem(element) { return element; }

  getChildren(element) {
    // 디렉토리 노드의 하위 항목
    if (element && element.contextValue === 'tomcatDir') {
      return this._getDirChildren(element.resourceUri.fsPath);
    }
    if (element) return [];

    const cfg = getConfig();
    const items = [];

    // 서버 상태 항목
    const serverItem = new vscode.TreeItem(
      tomcatRunning ? t('serverRunning') : t('serverStopped'),
      vscode.TreeItemCollapsibleState.None
    );
    serverItem.iconPath = new vscode.ThemeIcon(
      tomcatRunning ? 'vm-running' : 'vm-outline',
      tomcatRunning
        ? new vscode.ThemeColor('testing.iconPassed')
        : new vscode.ThemeColor('testing.iconSkipped')
    );
    serverItem.description = tomcatRunning ? t('port', cfg.port) : '';
    serverItem.contextValue = tomcatRunning ? 'serverRunning' : 'serverStopped';
    items.push(serverItem);

    // 실행 중일 때만 표시되는 액션 항목 (시작/중지/재시작/설정은 타이틀바 버튼으로 제공)
    if (tomcatRunning) {
      const deployItem = new vscode.TreeItem(t('deployAll'), vscode.TreeItemCollapsibleState.None);
      deployItem.iconPath = new vscode.ThemeIcon('cloud-upload');
      deployItem.command = { command: 'tomcatAutoDeploy.deployAll', title: t('deployAll') };
      items.push(deployItem);

      const browserItem = new vscode.TreeItem(t('openBrowser'), vscode.TreeItemCollapsibleState.None);
      browserItem.iconPath = new vscode.ThemeIcon('globe');
      browserItem.description = `http://localhost:${cfg.port}${cfg.contextPath}`;
      browserItem.command = { command: 'tomcatAutoDeploy.openBrowser', title: t('openBrowser') };
      items.push(browserItem);
    }

    const outputItem = new vscode.TreeItem(t('showOutput'), vscode.TreeItemCollapsibleState.None);
    outputItem.iconPath = new vscode.ThemeIcon('output');
    outputItem.command = { command: 'tomcatAutoDeploy.showOutput', title: t('showOutput') };
    items.push(outputItem);

    const localhostLogItem = new vscode.TreeItem(t('localhostLog'), vscode.TreeItemCollapsibleState.None);
    localhostLogItem.iconPath = new vscode.ThemeIcon('file-text');
    localhostLogItem.command = { command: 'tomcatAutoDeploy.showLocalhostLog', title: t('localhostLog') };
    items.push(localhostLogItem);

    const serverXmlItem = new vscode.TreeItem(t('openServerXml'), vscode.TreeItemCollapsibleState.None);
    serverXmlItem.iconPath = new vscode.ThemeIcon('file-code');
    serverXmlItem.command = { command: 'tomcatAutoDeploy.openServerXml', title: t('openServerXml') };
    items.push(serverXmlItem);

    // .vscode/tomcat 디렉토리 트리
    const tomcatBase = cfg.catalinaBase;
    if (tomcatBase && fs.existsSync(tomcatBase)) {
      const dirItem = this._makeDirItem(tomcatBase, 'CATALINA_BASE');
      items.push(dirItem);
    }

    return items;
  }

  _makeDirItem(dirPath, label) {
    const item = new vscode.TreeItem(label || path.basename(dirPath), vscode.TreeItemCollapsibleState.Collapsed);
    item.iconPath = vscode.ThemeIcon.Folder;
    item.resourceUri = vscode.Uri.file(dirPath);
    item.contextValue = 'tomcatDir';
    return item;
  }

  _makeFileItem(filePath) {
    const item = new vscode.TreeItem(path.basename(filePath), vscode.TreeItemCollapsibleState.None);
    item.iconPath = vscode.ThemeIcon.File;
    item.resourceUri = vscode.Uri.file(filePath);
    item.command = { command: 'vscode.open', title: 'Open', arguments: [vscode.Uri.file(filePath)] };
    item.contextValue = 'tomcatFile';
    return item;
  }

  _getDirChildren(dirPath) {
    try {
      const entries = fs.readdirSync(dirPath, { withFileTypes: true });
      const dirs = entries.filter(e => e.isDirectory()).sort((a, b) => a.name.localeCompare(b.name));
      const files = entries.filter(e => e.isFile()).sort((a, b) => a.name.localeCompare(b.name));
      return [
        ...dirs.map(d => this._makeDirItem(path.join(dirPath, d.name))),
        ...files.map(f => this._makeFileItem(path.join(dirPath, f.name))),
      ];
    } catch { return []; }
  }
}

let tomcatTreeProvider;

// ══════════════════════════════════════════════════════════
//  설정
// ══════════════════════════════════════════════════════════
function getConfig() {
  const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
  const ws  = getWorkspaceRoot() || '';
  const port = cfg.get('port', 8080);
  const manualPort = cfg.get('manualPortConfig', false);
  const portOffset = port - 8080;
  return {
    catalinaHome:   cfg.get('catalinaHome', ''),
    javaHome:       cfg.get('javaHome', ''),
    javaSourceRoot: cfg.get('javaSourceRoot', 'src/main/java'),
    webContentRoot: cfg.get('webContentRoot', 'src/main/webapp'),
    resourceRoot:   cfg.get('resourceRoot', 'src/main/resources'),
    classpath:      cfg.get('classpath', []),
    port,
    manualPortConfig: manualPort,
    debugPort:    manualPort ? cfg.get('debugPort', 5005) : 5005 + portOffset,
    redirectPort: manualPort ? cfg.get('redirectPort', 8443) : 8443 + portOffset,
    contextPath:    cfg.get('contextPath', '/'),
    javaOpts:       cfg.get('javaOpts', ''),
    catalinaBase:   path.join(ws, '.vscode', 'tomcat'),
    warDir:         path.join(ws, '.vscode', 'tomcat', 'apps', cfg.get('contextPath', '/').replace(/^\//, '') || 'ROOT'),
    confDir:        path.join(ws, '.vscode', 'tomcat', 'conf'),
  };
}

function getWorkspaceRoot() {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length > 0 ? f[0].uri.fsPath : null;
}

function isJavaWebProject() {
  const ws = getWorkspaceRoot();
  if (!ws) return false;

  const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
  const webContentRoot = cfg.get('webContentRoot', 'src/main/webapp');
  const webContentDir = path.join(ws, webContentRoot);
  if (!fs.existsSync(webContentDir)) return false;

  const buildFiles = ['pom.xml', 'build.gradle', 'build.gradle.kts'];
  for (const name of buildFiles) {
    const filePath = path.join(ws, name);
    if (fs.existsSync(filePath)) {
      try {
        const content = fs.readFileSync(filePath, 'utf-8');
        if (content.includes('spring-boot')) return false;
      } catch {}
    }
  }
  return true;
}

// ══════════════════════════════════════════════════════════
//  로그
// ══════════════════════════════════════════════════════════
function log(msg, level = 'INFO') {
  const ts = new Date().toLocaleTimeString(isKo ? 'ko-KR' : 'en-US');
  outputChannel.appendLine(`[${ts}] [${level}] ${msg}`);
}

// ══════════════════════════════════════════════════════════
//  상태바 - Tomcat 제어
// ══════════════════════════════════════════════════════════
function refreshTomcatBar(state) {
  const map = {
    stopped:  { text: '$(play) Tomcat',                     tip: t('tipStart'),   bg: undefined,                                               cmd: 'tomcatAutoDeploy.start'  },
    starting: { text: `$(sync~spin) ${t('textStarting')}`,  tip: t('tipStarting'), bg: undefined,                                               cmd: ''                        },
    running:  { text: '$(debug-stop) Tomcat',               tip: t('tipStop'),    bg: new vscode.ThemeColor('statusBarItem.warningBackground'), cmd: 'tomcatAutoDeploy.stop'   },
    stopping: { text: `$(sync~spin) ${t('textStopping')}`,  tip: t('tipStopping'), bg: undefined,                                               cmd: ''                        },
  };
  const m = map[state] || map.stopped;
  sbTomcat.text            = m.text;
  sbTomcat.tooltip         = m.tip;
  sbTomcat.backgroundColor = m.bg;
  sbTomcat.command         = m.cmd || undefined;
  sbTomcat.show();

  vscode.commands.executeCommand('setContext', 'tomcatAutoDeploy.running', state === 'running');
  vscode.commands.executeCommand('setContext', 'tomcatAutoDeploy.starting', state === 'starting');
  if (tomcatTreeProvider) tomcatTreeProvider.refresh();
}

// ══════════════════════════════════════════════════════════
//  상태바 - Deploy 결과
// ══════════════════════════════════════════════════════════
function refreshDeployBar(state, filename) {
  const map = {
    idle:      { text: `$(cloud-upload) ${t('deployIdle')}`,           bg: undefined },
    deploying: { text: `$(sync~spin) ${t('deploying', filename || '')}`, bg: undefined },
    ok:        { text: `$(check) ${t('deployOk', filename || '')}`,      bg: undefined },
    err:       { text: `$(error) ${t('deployErr', filename || '')}`,     bg: new vscode.ThemeColor('statusBarItem.errorBackground') },
  };
  const m = map[state] || map.idle;
  sbDeploy.text            = m.text;
  sbDeploy.backgroundColor = m.bg;
  sbDeploy.command         = 'tomcatAutoDeploy.showOutput';
  sbDeploy.show();

  if (state === 'ok')  setTimeout(() => refreshDeployBar('idle'), 3000);
  if (state === 'err') setTimeout(() => refreshDeployBar('idle'), 6000);
}

// ══════════════════════════════════════════════════════════
//  PID 파일 관리
// ══════════════════════════════════════════════════════════
function getPidFile() {
  return path.join(getConfig().catalinaBase, 'tomcat.pid');
}

function savePid(pid) {
  try { fs.writeFileSync(getPidFile(), String(pid), 'utf-8'); } catch {}
}

function readPid() {
  try { return parseInt(fs.readFileSync(getPidFile(), 'utf-8').trim(), 10) || null; } catch { return null; }
}

function removePidFile() {
  try { fs.unlinkSync(getPidFile()); } catch {}
}

function isProcessAlive(pid) {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      const out = require('child_process').execSync(
        `tasklist /FI "PID eq ${pid}" /NH`, { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      return out.includes(String(pid));
    }
    process.kill(pid, 0);
    return true;
  } catch { return false; }
}

function forceKillPid(pid) {
  const isWin = process.platform === 'win32';
  try {
    if (isWin) {
      require('child_process').execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', shell: true });
    } else {
      process.kill(-pid, 'SIGKILL');
    }
  } catch {
    try {
      if (isWin) {
        require('child_process').execSync(`taskkill /F /PID ${pid}`, { stdio: 'ignore', shell: true });
      } else {
        process.kill(pid, 'SIGKILL');
      }
    } catch {}
  }
}

/**
 * CATALINA_BASE 경로로 기동된 Java 프로세스를 찾아 PID 반환 (없으면 null)
 */
function findProcessByCatalinaBase(catalinaBase) {
  const isWin = process.platform === 'win32';
  const normalized = catalinaBase.replace(/\\/g, '/').toLowerCase();
  try {
    if (isWin) {
      const psCmd = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name like '%java%'\\" | Select-Object ProcessId,CommandLine | Format-List"`;
      const out = require('child_process').execSync(psCmd, {
        encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 15000, shell: true
      });
      const blocks = out.split(/\r?\n\s*\r?\n/).filter(b => b.trim());
      for (const block of blocks) {
        const cmdMatch = block.match(/CommandLine\s*:\s*(.+)/i);
        const pidMatch = block.match(/ProcessId\s*:\s*(\d+)/i);
        if (cmdMatch && pidMatch) {
          const cmdLine = cmdMatch[1].replace(/\\/g, '/').toLowerCase();
          if (cmdLine.includes(`catalina.base=${normalized}`) ||
              cmdLine.includes(`catalina.base="${normalized}"`)) {
            const pid = parseInt(pidMatch[1], 10);
            if (pid && pid !== process.pid) return pid;
          }
        }
      }
    } else {
      let out;
      try {
        out = require('child_process').execSync(
          `pgrep -f "catalina.base=${catalinaBase}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }
        );
      } catch {
        out = require('child_process').execSync(
          `ps -eo pid,args | grep "catalina.base=${catalinaBase}" | grep -v grep`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000, shell: true }
        );
      }
      for (const line of out.trim().split('\n')) {
        const pid = parseInt(line.trim().split(/\s+/)[0], 10);
        if (pid && pid !== process.pid) return pid;
      }
    }
  } catch {}
  return null;
}

// ══════════════════════════════════════════════════════════
//  고아 프로세스 감지
// ══════════════════════════════════════════════════════════
function detectOrphanProcess() {
  const pid = readPid();
  if (pid && isProcessAlive(pid)) {
    orphanPid = pid;
    tomcatRunning = true;
    log(t('logOrphanDetected', pid), 'WARN');
    refreshTomcatBar('running');
    return true;
  }
  if (pid) removePidFile();
  return false;
}

// ══════════════════════════════════════════════════════════
//  .vscode/tomcat 디렉토리 초기화
// ══════════════════════════════════════════════════════════
function initTomcatBase() {
  const cfg  = getConfig();
  const base = cfg.catalinaBase;

  for (const d of ['conf', 'webapps', 'logs', 'work', 'temp']) {
    fs.mkdirSync(path.join(base, d), { recursive: true });
  }

  // 이전 버전 war → apps/{contextPath} 마이그레이션
  const oldWarDir = path.join(base, 'war');
  if (fs.existsSync(oldWarDir)) {
    fs.cpSync(oldWarDir, cfg.warDir, { recursive: true });
    fs.rmSync(oldWarDir, { recursive: true, force: true });
    log(`[Init] war → apps/${path.basename(cfg.warDir)} 마이그레이션 완료`);
  }

  fs.mkdirSync(path.join(cfg.warDir, 'WEB-INF', 'classes'), { recursive: true });

  // apps/ 하위에서 현재 contextPath 디렉토리가 아닌 것 삭제
  const appsDir = path.join(base, 'apps');
  const activeTopDir = path.relative(appsDir, cfg.warDir).split(path.sep)[0];
  try {
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== activeTopDir) {
        fs.rmSync(path.join(appsDir, entry.name), { recursive: true, force: true });
        log(`[Init] 이전 앱 디렉토리 삭제: apps/${entry.name}`);
      }
    }
  } catch {}

  // ── context.xml ──
  const contextXml = path.join(cfg.confDir, 'context.xml');
  let needWriteContextXml = !fs.existsSync(contextXml);
  if (!needWriteContextXml) {
    try {
      const existing = fs.readFileSync(contextXml, 'utf-8');
      if (existing.includes('reloadable="true"')) {
        needWriteContextXml = true;
        log(t('logCtxReload'));
      }
    } catch {}
  }
  if (needWriteContextXml) {
    fs.writeFileSync(contextXml,
`<?xml version="1.0" encoding="UTF-8"?>
<Context reloadable="false">
  <Valve className="org.apache.catalina.valves.RemoteAddrValve"
         allow="127\\.\\d+\\.\\d+\\.\\d+|::1|0:0:0:0:0:0:0:1"/>
</Context>
`, 'utf-8');
    log(t('logCtxCreated'));
  }

  // ── server.xml ──
  const serverXml = path.join(cfg.confDir, 'server.xml');
  if (!fs.existsSync(serverXml)) {
    const ctxPath = cfg.contextPath === '/' ? '' : cfg.contextPath;
    fs.writeFileSync(serverXml,
`<?xml version="1.0" encoding="UTF-8"?>
<Server port="-1" shutdown="SHUTDOWN">
  <Listener className="org.apache.catalina.startup.VersionLoggerListener"/>
  <Listener className="org.apache.catalina.core.AprLifecycleListener" SSLEngine="on"/>
  <Listener className="org.apache.catalina.core.JreMemoryLeakPreventionListener"/>
  <Listener className="org.apache.catalina.mbeans.GlobalResourcesLifecycleListener"/>
  <Listener className="org.apache.catalina.core.ThreadLocalLeakPreventionListener"/>

  <GlobalNamingResources>
    <Resource name="UserDatabase" auth="Container"
              type="org.apache.catalina.UserDatabase"
              description="User database"
              factory="org.apache.catalina.users.MemoryUserDatabaseFactory"
              pathname="conf/tomcat-users.xml"/>
  </GlobalNamingResources>

  <Service name="Catalina">
    <Connector port="${cfg.port}" protocol="HTTP/1.1"
               connectionTimeout="20000" redirectPort="${cfg.redirectPort}"
               URIEncoding="UTF-8"/>

    <Engine name="Catalina" defaultHost="localhost">
      <Realm className="org.apache.catalina.realm.LockOutRealm">
        <Realm className="org.apache.catalina.realm.UserDatabaseRealm"
               resourceName="UserDatabase"/>
      </Realm>

      <Host name="localhost" appBase="webapps"
            unpackWARs="false" autoDeploy="false" deployOnStartup="false">
        <Context path="${ctxPath}" docBase="${cfg.warDir}"
                 reloadable="false"/>
        <Valve className="org.apache.catalina.valves.AccessLogValve"
               directory="logs" prefix="localhost_access" suffix=".txt"
               pattern="%h %l %u %t &quot;%r&quot; %s %b"/>
      </Host>
    </Engine>
  </Service>
</Server>
`, 'utf-8');
    log(t('logSrvCreated'));
  } else {
    let xml = fs.readFileSync(serverXml, 'utf-8');
    let changed = false;
    const ctxPath = cfg.contextPath === '/' ? '' : cfg.contextPath;

    const newXml1 = xml.replace(
      /(<Connector\b[^>]*\bport=")(\d+)(")/,
      (m, pre, oldPort, post) => {
        if (oldPort !== String(cfg.port)) { changed = true; }
        return `${pre}${cfg.port}${post}`;
      }
    );
    xml = newXml1;

    const newXml2 = xml.replace(
      /(<Connector\b[^>]*\bredirectPort=")(\d+)(")/,
      (m, pre, oldPort, post) => {
        if (oldPort !== String(cfg.redirectPort)) { changed = true; }
        return `${pre}${cfg.redirectPort}${post}`;
      }
    );
    xml = newXml2;

    if (!xml.includes('<Context')) {
      xml = xml.replace(
        '</Host>',
        `        <Context path="${ctxPath}" docBase="${cfg.warDir}"\n                 reloadable="false"/>\n      </Host>`
      );
      changed = true;
    } else {
      const newXml3 = xml.replace(
        /(<Context\b[^>]*\bpath=")([^"]*)(")/,
        (m, pre, oldPath, post) => {
          if (oldPath !== ctxPath) { changed = true; }
          return `${pre}${ctxPath}${post}`;
        }
      );
      xml = newXml3;

      const newXml4 = xml.replace(
        /(<Context\b[^>]*\bdocBase=")([^"]*)(")/,
        (m, pre, oldBase, post) => {
          if (oldBase !== cfg.warDir) { changed = true; }
          return `${pre}${cfg.warDir}${post}`;
        }
      );
      xml = newXml4;
    }

    if (changed) {
      fs.writeFileSync(serverXml, xml, 'utf-8');
      log(t('logSrvUpdated'));
    }
  }

  // ── CATALINA_HOME → CATALINA_BASE 필수 파일 복사 ──
  if (cfg.catalinaHome) {
    for (const f of ['web.xml', 'logging.properties']) {
      const dest = path.join(cfg.confDir, f);
      const src  = path.join(cfg.catalinaHome, 'conf', f);
      if (!fs.existsSync(dest) && fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        log(t('logFileCopied', f));
      }
    }
  }

  log(`[Init] CATALINA_BASE = ${base}`);
  log(`[Init] App dir       = ${cfg.warDir}`);
  log(`[Init] contextPath   = ${cfg.contextPath}`);
  log(`[Init] PORT          = ${cfg.port} (redirect: ${cfg.redirectPort}, debug: ${cfg.debugPort})`);
}


// ══════════════════════════════════════════════════════════
//  Tomcat 시작
// ══════════════════════════════════════════════════════════
async function startTomcat() {
  if (tomcatRunning || orphanPid) {
    vscode.window.showWarningMessage(t('alreadyRunning'));
    return;
  }
  refreshTomcatBar('starting');

  const cfg = getConfig();

  const existingPid = findProcessByCatalinaBase(cfg.catalinaBase);
  if (existingPid) {
    const sel = await vscode.window.showWarningMessage(
      t('existingProcess', existingPid),
      t('forceKillAndStart'), t('cancel')
    );
    if (sel === t('forceKillAndStart')) {
      forceKillPid(existingPid);
      log(t('logExistingKill', existingPid));
      await new Promise(r => setTimeout(r, 2000));
    } else {
      refreshTomcatBar('stopped');
      return;
    }
  }

  if (!cfg.catalinaHome) {
    const ans = await vscode.window.showErrorMessage(
      t('catalinaRequired'),
      t('openSettings')
    );
    if (ans) vscode.commands.executeCommand('workbench.action.openSettings', 'tomcatAutoDeploy.catalinaHome');
    refreshTomcatBar('stopped');
    return;
  }

  if (await isPortInUse(cfg.port)) {
    const killed = await showPortConflict(cfg.port, 'httpPortInUse');
    if (!killed || await isPortInUse(cfg.port)) { refreshTomcatBar('stopped'); return; }
  }

  if (await isPortInUse(cfg.debugPort)) {
    const killed = await showPortConflict(cfg.debugPort, 'debugPortInUse');
    if (!killed || await isPortInUse(cfg.debugPort)) { refreshTomcatBar('stopped'); return; }
  }

  initTomcatBase();

  await syncAll();

  outputChannel.show(true);

  const isWin    = process.platform === 'win32';
  const catalina = path.join(cfg.catalinaHome, 'bin', isWin ? 'catalina.bat' : 'catalina.sh');
  const prevOpts = process.env.CATALINA_OPTS || '';
  const env = {
    ...process.env,
    JAVA_HOME:      cfg.javaHome || process.env.JAVA_HOME || '',
    CATALINA_HOME:  cfg.catalinaHome,
    CATALINA_BASE:  cfg.catalinaBase,
    JPDA_ADDRESS:   `localhost:${cfg.debugPort}`,
    JPDA_TRANSPORT: 'dt_socket',
    JPDA_SUSPEND:   'n',
    JAVA_OPTS:      (cfg.javaOpts || '').split(/\r?\n/).map(s => s.trim()).filter(Boolean).join(' '),
    CATALINA_OPTS:  prevOpts,
  };

  log(t('logJpdaStart', cfg.debugPort));

  tomcatProcess = spawn(catalina, ['jpda', 'run'], { env, shell: true, detached: !isWin });
  if (tomcatProcess.pid) savePid(tomcatProcess.pid);
  tomcatProcess.stdout.on('data', d => {
    for (const line of d.toString().split(/\r?\n/)) {
      if (line.trim()) log(`[OUT] ${line}`);
    }
  });
  tomcatProcess.stderr.on('data', d => {
    for (const line of d.toString().split(/\r?\n/)) {
      if (line.trim()) log(`[ERR] ${line}`, 'WARN');
    }
  });
  tomcatProcess.on('exit', code => {
    tomcatRunning = false;
    tomcatProcess = null;
    orphanPid = null;
    removePidFile();
    stopLocalhostLogWatch();
    refreshTomcatBar('stopped');
    log(t('logExit', code));
  });

  try {
    await waitForTomcat(cfg.port, 30000);
    tomcatRunning = true;
    refreshTomcatBar('running');
    startLocalhostLogWatch();
    vscode.window.showInformationMessage(
      t('tomcatStarted', cfg.port, cfg.contextPath),
      t('openBrowser')
    ).then(sel => {
      if (sel) vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${cfg.port}${cfg.contextPath}`));
    });
    log(t('logStarted', cfg.port, cfg.contextPath));
  } catch (err) {
    tomcatRunning = false;
    tomcatProcess?.kill();
    tomcatProcess = null;
    refreshTomcatBar('stopped');
    log(t('logStartFailed', err.message), 'ERROR');
    vscode.window.showErrorMessage(t('startupFailed', err.message));
    outputChannel.show(true);
  }
}

// Tomcat HTTP 응답 폴링
function waitForTomcat(port, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      const req = http.request(
        { hostname: 'localhost', port, path: '/', method: 'HEAD', timeout: 1000 },
        () => resolve()
      );
      req.on('error', () => {
        if (Date.now() > deadline) reject(new Error(t('startupTimeout')));
        else setTimeout(check, 800);
      });
      req.end();
    };
    check();
  });
}

// ══════════════════════════════════════════════════════════
//  Tomcat 중지
// ══════════════════════════════════════════════════════════
async function stopTomcat() {
  if (!tomcatRunning && !orphanPid) {
    vscode.window.showWarningMessage(t('notRunning'));
    return;
  }
  refreshTomcatBar('stopping');
  log(t('logStopReq'));

  if (orphanPid) {
    log(t('logOrphanKill', orphanPid), 'WARN');
    forceKillPid(orphanPid);
    orphanPid = null;
    tomcatRunning = false;
    removePidFile();
    refreshTomcatBar('stopped');
    log(t('logKillDone'));
    vscode.window.showInformationMessage(t('orphanKilled'));
    return;
  }

  if (tomcatProcess) {
    const proc = tomcatProcess;
    const pid  = proc.pid;

    const waitExit = new Promise(resolve => {
      proc.once('exit', resolve);
      setTimeout(resolve, 10000);
    });

    const isWin = process.platform === 'win32';
    if (isWin && pid) {
      log(`[Tomcat] taskkill /F /T /PID ${pid}`);
      try {
        require('child_process').execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', shell: true });
      } catch {}
    } else if (pid) {
      proc.kill('SIGTERM');
      log(t('logSigterm'));
      setTimeout(() => {
        if (tomcatProcess) {
          try { process.kill(-pid, 'SIGKILL'); } catch {}
          try { process.kill(pid, 'SIGKILL'); } catch {}
          log(t('logSigkill'), 'WARN');
        }
      }, 3000);
    }

    await waitExit;
    tomcatRunning = false;
    tomcatProcess = null;
    removePidFile();
    refreshTomcatBar('stopped');
    log(t('logStopDone'));
  }
}


// ══════════════════════════════════════════════════════════
//  localhost.yyyy-MM-dd.log 실시간 감시
// ══════════════════════════════════════════════════════════
function startLocalhostLogWatch() {
  stopLocalhostLogWatch();

  const cfg = getConfig();
  const logsDir = path.join(cfg.catalinaBase, 'logs');
  localhostLogOffset = 0;

  function getLogPath() {
    const d = new Date();
    const yyyy = d.getFullYear();
    const mm   = String(d.getMonth() + 1).padStart(2, '0');
    const dd   = String(d.getDate()).padStart(2, '0');
    return path.join(logsDir, `localhost.${yyyy}-${mm}-${dd}.log`);
  }

  function tailLog() {
    const logPath = getLogPath();
    if (!fs.existsSync(logPath)) return;
    const stat = fs.statSync(logPath);
    if (stat.size <= localhostLogOffset) return;

    const stream = fs.createReadStream(logPath, {
      start: localhostLogOffset,
      encoding: 'utf-8',
    });
    let buf = '';
    stream.on('data', chunk => { buf += chunk; });
    stream.on('end', () => {
      localhostLogOffset = stat.size;
      for (const line of buf.split(/\r?\n/)) {
        if (line.trim()) localhostLogChannel.appendLine(line);
      }
    });
  }

  fs.mkdirSync(logsDir, { recursive: true });
  localhostLogWatcher = fs.watch(logsDir, (eventType, filename) => {
    if (filename && filename.startsWith('localhost.') && filename.endsWith('.log')) {
      const currentLog = path.basename(getLogPath());
      if (filename !== currentLog) return;
      tailLog();
    }
  });

  tailLog();
  log(t('logLogWatch'));
}

function stopLocalhostLogWatch() {
  if (localhostLogWatcher) {
    localhostLogWatcher.close();
    localhostLogWatcher = null;
  }
  localhostLogOffset = 0;
}

// ══════════════════════════════════════════════════════════
//  Tomcat 강제 중지 (즉시 SIGKILL / taskkill /F)
// ══════════════════════════════════════════════════════════
async function forceStopTomcat() {
  if (!tomcatRunning && !orphanPid) {
    vscode.window.showWarningMessage(t('notRunning'));
    return;
  }
  refreshTomcatBar('stopping');
  log(t('logForceStopReq'));

  const pid = orphanPid || (tomcatProcess && tomcatProcess.pid);
  if (pid) {
    forceKillPid(pid);
    log(t('logForceStop', pid));
  }

  if (tomcatProcess) {
    await new Promise(resolve => {
      tomcatProcess.once('exit', resolve);
      setTimeout(resolve, 5000);
    });
  }

  tomcatRunning = false;
  tomcatProcess = null;
  orphanPid = null;
  removePidFile();
  refreshTomcatBar('stopped');
  log(t('logForceStopDone'));
  vscode.window.showInformationMessage(t('forceStopDone'));
}

// ══════════════════════════════════════════════════════════
//  Maven / Gradle 의존성 classpath 해석
// ══════════════════════════════════════════════════════════
function detectBuildTool(ws) {
  if (fs.existsSync(path.join(ws, 'pom.xml')))          return 'maven';
  if (fs.existsSync(path.join(ws, 'build.gradle')))     return 'gradle';
  if (fs.existsSync(path.join(ws, 'build.gradle.kts'))) return 'gradle';
  return null;
}

/**
 * pom.xml 또는 build.gradle에서 Java 소스/타겟 버전을 추출.
 */
function detectJavaVersion(ws) {
  const buildTool = detectBuildTool(ws);

  if (buildTool === 'maven') {
    try {
      const pom = fs.readFileSync(path.join(ws, 'pom.xml'), 'utf8');
      let source = null, target = null;

      const srcProp = pom.match(/<maven\.compiler\.source>\s*([^<]+?)\s*<\/maven\.compiler\.source>/);
      const tgtProp = pom.match(/<maven\.compiler\.target>\s*([^<]+?)\s*<\/maven\.compiler\.target>/);
      if (srcProp) source = srcProp[1];
      if (tgtProp) target = tgtProp[1];

      if (!source && !target) {
        const rel = pom.match(/<maven\.compiler\.release>\s*([^<]+?)\s*<\/maven\.compiler\.release>/);
        if (rel) { source = rel[1]; target = rel[1]; }
      }

      if (!source && !target) {
        const pluginSrc = pom.match(/<artifactId>\s*maven-compiler-plugin\s*<\/artifactId>[\s\S]*?<source>\s*([^<]+?)\s*<\/source>/);
        const pluginTgt = pom.match(/<artifactId>\s*maven-compiler-plugin\s*<\/artifactId>[\s\S]*?<target>\s*([^<]+?)\s*<\/target>/);
        if (pluginSrc) source = pluginSrc[1];
        if (pluginTgt) target = pluginTgt[1];
      }

      if (!source && !target) {
        const pluginRel = pom.match(/<artifactId>\s*maven-compiler-plugin\s*<\/artifactId>[\s\S]*?<release>\s*([^<]+?)\s*<\/release>/);
        if (pluginRel) { source = pluginRel[1]; target = pluginRel[1]; }
      }

      return { source, target };
    } catch (_) {}
  }

  if (buildTool === 'gradle') {
    for (const name of ['build.gradle', 'build.gradle.kts']) {
      const gpath = path.join(ws, name);
      if (!fs.existsSync(gpath)) continue;
      try {
        const gradle = fs.readFileSync(gpath, 'utf8');
        let source = null, target = null;

        const srcCompat = gradle.match(/sourceCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?([0-9_.]+)['"]?/);
        const tgtCompat = gradle.match(/targetCompatibility\s*=\s*(?:JavaVersion\.VERSION_)?['"]?([0-9_.]+)['"]?/);
        if (srcCompat) source = srcCompat[1].replace(/^1_/, '1.').replace(/_/g, '.');
        if (tgtCompat) target = tgtCompat[1].replace(/^1_/, '1.').replace(/_/g, '.');

        if (!source && !target) {
          const toolchain = gradle.match(/languageVersion\s*(?:=|\.set\s*\()\s*JavaLanguageVersion\.of\s*\(\s*(\d+)\s*\)/);
          if (toolchain) { source = toolchain[1]; target = toolchain[1]; }
        }

        if (source || target) return { source, target };
      } catch (_) {}
    }
  }

  return { source: null, target: null };
}

/**
 * Windows에서 실행 파일 찾기 (.cmd, .bat, .exe 순서)
 */
function findWinExe(dir, baseName) {
  for (const ext of ['.cmd', '.bat', '.exe']) {
    const p = path.join(dir, baseName + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

/**
 * Maven 실행 파일 경로 탐색: mvnw → MAVEN_HOME/M2_HOME → PATH
 */
function findMvnCmd(ws) {
  const isWin = process.platform === 'win32';

  if (isWin) {
    const w = findWinExe(ws, 'mvnw');
    if (w) return w;
  } else {
    const w = path.join(ws, 'mvnw');
    if (fs.existsSync(w)) return w;
  }

  for (const envVar of ['MAVEN_HOME', 'M2_HOME']) {
    const home = process.env[envVar];
    if (home) {
      if (isWin) {
        const found = findWinExe(path.join(home, 'bin'), 'mvn');
        if (found) return found;
      } else {
        const bin = path.join(home, 'bin', 'mvn');
        if (fs.existsSync(bin)) return bin;
      }
    }
  }

  return isWin ? 'mvn.cmd' : 'mvn';
}

/**
 * Gradle 실행 파일 경로 탐색: gradlew → GRADLE_HOME → PATH
 */
function findGradleCmd(ws) {
  const isWin = process.platform === 'win32';

  if (isWin) {
    const w = findWinExe(ws, 'gradlew');
    if (w) return w;
  } else {
    const w = path.join(ws, 'gradlew');
    if (fs.existsSync(w)) return w;
  }

  const home = process.env.GRADLE_HOME;
  if (home) {
    if (isWin) {
      const found = findWinExe(path.join(home, 'bin'), 'gradle');
      if (found) return found;
    } else {
      const bin = path.join(home, 'bin', 'gradle');
      if (fs.existsSync(bin)) return bin;
    }
  }

  return isWin ? 'gradle.bat' : 'gradle';
}

async function resolveDependencyClasspath() {
  const ws = getWorkspaceRoot();
  if (!ws) return '';

  if (cachedDepClasspath !== null) return cachedDepClasspath;

  const buildTool = detectBuildTool(ws);
  if (!buildTool) {
    cachedDepClasspath = '';
    return '';
  }

  const isWin = process.platform === 'win32';
  fs.mkdirSync(path.join(ws, '.vscode', 'tomcat'), { recursive: true });
  const cpFile = path.join(ws, '.vscode', 'tomcat', 'dep-classpath.txt');

  try {
    if (buildTool === 'maven') {
      const mvn = findMvnCmd(ws);
      log(t('logDepMvnResolve', mvn));
      await execAsync(
        `"${mvn}" dependency:build-classpath -Dmdep.outputFile=.vscode/tomcat/dep-classpath.txt -q`,
        { cwd: ws, timeout: 120000 }
      );
      if (fs.existsSync(cpFile)) {
        cachedDepClasspath = fs.readFileSync(cpFile, 'utf-8').trim();
        log(t('logDepMvnDone', cachedDepClasspath.split(isWin ? ';' : ':').length));
      } else {
        cachedDepClasspath = '';
        log(t('logDepMvnFail'), 'WARN');
      }
    } else {
      const gradleCmd = findGradleCmd(ws);
      log(t('logDepGradleResolve', gradleCmd));
      const initScript = path.join(ws, '.vscode', 'tomcat', 'cp-init.gradle');
      fs.writeFileSync(initScript, `
allprojects {
  task __printCp {
    doLast {
      def cp = configurations.findByName('compileClasspath')
      if (cp && cp.isCanBeResolved()) {
        new File("${cpFile.replace(/\\/g, '/')}").text = cp.resolve().join(File.pathSeparator)
      }
    }
  }
}
`, 'utf-8');
      await execAsync(
        `"${gradleCmd}" -q --init-script "${initScript}" __printCp`,
        { cwd: ws, timeout: 120000 }
      );
      if (fs.existsSync(cpFile)) {
        cachedDepClasspath = fs.readFileSync(cpFile, 'utf-8').trim();
        log(t('logDepGradleDone', cachedDepClasspath.split(isWin ? ';' : ':').length));
      } else {
        cachedDepClasspath = '';
        log(t('logDepGradleFail'), 'WARN');
      }
      try { fs.unlinkSync(initScript); } catch {}
    }
  } catch (err) {
    log(t('logDepFailed', err.message), 'ERROR');
    cachedDepClasspath = '';
  }

  return cachedDepClasspath;
}

function invalidateDepClasspath() {
  cachedDepClasspath = null;
  log(t('logDepInvalidated'));
}

// ══════════════════════════════════════════════════════════
//  포트 사용 여부 확인
// ══════════════════════════════════════════════════════════
function isPortInUse(port) {
  const net = require('net');
  return new Promise(resolve => {
    const server = net.createServer();
    server.once('error', () => resolve(true));
    server.once('listening', () => { server.close(); resolve(false); });
    server.listen(port, 'localhost');
  });
}

/**
 * 포트를 점유 중인 프로세스 목록 조회 (Windows / Unix)
 * 반환: [{ pid, name, detail }]
 */
async function findPortOwner(port) {
  const isWin = process.platform === 'win32';

  if (isWin) {
    try {
      const { stdout } = await execAsync(
        `netstat -ano | findstr "LISTENING" | findstr ":${port} "`,
        { encoding: 'utf-8', timeout: 5000 }
      );
      const pids = [...new Set(
        stdout.trim().split(/\r?\n/)
          .map(line => line.trim().split(/\s+/).pop())
          .filter(p => p && /^\d+$/.test(p))
      )];
      const results = [];
      for (const pid of pids) {
        try {
          const { stdout: info } = await execAsync(
            `tasklist /FI "PID eq ${pid}" /V /NH`,
            { encoding: 'utf-8', timeout: 5000 }
          );
          const line = info.trim().split(/\r?\n/).find(l => l.includes(pid));
          const name = line ? line.trim().split(/\s+/)[0] : 'unknown';
          results.push({ pid, name, detail: line ? line.trim() : `PID ${pid}` });
        } catch {
          results.push({ pid, name: 'unknown', detail: `PID ${pid}` });
        }
      }
      return results;
    } catch { return []; }
  }

  const isMac = process.platform === 'darwin';

  // ── macOS: lsof 사용 ──
  if (isMac) {
    const lsofCmd = `lsof -iTCP:${port} -sTCP:LISTEN -nP -F pcn`;
    for (const prefix of ['', 'sudo ']) {
      try {
        const { stdout } = await execAsync(prefix + lsofCmd, { encoding: 'utf-8', timeout: 5000 });
        if (!stdout.trim()) continue;
        const results = [];
        let pid = null, name = null;
        for (const line of stdout.trim().split(/\r?\n/)) {
          if (line.startsWith('p')) pid = line.slice(1);
          else if (line.startsWith('c')) name = line.slice(1);
          else if (line.startsWith('n') && pid) {
            results.push({ pid, name: name || 'unknown', detail: `PID ${pid} — ${name || 'unknown'}` });
            pid = null; name = null;
          }
        }
        if (pid) results.push({ pid, name: name || 'unknown', detail: `PID ${pid} — ${name || 'unknown'}` });
        if (results.length > 0) return results;
      } catch {}
    }
    return [];
  }

  // ── Linux: ss → netstat 순서, sudo 없이 → sudo 순서 ──
  // sudo 없이 실행하면 라인은 나오지만 프로세스 정보가 빠질 수 있으므로
  // PID 추출 성공 여부로 판단
  const pidRegex = /(?:,pid=|pid=)(\d+)|(\d+)\/\S+/g;

  function extractPids(text) {
    const found = new Set();
    for (const line of text.split(/\r?\n/)) {
      let m;
      pidRegex.lastIndex = 0;
      while ((m = pidRegex.exec(line)) !== null) {
        found.add(m[1] || m[2]);
      }
    }
    return [...found];
  }

  const cmds = [
    `ss -tnlp | grep ':${port} '`,
    `netstat -tnlp | grep ':${port} '`,
  ];
  let pids = [];
  for (const cmd of cmds) {
    for (const prefix of ['', 'sudo ']) {
      try {
        const { stdout } = await execAsync(prefix + cmd, { encoding: 'utf-8', timeout: 5000 });
        if (stdout.trim()) {
          const found = extractPids(stdout);
          if (found.length > 0) { pids = found; break; }
        }
      } catch {}
    }
    if (pids.length > 0) break;
  }

  const results = [];
  for (const pid of pids) {
    let detail = `PID ${pid}`;
    let name = 'unknown';
    const psCmd = `ps -p ${pid} -o pid=,user=,comm=,args=`;
    for (const prefix of ['', 'sudo ']) {
      try {
        const { stdout } = await execAsync(prefix + psCmd, { encoding: 'utf-8', timeout: 5000 });
        if (stdout.trim()) {
          detail = stdout.trim();
          const parts = detail.split(/\s+/);
          name = parts.length >= 3 ? parts[2] : 'unknown';
          break;
        }
      } catch {}
    }
    results.push({ pid, name, detail });
  }
  return results;
}

/**
 * 포트 충돌 시 점유 프로세스를 QuickPick으로 보여주고 Kill 버튼 제공
 * 반환: true면 kill 성공 → 재시도 가능, false면 사용자가 취소/설정 변경
 */
async function showPortConflict(port, msgKey) {
  let owners = await findPortOwner(port);

  // findPortOwner 실패 시 PID 파일을 마지막 수단으로 사용
  if (owners.length === 0) {
    const savedPid = readPid();
    if (savedPid && isProcessAlive(savedPid)) {
      owners = [{ pid: String(savedPid), name: 'java (tomcat.pid)', detail: `PID ${savedPid} — tomcat.pid` }];
    }
  }

  if (owners.length === 0) {
    const ans = await vscode.window.showErrorMessage(
      t(msgKey, port) + ' ' + t('portOwnerNotFound', port),
      t('openSettings')
    );
    if (ans) vscode.commands.executeCommand('workbench.action.openSettings', 'tomcatAutoDeploy');
    return false;
  }

  log(t('portOwnerFound', port));
  owners.forEach(o => log(`  PID ${o.pid} — ${o.detail}`));

  const items = owners.map(o => ({
    label: `$(close) PID ${o.pid}`,
    description: o.name,
    detail: o.detail,
    pid: o.pid,
  }));
  items.push({ label: `$(gear) ${t('openSettings')}`, description: '', detail: '', pid: null });

  const picked = await vscode.window.showQuickPick(items, {
    title: t(msgKey, port),
    placeHolder: t('portOwnerFound', port),
  });

  if (!picked) return false;

  if (!picked.pid) {
    vscode.commands.executeCommand('workbench.action.openSettings', 'tomcatAutoDeploy');
    return false;
  }

  const isWin = process.platform === 'win32';
  const isMac = process.platform === 'darwin';
  const pid = Number(picked.pid);
  try {
    if (isWin) {
      await execAsync(`taskkill /F /T /PID ${pid}`, { timeout: 5000 });
    } else if (isMac) {
      // macOS: process.kill()이 EPERM 발생할 수 있으므로 shell kill 단계적 시도
      let killed = false;
      try { process.kill(pid, 'SIGKILL'); killed = true; } catch {}
      if (!killed) {
        try { await execAsync(`kill -9 ${pid}`, { timeout: 5000 }); killed = true; } catch {}
      }
      if (!killed) {
        await execAsync(`sudo kill -9 ${pid}`, { timeout: 5000 });
      }
    } else {
      process.kill(pid, 'SIGKILL');
    }
    // macOS: 포트 해제가 느릴 수 있으므로 polling 대기 (최대 3초)
    if (isMac) {
      for (let i = 0; i < 6; i++) {
        await new Promise(r => setTimeout(r, 500));
        if (!await isPortInUse(port)) break;
      }
    } else {
      await new Promise(r => setTimeout(r, 1000));
    }
    log(t('portKillSuccess', pid));
    vscode.window.showInformationMessage(t('portKillSuccess', pid));
    return true;
  } catch (e) {
    // sudo로 재시도 (Linux)
    if (!isWin && !isMac) {
      try {
        await execAsync(`sudo kill -9 ${pid}`, { timeout: 5000 });
        log(t('portKillSuccess', pid));
        vscode.window.showInformationMessage(t('portKillSuccess', pid));
        await new Promise(r => setTimeout(r, 1000));
        return true;
      } catch (e2) { e = e2; }
    }
    log(t('portKillFail', pid, e.message), 'WARN');
    vscode.window.showErrorMessage(t('portKillFail', pid, e.message));
    return false;
  }
}

// ══════════════════════════════════════════════════════════
//  JDWP HotSwap: 클래스 바이트코드 교체 (컨텍스트 재시작 없음)
// ══════════════════════════════════════════════════════════
/**
 * JDWP HotSwap — 여러 클래스를 한번에 교체.
 * @param {number} port - JDWP 디버그 포트
 * @param {Array<{className: string, classBytes: Buffer}>} classes - 교체할 클래스 목록
 * @returns {Promise<'ok'|'not_loaded'>}
 */
function jdwpHotSwap(port, classes) {
  const net = require('net');

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, 'localhost');
    socket.setTimeout(5000);

    let nextId = 1;
    let refTypeIdSize = 8;
    let buf = Buffer.alloc(0);
    const cbs = new Map();
    let phase = 'handshake';

    socket.on('timeout', () => { socket.destroy(); reject(new Error(t('jdwpTimeout'))); });
    socket.on('error', err => { reject(new Error(t('jdwpConnFail', err.message))); });

    function send(cmdSet, cmd, data) {
      return new Promise((res, rej) => {
        const id = nextId++;
        const hdr = Buffer.alloc(11);
        hdr.writeUInt32BE(11 + data.length, 0);
        hdr.writeUInt32BE(id, 4);
        hdr.writeUInt8(0, 8);
        hdr.writeUInt8(cmdSet, 9);
        hdr.writeUInt8(cmd, 10);
        socket.write(Buffer.concat([hdr, data]));
        cbs.set(id, (err, d) => err ? rej(err) : res(d));
      });
    }

    function processReplies() {
      while (buf.length >= 11) {
        const pktLen = buf.readUInt32BE(0);
        if (buf.length < pktLen) break;
        const id      = buf.readUInt32BE(4);
        const flags   = buf.readUInt8(8);
        const errCode = buf.readUInt16BE(9);
        const data    = buf.slice(11, pktLen);
        buf = buf.slice(pktLen);

        if (flags & 0x80) {
          const cb = cbs.get(id);
          if (cb) {
            cbs.delete(id);
            cb(errCode ? new Error(t('jdwpError', errCode)) : null, data);
          }
        }
      }
    }

    socket.on('connect', () => socket.write('JDWP-Handshake'));

    socket.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);

      if (phase === 'handshake') {
        if (buf.length < 14) return;
        if (buf.slice(0, 14).toString() !== 'JDWP-Handshake') {
          socket.destroy();
          return reject(new Error(t('jdwpHandshakeFail')));
        }
        buf = buf.slice(14);
        phase = 'ready';
        doSwap();
      }
      if (phase === 'ready') processReplies();
    });

    async function doSwap() {
      try {
        const ids = await send(1, 7, Buffer.alloc(0));
        refTypeIdSize = ids.readInt32BE(12);

        // 각 클래스의 refTypeId 조회 (JVM에 로드된 것만)
        const loaded = [];
        for (const { className, classBytes } of classes) {
          const sig = 'L' + className.replace(/\./g, '/') + ';';
          const sigBuf = Buffer.alloc(4 + Buffer.byteLength(sig));
          sigBuf.writeInt32BE(Buffer.byteLength(sig), 0);
          sigBuf.write(sig, 4);
          const clsData = await send(1, 2, sigBuf);
          const count = clsData.readInt32BE(0);
          if (count > 0) {
            loaded.push({ refTypeId: clsData.slice(5, 5 + refTypeIdSize), classBytes });
          }
        }

        if (loaded.length === 0) {
          socket.destroy();
          return resolve('not_loaded');
        }

        // RedefineClasses — 로드된 클래스 모두 한번에 교체
        const totalSize = 4 + loaded.reduce(
          (sum, e) => sum + refTypeIdSize + 4 + e.classBytes.length, 0);
        const pkt = Buffer.alloc(totalSize);
        let off = 0;
        pkt.writeInt32BE(loaded.length, off); off += 4;
        for (const { refTypeId, classBytes } of loaded) {
          refTypeId.copy(pkt, off);  off += refTypeIdSize;
          pkt.writeInt32BE(classBytes.length, off); off += 4;
          classBytes.copy(pkt, off); off += classBytes.length;
        }

        await send(1, 18, pkt);
        socket.destroy();
        resolve('ok');
      } catch (err) {
        socket.destroy();
        reject(err);
      }
    }
  });
}

// ══════════════════════════════════════════════════════════
//  Java 컴파일 → .vscode/tomcat/war/WEB-INF/classes
// ══════════════════════════════════════════════════════════
async function compileAndDeploy(savedFilePath) {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const cfg        = getConfig();
  const classesDir = path.join(cfg.warDir, 'WEB-INF', 'classes');
  const srcRoot    = path.join(ws, cfg.javaSourceRoot);
  const javaBin    = cfg.javaHome ? path.join(cfg.javaHome, 'bin', 'javac') : 'javac';
  const fname      = path.basename(savedFilePath);

  fs.mkdirSync(classesDir, { recursive: true });

  const cpSep = process.platform === 'win32' ? ';' : ':';
  const cpParts = [classesDir];
  if (cfg.catalinaHome) {
    cpParts.push(path.join(cfg.catalinaHome, 'lib', '*'));
  }
  const depCp = await resolveDependencyClasspath();
  if (depCp) cpParts.push(depCp);
  cpParts.push(...cfg.classpath);
  const cp    = cpParts.join(cpSep);

  const javaVer = detectJavaVersion(ws);

  // javac @argfile 사용 — Windows 명령줄 길이 제한(8191자) 회피
  const argLines = ['-encoding', 'UTF-8'];
  if (javaVer.source) argLines.push('-source', javaVer.source);
  if (javaVer.target) argLines.push('-target', javaVer.target);
  argLines.push('-cp', cp, '-sourcepath', srcRoot, '-d', classesDir, savedFilePath);

  const argFile = path.join(ws, '.vscode', 'tomcat', 'javac-args.txt');
  fs.writeFileSync(argFile, argLines.map(a => `"${a.replace(/\\/g, '/')}"`).join('\n'), 'utf-8');

  const cmd = `"${javaBin}" @"${argFile}"`;

  log(t('logCompile', fname));
  refreshDeployBar('deploying', fname);

  try {
    const { stderr } = await execAsync(cmd);
    if (stderr) log(t('logStderr', stderr), 'WARN');
    refreshDeployBar('ok', fname);

    if (tomcatRunning) {
      const relPath   = path.relative(srcRoot, savedFilePath);
      const className = relPath.replace(/\.java$/, '').replace(/[/\\]/g, '.');
      const classFile = path.join(classesDir, relPath.replace(/\.java$/, '.class'));

      if (fs.existsSync(classFile)) {
        try {
          // 메인 클래스 + inner class ($1, $2, ...) 모두 수집
          const baseName = path.basename(savedFilePath, '.java');
          const classDir = path.dirname(classFile);
          const swapClasses = [{ className, classBytes: fs.readFileSync(classFile) }];
          for (const f of fs.readdirSync(classDir)) {
            if (f.startsWith(baseName + '$') && f.endsWith('.class')) {
              const innerName = className + '$' + f.slice(baseName.length + 1, -6);
              swapClasses.push({ className: innerName, classBytes: fs.readFileSync(path.join(classDir, f)) });
            }
          }
          const result = await jdwpHotSwap(cfg.debugPort, swapClasses);
          if (result === 'ok') {
            log(t('logHotSwapOk', savedFilePath));
          } else {
            log(t('logHotSwapSkip', className));
          }
        } catch (err) {
          log(t('logHotSwapFail', className, err.message), 'WARN');
        }
      }
    }
  } catch (err) {
    log(t('logCompileFail', err.message), 'ERROR');
    refreshDeployBar('err', fname);
    outputChannel.show(true);
  } finally {
    try { fs.unlinkSync(argFile); } catch {}
  }
}

// ══════════════════════════════════════════════════════════
//  JSP / Static → .vscode/tomcat/war
// ══════════════════════════════════════════════════════════
async function deployStatic(savedFilePath) {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const cfg        = getConfig();
  const webSrcRoot = path.join(ws, cfg.webContentRoot);
  const rel        = path.relative(webSrcRoot, savedFilePath);

  if (rel.startsWith('..')) return;

  const dest  = path.join(cfg.warDir, rel);
  const fname = path.basename(savedFilePath);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  refreshDeployBar('deploying', fname);

  try {
    fs.copyFileSync(savedFilePath, dest);
    log(`[Static] ${rel} → ${dest}`);
    refreshDeployBar('ok', fname);
  } catch (e) {
    log(`[Static] deploy failed: ${e.message}`, 'ERROR');
    refreshDeployBar('err', fname);
  }
}

async function deployResource(savedFilePath) {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const cfg        = getConfig();
  const resSrcRoot = path.join(ws, cfg.resourceRoot);
  const rel        = path.relative(resSrcRoot, savedFilePath);

  if (rel.startsWith('..')) return;

  const dest  = path.join(cfg.warDir, 'WEB-INF', 'classes', rel);
  const fname = path.basename(savedFilePath);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  refreshDeployBar('deploying', fname);

  try {
    fs.copyFileSync(savedFilePath, dest);
    log(`[Resource] ${rel} → WEB-INF/classes/${rel}`);
    refreshDeployBar('ok', fname);
  } catch (e) {
    log(`[Resource] deploy failed: ${e.message}`, 'ERROR');
    refreshDeployBar('err', fname);
  }
}

// ══════════════════════════════════════════════════════════
//  기동 시 전체 동기화 (Java 컴파일 + Static 복사)
// ══════════════════════════════════════════════════════════
function collectFiles(dir, ext) {
  const results = [];
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectFiles(full, ext));
    } else if (!ext || ext.includes(path.extname(entry.name).toLowerCase())) {
      results.push(full);
    }
  }
  return results;
}

function isFileChanged(src, dest) {
  if (!fs.existsSync(dest)) return true;
  const ss = fs.statSync(src);
  const ds = fs.statSync(dest);
  return ss.size !== ds.size || ss.mtimeMs > ds.mtimeMs;
}

function copyDirSync(srcDir, destDir, changedFiles) {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyDirSync(s, d, changedFiles);
    } else {
      if (isFileChanged(s, d)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(s, d);
        if (changedFiles) changedFiles.push(d);
        count++;
      }
    }
  }
  return count;
}

function copyDirSyncWithSkip(srcDir, destDir, skipDirs, changedFiles) {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      if (skipDirs && skipDirs.has(s)) continue;
      count += copyDirSyncWithSkip(s, d, skipDirs, changedFiles);
    } else {
      if (isFileChanged(s, d)) {
        fs.mkdirSync(destDir, { recursive: true });
        fs.copyFileSync(s, d);
        if (changedFiles) changedFiles.push(d);
        count++;
      }
    }
  }
  return count;
}

async function compileAllJava(ws, cfg, classesDir, depClasspath) {
  const srcRoot  = path.join(ws, cfg.javaSourceRoot);
  const javaFiles = collectFiles(srcRoot, ['.java']);
  if (javaFiles.length === 0) return;

  fs.mkdirSync(classesDir, { recursive: true });

  const javaBin = cfg.javaHome ? path.join(cfg.javaHome, 'bin', 'javac') : 'javac';
  const cpSep   = process.platform === 'win32' ? ';' : ':';
  const cpParts = [classesDir];
  if (cfg.catalinaHome) cpParts.push(path.join(cfg.catalinaHome, 'lib', '*'));
  if (depClasspath) cpParts.push(depClasspath);
  cpParts.push(...cfg.classpath);
  const cp = cpParts.join(cpSep);

  const javaVer = detectJavaVersion(ws);
  let versionFlags = '';
  if (javaVer.source) versionFlags += ` -source ${javaVer.source}`;
  if (javaVer.target) versionFlags += ` -target ${javaVer.target}`;

  // javac @argfile 사용 — Windows 명령줄 길이 제한(8191자) 회피
  const argLines = [
    '-encoding', 'UTF-8',
  ];
  if (javaVer.source) argLines.push('-source', javaVer.source);
  if (javaVer.target) argLines.push('-target', javaVer.target);
  argLines.push('-cp', cp, '-sourcepath', srcRoot, '-d', classesDir);
  javaFiles.forEach(f => argLines.push(f));

  const argFile = path.join(ws, '.vscode', 'tomcat', 'javac-args.txt');
  fs.mkdirSync(path.dirname(argFile), { recursive: true });
  fs.writeFileSync(argFile, argLines.map(a => `"${a.replace(/\\/g, '/')}"`).join('\n'), 'utf-8');

  const cmd = `"${javaBin}" @"${argFile}"`;

  log(t('logSyncCompiling', javaFiles.length));
  try {
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    log(t('logSyncCompileDone', javaFiles.length));
  } catch (err) {
    log(t('logSyncCompileFail', err.message), 'ERROR');
  } finally {
    try { fs.unlinkSync(argFile); } catch {}
  }
}

async function syncAll() {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const cfg        = getConfig();
  const srcRoot    = path.join(ws, cfg.javaSourceRoot);
  const webSrcRoot = path.join(ws, cfg.webContentRoot);
  const classesDir = path.join(cfg.warDir, 'WEB-INF', 'classes');
  const buildTool  = detectBuildTool(ws);
  const allChanged = [];

  log(t('logSyncStart'));

  // ── 의존성 classpath 미리 해석 (javac 폴백에서도 사용) ──
  let depCp = '';
  if (buildTool === 'maven' || buildTool === 'gradle') {
    depCp = await resolveDependencyClasspath() || '';
  }

  // ── 1) Java classes 동기화 ──
  // 익명/내부 클래스($포함) 제외, top-level class만 카운트
  const countTopLevelClasses = dir =>
    collectFiles(dir, ['.class']).filter(f => !path.basename(f, '.class').includes('$')).length;
  const javaCount     = collectFiles(srcRoot, ['.java']).length;
  const deployedCount = countTopLevelClasses(classesDir);

  if (buildTool === 'maven' || buildTool === 'gradle') {
    // Maven/Gradle: 소스 수 vs 배포 class 수 불일치 → 빌드 먼저 안내
    if (javaCount !== deployedCount) {
      log(t('logSyncClassCount', javaCount, deployedCount));
      const toolName = buildTool === 'maven' ? 'Maven' : 'Gradle';
      vscode.window.showWarningMessage(t('warnBuildFirst', javaCount, deployedCount, toolName));
    }
    // 빌드 산출물이 있으면 복사
    const buildDir = buildTool === 'maven'
      ? path.join(ws, 'target', 'classes')
      : path.join(ws, 'build', 'classes');
    if (fs.existsSync(buildDir)) {
      fs.mkdirSync(classesDir, { recursive: true });
      const count = copyDirSync(buildDir, classesDir, allChanged);
      const msgKey = buildTool === 'maven' ? 'logSyncMaven' : 'logSyncGradle';
      log(t(msgKey, count));
    } else {
      const warnKey = buildTool === 'maven' ? 'logSyncMavenWarn' : 'logSyncGradleWarn';
      log(t(warnKey), 'WARN');
      await compileAllJava(ws, cfg, classesDir, depCp);
    }
  } else {
    // 빌드 도구 없음 → 갯수 불일치 시 javac 전체 컴파일
    if (javaCount !== deployedCount) {
      log(t('logSyncClassCount', javaCount, deployedCount));
      vscode.window.showWarningMessage(t('logSyncClassCount', javaCount, deployedCount));
      await compileAllJava(ws, cfg, classesDir, '');
      // 컴파일 후 다시 비교 — 여전히 불일치면 주석된 Java 파일 존재 안내
      const recount = countTopLevelClasses(classesDir);
      if (javaCount !== recount) {
        log(t('warnCommentedJava', javaCount, recount), 'WARN');
        vscode.window.showWarningMessage(t('warnCommentedJava', javaCount, recount));
      }
    }
  }

  // ── 2) 의존성 JAR → WEB-INF/lib 복사 ──
  if (depCp) {
    const libDir = path.join(cfg.warDir, 'WEB-INF', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    const cpSep  = process.platform === 'win32' ? ';' : ':';
    const jars   = depCp.split(cpSep).filter(p => p.endsWith('.jar') && fs.existsSync(p));
    let jarCount = 0;
    for (const jar of jars) {
      const dest = path.join(libDir, path.basename(jar));
      try {
        if (fs.existsSync(dest) && fs.statSync(jar).size === fs.statSync(dest).size) continue;
        fs.copyFileSync(jar, dest);
        allChanged.push(dest);
        jarCount++;
      } catch (e) {
        log(t('logSyncJarFail', path.basename(jar), e.message), 'WARN');
      }
    }
    log(t('logSyncJarDone', jarCount, jars.length));
  }

  // ── 3) webContentRoot 전체 복사 ──
  if (fs.existsSync(webSrcRoot)) {
    const skipDirs = new Set(['classes', 'lib'].map(d =>
      path.join(webSrcRoot, 'WEB-INF', d)
    ));
    const copied = copyDirSyncWithSkip(webSrcRoot, cfg.warDir, skipDirs, allChanged);
    if (copied > 0) log(t('logSyncWebContent', copied));
  }

  // ── 4) resourceRoot → WEB-INF/classes 복사 ──
  const resSrcRoot = path.join(ws, cfg.resourceRoot);
  if (fs.existsSync(resSrcRoot)) {
    const copied = copyDirSync(resSrcRoot, classesDir, allChanged);
    if (copied > 0) log(t('logSyncResource', copied));
  }

  // ── 변경 파일 목록 출력 ──
  if (allChanged.length > 0) {
    const baseDir = cfg.warDir + path.sep;
    for (const f of allChanged) {
      const rel = f.startsWith(baseDir) ? f.slice(baseDir.length) : f;
      log(t('logSyncChanged', rel.replace(/\\/g, '/')));
    }
  } else {
    log(t('logSyncNoChange'));
  }

  log(t('logSyncDone', allChanged.length));
}

// ══════════════════════════════════════════════════════════
//  파일 저장 이벤트
// ══════════════════════════════════════════════════════════
async function onSaved(doc) {
  const fp  = doc.uri.fsPath;
  const ext = path.extname(fp).toLowerCase();

  if (ext === '.java') {
    await compileAndDeploy(fp);
    return;
  }

  const ws = getWorkspaceRoot();
  if (ws) {
    const cfg = getConfig();
    const webSrcRoot = path.join(ws, cfg.webContentRoot);
    const relWeb = path.relative(webSrcRoot, fp);
    if (!relWeb.startsWith('..')) { await deployStatic(fp); return; }

    const resSrcRoot = path.join(ws, cfg.resourceRoot);
    const relRes = path.relative(resSrcRoot, fp);
    if (!relRes.startsWith('..')) await deployResource(fp);
  }
}

// ══════════════════════════════════════════════════════════
//  .vscode/settings.json 초기화
// ══════════════════════════════════════════════════════════
async function ensureWorkspaceSettings() {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const vscodeDir  = path.join(ws, '.vscode');
  const settingsFile = path.join(vscodeDir, 'settings.json');

  const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
  if (cfg.get('catalinaHome', '')) return;

  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      const content = fs.readFileSync(settingsFile, 'utf-8');
      settings = JSON.parse(content);
    } catch {}
    if (Object.keys(settings).some(k => k.startsWith('tomcatAutoDeploy.'))) return;
  }

  settings['tomcatAutoDeploy.catalinaHome'] = '';
  settings['tomcatAutoDeploy.javaHome'] = '';
  settings['tomcatAutoDeploy.port'] = 8080;
  settings['tomcatAutoDeploy.debugPort'] = 5005;
  settings['tomcatAutoDeploy.redirectPort'] = 8443;
  settings['tomcatAutoDeploy.manualPortConfig'] = false;
  settings['tomcatAutoDeploy.contextPath'] = '/';
  settings['tomcatAutoDeploy.javaSourceRoot'] = 'src/main/java';
  settings['tomcatAutoDeploy.webContentRoot'] = 'src/main/webapp';
  settings['tomcatAutoDeploy.resourceRoot'] = 'src/main/resources';
  settings['tomcatAutoDeploy.classpath'] = [];
  settings['tomcatAutoDeploy.javaOpts'] = '-Dfile.encoding=UTF-8';

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
  log(t('logSettingsCreated'));

  const doc = await vscode.workspace.openTextDocument(settingsFile);
  await vscode.window.showTextDocument(doc);
  vscode.window.showWarningMessage(t('catalinaCheck'));
}

// ══════════════════════════════════════════════════════════
//  activate
// ══════════════════════════════════════════════════════════
function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Tomcat Auto Deploy');
  localhostLogChannel = vscode.window.createOutputChannel('Tomcat Localhost Log');
  outputChannel.show(true);

  let buildTime = t('devMode');
  try {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf-8'));
    buildTime = new Date(info.buildTime).toLocaleString(isKo ? 'ko-KR' : 'en-US');
  } catch {}
  log(t('logActivated', buildTime));

  ensureWorkspaceSettings();

  sbTomcat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  sbDeploy = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  refreshDeployBar('idle');
  context.subscriptions.push(sbTomcat, sbDeploy);

  if (!detectOrphanProcess()) {
    refreshTomcatBar('stopped');
  }

  tomcatTreeProvider = new TomcatTreeProvider();
  const treeView = vscode.window.createTreeView('tomcatServerView', {
    treeDataProvider: tomcatTreeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(onSaved));

  let updatingPorts = false;
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(async (e) => {
    if (updatingPorts) return;
    if (!e.affectsConfiguration('tomcatAutoDeploy')) return;
    const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
    if (cfg.get('manualPortConfig', false)) return;
    const port = cfg.get('port', 8080);
    const offset = port - 8080;
    const expectedDebug = 5005 + offset;
    const expectedRedirect = 8443 + offset;
    const target = vscode.ConfigurationTarget.Workspace;
    const curDebug = cfg.inspect('debugPort');
    const curRedirect = cfg.inspect('redirectPort');
    const needDebug = (curDebug.workspaceValue ?? curDebug.defaultValue) !== expectedDebug;
    const needRedirect = (curRedirect.workspaceValue ?? curRedirect.defaultValue) !== expectedRedirect;
    if (needDebug || needRedirect) {
      updatingPorts = true;
      try {
        if (needDebug) await cfg.update('debugPort', expectedDebug, target);
        if (needRedirect) await cfg.update('redirectPort', expectedRedirect, target);
      } finally {
        updatingPorts = false;
      }
    }
  }));

  const depWatcher = vscode.workspace.createFileSystemWatcher('**/{pom.xml,build.gradle,build.gradle.kts}');
  depWatcher.onDidChange(() => invalidateDepClasspath());
  depWatcher.onDidCreate(() => invalidateDepClasspath());
  depWatcher.onDidDelete(() => invalidateDepClasspath());
  context.subscriptions.push(depWatcher);

  const cmds = {
    'tomcatAutoDeploy.start':       startTomcat,
    'tomcatAutoDeploy.stop':        stopTomcat,
    'tomcatAutoDeploy.forceStop':   forceStopTomcat,
    'tomcatAutoDeploy.restart':     async () => { await stopTomcat(); await new Promise(r => setTimeout(r, 2000)); await startTomcat(); },
    'tomcatAutoDeploy.deployAll':   async () => { initTomcatBase(); await syncAll(); },
    'tomcatAutoDeploy.openBrowser': () => { const c = getConfig(); vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${c.port}${c.contextPath}`)); },
    'tomcatAutoDeploy.showOutput':  () => outputChannel.show(),
    'tomcatAutoDeploy.showLocalhostLog': () => localhostLogChannel.show(),
    'tomcatAutoDeploy.configure':   () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', { query: 'tomcatAutoDeploy' }),
    'tomcatAutoDeploy.openServerXml': () => {
      const cfg = getConfig();
      const serverXml = path.join(cfg.confDir, 'server.xml');
      if (!fs.existsSync(serverXml)) {
        initTomcatBase();
      }
      vscode.window.showTextDocument(vscode.Uri.file(serverXml));
    },
  };

  for (const [id, fn] of Object.entries(cmds)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }

  context.subscriptions.push({ dispose: () => {
    if (tomcatProcess && tomcatProcess.pid) {
      if (process.platform === 'win32') {
        try { require('child_process').execSync(`taskkill /F /T /PID ${tomcatProcess.pid}`, { stdio: 'ignore', shell: true }); } catch {}
      } else {
        tomcatProcess.kill('SIGTERM');
      }
    }
  }});

  if (isJavaWebProject()) {
    vscode.window.showInformationMessage(
      t('ready'),
      t('btnStart'), t('btnSettings')
    ).then(sel => {
      if (sel === t('btnStart')) startTomcat();
      if (sel === t('btnSettings')) vscode.commands.executeCommand('tomcatAutoDeploy.configure');
    });
  }
}

function deactivate() {
  stopLocalhostLogWatch();
  if (tomcatProcess && tomcatProcess.pid) {
    if (process.platform === 'win32') {
      try { require('child_process').execSync(`taskkill /F /T /PID ${tomcatProcess.pid}`, { stdio: 'ignore', shell: true }); } catch {}
    } else {
      tomcatProcess.kill('SIGTERM');
    }
    removePidFile();
  }
}

module.exports = { activate, deactivate };
