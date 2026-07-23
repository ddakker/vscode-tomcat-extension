// extension.js - Tomcat Auto Deploy VS Code Extension v2.0
'use strict';

const vscode  = require('vscode');
const path    = require('path');
const fs      = require('fs');
const http    = require('http');
const { exec, spawn } = require('child_process');
const { promisify }   = require('util');

const execAsync = promisify(exec);
const VERSION = require('./package.json').version;
const {
  makeInstanceConfig, findServerConflicts, flatToServerEntry,
} = require('./lib/instances');

// ══════════════════════════════════════════════════════════
//  i18n
// ══════════════════════════════════════════════════════════
const isKo = vscode.env.language.startsWith('ko');

const messages = {
  // TreeView
  deployAll:          ['배포',              'Deploy All'],
  buildAndDeploy:     ['빌드 후 배포',       'Build & Deploy'],
  syncStaticOnly:     ['웹/리소스 동기화', 'Sync Web/Resources'],
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
  openContextXml:     ['context.xml 열기',  'Open context.xml'],
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
  deployHotSwapWarn:  ['HotSwap 실패: {0}',   'HotSwap Failed: {0}'],

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
  ready:              [`Tomcat Auto Deploy v${VERSION} 준비됨 — 상태바에서 ▶/■ 클릭`,
                       `Tomcat Auto Deploy v${VERSION} ready — click ▶/■ in status bar`],
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
  logHotSwapBatch:    ['클래스 {0}개', '{0} classes'],
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
  syncCompileFailMsg: ['{0}: Java 컴파일 실패 — 출력 로그를 확인하세요.',
                       '{0}: Java compile failed — check the output log.'],
  logSyncJarFail:     ['[Sync] JAR 복사 실패: {0} → {1}',
                       '[Sync] JAR copy failed: {0} → {1}'],
  logSyncJarDone:     ['[Sync] 의존성 JAR → WEB-INF/lib ({0}개 복사, 총 {1}개)',
                       '[Sync] Dependency JARs → WEB-INF/lib ({0} copied, {1} total)'],
  logSyncWebContent:  ['[Sync] webContentRoot 전체 복사 ({0}개 파일)',
                       '[Sync] webContentRoot fully copied ({0} files)'],
  logSyncResource:    ['[Sync] resourceRoot → WEB-INF/classes ({0}개 파일)',
                       '[Sync] resourceRoot → WEB-INF/classes ({0} files)'],
  logSyncOrphanDeleted: ['[Sync] 소스에 없는 파일 삭제: {0}',
                       '[Sync] Deleted orphan file: {0}'],
  logSyncChanged:     ['[Sync]   ↳ {0}',               '[Sync]   ↳ {0}'],
  logSyncNoChange:    ['[Sync] 변경된 파일 없음',        '[Sync] No files changed'],
  logSyncDone:        ['[Sync] 전체 동기화 완료 (변경 {0}건)',
                       '[Sync] Full sync complete ({0} files changed)'],
  logStaticSyncStart: ['[Sync] 웹/리소스 동기화 시작...', '[Sync] Web/resource sync starting...'],
  logStaticSyncDone:  ['[Sync] 웹/리소스 동기화 완료 (변경 {0}건)',
                       '[Sync] Web/resource sync complete ({0} files changed)'],
  logBuildStart:      ['[Build] {0} 빌드 시작...',       '[Build] {0} build starting...'],
  logBuildDone:       ['[Build] {0} 빌드 완료',          '[Build] {0} build complete'],
  logBuildFail:       ['[Build] 빌드 실패:\n{0}',        '[Build] Build failed:\n{0}'],
  logAutoFullBuild:   ['[Sync] javac 컴파일 실패 → 전체 빌드/배포 자동 실행',
                       '[Sync] javac compile failed → auto running full build/deploy'],
  progressBuilding:   ['{0} 빌드 중...',              'Building {0}...'],
  progressSyncing:    ['{0} 동기화 중...',             'Syncing {0}...'],
  progressSyncingFiles: ['동기화 중...',               'Syncing...'],
  progressStaticSyncing: ['{0} 웹/리소스 동기화 중...', 'Syncing web/resources: {0}...'],
  logSettingsCreated: ['[Init] .vscode/settings.json에 기본 설정 생성',
                       '[Init] Default settings created in .vscode/settings.json'],
  logLogWatch:        ['[Log] localhost 로그 감시 시작', '[Log] Localhost log watch started'],
  logActivated:       [`Tomcat Auto Deploy v${VERSION} 활성화 (빌드: {0})`,
                       `Tomcat Auto Deploy v${VERSION} activated (build: {0})`],

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
const instances = new Map();   // name → InstanceState (동시 실행 지원)
const warnedOrphanFolders = new Set(); // 이미 경고 로그를 남긴 고아 인스턴스 폴더 (세션당 1회)
let outputChannel;             // 공통 [Deps]/[Sync]/[Build]/[Init]/[Java] 로그 (유지)
let sbTomcat;                  // 요약 상태바
let sbDeploy;                  // 공통 deploy 상태바
let cachedDepClasspath = null; // 공통 (소스·의존성 공통이므로 유지)

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
    if (element && (element.contextValue === 'tomcatDir' || element.contextValue === 'orphanInstanceFolder')) {
      return this._getDirChildren(element.resourceUri.fsPath);
    }
    // 인스턴스 노드의 하위 항목
    if (element && element.instanceName) {
      return this._getInstanceChildren(getInstance(element.instanceName));
    }
    if (element) return [];

    // ── 루트: ① 안내(미설정) → ② 전체 제어 헤더 → ③ 인스턴스들 → ④ 빌드/배포 ──
    const items  = [];
    const common = getCommonConfig();
    const all    = [...instances.values()];

    // ① 빈/최초 상태: catalinaHome 미설정 → 설정 유도
    if (!common.catalinaHome) {
      const setup = new vscode.TreeItem(
        isKo ? '먼저 Tomcat 경로를 설정하세요' : 'Configure Tomcat path first',
        vscode.TreeItemCollapsibleState.None
      );
      setup.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      setup.command  = { command: 'tomcatAutoDeploy.configure', title: t('settings') };
      items.push(setup);
    }

    // ② 전체 제어 헤더 (인라인 startAll/stopAll)
    const running = all.filter(i => i.running || i.orphanPid).length;
    const header = new vscode.TreeItem(
      isKo ? '전체 제어' : 'All Servers',
      vscode.TreeItemCollapsibleState.None
    );
    header.description  = `${running}/${all.length}`;
    header.iconPath     = new vscode.ThemeIcon('server-process');
    header.contextValue = 'controlHeader';
    header.tooltip      = isKo ? '모두 시작 / 모두 정지' : 'Start All / Stop All';
    items.push(header);

    // ③ 인스턴스 노드
    for (const inst of all) {
      items.push(this._makeInstanceItem(inst));
    }

    // ③-1 설정에서 제거됐지만 디스크에 남은 고아 인스턴스 폴더 — 자동 삭제하지 않고 안내만
    for (const dir of getOrphanInstanceFolders()) {
      const name = path.basename(dir);
      const orphan = this._makeDirItem(dir, name);
      orphan.contextValue = 'orphanInstanceFolder';
      orphan.description = isKo ? '설정에 없음 · 삭제 가능' : 'not in settings · deletable';
      orphan.iconPath = new vscode.ThemeIcon('warning', new vscode.ThemeColor('list.warningForeground'));
      orphan.tooltip = isKo
        ? `.vscode/tomcat/${name}/ — 인스턴스 설정에서 제거되어 더 이상 사용되지 않습니다.\n` +
          `로그/컴파일 캐시가 남아있을 수 있으니 필요 없으면 우측 휴지통 버튼으로 삭제하세요.`
        : `.vscode/tomcat/${name}/ — no longer used (removed from instance settings).\n` +
          `May still contain logs/build cache — use the trash button to delete if not needed.`;
      items.push(orphan);
    }

    // ④ 배포 파일 — 모든 인스턴스가 공유하는 docBase 디렉토리
    const sharedWar = all.length ? all[0].warDir : null;
    if (sharedWar && fs.existsSync(sharedWar)) {
      items.push(this._makeDirItem(sharedWar, isKo ? '배포 파일 (docBase)' : 'Deployed files (docBase)'));
    }

    // ⑤ 공통 빌드/배포
    const buildTool = detectBuildTool(getWorkspaceRoot() || '');
    if (buildTool) {
      const build = new vscode.TreeItem(
        isKo ? '재빌드+동기화' : 'Rebuild+Sync',
        vscode.TreeItemCollapsibleState.None
      );
      if (rebuildAllStatus) {
        build.description = rebuildAllStatus;
        build.iconPath    = new vscode.ThemeIcon('sync', new vscode.ThemeColor('testing.iconQueued'));
      } else {
        build.iconPath = new vscode.ThemeIcon('tools');
      }
      build.command  = { command: 'tomcatAutoDeploy.buildAndDeploy', title: t('buildAndDeploy') };
      build.tooltip  = isKo
        ? 'Maven/Gradle 빌드 실행 → 전체 동기화\n(java 컴파일 + 의존성 JAR + 웹/리소스 전체 복사 + 실행 중이면 HotSwap 적용)\nJava 소스가 빌드 산출물(target/classes 등)에 아직 반영 안 됐을 때 사용'
        : 'Run Maven/Gradle build → full sync\n(java compile + dependency JARs + all web/resource files + HotSwap if running)\nUse when Java sources are not yet reflected in the build output (target/classes, etc.)';
      items.push(build);
    }

    // ⑥ 재빌드 없이 전체 동기화 (java 컴파일 스킵 체크 + 정적파일 전체, 의존성 JAR 포함)
    const syncAllItem = new vscode.TreeItem(
      isKo ? '전체동기화' : 'Full Sync',
      vscode.TreeItemCollapsibleState.None
    );
    if (syncAllStatus) {
      syncAllItem.description = syncAllStatus;
      syncAllItem.iconPath    = new vscode.ThemeIcon('sync', new vscode.ThemeColor('testing.iconQueued'));
    } else {
      syncAllItem.iconPath = new vscode.ThemeIcon('cloud-upload');
    }
    syncAllItem.command = { command: 'tomcatAutoDeploy.deployAll', title: t('deployAll') };
    syncAllItem.tooltip = isKo
      ? 'Maven/Gradle 빌드 없이 전체 동기화\n(java 증분 컴파일 + 의존성 JAR + 웹/리소스 전체 복사 + 실행 중이면 HotSwap 적용)\n빌드 단계를 건너뛰고 바로 배포'
      : 'Full sync without Maven/Gradle build\n(incremental java compile + dependency JARs + all web/resource files + HotSwap if running)\nSkips the build step and deploys directly';
    items.push(syncAllItem);

    // ⑦ webContentRoot + resourceRoot만 동기화 — java 컴파일/의존성 JAR 처리 없음
    const syncStaticItem = new vscode.TreeItem(
      isKo ? '웹/리소스동기화' : 'Web/Resources Sync',
      vscode.TreeItemCollapsibleState.None
    );
    if (syncStaticStatus) {
      syncStaticItem.description = syncStaticStatus;
      syncStaticItem.iconPath    = new vscode.ThemeIcon('sync', new vscode.ThemeColor('testing.iconQueued'));
    } else {
      syncStaticItem.iconPath = new vscode.ThemeIcon('file-media');
    }
    syncStaticItem.command = { command: 'tomcatAutoDeploy.syncStaticOnly', title: t('syncStaticOnly') };
    syncStaticItem.tooltip = isKo
      ? 'jsp/html/js/css/이미지/설정파일 등 webContentRoot + resourceRoot 전체 동기화\njava 컴파일/의존성 JAR 처리 없음 — 가장 빠름\njsp/js/css 등 화면·리소스 파일만 변경됐을 때 사용'
      : 'Sync entire webContentRoot + resourceRoot (jsp/html/js/css/images/config files, etc.)\nNo java compile or dependency JAR handling — fastest\nUse when only jsp/js/css or other web/resource files changed';
    items.push(syncStaticItem);

    return items;
  }

  // 인스턴스 1개의 루트 노드 (3-상태 아이콘 + contextValue → 인라인 버튼 제어)
  _makeInstanceItem(inst) {
    const item = new vscode.TreeItem(inst.name, vscode.TreeItemCollapsibleState.Collapsed);
    item.instanceName = inst.name;
    if (inst.starting) {
      item.description  = `:${inst.port} ${isKo ? '기동중…' : 'starting…'}`;
      item.iconPath     = new vscode.ThemeIcon('sync', new vscode.ThemeColor('testing.iconQueued'));
      item.contextValue = 'instanceStarting';
    } else if (inst.running || inst.orphanPid) {
      const st = inst.orphanPid ? (isKo ? '외부 실행' : 'orphan') : (isKo ? '실행중' : 'running');
      if (inst.hotSwapFailed) {
        item.description  = `:${inst.port} ${st} · ${isKo ? 'HotSwap 실패 — 재기동 필요' : 'HotSwap failed — restart needed'}`;
        item.iconPath     = new vscode.ThemeIcon('error', new vscode.ThemeColor('list.errorForeground'));
        item.tooltip      = isKo
          ? '구조가 변경된 클래스가 있어 HotSwap이 실패했습니다. 최신 코드를 반영하려면 이 인스턴스를 재기동하세요.'
          : 'HotSwap failed because a class structure changed. Restart this instance to apply the latest code.';
      } else {
        item.description  = `:${inst.port} ${st}`;
        item.iconPath     = new vscode.ThemeIcon('vm-running', new vscode.ThemeColor('testing.iconPassed'));
      }
      item.contextValue = 'instanceRunning';
    } else {
      item.description  = `:${inst.port} ${isKo ? '정지' : 'stopped'}`;
      item.iconPath     = new vscode.ThemeIcon('vm-outline', new vscode.ThemeColor('testing.iconSkipped'));
      item.contextValue = 'instanceStopped';
    }
    return item;
  }

  // 인스턴스 노드의 하위 액션/디렉토리
  _getInstanceChildren(inst) {
    if (!inst) return [];
    const items = [];
    const arg = { instanceName: inst.name };
    const ctxPath = inst.contextPath || '/';

    if (inst.running || inst.orphanPid) {
      const browser = new vscode.TreeItem(t('openBrowser'), vscode.TreeItemCollapsibleState.None);
      browser.iconPath    = new vscode.ThemeIcon('globe');
      browser.description = `http://localhost:${inst.port}${ctxPath}`;
      browser.command     = { command: 'tomcatAutoDeploy.openBrowser', title: t('openBrowser'), arguments: [arg] };
      items.push(browser);
    }

    const out = new vscode.TreeItem(t('showOutput'), vscode.TreeItemCollapsibleState.None);
    out.iconPath = new vscode.ThemeIcon('output');
    out.command  = { command: 'tomcatAutoDeploy.showOutput', title: t('showOutput'), arguments: [arg] };
    items.push(out);

    const lh = new vscode.TreeItem(t('localhostLog'), vscode.TreeItemCollapsibleState.None);
    lh.iconPath = new vscode.ThemeIcon('file-text');
    lh.command  = { command: 'tomcatAutoDeploy.showLocalhostLog', title: t('localhostLog'), arguments: [arg] };
    items.push(lh);

    const sx = new vscode.TreeItem(t('openServerXml'), vscode.TreeItemCollapsibleState.None);
    sx.iconPath = new vscode.ThemeIcon('file-code');
    sx.command  = { command: 'tomcatAutoDeploy.openServerXml', title: t('openServerXml'), arguments: [arg] };
    items.push(sx);

    const cx = new vscode.TreeItem(t('openContextXml'), vscode.TreeItemCollapsibleState.None);
    cx.iconPath = new vscode.ThemeIcon('file-code');
    cx.command  = { command: 'tomcatAutoDeploy.openContextXml', title: t('openContextXml'), arguments: [arg] };
    items.push(cx);

    if (inst.catalinaBase && fs.existsSync(inst.catalinaBase)) {
      items.push(this._makeDirItem(inst.catalinaBase, 'CATALINA_BASE'));
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
let rebuildAllStatus   = null; // 진행 중인 "전체 재빌드 후 동기화" 상태 메시지 (없으면 null)
let syncAllStatus      = null; // 진행 중인 "전체 동기화 (재빌드 없이)" 상태 메시지
let syncStaticStatus   = null; // 진행 중인 "웹/리소스 동기화" 상태 메시지

// ══════════════════════════════════════════════════════════
//  설정
// ══════════════════════════════════════════════════════════
// 공통 설정 (인스턴스 무관). catalinaHome/javaHome/javaOpts 는 인스턴스 미지정 시 폴백 소스이기도 하다.
function getCommonConfig() {
  const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
  return {
    catalinaHome:   cfg.get('catalinaHome', ''),
    javaHome:       cfg.get('javaHome', ''),
    javaOpts:       cfg.get('javaOpts', ''),
    javaSourceRoot: cfg.get('javaSourceRoot', 'src/main/java'),
    webContentRoot: cfg.get('webContentRoot', 'src/main/webapp'),
    resourceRoot:   cfg.get('resourceRoot', 'src/main/resources'),
    classpath:      cfg.get('classpath', []),
    contextPath:    cfg.get('contextPath', '/'),
  };
}

// 기본 인스턴스 이름 (설정에서 읽음, 기본값 "default")
function getDefaultInstanceName() {
  const name = vscode.workspace.getConfiguration('tomcatAutoDeploy').get('instanceName', 'default');
  return (name && typeof name === 'string' && name.trim()) ? name.trim() : 'default';
}

// 기본 인스턴스 객체 (없으면 null)
function getDefaultInstance() {
  return instances.get(getDefaultInstanceName()) || null;
}

// servers 설정.
//  - 기본 인스턴스는 "항상" 평면 UI 설정(port/debugPort/redirectPort)으로 구성 → 서버를 추가하지 않으면 이거 하나
//  - servers 배열은 기본 인스턴스 외의 "추가" 인스턴스 목록 (트리 + 버튼/배열 편집으로 늘어남)
function getServers() {
  const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
  const def = flatToServerEntry({
    name:             getDefaultInstanceName(),
    port:             cfg.get('port', 8080),
    debugPort:        cfg.get('debugPort', 5005),
    redirectPort:     cfg.get('redirectPort', 8443),
    manualPortConfig: cfg.get('manualPortConfig', false),
  });
  return [def, ...getExtraServers(def.name)];
}

// servers 배열에서 기본 인스턴스를 제외한 "추가" 인스턴스만 (기본 인스턴스는 평면 설정 소유)
function getExtraServers(defaultName) {
  const name = defaultName ?? getDefaultInstanceName();
  const servers = vscode.workspace.getConfiguration('tomcatAutoDeploy').get('servers', []);
  if (!Array.isArray(servers)) return [];
  return servers.filter(s => s && typeof s.name === 'string' && s.name !== name);
}

// 의존성 캐시 등 인스턴스 공용 디렉토리 (.vscode/tomcat/ 직하)
function getTomcatRoot() {
  return path.join(getWorkspaceRoot() || '', '.vscode', 'tomcat');
}
function getBuildClassesDir() {
  return path.join(getTomcatRoot(), '.build', 'classes');
}

let warnedMixedCatalinaHome = false;
// 공통 1회 컴파일용 설정. catalinaHome은 첫 인스턴스의 effective 값을 대표로 사용.
function getCompileConfig(common) {
  const servers = getServers();
  let repHome = '';
  const homes = new Set();
  for (const s of servers) {
    const ch = s.catalinaHome ?? common.catalinaHome ?? '';
    if (ch) { homes.add(ch); if (!repHome) repHome = ch; }
  }
  if (!repHome) repHome = common.catalinaHome || '';
  if (homes.size > 1 && !warnedMixedCatalinaHome) {
    warnedMixedCatalinaHome = true;
    log('[Sync] 인스턴스마다 catalinaHome이 다릅니다 — 공통 컴파일은 첫 인스턴스(' +
        repHome + ') 기준. Tomcat9(javax)/10(jakarta) 혼용 시 일부 인스턴스 컴파일 오류 가능.', 'WARN');
  }
  return {
    javaHome:       common.javaHome,
    catalinaHome:   repHome,
    classpath:      common.classpath,
    javaSourceRoot: common.javaSourceRoot,
    resourceRoot:   common.resourceRoot,
  };
}

// .build/classes → inst.warDir/WEB-INF/classes 복사 + inst classes 고아 정리
// warDir는 모든 인스턴스가 공유하는 단일 배포 디렉토리 (lib/instances.js 참고)
function copyBuildToWarDir(warDir, common, allChanged) {
  const ws = getWorkspaceRoot() || '';
  const buildClassesDir = getBuildClassesDir();
  const classesDir = path.join(warDir, 'WEB-INF', 'classes');
  fs.mkdirSync(classesDir, { recursive: true });

  // 소스/리소스에 없는 .class·리소스 정리
  const srcRoot    = path.join(ws, common.javaSourceRoot);
  const resSrcRoot = path.join(ws, common.resourceRoot);
  const genSourcesDirs = [];
  const buildTool = detectBuildTool(ws);
  if (buildTool) {
    const genBase = buildTool === 'maven'
      ? path.join(ws, 'target', 'generated-sources')
      : path.join(ws, 'build', 'generated', 'sources');
    if (fs.existsSync(genBase)) {
      for (const e of fs.readdirSync(genBase, { withFileTypes: true })) {
        if (e.isDirectory()) genSourcesDirs.push(path.join(genBase, e.name));
      }
    }
  }
  purgeOrphanClasses(srcRoot, genSourcesDirs, resSrcRoot, classesDir);

  if (fs.existsSync(buildClassesDir)) {
    return copyDirSync(buildClassesDir, classesDir, allChanged);
  }
  return 0;
}

// 새 InstanceState 생성 (정적 파생 + 런타임 필드)
function makeInstanceState(server, common, ws) {
  return {
    ...makeInstanceConfig(server, common, ws),
    proc: null, running: false, starting: false, orphanPid: null,
    logChannel: null, localhostChannel: null, logWatcher: null, logOffset: 0,
    lineRaw: false,
  };
}

function getInstance(name) { return instances.get(name); }
function runningInstances() { return [...instances.values()].filter(i => i.running || i.orphanPid); }
function anyRunning()  { return [...instances.values()].some(i => i.running || i.orphanPid); }
function anyStarting() { return [...instances.values()].some(i => i.starting); }

// 설정(servers) ↔ instances Map 재조정.
//  - 신규 → 추가
//  - 제거 → 정지 상태인 것만 Map에서 제거 + 채널/워처 정리
//  - port 등 변경 → 정지 상태일 때만 갱신 (실행 중이면 보류 후 경고)
function syncInstances() {
  const ws     = getWorkspaceRoot() || '';
  const common = getCommonConfig();
  const servers = getServers();

  // 이름/포트 충돌 경고
  for (const w of findServerConflicts(servers, common, ws)) {
    log(`[Config] ${w}`, 'WARN');
    vscode.window.showWarningMessage(`Tomcat: ${w}`);
  }

  const wantNames = new Set();
  for (const server of servers) {
    if (!server || !server.name || typeof server.port !== 'number') continue;
    wantNames.add(server.name);
    const fresh = makeInstanceState(server, common, ws);
    const cur = instances.get(server.name);
    if (!cur) {
      instances.set(server.name, fresh);
    } else if (!cur.running && !cur.starting && !cur.orphanPid) {
      // 정지 상태 → 정적 설정만 갱신 (런타임 필드/채널 보존)
      Object.assign(cur, {
        port: fresh.port, debugPort: fresh.debugPort, redirectPort: fresh.redirectPort,
        catalinaHome: fresh.catalinaHome, javaHome: fresh.javaHome, javaOpts: fresh.javaOpts,
        contextPath: fresh.contextPath, catalinaBase: fresh.catalinaBase,
        warDir: fresh.warDir, confDir: fresh.confDir,
      });
    } else {
      // 실행 중 → 변경 보류 (다음 재시작 때 반영)
      if (cur.port !== fresh.port || cur.debugPort !== fresh.debugPort || cur.javaOpts !== fresh.javaOpts) {
        log(`[Config] "${server.name}" 실행 중 — 설정 변경은 다음 재시작 때 반영됩니다.`, 'WARN');
      }
    }
  }

  // 설정에서 사라진 인스턴스 — 정지 상태인 것만 제거
  for (const [name, inst] of [...instances.entries()]) {
    if (wantNames.has(name)) continue;
    if (inst.running || inst.starting || inst.orphanPid) {
      log(`[Config] "${name}" 설정에서 제거됨 — 실행 중이라 정지 후 반영됩니다.`, 'WARN');
      continue;
    }
    disposeInstanceChannels(inst);
    instances.delete(name);
  }

  // 설정에서 제거됐지만 디스크에 남은 인스턴스 폴더 — 자동 삭제하지 않고 안내만 (트리뷰 + 최초 1회 로그)
  for (const dir of getOrphanInstanceFolders()) {
    if (warnedOrphanFolders.has(dir)) continue;
    warnedOrphanFolders.add(dir);
    log(`[Config] 설정에 없는 인스턴스 폴더 발견: .vscode/tomcat/${path.basename(dir)}/ ` +
        `(자동 삭제하지 않음 — 필요 없으면 수동으로 삭제하세요)`, 'WARN');
  }
}

// 기동 직전 최신 설정을 다시 읽어 인스턴스에 반영한다.
// syncInstances 는 실행 중인 인스턴스를 건너뛰므로, 실행 중에 바꾼 설정(javaOpts/포트 등)을
// 여기서 반영하지 않으면 재시작해도 옛 값으로 뜬다.
function reloadInstanceConfig(inst) {
  const server = getServers().find(s => s && s.name === inst.name && typeof s.port === 'number');
  if (!server) return;
  Object.assign(inst, makeInstanceConfig(server, getCommonConfig(), getWorkspaceRoot() || ''));
}

// 설정(instances Map)에 없는 .vscode/tomcat/<name> 폴더 목록.
// webapp(공유 docBase)/.build(공유 빌드 캐시)는 인스턴스 폴더가 아니므로 제외.
function getOrphanInstanceFolders() {
  const root = getTomcatRoot();
  if (!root || !fs.existsSync(root)) return [];
  const reserved = new Set(['webapp', '.build']);
  try {
    return fs.readdirSync(root, { withFileTypes: true })
      .filter(e => e.isDirectory() && !reserved.has(e.name) && !instances.has(e.name))
      .map(e => path.join(root, e.name));
  } catch { return []; }
}

function disposeInstanceChannels(inst) {
  try { inst.logWatcher && inst.logWatcher.close(); } catch {}
  inst.logWatcher = null;
  try { inst.logChannel && inst.logChannel.dispose(); } catch {}
  try { inst.localhostChannel && inst.localhostChannel.dispose(); } catch {}
  inst.logChannel = inst.localhostChannel = null;
}

// 인스턴스 콘솔(stdout/stderr) 채널 — lazy 생성
function getLogChannel(inst) {
  if (!inst.logChannel) {
    inst.logChannel = vscode.window.createOutputChannel(`Tomcat: ${inst.name}`);
  }
  return inst.logChannel;
}

// 인스턴스 localhost 접근 로그 채널 — lazy 생성
function getLocalhostChannel(inst) {
  if (!inst.localhostChannel) {
    inst.localhostChannel = vscode.window.createOutputChannel(`Tomcat Localhost: ${inst.name}`);
  }
  return inst.localhostChannel;
}

// 인스턴스 콘솔 채널에 타임스탬프 로그 한 줄
function logTo(inst, msg, level = 'INFO') {
  const ts = new Date().toLocaleTimeString(isKo ? 'ko-KR' : 'en-US');
  getLogChannel(inst).appendLine(`[${ts}] [${level}] ${msg}`);
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

// 줄 맨 앞이 자체 타임스탬프로 시작하는지 판단 (두 형식 모두 지원)
//  - 애플리케이션(logback/log4j): 2026-06-05 15:14:45,969
//  - Tomcat JULI 기본 형식:       05-Jun-2026 15:14:45.969
const HAS_OWN_TIMESTAMP =
  /^(\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}|\d{2}-[A-Za-z]{3}-\d{4} \d{2}:\d{2}:\d{2})/;

// Tomcat 로그 한 줄을 출력 문자열로 변환 (연속 줄 판단은 inst.lineRaw 기반 — 인스턴스별 분리)
//  - 자체 날짜로 시작하면 [시각] [레벨] 접두사 없이 원본 그대로
//  - 직전 줄이 원본이었던 연속 줄(스택트레이스 등)도 원본 그대로 유지
//  - 그 외(부팅 메시지 등)만 접두사 부착
function formatTomcatLine(inst, line, level) {
  if (HAS_OWN_TIMESTAMP.test(line)) {
    inst.lineRaw = true;
  } else if (!inst.lineRaw) {
    const ts = new Date().toLocaleTimeString(isKo ? 'ko-KR' : 'en-US');
    return `[${ts}] [${level}] ${line}`;
  }
  return line;
}

// stdout/stderr 한 청크를 인스턴스 채널에 한 번의 append로 출력 (스크롤 튐 방지)
function logTomcatChunk(inst, data, level) {
  const lines = [];
  for (const line of data.toString().split(/\r?\n/)) {
    if (line.trim()) lines.push(formatTomcatLine(inst, line, level));
  }
  if (lines.length) getLogChannel(inst).append(lines.join('\n') + '\n');
}

// ══════════════════════════════════════════════════════════
//  상태바 - Tomcat 제어
// ══════════════════════════════════════════════════════════
// 모든 인스턴스 상태 요약 (running/total). 클릭 → pickInstance QuickPick.
function refreshTomcatBar() {
  if (!sbTomcat) return;
  const all = [...instances.values()];
  const running = all.filter(i => i.running || i.orphanPid).length;
  const starting = anyStarting();
  const icon = starting ? '$(sync~spin)' : '$(server)';
  sbTomcat.text = `${icon} Tomcat ${running}/${all.length}`;
  sbTomcat.tooltip = all.length
    ? all.map(i => {
        const st = i.orphanPid ? 'orphan' : i.starting ? 'starting' : i.running ? 'running' : 'stopped';
        return `${i.name}: ${st} (:${i.port})`;
      }).join('\n')
    : 'Tomcat';
  sbTomcat.backgroundColor = running > 0
    ? new vscode.ThemeColor('statusBarItem.warningBackground') : undefined;
  sbTomcat.command = 'tomcatAutoDeploy.pickInstance';
  sbTomcat.show();

  vscode.commands.executeCommand('setContext', 'tomcatAutoDeploy.running', running > 0);
  vscode.commands.executeCommand('setContext', 'tomcatAutoDeploy.starting', starting);
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
    warn:      { text: `$(error) ${t('deployHotSwapWarn', filename || '')}`, bg: new vscode.ThemeColor('statusBarItem.errorBackground') },
  };
  const m = map[state] || map.idle;
  sbDeploy.text            = m.text;
  sbDeploy.backgroundColor = m.bg;
  sbDeploy.command         = 'tomcatAutoDeploy.showOutput';
  sbDeploy.show();

  if (state === 'ok')   setTimeout(() => refreshDeployBar('idle'), 3000);
  if (state === 'err')  setTimeout(() => refreshDeployBar('idle'), 6000);
  if (state === 'warn') setTimeout(() => refreshDeployBar('idle'), 6000);
}

// ══════════════════════════════════════════════════════════
//  PID 파일 관리
// ══════════════════════════════════════════════════════════
function getPidFile(inst) {
  return path.join(inst.catalinaBase, 'tomcat.pid');
}

function savePid(inst, pid) {
  try { fs.writeFileSync(getPidFile(inst), String(pid), 'utf-8'); } catch {}
}

function readPid(inst) {
  try { return parseInt(fs.readFileSync(getPidFile(inst), 'utf-8').trim(), 10) || null; } catch { return null; }
}

function removePidFile(inst) {
  try { fs.unlinkSync(getPidFile(inst)); } catch {}
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
function detectOrphanProcess(inst) {
  const pid = readPid(inst);
  if (pid && isProcessAlive(pid)) {
    inst.orphanPid = pid;
    inst.running = true;
    log(t('logOrphanDetected', pid), 'WARN');
    logTo(inst, t('logOrphanDetected', pid), 'WARN');
    return true;
  }
  if (pid) removePidFile(inst);
  return false;
}

// ══════════════════════════════════════════════════════════
//  .vscode/tomcat 디렉토리 초기화
// ══════════════════════════════════════════════════════════
function initTomcatBase(inst) {
  const cfg  = inst;
  const base = cfg.catalinaBase;
  const isPrimary   = inst.name === getDefaultInstanceName();
  const defaultInst = isPrimary ? null : getDefaultInstance();

  for (const d of ['conf', 'webapps', 'logs', 'work', 'temp']) {
    fs.mkdirSync(path.join(base, d), { recursive: true });
  }

  // 배포 디렉토리(docBase)는 모든 인스턴스 공유 → cfg.warDir = .vscode/tomcat/webapp/<contextPath>
  fs.mkdirSync(path.join(cfg.warDir, 'WEB-INF', 'classes'), { recursive: true });

  // 공유 webapp/ 하위에서 현재 contextPath 가 아닌 옛 디렉토리 정리
  const appsDir = path.dirname(cfg.warDir);
  const activeTopDir = path.basename(cfg.warDir);
  try {
    for (const entry of fs.readdirSync(appsDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== activeTopDir) {
        fs.rmSync(path.join(appsDir, entry.name), { recursive: true, force: true });
        log(`[Init] 이전 앱 디렉토리 삭제: webapp/${entry.name}`);
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
    const primaryCtxXml = defaultInst ? path.join(defaultInst.confDir, 'context.xml') : null;
    if (primaryCtxXml && fs.existsSync(primaryCtxXml)) {
      fs.copyFileSync(primaryCtxXml, contextXml);
      log(`[Init] context.xml — "${defaultInst.name}"에서 복사`);
    } else {
      fs.writeFileSync(contextXml,
`<?xml version="1.0" encoding="UTF-8"?>
<Context reloadable="false">
  <Valve className="org.apache.catalina.valves.RemoteAddrValve"
         allow="127\\.\\d+\\.\\d+\\.\\d+|::1|0:0:0:0:0:0:0:1"/>
</Context>
`, 'utf-8');
      log(t('logCtxCreated'));
    }
  }

  // ── server.xml ──
  const serverXml = path.join(cfg.confDir, 'server.xml');
  if (!fs.existsSync(serverXml)) {
    const primarySrvXml = defaultInst ? path.join(defaultInst.confDir, 'server.xml') : null;
    if (primarySrvXml && fs.existsSync(primarySrvXml)) {
      // 기본 인스턴스의 server.xml을 복사 — 아래 업데이트 블록에서 포트/docBase 교체
      fs.copyFileSync(primarySrvXml, serverXml);
      log(`[Init] server.xml — "${defaultInst.name}"에서 복사`);
    } else {
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
    }
  }
  // 포트/docBase는 항상 최신화 (신규 생성·기본 복사·기존 파일 모두)
  {
    let xml = fs.readFileSync(serverXml, 'utf-8');
    let changed = false;
    const ctxPath = cfg.contextPath === '/' ? '' : cfg.contextPath;

    xml = xml.replace(/(<Connector\b[^>]*\bport=")(\d+)(")/, (m, pre, oldPort, post) => {
      if (oldPort !== String(cfg.port)) changed = true;
      return `${pre}${cfg.port}${post}`;
    });
    xml = xml.replace(/(<Connector\b[^>]*\bredirectPort=")(\d+)(")/, (m, pre, old, post) => {
      if (old !== String(cfg.redirectPort)) changed = true;
      return `${pre}${cfg.redirectPort}${post}`;
    });

    if (!xml.includes('<Context')) {
      xml = xml.replace(
        '</Host>',
        `        <Context path="${ctxPath}" docBase="${cfg.warDir}"\n                 reloadable="false"/>\n      </Host>`
      );
      changed = true;
    } else {
      xml = xml.replace(/(<Context\b[^>]*\bpath=")([^"]*)(")/,  (m, pre, old, post) => {
        if (old !== ctxPath) changed = true;
        return `${pre}${ctxPath}${post}`;
      });
      xml = xml.replace(/(<Context\b[^>]*\bdocBase=")([^"]*)(")/,  (m, pre, old, post) => {
        if (old !== cfg.warDir) changed = true;
        return `${pre}${cfg.warDir}${post}`;
      });
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
async function startTomcat(inst) {
  if (!inst) return;
  if (inst.running || inst.orphanPid || inst.starting) {
    vscode.window.showWarningMessage(`${inst.name}: ${t('alreadyRunning')}`);
    return;
  }
  reloadInstanceConfig(inst);   // 실행 중 변경된 설정을 기동 시점에 반영
  inst.starting = true;
  inst.hotSwapFailed = false;
  refreshTomcatBar();

  // 시작 시 이 인스턴스 로그 패널만 비움 (공통 채널/다른 인스턴스 로그는 보존)
  getLogChannel(inst).clear();
  getLocalhostChannel(inst).clear();

  try {
    const cfg = inst;

    const existingPid = findProcessByCatalinaBase(cfg.catalinaBase);
    if (existingPid) {
      const sel = await vscode.window.showWarningMessage(
        `${inst.name}: ${t('existingProcess', existingPid)}`,
        t('forceKillAndStart'), t('cancel')
      );
      if (sel === t('forceKillAndStart')) {
        forceKillPid(existingPid);
        log(t('logExistingKill', existingPid));
        await new Promise(r => setTimeout(r, 2000));
      } else {
        inst.starting = false;
        refreshTomcatBar();
        return;
      }
    }

    if (!cfg.catalinaHome) {
      const ans = await vscode.window.showErrorMessage(
        `${inst.name}: ${t('catalinaRequired')}`,
        t('openSettings')
      );
      if (ans) vscode.commands.executeCommand('workbench.action.openSettings', 'tomcatAutoDeploy.catalinaHome');
      inst.starting = false;
      refreshTomcatBar();
      return;
    }

    if (await isPortInUse(cfg.port)) {
      const killed = await showPortConflict(cfg.port, 'httpPortInUse');
      if (!killed || await isPortInUse(cfg.port)) { inst.starting = false; refreshTomcatBar(); return; }
    }

    if (await isPortInUse(cfg.debugPort)) {
      const killed = await showPortConflict(cfg.debugPort, 'debugPortInUse');
      if (!killed || await isPortInUse(cfg.debugPort)) { inst.starting = false; refreshTomcatBar(); return; }
    }

    initTomcatBase(inst);

    const compileOk = await syncAll(inst);
    if (compileOk === false && detectBuildTool(getWorkspaceRoot())) {
      log(t('logAutoFullBuild'));
      await buildAndDeploy();
    }

    // 동기화 중 stop을 눌러 starting이 해제됐다면 spawn하지 않고 종료
    if (!inst.starting) {
      refreshTomcatBar();
      return;
    }

    getLogChannel(inst).show(true);

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

    log(`[${inst.name}] ${t('logJpdaStart', cfg.debugPort)}`);

    inst.lineRaw = false;
    inst.proc = spawn(catalina, ['jpda', 'run'], { env, shell: true, detached: !isWin });
    if (inst.proc.pid) savePid(inst, inst.proc.pid);
    inst.proc.stdout.on('data', d => logTomcatChunk(inst, d, 'INFO'));
    inst.proc.stderr.on('data', d => logTomcatChunk(inst, d, 'WARN'));
    inst.proc.on('exit', code => {
      inst.running = false;
      inst.proc = null;
      inst.orphanPid = null;
      removePidFile(inst);
      stopLocalhostLogWatch(inst);
      refreshTomcatBar();
      logTo(inst, t('logExit', code));
    });

    try {
      await waitForTomcat(inst, 30000);
      inst.running = true;
      inst.starting = false;
      refreshTomcatBar();
      startLocalhostLogWatch(inst);
      vscode.window.showInformationMessage(
        `${inst.name}: ${t('tomcatStarted', cfg.port, cfg.contextPath)}`,
        t('openBrowser')
      ).then(sel => {
        if (sel) vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${cfg.port}${cfg.contextPath}`));
      });
      logTo(inst, t('logStarted', cfg.port, cfg.contextPath));
    } catch (err) {
      // 중지 요청에 의한 취소 — stop/forceStop이 프로세스를 정리하므로 조용히 종료
      if (err && err.message === '__cancelled__') return;
      inst.running = false;
      inst.proc?.kill();
      inst.proc = null;
      refreshTomcatBar();
      logTo(inst, t('logStartFailed', err.message), 'ERROR');
      vscode.window.showErrorMessage(`${inst.name}: ${t('startupFailed', err.message)}`);
      getLogChannel(inst).show(true);
    }
  } catch (err) {
    inst.running = false;
    inst.proc?.kill();
    inst.proc = null;
    refreshTomcatBar();
    logTo(inst, t('logStartFailed', err && err.message || String(err)), 'ERROR');
    vscode.window.showErrorMessage(`${inst.name}: ${t('startupFailed', err && err.message || String(err))}`);
    getLogChannel(inst).show(true);
  } finally {
    inst.starting = false;
    refreshTomcatBar();
  }
}

// Tomcat HTTP 응답 폴링 (기동 대기 중 stop 시 inst.starting/proc 기반으로 즉시 취소)
function waitForTomcat(inst, timeoutMs) {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const check = () => {
      if (!inst.starting || !inst.proc) {
        reject(new Error('__cancelled__'));
        return;
      }
      const req = http.request(
        { hostname: 'localhost', port: inst.port, path: '/', method: 'HEAD', timeout: 1000 },
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
async function stopTomcat(inst) {
  if (!inst) return;
  if (!inst.running && !inst.orphanPid && !inst.proc) {
    if (inst.starting) {
      // 기동 도중(예: syncAll 진행 중) 사용자가 중지를 누른 경우 — spawn 직전에 빠져나가도록 신호만 보낸다
      inst.starting = false;
      refreshTomcatBar();
      logTo(inst, t('logStopReq'));
      return;
    }
    vscode.window.showWarningMessage(`${inst.name}: ${t('notRunning')}`);
    return;
  }
  inst.starting = false;  // 기동 대기 중이면 waitForTomcat을 취소시킨다
  refreshTomcatBar();
  logTo(inst, t('logStopReq'));

  if (inst.orphanPid) {
    logTo(inst, t('logOrphanKill', inst.orphanPid), 'WARN');
    forceKillPid(inst.orphanPid);
    inst.orphanPid = null;
    inst.running = false;
    removePidFile(inst);
    refreshTomcatBar();
    logTo(inst, t('logKillDone'));
    vscode.window.showInformationMessage(`${inst.name}: ${t('orphanKilled')}`);
    return;
  }

  if (inst.proc) {
    const proc = inst.proc;
    const pid  = proc.pid;

    const waitExit = new Promise(resolve => {
      proc.once('exit', resolve);
      setTimeout(resolve, 10000);
    });

    const isWin = process.platform === 'win32';
    if (isWin && pid) {
      logTo(inst, `taskkill /F /T /PID ${pid}`);
      try {
        require('child_process').execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', shell: true });
      } catch {}
    } else if (pid) {
      proc.kill('SIGTERM');
      logTo(inst, t('logSigterm'));
      setTimeout(() => {
        if (inst.proc) {
          try { process.kill(-pid, 'SIGKILL'); } catch {}
          try { process.kill(pid, 'SIGKILL'); } catch {}
          logTo(inst, t('logSigkill'), 'WARN');
        }
      }, 3000);
    }

    await waitExit;
    inst.running = false;
    inst.proc = null;
    removePidFile(inst);
    stopLocalhostLogWatch(inst);
    refreshTomcatBar();
    logTo(inst, t('logStopDone'));
  }
}


// ══════════════════════════════════════════════════════════
//  localhost.yyyy-MM-dd.log 실시간 감시
// ══════════════════════════════════════════════════════════
function startLocalhostLogWatch(inst) {
  stopLocalhostLogWatch(inst);

  const logsDir = path.join(inst.catalinaBase, 'logs');
  const channel = getLocalhostChannel(inst);
  inst.logOffset = 0;

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
    if (stat.size <= inst.logOffset) return;

    const stream = fs.createReadStream(logPath, {
      start: inst.logOffset,
      encoding: 'utf-8',
    });
    let buf = '';
    stream.on('data', chunk => { buf += chunk; });
    stream.on('end', () => {
      inst.logOffset = stat.size;
      for (const line of buf.split(/\r?\n/)) {
        if (line.trim()) channel.appendLine(line);
      }
    });
  }

  fs.mkdirSync(logsDir, { recursive: true });
  inst.logWatcher = fs.watch(logsDir, (eventType, filename) => {
    if (filename && filename.startsWith('localhost.') && filename.endsWith('.log')) {
      const currentLog = path.basename(getLogPath());
      if (filename !== currentLog) return;
      tailLog();
    }
  });

  tailLog();
  logTo(inst, t('logLogWatch'));
}

function stopLocalhostLogWatch(inst) {
  if (inst.logWatcher) {
    try { inst.logWatcher.close(); } catch {}
    inst.logWatcher = null;
  }
  inst.logOffset = 0;
}

// ══════════════════════════════════════════════════════════
//  Tomcat 강제 중지 (즉시 SIGKILL / taskkill /F)
// ══════════════════════════════════════════════════════════
async function forceStopTomcat(inst) {
  if (!inst) return;
  if (!inst.running && !inst.orphanPid && !inst.proc) {
    if (inst.starting) {
      inst.starting = false;
      refreshTomcatBar();
      logTo(inst, t('logForceStopReq'));
      return;
    }
    vscode.window.showWarningMessage(`${inst.name}: ${t('notRunning')}`);
    return;
  }
  inst.starting = false;  // 기동 대기 중이면 waitForTomcat을 취소시킨다
  refreshTomcatBar();
  logTo(inst, t('logForceStopReq'));

  const pid = inst.orphanPid || (inst.proc && inst.proc.pid);
  if (pid) {
    forceKillPid(pid);
    logTo(inst, t('logForceStop', pid));
  }

  if (inst.proc) {
    await new Promise(resolve => {
      inst.proc.once('exit', resolve);
      setTimeout(resolve, 5000);
    });
  }

  inst.running = false;
  inst.proc = null;
  inst.orphanPid = null;
  removePidFile(inst);
  stopLocalhostLogWatch(inst);
  refreshTomcatBar();
  logTo(inst, t('logForceStopDone'));
  vscode.window.showInformationMessage(`${inst.name}: ${t('forceStopDone')}`);
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
            log(`[HotSwap]   - ${className}: JVM 로드됨 (교체 대상)`);
            loaded.push({ refTypeId: clsData.slice(5, 5 + refTypeIdSize), classBytes });
          } else {
            log(`[HotSwap]   - ${className}: JVM 미로드 (스킵)`);
          }
        }

        log(`[HotSwap] JVM 로드 확인: ${classes.length}개 중 ${loaded.length}개 로드됨`);

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

  const common     = getCommonConfig();
  const compileCfg = getCompileConfig(common);
  const buildClassesDir = getBuildClassesDir();
  const srcRoot    = path.join(ws, common.javaSourceRoot);
  const javaBin    = compileCfg.javaHome ? path.join(compileCfg.javaHome, 'bin', 'javac') : 'javac';
  const fname      = path.basename(savedFilePath);

  fs.mkdirSync(buildClassesDir, { recursive: true });

  const cpSep = process.platform === 'win32' ? ';' : ':';
  const cpParts = [buildClassesDir];
  if (compileCfg.catalinaHome) {
    cpParts.push(path.join(compileCfg.catalinaHome, 'lib', '*'));
  }
  const depCp = await resolveDependencyClasspath();
  if (depCp) cpParts.push(depCp);
  cpParts.push(...compileCfg.classpath);
  const cp    = cpParts.join(cpSep);

  const javaVer = detectJavaVersion(ws);

  // javac @argfile 사용 — Windows 명령줄 길이 제한(8191자) 회피
  const argLines = ['-encoding', 'UTF-8'];
  if (javaVer.source) argLines.push('-source', javaVer.source);
  if (javaVer.target) argLines.push('-target', javaVer.target);
  // sourcepath: src + generated-sources
  const sourcePaths = [srcRoot];
  const buildTool = detectBuildTool(ws);
  if (buildTool) {
    const genBase = buildTool === 'maven'
      ? path.join(ws, 'target', 'generated-sources')
      : path.join(ws, 'build', 'generated', 'sources');
    if (fs.existsSync(genBase)) {
      for (const entry of fs.readdirSync(genBase, { withFileTypes: true })) {
        if (entry.isDirectory()) sourcePaths.push(path.join(genBase, entry.name));
      }
    }
  }
  argLines.push('-cp', cp, '-sourcepath', sourcePaths.join(cpSep), '-d', buildClassesDir, savedFilePath);

  const argFile = path.join(getTomcatRoot(), '.build', 'javac-args-save.txt');
  fs.mkdirSync(path.dirname(argFile), { recursive: true });
  fs.writeFileSync(argFile, argLines.map(a => `"${a.replace(/\\/g, '/')}"`).join('\n'), 'utf-8');

  const cmd = `"${javaBin}" @"${argFile}"`;

  log(t('logCompile', fname));
  refreshDeployBar('deploying', fname);

  try {
    const { stderr } = await execAsync(cmd);
    if (stderr) log(t('logStderr', stderr), 'WARN');

    const relPath   = path.relative(srcRoot, savedFilePath);
    const className = relPath.replace(/\.java$/, '').replace(/[/\\]/g, '.');
    const relClass  = relPath.replace(/\.java$/, '.class');
    const buildClassFile = path.join(buildClassesDir, relClass);

    if (!fs.existsSync(buildClassFile)) { refreshDeployBar('ok', fname); return; }

    // 메인 + inner($) .class 버퍼 수집 (rel 경로 유지)
    const baseName = path.basename(savedFilePath, '.java');
    const classDir = path.dirname(buildClassFile);
    const relDir   = path.dirname(relClass);
    const swap = [{ className, rel: relClass, bytes: fs.readFileSync(buildClassFile) }];
    for (const f of fs.readdirSync(classDir)) {
      if (f.startsWith(baseName + '$') && f.endsWith('.class')) {
        const innerName = className + '$' + f.slice(baseName.length + 1, -6);
        swap.push({ className: innerName, rel: path.join(relDir, f), bytes: fs.readFileSync(path.join(classDir, f)) });
      }
    }
    // 각 실행 중 인스턴스로 복사 + HotSwap (같은 버퍼 재사용)
    const swapClasses = swap.map(c => ({ className: c.className, classBytes: c.bytes }));
    let hotSwapFailed = false;
    for (const inst of runningInstances()) {
      const instClassesDir = path.join(inst.warDir, 'WEB-INF', 'classes');
      for (const c of swap) {
        const dest = path.join(instClassesDir, c.rel);
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, c.bytes);
      }
      if (inst.orphanPid || !inst.running) continue; // orphan은 디버그 연결 불명 → 디스크 반영만
      try {
        const result = await jdwpHotSwap(inst.debugPort, swapClasses);
        if (result === 'ok') { logTo(inst, t('logHotSwapOk', savedFilePath)); inst.hotSwapFailed = false; }
        else                 logTo(inst, t('logHotSwapSkip', className));
      } catch (err) {
        logTo(inst, t('logHotSwapFail', className, err.message), 'WARN');
        hotSwapFailed = true;
        inst.hotSwapFailed = true;
      }
    }
    refreshDeployBar(hotSwapFailed ? 'warn' : 'ok', fname);
    if (tomcatTreeProvider) tomcatTreeProvider.refresh();
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

  const common     = getCommonConfig();
  const webSrcRoot = path.join(ws, common.webContentRoot);
  const rel        = path.relative(webSrcRoot, savedFilePath);

  if (rel.startsWith('..')) return;

  const fname = path.basename(savedFilePath);
  refreshDeployBar('deploying', fname);

  try {
    for (const inst of runningInstances()) {
      const dest = path.join(inst.warDir, rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(savedFilePath, dest);
      logTo(inst, `[Static] ${rel.replace(/\\/g, '/')} → ${dest}`);
    }
    refreshDeployBar('ok', fname);
  } catch (e) {
    log(`[Static] deploy failed: ${e.message}`, 'ERROR');
    refreshDeployBar('err', fname);
  }
}

async function deployResource(savedFilePath) {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const common     = getCommonConfig();
  const resSrcRoot = path.join(ws, common.resourceRoot);
  const rel        = path.relative(resSrcRoot, savedFilePath);

  if (rel.startsWith('..')) return;

  const fname = path.basename(savedFilePath);
  refreshDeployBar('deploying', fname);

  try {
    for (const inst of runningInstances()) {
      const dest = path.join(inst.warDir, 'WEB-INF', 'classes', rel);
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(savedFilePath, dest);
      logTo(inst, `[Resource] ${rel.replace(/\\/g, '/')} → WEB-INF/classes/`);
    }
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

/**
 * 소스에 존재하지 않는 대상 파일/디렉토리 삭제
 */
function purgeOrphanFiles(srcDir, destDir, excludeNames, baseDestDir) {
  if (!fs.existsSync(destDir)) return;
  const actualBase = baseDestDir || destDir;
  const srcExists = fs.existsSync(srcDir);
  const srcNames = srcExists ? new Set(fs.readdirSync(srcDir)) : new Set();

  for (const entry of fs.readdirSync(destDir, { withFileTypes: true })) {
    if (excludeNames && excludeNames.has(entry.name)) continue;

    const d = path.join(destDir, entry.name);
    const rel = path.relative(actualBase, d).replace(/\\/g, '/');
    if (!srcNames.has(entry.name)) {
      fs.rmSync(d, { recursive: true, force: true });
      log(t('logSyncOrphanDeleted', rel));
    } else if (entry.isDirectory()) {
      purgeOrphanFiles(path.join(srcDir, entry.name), d, null, actualBase);
    }
  }
}

/**
 * WEB-INF/classes 내의 고아 .class 및 리소스 삭제
 */
function purgeOrphanClasses(srcRoot, genSourcesDirs, resSrcRoot, classesDir) {
  if (!fs.existsSync(classesDir)) return;

  const validRels = new Set();
  const collectRels = (dir, base, ext) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        collectRels(full, base, ext);
      } else if (!ext || entry.name.endsWith(ext)) {
        let rel = path.relative(base, full);
        if (ext === '.java') rel = rel.replace(/\.java$/, '.class');
        validRels.add(rel.replace(/\\/g, '/'));
      }
    }
  };

  collectRels(srcRoot, srcRoot, '.java');
  for (const gen of genSourcesDirs) collectRels(gen, gen, '.java');
  collectRels(resSrcRoot, resSrcRoot);

  const scanAndDelete = (currDir) => {
    if (!fs.existsSync(currDir)) return;
    for (const entry of fs.readdirSync(currDir, { withFileTypes: true })) {
      const full = path.join(currDir, entry.name);
      const rel = path.relative(classesDir, full).replace(/\\/g, '/');

      if (entry.isDirectory()) {
        scanAndDelete(full);
        try {
          if (fs.readdirSync(full).length === 0) fs.rmdirSync(full);
        } catch {}
      } else {
        const isInner = entry.name.includes('$');
        const baseRel = isInner ? rel.replace(/\$[^./]+\.class$/, '.class') : rel;

        if (!validRels.has(rel) && !validRels.has(baseRel)) {
          fs.rmSync(full, { force: true });
          log(t('logSyncOrphanDeleted', 'WEB-INF/classes/' + rel));
        }
      }
    }
  };
  scanAndDelete(classesDir);
}

async function compileAllJava(ws, cfg, classesDir, depClasspath) {
  const srcRoot  = path.join(ws, cfg.javaSourceRoot);
  const resSrcRoot = path.join(ws, cfg.resourceRoot);

  // generated-sources 디렉토리 탐색 (ANTLR, QueryDSL 등 빌드 도구가 생성한 소스)
  const genSourcesDirs = [];
  const buildTool = detectBuildTool(ws);
  if (buildTool) {
    const genBase = buildTool === 'maven'
      ? path.join(ws, 'target', 'generated-sources')
      : path.join(ws, 'build', 'generated', 'sources');
    if (fs.existsSync(genBase)) {
      for (const entry of fs.readdirSync(genBase, { withFileTypes: true })) {
        if (entry.isDirectory()) genSourcesDirs.push(path.join(genBase, entry.name));
      }
    }
  }

  // 고아 클래스 삭제 (컴파일 전 수행)
  purgeOrphanClasses(srcRoot, genSourcesDirs, resSrcRoot, classesDir);

  // 소스 파일 수집 (src + generated-sources)
  const allJavaFiles = collectFiles(srcRoot, ['.java']);
  for (const genDir of genSourcesDirs) {
    allJavaFiles.push(...collectFiles(genDir, ['.java']));
  }
  if (allJavaFiles.length === 0) return true;

  fs.mkdirSync(classesDir, { recursive: true });

  // .class가 .java보다 새로운 파일은 스킵 (변경된 것만 컴파일)
  const findClassFile = (jf) => {
    // srcRoot 기준 또는 genSourcesDirs 기준 상대경로로 .class 경로 결정
    let rel = path.relative(srcRoot, jf);
    if (rel.startsWith('..')) {
      for (const genDir of genSourcesDirs) {
        const r = path.relative(genDir, jf);
        if (!r.startsWith('..')) { rel = r; break; }
      }
    }
    return path.join(classesDir, rel.replace(/\.java$/, '.class'));
  };
  const javaFiles = allJavaFiles.filter(jf => {
    const classFile = findClassFile(jf);
    if (!fs.existsSync(classFile)) return true;
    return fs.statSync(jf).mtimeMs > fs.statSync(classFile).mtimeMs;
  });
  if (javaFiles.length === 0) {
    log(t('logSyncCompileDone', 0));
    return true;
  }

  const javaBin = cfg.javaHome ? path.join(cfg.javaHome, 'bin', 'javac') : 'javac';
  const cpSep   = process.platform === 'win32' ? ';' : ':';
  const cpParts = [classesDir];
  if (cfg.catalinaHome) cpParts.push(path.join(cfg.catalinaHome, 'lib', '*'));
  if (depClasspath) cpParts.push(depClasspath);
  cpParts.push(...cfg.classpath);
  const cp = cpParts.join(cpSep);

  const javaVer = detectJavaVersion(ws);

  // javac @argfile 사용 — Windows 명령줄 길이 제한(8191자) 회피
  const argLines = [
    '-encoding', 'UTF-8',
  ];
  if (javaVer.source) argLines.push('-source', javaVer.source);
  if (javaVer.target) argLines.push('-target', javaVer.target);

  // sourcepath: src + generated-sources
  const sourcePaths = [srcRoot, ...genSourcesDirs].join(cpSep);
  argLines.push('-cp', cp, '-sourcepath', sourcePaths, '-d', classesDir);
  javaFiles.forEach(f => argLines.push(f));

  const argFile = path.join(getTomcatRoot(), '.build', 'javac-args.txt');
  fs.mkdirSync(path.dirname(argFile), { recursive: true });
  fs.writeFileSync(argFile, argLines.map(a => `"${a.replace(/\\/g, '/')}"`).join('\n'), 'utf-8');

  const cmd = `"${javaBin}" @"${argFile}"`;

  log(t('logSyncCompiling', javaFiles.length));
  for (const jf of javaFiles) {
    let rel = path.relative(srcRoot, jf);
    if (rel.startsWith('..')) {
      for (const genDir of genSourcesDirs) {
        const r = path.relative(genDir, jf);
        if (!r.startsWith('..')) { rel = r; break; }
      }
    }
    log(t('logSyncChanged', rel.replace(/\\/g, '/')));
  }
  log(`[Sync] $ ${cmd}`);
  try {
    await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
    log(t('logSyncCompileDone', javaFiles.length));
    return true;
  } catch (err) {
    log(t('logSyncCompileFail', err.message), 'ERROR');
    return false;
  } finally {
    try { fs.unlinkSync(argFile); } catch {}
  }
}

/**
 * WEB-INF/classes 하위 변경된 .class 파일들을 실행 중인 인스턴스에 JDWP HotSwap 적용.
 * 저장 시 compileAndDeploy와 동일한 방식으로, syncAll(전체동기화/재빌드+동기화)에서 재사용.
 */
async function hotSwapChangedClasses(inst, changedFiles) {
  if (inst.orphanPid || !inst.running) return true; // orphan은 디버그 연결 불명 → 디스크 반영만
  if (!changedFiles || changedFiles.length === 0) return true;

  const instClassesDir = path.join(inst.warDir, 'WEB-INF', 'classes');
  const swapClasses = [];
  for (const f of changedFiles) {
    if (!f.endsWith('.class')) continue;
    const rel = path.relative(instClassesDir, f);
    if (rel.startsWith('..')) continue;
    const className = rel.replace(/\.class$/, '').replace(/[/\\]/g, '.');
    swapClasses.push({ className, classBytes: fs.readFileSync(f) });
  }
  if (swapClasses.length === 0) return true;

  const label = t('logHotSwapBatch', swapClasses.length);
  try {
    const result = await jdwpHotSwap(inst.debugPort, swapClasses);
    if (result === 'ok') { logTo(inst, t('logHotSwapOk', label)); inst.hotSwapFailed = false; }
    else                 logTo(inst, t('logHotSwapSkip', label));
    return true;
  } catch (err) {
    logTo(inst, t('logHotSwapFail', label, err.message), 'WARN');
    inst.hotSwapFailed = true;
    return false;
  }
}

/**
 * 컴파일 + class/의존성 JAR/정적 파일을 공유 warDir(docBase)에 배포.
 * 모든 인스턴스가 동일한 warDir를 쓰므로(lib/instances.js) 인스턴스 수와 무관하게 1회만 수행하면 된다.
 * HotSwap은 포함하지 않음 — 실행 중인 인스턴스별로 호출측에서 hotSwapChangedClasses를 따로 호출해야 한다.
 */
async function syncFilesToWarDir(warDir) {
  const ws = getWorkspaceRoot();
  if (!ws) return { compileOk: false, classChanged: [] };

  const common     = getCommonConfig();
  const compileCfg = getCompileConfig(common);
  const srcRoot    = path.join(ws, common.javaSourceRoot);
  const buildClassesDir = getBuildClassesDir();
  const buildTool  = detectBuildTool(ws);
  const allChanged = [];

  log(t('logSyncStart'));

  // ── 의존성 classpath 미리 해석 (공통) ──
  let depCp = '';
  if (buildTool === 'maven' || buildTool === 'gradle') {
    depCp = await resolveDependencyClasspath() || '';
  }

  // ── 1) Java 컴파일 → .build/classes ──
  const compileOk = await compileAllJava(ws, compileCfg, buildClassesDir, depCp);

  // ── 2) .build/classes → warDir/WEB-INF/classes 복사 + 고아 정리 ──
  const classChanged = [];
  copyBuildToWarDir(warDir, common, classChanged);
  allChanged.push(...classChanged);

  // 익명/내부 클래스($포함) 제외, top-level class만 카운트 (.build 기준)
  const countTopLevelClasses = dir =>
    collectFiles(dir, ['.class']).filter(f => !path.basename(f, '.class').includes('$')).length;
  let javaCount = collectFiles(srcRoot, ['.java']).length;
  if (buildTool) {
    const genBase = buildTool === 'maven'
      ? path.join(ws, 'target', 'generated-sources')
      : path.join(ws, 'build', 'generated', 'sources');
    if (fs.existsSync(genBase)) {
      javaCount += collectFiles(genBase, ['.java']).length;
    }
  }
  const recount = countTopLevelClasses(buildClassesDir);
  if (javaCount !== recount) {
    log(t('warnCommentedJava', javaCount, recount), 'WARN');
    vscode.window.showWarningMessage(t('warnCommentedJava', javaCount, recount));
  }

  // ── 3) 의존성 JAR → warDir/WEB-INF/lib 복사 및 정리 ──
  if (depCp) {
    const libDir = path.join(warDir, 'WEB-INF', 'lib');
    fs.mkdirSync(libDir, { recursive: true });
    const cpSep  = process.platform === 'win32' ? ';' : ':';
    const jars   = depCp.split(cpSep).filter(p => p.endsWith('.jar') && fs.existsSync(p));
    const jarNames = new Set(jars.map(p => path.basename(p)));

    // 고아 JAR 삭제
    for (const entry of fs.readdirSync(libDir)) {
      if (entry.endsWith('.jar') && !jarNames.has(entry)) {
        fs.rmSync(path.join(libDir, entry), { force: true });
        log(t('logSyncOrphanDeleted', 'WEB-INF/lib/' + entry));
      }
    }

    let jarCount = 0;
    for (const jar of jars) {
      const dest = path.join(libDir, path.basename(jar));
      try {
        if (!isFileChanged(jar, dest)) continue;
        fs.copyFileSync(jar, dest);
        allChanged.push(dest);
        jarCount++;
      } catch (e) {
        log(t('logSyncJarFail', path.basename(jar), e.message), 'WARN');
      }
    }
    log(t('logSyncJarDone', jarCount, jars.length));
  }

  // ── 4,5) webContentRoot + resourceRoot 동기화 ──
  syncStaticFiles(warDir, common, allChanged);

  // ── 변경 파일 목록 출력 ──
  if (allChanged.length > 0) {
    const baseDir = warDir + path.sep;
    for (const f of allChanged) {
      const rel = f.startsWith(baseDir) ? f.slice(baseDir.length) : f;
      log(t('logSyncChanged', rel.replace(/\\/g, '/')));
    }
  } else {
    log(t('logSyncNoChange'));
  }

  log(t('logSyncDone', allChanged.length));
  return { compileOk, classChanged };
}

/**
 * 인스턴스 1개 기동 시 전체 동기화: 공유 warDir 배포 + 이 인스턴스에 HotSwap 적용.
 */
async function syncAll(inst) {
  if (!inst) return;

  const { compileOk, classChanged } = await syncFilesToWarDir(inst.warDir);

  const hotSwapOk = await hotSwapChangedClasses(inst, classChanged);
  if (!hotSwapOk) refreshDeployBar('warn', inst.name);
  if (tomcatTreeProvider) tomcatTreeProvider.refresh();

  return compileOk;
}

/**
 * webContentRoot + resourceRoot → warDir 동기화 (java 컴파일/의존성 JAR 없이).
 * syncFilesToWarDir과 syncStaticOnly가 공유하는 정적 파일 복사 로직.
 */
function syncStaticFiles(warDir, common, allChanged) {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const webSrcRoot  = path.join(ws, common.webContentRoot);
  const resSrcRoot  = path.join(ws, common.resourceRoot);
  const classesDir  = path.join(warDir, 'WEB-INF', 'classes');

  // webContentRoot 전체 복사 및 정리 → warDir
  if (fs.existsSync(webSrcRoot)) {
    purgeOrphanFiles(webSrcRoot, warDir, new Set(['WEB-INF']));
    const skipDirs = new Set(['classes', 'lib'].map(d =>
      path.join(webSrcRoot, 'WEB-INF', d)
    ));
    const copied = copyDirSyncWithSkip(webSrcRoot, warDir, skipDirs, allChanged);
    if (copied > 0) log(t('logSyncWebContent', copied));
  }

  // resourceRoot → warDir/WEB-INF/classes
  if (fs.existsSync(resSrcRoot)) {
    const copied = copyDirSync(resSrcRoot, classesDir, allChanged);
    if (copied > 0) log(t('logSyncResource', copied));
  }
}

/**
 * webContentRoot + resourceRoot(jsp/js/css/이미지/설정파일 등)만 재빌드/javac 없이 공유 warDir에 동기화.
 * (전체 재빌드가 과도한 경우용. warDir는 모든 인스턴스가 공유하므로 1회만 수행하면 된다.)
 */
function syncStaticOnly(warDir) {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const common     = getCommonConfig();
  const allChanged = [];

  log(t('logStaticSyncStart'));
  syncStaticFiles(warDir, common, allChanged);

  if (allChanged.length > 0) {
    const baseDir = warDir + path.sep;
    for (const f of allChanged) {
      const rel = f.startsWith(baseDir) ? f.slice(baseDir.length) : f;
      log(t('logSyncChanged', rel.replace(/\\/g, '/')));
    }
  } else {
    log(t('logSyncNoChange'));
  }

  log(t('logStaticSyncDone', allChanged.length));
}

/**
 * Maven/Gradle 빌드 후 전체 배포.
 * 빌드 도구로 컴파일(target/classes 생성) → syncAll(javac 재컴파일 + 정적파일 배포)
 */
async function buildAndDeploy() {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  try {
    const buildTool = detectBuildTool(ws);
    if (buildTool) {
      const common = getCommonConfig();
      const javaHome = common.javaHome || process.env.JAVA_HOME || '';
      const env = { ...process.env };
      if (javaHome) env.JAVA_HOME = javaHome;

      let buildCmd;
      if (buildTool === 'maven') {
        const mvn = findMvnCmd(ws);
        buildCmd = `"${mvn}" compile -f "${path.join(ws, 'pom.xml')}"`;
      } else {
        const gradle = findGradleCmd(ws);
        buildCmd = `"${gradle}" classes -p "${ws}"`;
      }

      rebuildAllStatus = t('progressBuilding', buildTool);
      if (tomcatTreeProvider) tomcatTreeProvider.refresh();
      log(t('logBuildStart', buildTool));
      log(`[Build] $ ${buildCmd}`);
      try {
        await execAsync(buildCmd, { cwd: ws, env, maxBuffer: 10 * 1024 * 1024 });
        log(t('logBuildDone', buildTool));
      } catch (err) {
        log(t('logBuildFail', err.message), 'ERROR');
        vscode.window.showErrorMessage(t('logBuildFail', err.message));
        return;
      }
    }

    // 배포 파일(warDir)은 모든 인스턴스가 공유 → 파일 동기화는 1회만, HotSwap만 인스턴스별로 적용
    if (instances.size === 0) syncInstances();
    const targets = [...instances.values()];
    if (targets.length === 0) return;

    for (const inst of targets) initTomcatBase(inst);

    rebuildAllStatus = t('progressSyncingFiles');
    if (tomcatTreeProvider) tomcatTreeProvider.refresh();
    const { compileOk, classChanged } = await syncFilesToWarDir(targets[0].warDir);
    if (compileOk === false) {
      vscode.window.showErrorMessage(t('syncCompileFailMsg', targets[0].name));
      outputChannel.show(true);
    }

    // HotSwap은 실행 중인(또는 외부 실행 중인) 인스턴스에만 적용
    for (const inst of targets) {
      if (!inst.running && !inst.orphanPid) continue;
      rebuildAllStatus = t('progressSyncing', inst.name);
      if (tomcatTreeProvider) tomcatTreeProvider.refresh();
      const hotSwapOk = await hotSwapChangedClasses(inst, classChanged);
      if (!hotSwapOk) refreshDeployBar('warn', inst.name);
    }
  } finally {
    rebuildAllStatus = null;
    if (tomcatTreeProvider) tomcatTreeProvider.refresh();
  }
}

// ══════════════════════════════════════════════════════════
//  파일 저장 이벤트
// ══════════════════════════════════════════════════════════
async function onSaved(doc) {
  if (runningInstances().length === 0) return;

  const fp  = doc.uri.fsPath;
  const ext = path.extname(fp).toLowerCase();

  if (ext === '.java') {
    await compileAndDeploy(fp);
    return;
  }

  const ws = getWorkspaceRoot();
  if (ws) {
    const common = getCommonConfig();
    const webSrcRoot = path.join(ws, common.webContentRoot);
    const relWeb = path.relative(webSrcRoot, fp);
    if (!relWeb.startsWith('..')) { await deployStatic(fp); return; }

    const resSrcRoot = path.join(ws, common.resourceRoot);
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
//  마이그레이션: 디렉토리 → default/
// ══════════════════════════════════════════════════════════
// .vscode/tomcat/{conf,apps,...}가 직하에 있으면(구버전) → .vscode/tomcat/default/로 1회 이동
function migrateTomcatDirectory() {
  const root = getTomcatRoot();
  if (!root || !fs.existsSync(root)) return;
  const hasConf = fs.existsSync(path.join(root, 'conf'));
  const hasApps = fs.existsSync(path.join(root, 'apps'));
  if (!hasConf && !hasApps) return;           // 구버전 베이스 아님
  const defaultDir = path.join(root, 'default');
  if (fs.existsSync(defaultDir)) return;       // 이미 인스턴스 하위폴더 존재

  // 업그레이드 중 실행 중이던 구버전 Tomcat 감지 (신규 default는 catalinaBase가 달라 orphan 인식 불가)
  let oldPid = null;
  try { oldPid = parseInt(fs.readFileSync(path.join(root, 'tomcat.pid'), 'utf-8').trim(), 10) || null; } catch {}
  if (oldPid && isProcessAlive(oldPid)) {
    log(`[Migrate] 실행 중 업그레이드 감지 (PID=${oldPid}) — 기존 Tomcat을 수동 종료 후 재시작 권장`, 'WARN');
    vscode.window.showWarningMessage('Tomcat: 실행 중 업그레이드가 감지되었습니다. 기존 Tomcat을 수동 종료 후 다시 시작하세요.');
  }

  fs.mkdirSync(defaultDir, { recursive: true });
  // 화이트리스트만 이동 — dep-classpath.txt/.build/cp-init.gradle 등은 최상위 유지
  for (const name of ['conf', 'apps', 'logs', 'work', 'temp', 'tomcat.pid']) {
    const src = path.join(root, name);
    if (!fs.existsSync(src)) continue;
    const dest = path.join(defaultDir, name);
    try {
      fs.renameSync(src, dest);
    } catch {
      try { fs.cpSync(src, dest, { recursive: true }); fs.rmSync(src, { recursive: true, force: true }); } catch {}
    }
  }
  log('[Migrate] .vscode/tomcat/{conf,apps,...} → .vscode/tomcat/default/ 이동 완료');
}

// instanceName 설정 변경 시 기존 catalinaBase 폴더를 새 이름으로 이전
// syncInstances() 전에 호출해야 instances Map이 아직 이전 이름을 갖고 있음
function migrateDefaultInstanceFolder() {
  const newName = getDefaultInstanceName();
  const root = getTomcatRoot();
  if (!root) return;

  // instances Map에서 extras(새 이름 기준)에 없는 항목 = 기존 기본 인스턴스
  const extraNames = new Set(getExtraServers(newName).map(s => s.name));
  let oldName = null;
  for (const name of instances.keys()) {
    if (!extraNames.has(name) && name !== newName) { oldName = name; break; }
  }
  if (!oldName) return;

  const oldDir = path.join(root, oldName);
  const newDir = path.join(root, newName);
  if (!fs.existsSync(oldDir) || fs.existsSync(newDir)) return;

  const inst = instances.get(oldName);
  if (inst && (inst.running || inst.starting)) {
    log(`[Migrate] "${oldName}" 실행 중 — 재시작 후 폴더를 "${newName}"으로 이전해 주세요.`, 'WARN');
    vscode.window.showWarningMessage(
      isKo ? `Tomcat: "${oldName}" 실행 중. 인스턴스를 재시작하면 폴더가 "${newName}"으로 이전됩니다.`
           : `Tomcat: "${oldName}" is running. Restart the instance to rename its folder to "${newName}".`
    );
    return;
  }

  try {
    fs.renameSync(oldDir, newDir);
    log(`[Migrate] .vscode/tomcat/${oldName}/ → .vscode/tomcat/${newName}/ 이전 완료`);
  } catch (err) {
    log(`[Migrate] 폴더 이름 변경 실패 (${oldName} → ${newName}): ${err.message}`, 'WARN');
  }
}

// ══════════════════════════════════════════════════════════
//  인스턴스 선택 (명령 인자 node 또는 QuickPick)
// ══════════════════════════════════════════════════════════
function instanceState(inst) {
  return inst.orphanPid ? (isKo ? '외부 실행' : 'orphan')
       : inst.starting  ? (isKo ? '기동중' : 'starting')
       : inst.running   ? (isKo ? '실행중' : 'running')
       :                  (isKo ? '정지' : 'stopped');
}

async function pickInstanceInteractive() {
  const all = [...instances.values()];
  if (all.length === 0) { vscode.window.showWarningMessage(isKo ? 'Tomcat: 설정된 서버가 없습니다.' : 'Tomcat: no servers configured.'); return null; }
  if (all.length === 1) return all[0];
  const pick = await vscode.window.showQuickPick(
    all.map(i => ({ label: i.name, description: `:${i.port} ${instanceState(i)}`, inst: i })),
    { placeHolder: isKo ? '인스턴스 선택' : 'Select instance' }
  );
  return pick ? pick.inst : null;
}

async function resolveInst(node) {
  if (node && node.instanceName) return getInstance(node.instanceName);
  return pickInstanceInteractive();
}

// ══════════════════════════════════════════════════════════
//  인스턴스 추가/삭제 (UI → settings.json servers 배열 갱신)
// ══════════════════════════════════════════════════════════

// 과거 자동 마이그레이션이 남긴 servers:[{name:'default',...}] 정리 — 기본 인스턴스는 평면 설정이 소유
async function cleanupLegacyDefaultServer() {
  const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
  const servers = cfg.get('servers', []);
  const defaultName = getDefaultInstanceName();
  if (!Array.isArray(servers) || !servers.some(s => s && s.name === defaultName)) return;
  const extras = servers.filter(s => s && s.name !== defaultName);
  await cfg.update('servers', extras.length ? extras : undefined, vscode.ConfigurationTarget.Workspace);
  log(`[Config] 레거시 "${defaultName}" 서버 항목 제거 — 기본 인스턴스는 포트 설정으로 동작합니다.`);
}

// servers 배열 저장 → onDidChangeConfiguration 이 syncInstances/refresh 를 자동 반영
function saveServers(servers) {
  return vscode.workspace.getConfiguration('tomcatAutoDeploy')
    .update('servers', servers, vscode.ConfigurationTarget.Workspace);
}

// 저장용 엔트리 — debug/redirect 포트와 java/catalina/opts 까지 전부 명시값으로 채운다.
// (자동계산·공통 폴백에 의존하지 않고 settings.json 에 값이 다 박히도록)
function explicitServerEntry(server, common, ws) {
  const c = makeInstanceConfig(server, common, ws);
  return {
    name:         c.name,
    port:         c.port,
    debugPort:    c.debugPort,
    redirectPort: c.redirectPort,
    javaHome:     c.javaHome,
    catalinaHome: c.catalinaHome,
    javaOpts:     c.javaOpts,
  };
}

// 후보 포트(http/debug/redirect)가 기존 인스턴스와 겹치면 소유자 이름 반환.
function findPortOwner(port, servers, common, ws, excludeName) {
  for (const s of servers) {
    if (!s || s.name === excludeName || typeof s.port !== 'number') continue;
    const c = makeInstanceConfig(s, common, ws);
    if (port === c.port || port === c.debugPort || port === c.redirectPort) return s.name;
  }
  return null;
}

// 선택 입력 한 줄 (비우면 공통 설정 폴백). Escape → undefined 로 전체 취소 신호.
function askOptional(step, label, placeHolder) {
  return vscode.window.showInputBox({
    title: isKo ? `인스턴스 추가 (${step}/5) — ${label} (선택)` : `Add instance (${step}/5) — ${label} (optional)`,
    placeHolder,
    ignoreFocusOut: true,
  });
}

async function addInstanceCommand() {
  const ws = getWorkspaceRoot();
  if (!ws) {
    vscode.window.showWarningMessage(isKo ? 'Tomcat: 워크스페이스를 먼저 여세요.' : 'Tomcat: open a workspace first.');
    return;
  }
  const common    = getCommonConfig();
  const effective = getServers();                  // 검증용 — 단일 모드의 평면 default 도 포함
  const used      = new Set(effective.map(s => s.name));

  const name = await vscode.window.showInputBox({
    title: isKo ? '인스턴스 추가 (1/5) — 이름' : 'Add instance (1/5) — name',
    placeHolder: isKo ? '예: staging' : 'e.g. staging',
    ignoreFocusOut: true,
    validateInput: (v) => {
      const n = (v || '').trim();
      if (!n) return isKo ? '이름을 입력하세요.' : 'Name is required.';
      if (!/^[A-Za-z0-9._-]+$/.test(n)) return isKo ? '영문/숫자/. _ - 만 사용하세요.' : 'Use letters, digits, . _ - only.';
      if (used.has(n)) return isKo ? `이미 존재하는 이름입니다: ${n}` : `Name already exists: ${n}`;
      return null;
    },
  });
  if (name === undefined) return;
  const finalName = name.trim();

  const portStr = await vscode.window.showInputBox({
    title: isKo ? '인스턴스 추가 (2/5) — HTTP 포트' : 'Add instance (2/5) — HTTP port',
    placeHolder: '8081',
    ignoreFocusOut: true,
    validateInput: (v) => {
      const n = Number((v || '').trim());
      if (!Number.isInteger(n) || n < 1 || n > 65535) return isKo ? '1~65535 사이 숫자를 입력하세요.' : 'Enter a number 1-65535.';
      const owner = findPortOwner(n, effective, common, ws, null);
      if (owner) return isKo ? `포트가 "${owner}"의 포트와 겹칩니다.` : `Port conflicts with "${owner}".`;
      return null;
    },
  });
  if (portStr === undefined) return;
  const port = Number(portStr.trim());

  // 선택 입력 — 비우면(또는 건너뛰면) 공통(javaHome/catalinaHome/javaOpts) 값을 명시적으로 채운다
  const fallback     = isKo ? '비워두면 공통 설정값 사용 (Enter로 건너뜀)' : 'empty = use common setting (Enter to skip)';
  const javaHome     = await askOptional(3, 'javaHome', fallback);
  if (javaHome === undefined) return;
  const catalinaHome = await askOptional(4, 'catalinaHome', fallback);
  if (catalinaHome === undefined) return;
  const javaOpts     = await askOptional(5, 'javaOpts', isKo ? '예: -Xmx1024m (비우면 공통)' : 'e.g. -Xmx1024m (empty = common)');
  if (javaOpts === undefined) return;

  // 사용자가 입력한 오버라이드만 반영 → explicitServerEntry 가 나머지를 공통값/자동계산으로 채워 모두 명시값으로 저장
  const override = { name: finalName, port };
  if (javaHome.trim())     override.javaHome     = javaHome.trim();
  if (catalinaHome.trim()) override.catalinaHome = catalinaHome.trim();
  if (javaOpts.trim())     override.javaOpts     = javaOpts.trim();

  const entry = explicitServerEntry(override, common, ws);
  // default 는 평면 설정이 소유 → servers 배열에는 "추가" 인스턴스만 저장 (leftover default 도 함께 정리됨)
  await saveServers([...getExtraServers(), entry]);
  log(`[Config] 인스턴스 추가: ${entry.name} (http:${entry.port} debug:${entry.debugPort} redirect:${entry.redirectPort})`);
  vscode.window.showInformationMessage(
    isKo ? `Tomcat 인스턴스 추가됨: ${entry.name} (:${entry.port})` : `Tomcat instance added: ${entry.name} (:${entry.port})`
  );
}

async function removeInstanceCommand(node) {
  const defaultName = getDefaultInstanceName();
  const cannotRemoveDefault = () => vscode.window.showInformationMessage(isKo
    ? `Tomcat: 기본 인스턴스(${defaultName})는 설정의 포트 값으로 동작합니다. 삭제 대신 설정에서 값을 변경하세요.`
    : `Tomcat: the default instance (${defaultName}) is driven by the port setting. Change the setting instead of removing it.`);

  const extras = getExtraServers(defaultName);      // 기본 인스턴스는 삭제 대상이 아님 (평면 설정 소유)

  let name = node && node.instanceName;
  if (name === defaultName) { cannotRemoveDefault(); return; }
  if (!name) {
    if (extras.length === 0) { cannotRemoveDefault(); return; }
    const pick = await vscode.window.showQuickPick(
      extras.map(s => ({ label: s.name, description: `:${s.port}` })),
      { placeHolder: isKo ? '삭제할 인스턴스 선택' : 'Select instance to remove', ignoreFocusOut: true }
    );
    if (!pick) return;
    name = pick.label;
  }

  const ok = await vscode.window.showWarningMessage(
    isKo ? `인스턴스 "${name}" 설정을 삭제할까요? (.vscode/tomcat/${name}/ 폴더는 보존됩니다)`
         : `Remove instance "${name}"? (the .vscode/tomcat/${name}/ folder is kept)`,
    { modal: true },
    isKo ? '삭제' : 'Remove'
  );
  if (!ok) return;

  // 실행 중이면 먼저 정지 후 설정에서 제거
  const inst = getInstance(name);
  if (inst && (inst.running || inst.starting)) await stopTomcat(inst);

  await saveServers(extras.filter(s => s.name !== name));
  log(`[Config] 인스턴스 삭제: ${name}`);
}

// 트리뷰의 고아 인스턴스 폴더(설정에 없는 .vscode/tomcat/<name>) 삭제 — 확인 후 실제 폴더까지 제거
async function deleteOrphanFolderCommand(node) {
  const dirPath = node && node.resourceUri && node.resourceUri.fsPath;
  if (!dirPath || !fs.existsSync(dirPath)) return;
  const name = path.basename(dirPath);

  const ok = await vscode.window.showWarningMessage(
    isKo ? `고아 인스턴스 폴더 "${name}"를 삭제할까요?\n.vscode/tomcat/${name}/ 전체가 영구 삭제되며 되돌릴 수 없습니다.`
         : `Delete orphan instance folder "${name}"?\nThis permanently deletes .vscode/tomcat/${name}/ — this cannot be undone.`,
    { modal: true },
    isKo ? '삭제' : 'Delete'
  );
  if (!ok) return;

  try {
    fs.rmSync(dirPath, { recursive: true, force: true });
    warnedOrphanFolders.delete(dirPath);
    log(`[Config] 고아 인스턴스 폴더 삭제: .vscode/tomcat/${name}/`);
  } catch (err) {
    vscode.window.showErrorMessage(isKo ? `삭제 실패: ${err.message}` : `Delete failed: ${err.message}`);
    return;
  }
  if (tomcatTreeProvider) tomcatTreeProvider.refresh();
}

// 상태바 클릭: 인스턴스 선택 → 상태에 따라 시작/정지
async function pickInstanceCommand() {
  const all = [...instances.values()];
  if (all.length === 0) { vscode.window.showWarningMessage(isKo ? 'Tomcat: 설정된 서버가 없습니다.' : 'Tomcat: no servers configured.'); return; }
  const pick = await vscode.window.showQuickPick(
    all.map(i => ({
      label: `${(i.running || i.orphanPid) ? '$(debug-stop)' : '$(play)'} ${i.name}`,
      description: `:${i.port} ${instanceState(i)}`,
      inst: i,
    })),
    { placeHolder: isKo ? '인스턴스 선택 → 시작/정지' : 'Select instance → start/stop' }
  );
  if (!pick) return;
  const inst = pick.inst;
  if (inst.running || inst.orphanPid) await stopTomcat(inst);
  else if (!inst.starting) await startTomcat(inst);
}

// ══════════════════════════════════════════════════════════
//  activate
// ══════════════════════════════════════════════════════════
function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Tomcat Auto Deploy');
  outputChannel.show(true);

  let buildTime = t('devMode');
  try {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf-8'));
    buildTime = new Date(info.buildTime).toLocaleString(isKo ? 'ko-KR' : 'en-US');
  } catch {}
  log(t('logActivated', buildTime));

  sbTomcat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  sbDeploy = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  refreshDeployBar('idle');
  context.subscriptions.push(sbTomcat, sbDeploy);

  tomcatTreeProvider = new TomcatTreeProvider();
  const treeView = vscode.window.createTreeView('tomcatServerView', {
    treeDataProvider: tomcatTreeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  // 비동기 초기화: 설정 생성 → 마이그레이션 → 인스턴스 구성 → orphan 감지
  (async () => {
    await ensureWorkspaceSettings();
    await cleanupLegacyDefaultServer();
    migrateTomcatDirectory();
    syncInstances();
    for (const inst of instances.values()) detectOrphanProcess(inst);
    refreshTomcatBar();
  })();

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(onSaved));

  // 설정(servers 등) 변경 → 인스턴스 Map 재조정
  context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
    if (!e.affectsConfiguration('tomcatAutoDeploy')) return;
    if (e.affectsConfiguration('tomcatAutoDeploy.instanceName')) migrateDefaultInstanceFolder();
    syncInstances();
    refreshTomcatBar();
  }));

  const depWatcher = vscode.workspace.createFileSystemWatcher('**/{pom.xml,build.gradle,build.gradle.kts}');
  depWatcher.onDidChange(() => invalidateDepClasspath());
  depWatcher.onDidCreate(() => invalidateDepClasspath());
  depWatcher.onDidDelete(() => invalidateDepClasspath());
  context.subscriptions.push(depWatcher);

  const cmds = {
    'tomcatAutoDeploy.start':       async (node) => { const i = await resolveInst(node); if (i) await startTomcat(i); },
    'tomcatAutoDeploy.stop':        async (node) => { const i = await resolveInst(node); if (i) await stopTomcat(i); },
    'tomcatAutoDeploy.forceStop':   async (node) => { const i = await resolveInst(node); if (i) await forceStopTomcat(i); },
    'tomcatAutoDeploy.restart':     async (node) => {
      const i = await resolveInst(node); if (!i) return;
      await stopTomcat(i); await new Promise(r => setTimeout(r, 2000)); await startTomcat(i);
    },
    'tomcatAutoDeploy.startAll':    async () => {
      for (const i of instances.values()) {
        if (i.running || i.orphanPid || i.starting) continue;  // 순차 — 포트충돌 다이얼로그 폭주 방지
        await startTomcat(i);
      }
    },
    'tomcatAutoDeploy.stopAll':     async () => { for (const i of runningInstances()) await stopTomcat(i); },
    'tomcatAutoDeploy.pickInstance': pickInstanceCommand,
    'tomcatAutoDeploy.addInstance':    addInstanceCommand,
    'tomcatAutoDeploy.removeInstance': removeInstanceCommand,
    'tomcatAutoDeploy.deleteOrphanFolder': deleteOrphanFolderCommand,
    'tomcatAutoDeploy.deployAll':   async () => {
      const targets = [...instances.values()];
      if (targets.length === 0) return;
      try {
        for (const i of targets) initTomcatBase(i);

        // 배포 파일(warDir)은 모든 인스턴스가 공유 → 파일 동기화는 1회만 수행
        syncAllStatus = t('progressSyncingFiles');
        if (tomcatTreeProvider) tomcatTreeProvider.refresh();
        const { compileOk, classChanged } = await syncFilesToWarDir(targets[0].warDir);
        if (compileOk === false) {
          vscode.window.showErrorMessage(t('syncCompileFailMsg', targets[0].name));
          outputChannel.show(true);
        }

        // HotSwap은 실행 중인(또는 외부 실행 중인) 인스턴스에만 적용
        for (const i of targets) {
          if (!i.running && !i.orphanPid) continue;
          syncAllStatus = t('progressSyncing', i.name);
          if (tomcatTreeProvider) tomcatTreeProvider.refresh();
          const hotSwapOk = await hotSwapChangedClasses(i, classChanged);
          if (!hotSwapOk) refreshDeployBar('warn', i.name);
        }
      } finally {
        syncAllStatus = null;
        if (tomcatTreeProvider) tomcatTreeProvider.refresh();
      }
    },
    'tomcatAutoDeploy.buildAndDeploy': buildAndDeploy,
    'tomcatAutoDeploy.syncStaticOnly': async () => {
      const targets = [...instances.values()];
      if (targets.length === 0) return;
      try {
        for (const i of targets) initTomcatBase(i);

        // 배포 파일(warDir)은 모든 인스턴스가 공유 → 정적 파일 동기화도 1회만 수행
        syncStaticStatus = t('progressSyncingFiles');
        if (tomcatTreeProvider) tomcatTreeProvider.refresh();
        // syncStaticOnly는 전부 동기 fs 호출이라 await 지점이 없음 — 트리뷰가
        // "진행중" 상태를 실제로 렌더링할 틈을 주기 위해 한 틱 양보
        await new Promise(r => setTimeout(r, 0));
        syncStaticOnly(targets[0].warDir);
      } finally {
        syncStaticStatus = null;
        if (tomcatTreeProvider) tomcatTreeProvider.refresh();
      }
    },
    'tomcatAutoDeploy.openBrowser': async (node) => {
      const i = await resolveInst(node);
      if (i) vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${i.port}${i.contextPath || '/'}`));
    },
    'tomcatAutoDeploy.showOutput':  async (node) => { const i = await resolveInst(node); if (i) getLogChannel(i).show(); else outputChannel.show(); },
    'tomcatAutoDeploy.showLocalhostLog': async (node) => { const i = await resolveInst(node); if (i) getLocalhostChannel(i).show(); },
    'tomcatAutoDeploy.configure':   () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', { query: 'tomcatAutoDeploy' }),
    'tomcatAutoDeploy.openServerXml': async (node) => {
      const i = await resolveInst(node); if (!i) return;
      const serverXml = path.join(i.confDir, 'server.xml');
      if (!fs.existsSync(serverXml)) initTomcatBase(i);
      vscode.window.showTextDocument(vscode.Uri.file(serverXml));
    },
    'tomcatAutoDeploy.openContextXml': async (node) => {
      const i = await resolveInst(node); if (!i) return;
      const contextXml = path.join(i.confDir, 'context.xml');
      if (!fs.existsSync(contextXml)) initTomcatBase(i);
      vscode.window.showTextDocument(vscode.Uri.file(contextXml));
    },
  };

  for (const [id, fn] of Object.entries(cmds)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }

  context.subscriptions.push({ dispose: () => killAllInstances() });

  if (isJavaWebProject()) {
    vscode.window.showInformationMessage(
      t('ready'),
      t('btnStart'), t('btnSettings')
    ).then(async sel => {
      if (sel === t('btnStart')) { const i = await pickInstanceInteractive(); if (i) startTomcat(i); }
      if (sel === t('btnSettings')) vscode.commands.executeCommand('tomcatAutoDeploy.configure');
    });
  }
}

// 모든 인스턴스 프로세스/워처 종료 (deactivate/창 닫기 공통)
function killAllInstances() {
  const isWin = process.platform === 'win32';
  for (const inst of instances.values()) {
    try { inst.logWatcher && inst.logWatcher.close(); } catch {}
    if (inst.proc && inst.proc.pid) {
      if (isWin) {
        try { require('child_process').execSync(`taskkill /F /T /PID ${inst.proc.pid}`, { stdio: 'ignore', shell: true }); } catch {}
      } else {
        try { inst.proc.kill('SIGTERM'); } catch {}
      }
      removePidFile(inst);
    }
  }
}

function deactivate() {
  killAllInstances();
}

module.exports = { activate, deactivate };
