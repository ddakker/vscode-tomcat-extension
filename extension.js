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
//  전역 상태
// ══════════════════════════════════════════════════════════
let outputChannel;
let tomcatProcess = null;
let tomcatRunning = false;
let orphanPid     = null;   // 이전 세션에서 남은 고아 프로세스 PID
let sbTomcat;   // 상태바: Tomcat 시작/중지 버튼
let sbDeploy;   // 상태바: Deploy 결과
let cachedDepClasspath = null; // Maven/Gradle 의존성 classpath 캐시

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
    if (element) return []; // 최상위만

    const cfg = getConfig();
    const items = [];

    // 서버 상태 항목
    const serverItem = new vscode.TreeItem(
      tomcatRunning ? '서버 실행 중' : '서버 중지됨',
      vscode.TreeItemCollapsibleState.None
    );
    serverItem.iconPath = new vscode.ThemeIcon(
      tomcatRunning ? 'vm-running' : 'vm-outline',
      tomcatRunning
        ? new vscode.ThemeColor('testing.iconPassed')
        : new vscode.ThemeColor('testing.iconSkipped')
    );
    serverItem.description = tomcatRunning ? `포트 ${cfg.port}` : '';
    serverItem.contextValue = tomcatRunning ? 'serverRunning' : 'serverStopped';
    items.push(serverItem);

    // 액션 항목들
    if (!tomcatRunning) {
      const startItem = new vscode.TreeItem('시작', vscode.TreeItemCollapsibleState.None);
      startItem.iconPath = new vscode.ThemeIcon('play', new vscode.ThemeColor('testing.iconPassed'));
      startItem.command = { command: 'tomcatAutoDeploy.start', title: '시작' };
      items.push(startItem);
    } else {
      const stopItem = new vscode.TreeItem('중지', vscode.TreeItemCollapsibleState.None);
      stopItem.iconPath = new vscode.ThemeIcon('debug-stop', new vscode.ThemeColor('testing.iconFailed'));
      stopItem.command = { command: 'tomcatAutoDeploy.stop', title: '중지' };
      items.push(stopItem);

      const restartItem = new vscode.TreeItem('재시작', vscode.TreeItemCollapsibleState.None);
      restartItem.iconPath = new vscode.ThemeIcon('refresh');
      restartItem.command = { command: 'tomcatAutoDeploy.restart', title: '재시작' };
      items.push(restartItem);

      const browserItem = new vscode.TreeItem('브라우저 열기', vscode.TreeItemCollapsibleState.None);
      browserItem.iconPath = new vscode.ThemeIcon('globe');
      browserItem.description = `http://localhost:${cfg.port}`;
      browserItem.command = { command: 'tomcatAutoDeploy.openBrowser', title: '브라우저 열기' };
      items.push(browserItem);
    }

    const outputItem = new vscode.TreeItem('Output 보기', vscode.TreeItemCollapsibleState.None);
    outputItem.iconPath = new vscode.ThemeIcon('output');
    outputItem.command = { command: 'tomcatAutoDeploy.showOutput', title: 'Output 보기' };
    items.push(outputItem);

    const settingsItem = new vscode.TreeItem('설정', vscode.TreeItemCollapsibleState.None);
    settingsItem.iconPath = new vscode.ThemeIcon('gear');
    settingsItem.command = { command: 'tomcatAutoDeploy.configure', title: '설정' };
    items.push(settingsItem);

    return items;
  }
}

let tomcatTreeProvider;

// ══════════════════════════════════════════════════════════
//  설정
// ══════════════════════════════════════════════════════════
function getConfig() {
  const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
  const ws  = getWorkspaceRoot() || '';
  return {
    catalinaHome:   cfg.get('catalinaHome', ''),
    javaHome:       cfg.get('javaHome', ''),
    javaSourceRoot: cfg.get('javaSourceRoot', 'src/main/java'),
    webContentRoot: cfg.get('webContentRoot', 'src/main/webapp'),
    classpath:      cfg.get('classpath', []),
    port:           cfg.get('port', 8080),
    debugPort:      cfg.get('debugPort', 5005),
    // 프로젝트 루트 기준 자동 계산 경로
    catalinaBase:   path.join(ws, '.tomcat'),
    webappsRoot:    path.join(ws, '.tomcat', 'webapps', 'ROOT'),
    confDir:        path.join(ws, '.tomcat', 'conf'),
  };
}

function getWorkspaceRoot() {
  const f = vscode.workspace.workspaceFolders;
  return f && f.length > 0 ? f[0].uri.fsPath : null;
}

// ══════════════════════════════════════════════════════════
//  로그
// ══════════════════════════════════════════════════════════
function log(msg, level = 'INFO') {
  const ts = new Date().toLocaleTimeString('ko-KR');
  outputChannel.appendLine(`[${ts}] [${level}] ${msg}`);
}

// ══════════════════════════════════════════════════════════
//  상태바 - Tomcat 제어
// ══════════════════════════════════════════════════════════
function refreshTomcatBar(state) {
  const map = {
    stopped:  { text: '$(play) Tomcat',           tip: 'Tomcat 시작',  bg: undefined,                                               cmd: 'tomcatAutoDeploy.start'  },
    starting: { text: '$(sync~spin) Tomcat 기동중', tip: '기동 중...',   bg: undefined,                                               cmd: ''                        },
    running:  { text: '$(debug-stop) Tomcat',      tip: 'Tomcat 중지',  bg: new vscode.ThemeColor('statusBarItem.warningBackground'), cmd: 'tomcatAutoDeploy.stop'   },
    stopping: { text: '$(sync~spin) Tomcat 중지중', tip: '중지 중...',   bg: undefined,                                               cmd: ''                        },
  };
  const m = map[state] || map.stopped;
  sbTomcat.text            = m.text;
  sbTomcat.tooltip         = m.tip;
  sbTomcat.backgroundColor = m.bg;
  sbTomcat.command         = m.cmd || undefined;
  sbTomcat.show();

  // 사이드바 TreeView 갱신 + when 절 컨텍스트 키
  vscode.commands.executeCommand('setContext', 'tomcatAutoDeploy.running', state === 'running');
  if (tomcatTreeProvider) tomcatTreeProvider.refresh();
}

// ══════════════════════════════════════════════════════════
//  상태바 - Deploy 결과
// ══════════════════════════════════════════════════════════
function refreshDeployBar(state, filename) {
  const map = {
    idle:      { text: '$(cloud-upload) Deploy 대기중',          bg: undefined },
    deploying: { text: `$(sync~spin) 배포중: ${filename || ''}`, bg: undefined },
    ok:        { text: `$(check) 배포완료: ${filename || ''}`,   bg: undefined },
    err:       { text: `$(error) 배포실패: ${filename || ''}`,   bg: new vscode.ThemeColor('statusBarItem.errorBackground') },
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
      process.kill(-pid, 'SIGKILL');  // 프로세스 그룹 전체
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
      // PowerShell로 java 프로세스의 커맨드라인에서 catalina.base 검색
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
      // pgrep으로 검색 (macOS/Linux 공통)
      let out;
      try {
        out = require('child_process').execSync(
          `pgrep -f "catalina.base=${catalinaBase}"`,
          { encoding: 'utf-8', stdio: ['pipe', 'pipe', 'ignore'], timeout: 5000 }
        );
      } catch {
        // pgrep 미설치 시 ps 폴백
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
    log(`[Orphan] 이전 세션의 Tomcat 프로세스 감지 (PID=${pid})`, 'WARN');
    refreshTomcatBar('running');
    return true;
  }
  // PID 파일은 있지만 프로세스가 없으면 정리
  if (pid) removePidFile();
  return false;
}

// ══════════════════════════════════════════════════════════
//  .tomcat 디렉토리 초기화
//  - conf/context.xml  : reloadable="false" (JDWP HotSwap 사용)
//  - conf/server.xml   : CATALINA_BASE 기반 포트/경로 설정
//  - webapps/ROOT/WEB-INF/classes/ : 컴파일 결과물 경로
// ══════════════════════════════════════════════════════════
function initTomcatBase() {
  const cfg  = getConfig();
  const base = cfg.catalinaBase;

  // 필수 디렉토리
  for (const d of [
    'conf',
    'webapps/ROOT/WEB-INF/classes',
    'logs', 'work', 'temp',
  ]) {
    fs.mkdirSync(path.join(base, d), { recursive: true });
  }

  // ── context.xml ──────────────────────────────────────────
  // reloadable="false" : JDWP HotSwap으로 클래스 교체 (컨텍스트 재시작 없음)
  const contextXml = path.join(cfg.confDir, 'context.xml');
  let needWriteContextXml = !fs.existsSync(contextXml);
  if (!needWriteContextXml) {
    try {
      const existing = fs.readFileSync(contextXml, 'utf-8');
      if (existing.includes('reloadable="true"')) {
        needWriteContextXml = true;
        log('[Init] context.xml reloadable=false 로 변경 (JDWP HotSwap 사용)');
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
    log('[Init] context.xml 생성');
  }

  // ── server.xml ───────────────────────────────────────────
  const serverXml = path.join(cfg.confDir, 'server.xml');
  let needWriteServerXml = !fs.existsSync(serverXml);
  // 기존 server.xml의 shutdown 포트가 -1이 아니면 강제 재생성
  if (!needWriteServerXml) {
    try {
      const existing = fs.readFileSync(serverXml, 'utf-8');
      if (!existing.includes('port="-1"')) {
        needWriteServerXml = true;
        log('[Init] server.xml shutdown 포트 수정 필요 → 재생성');
      }
    } catch {}
  }
  if (needWriteServerXml) {
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
               connectionTimeout="20000" redirectPort="8443"
               URIEncoding="UTF-8"/>

    <Engine name="Catalina" defaultHost="localhost">
      <Realm className="org.apache.catalina.realm.LockOutRealm">
        <Realm className="org.apache.catalina.realm.UserDatabaseRealm"
               resourceName="UserDatabase"/>
      </Realm>

      <Host name="localhost" appBase="webapps"
            unpackWARs="false" autoDeploy="false" deployOnStartup="true">
        <Valve className="org.apache.catalina.valves.AccessLogValve"
               directory="logs" prefix="localhost_access" suffix=".txt"
               pattern="%h %l %u %t &quot;%r&quot; %s %b"/>
      </Host>
    </Engine>
  </Service>
</Server>
`, 'utf-8');
    log('[Init] server.xml 생성');
  }

  // ── CATALINA_HOME → CATALINA_BASE 필수 파일 복사 ─────────
  if (cfg.catalinaHome) {
    for (const f of ['web.xml', 'logging.properties']) {
      const dest = path.join(cfg.confDir, f);
      const src  = path.join(cfg.catalinaHome, 'conf', f);
      if (!fs.existsSync(dest) && fs.existsSync(src)) {
        fs.copyFileSync(src, dest);
        log(`[Init] ${f} 복사 완료`);
      }
    }
  }

  log(`[Init] CATALINA_BASE = ${base}`);
  log(`[Init] webapps/ROOT  = ${cfg.webappsRoot}`);
  log(`[Init] PORT          = ${cfg.port}`);
}


// ══════════════════════════════════════════════════════════
//  Tomcat 시작
// ══════════════════════════════════════════════════════════
async function startTomcat() {
  if (tomcatRunning || orphanPid) {
    vscode.window.showWarningMessage('Tomcat이 이미 실행 중입니다. 먼저 중지해주세요.');
    return;
  }
  const cfg = getConfig();

  // CATALINA_BASE 기준으로 이미 기동된 프로세스 확인
  const existingPid = findProcessByCatalinaBase(cfg.catalinaBase);
  if (existingPid) {
    const sel = await vscode.window.showWarningMessage(
      `이 CATALINA_BASE를 사용하는 Tomcat 프로세스가 이미 실행 중입니다. (PID: ${existingPid})`,
      '강제 종료 후 시작', '취소'
    );
    if (sel === '강제 종료 후 시작') {
      forceKillPid(existingPid);
      log(`[Tomcat] 기존 프로세스 강제 종료 (PID=${existingPid})`);
      await new Promise(r => setTimeout(r, 2000));
    } else {
      return;
    }
  }

  if (!cfg.catalinaHome) {
    const ans = await vscode.window.showErrorMessage(
      'CATALINA_HOME(catalinaHome) 설정이 필요합니다.',
      '설정 열기'
    );
    if (ans) vscode.commands.executeCommand('workbench.action.openSettings', 'tomcatAutoDeploy.catalinaHome');
    return;
  }

  initTomcatBase();
  refreshTomcatBar('starting');

  // 기동 전 전체 동기화 (Java 컴파일 + Static 복사)
  await syncAll();

  const isWin    = process.platform === 'win32';
  const catalina = path.join(cfg.catalinaHome, 'bin', isWin ? 'catalina.bat' : 'catalina.sh');
  const prevOpts = process.env.CATALINA_OPTS || '';
  const utf8Opts = '-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8';
  const env = {
    ...process.env,
    JAVA_HOME:      cfg.javaHome || process.env.JAVA_HOME || '',
    CATALINA_HOME:  cfg.catalinaHome,
    CATALINA_BASE:  cfg.catalinaBase,
    JPDA_ADDRESS:   `localhost:${cfg.debugPort}`,
    JPDA_TRANSPORT: 'dt_socket',
    JPDA_SUSPEND:   'n',
    CATALINA_OPTS:  `${utf8Opts} ${prevOpts}`.trim(),
  };

  log(`[Tomcat] JPDA 디버그 모드로 기동 (포트: ${cfg.debugPort})...`);

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
    refreshTomcatBar('stopped');
    log(`[Tomcat] 종료 (code=${code})`);
  });

  try {
    await waitForTomcat(cfg.port, 30000);
    tomcatRunning = true;
    refreshTomcatBar('running');
    vscode.window.showInformationMessage(
      `✅ Tomcat 시작 완료 → http://localhost:${cfg.port}`,
      '브라우저 열기'
    ).then(sel => {
      if (sel) vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${cfg.port}`));
    });
    log(`[Tomcat] 기동 완료 → http://localhost:${cfg.port}`);
  } catch (err) {
    tomcatRunning = false;
    tomcatProcess?.kill();
    tomcatProcess = null;
    refreshTomcatBar('stopped');
    log(`[Tomcat] 기동 실패: ${err.message}`, 'ERROR');
    vscode.window.showErrorMessage(`Tomcat 기동 실패: ${err.message}`);
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
        if (Date.now() > deadline) reject(new Error('Tomcat 기동 타임아웃 (30초)'));
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
    vscode.window.showWarningMessage('Tomcat이 실행 중이 아닙니다.');
    return;
  }
  refreshTomcatBar('stopping');
  log('[Tomcat] 중지 요청...');

  // 고아 프로세스 (이전 세션에서 남은 것) → 강제 종료
  if (orphanPid) {
    log(`[Tomcat] 고아 프로세스 강제 종료 (PID=${orphanPid})`, 'WARN');
    forceKillPid(orphanPid);
    orphanPid = null;
    tomcatRunning = false;
    removePidFile();
    refreshTomcatBar('stopped');
    log('[Tomcat] 강제 종료 완료');
    vscode.window.showInformationMessage('Tomcat 프로세스를 강제 종료했습니다.');
    return;
  }

  // 현재 세션에서 시작한 프로세스 → 프로세스 종료 후 대기
  if (tomcatProcess) {
    const proc = tomcatProcess;
    const pid  = proc.pid;

    // 종료 완료를 기다리는 Promise
    const waitExit = new Promise(resolve => {
      proc.once('exit', resolve);
      // 최대 10초 대기
      setTimeout(resolve, 10000);
    });

    const isWin = process.platform === 'win32';
    if (isWin && pid) {
      // Windows: taskkill /T 로 프로세스 트리 전체 종료
      log(`[Tomcat] taskkill /F /T /PID ${pid}`);
      try {
        require('child_process').execSync(`taskkill /F /T /PID ${pid}`, { stdio: 'ignore', shell: true });
      } catch {}
    } else if (pid) {
      proc.kill('SIGTERM');
      log('[Tomcat] SIGTERM 전송');
      // 3초 후에도 살아있으면 강제 종료
      setTimeout(() => {
        if (tomcatProcess) {
          try { process.kill(-pid, 'SIGKILL'); } catch {}
          try { process.kill(pid, 'SIGKILL'); } catch {}
          log('[Tomcat] 강제 SIGKILL 전송', 'WARN');
        }
      }, 3000);
    }

    await waitExit;
    tomcatRunning = false;
    tomcatProcess = null;
    removePidFile();
    refreshTomcatBar('stopped');
    log('[Tomcat] 중지 완료');
  }
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

  // 1) Maven Wrapper
  if (isWin) {
    const w = findWinExe(ws, 'mvnw');
    if (w) return w;
  } else {
    const w = path.join(ws, 'mvnw');
    if (fs.existsSync(w)) return w;
  }

  // 2) MAVEN_HOME / M2_HOME 환경변수
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

  // 3) PATH (기본값)
  return isWin ? 'mvn.cmd' : 'mvn';
}

/**
 * Gradle 실행 파일 경로 탐색: gradlew → GRADLE_HOME → PATH
 */
function findGradleCmd(ws) {
  const isWin = process.platform === 'win32';

  // 1) Gradle Wrapper
  if (isWin) {
    const w = findWinExe(ws, 'gradlew');
    if (w) return w;
  } else {
    const w = path.join(ws, 'gradlew');
    if (fs.existsSync(w)) return w;
  }

  // 2) GRADLE_HOME 환경변수
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

  // 3) PATH (기본값)
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
  fs.mkdirSync(path.join(ws, '.tomcat'), { recursive: true });
  const cpFile = path.join(ws, '.tomcat', 'dep-classpath.txt');

  try {
    if (buildTool === 'maven') {
      const mvn = findMvnCmd(ws);
      log(`[의존성] Maven classpath 해석 중... (${mvn})`);
      await execAsync(
        `"${mvn}" dependency:build-classpath -Dmdep.outputFile=.tomcat/dep-classpath.txt -q`,
        { cwd: ws, timeout: 120000 }
      );
      if (fs.existsSync(cpFile)) {
        cachedDepClasspath = fs.readFileSync(cpFile, 'utf-8').trim();
        log(`[의존성] Maven classpath 해석 완료 (${cachedDepClasspath.split(isWin ? ';' : ':').length}개 항목)`);
      } else {
        cachedDepClasspath = '';
        log('[의존성] Maven classpath 파일 생성 실패', 'WARN');
      }
    } else {
      // Gradle
      const gradleCmd = findGradleCmd(ws);
      log(`[의존성] Gradle classpath 해석 중... (${gradleCmd})`);
      const initScript = path.join(ws, '.tomcat', 'cp-init.gradle');
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
        log(`[의존성] Gradle classpath 해석 완료 (${cachedDepClasspath.split(isWin ? ';' : ':').length}개 항목)`);
      } else {
        cachedDepClasspath = '';
        log('[의존성] Gradle classpath 파일 생성 실패', 'WARN');
      }
      try { fs.unlinkSync(initScript); } catch {}
    }
  } catch (err) {
    log(`[의존성] classpath 해석 실패: ${err.message}`, 'ERROR');
    cachedDepClasspath = '';
  }

  return cachedDepClasspath;
}

function invalidateDepClasspath() {
  cachedDepClasspath = null;
  log('[의존성] classpath 캐시 무효화 — 다음 컴파일 시 재해석');
}

// ══════════════════════════════════════════════════════════
//  JDWP HotSwap: 클래스 바이트코드 교체 (컨텍스트 재시작 없음)
// ══════════════════════════════════════════════════════════
function jdwpHotSwap(port, className, classBytes) {
  const net = require('net');

  return new Promise((resolve, reject) => {
    const socket = net.createConnection(port, 'localhost');
    socket.setTimeout(5000);

    let nextId = 1;
    let refTypeIdSize = 8;
    let buf = Buffer.alloc(0);
    const cbs = new Map();
    let phase = 'handshake';

    socket.on('timeout', () => { socket.destroy(); reject(new Error('JDWP 타임아웃')); });
    socket.on('error', err => { reject(new Error(`JDWP 연결 실패: ${err.message}`)); });

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
            cb(errCode ? new Error(`JDWP 에러 코드 ${errCode}`) : null, data);
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
          return reject(new Error('JDWP 핸드셰이크 실패'));
        }
        buf = buf.slice(14);
        phase = 'ready';
        doSwap();
      }
      if (phase === 'ready') processReplies();
    });

    async function doSwap() {
      try {
        // 1) ID 크기 조회
        const ids = await send(1, 7, Buffer.alloc(0));
        refTypeIdSize = ids.readInt32BE(12); // referenceTypeIDSize

        // 2) 클래스 검색
        const sig = 'L' + className.replace(/\./g, '/') + ';';
        const sigBuf = Buffer.alloc(4 + Buffer.byteLength(sig));
        sigBuf.writeInt32BE(Buffer.byteLength(sig), 0);
        sigBuf.write(sig, 4);
        const clsData = await send(1, 2, sigBuf);
        const count = clsData.readInt32BE(0);
        if (count === 0) {
          socket.destroy();
          return resolve('not_loaded'); // 아직 로드되지 않은 클래스
        }
        // refTypeTag(1) + referenceTypeID(n)
        const refTypeId = clsData.slice(5, 5 + refTypeIdSize);

        // 3) RedefineClasses
        const pkt = Buffer.alloc(4 + refTypeIdSize + 4 + classBytes.length);
        let off = 0;
        pkt.writeInt32BE(1, off); off += 4;
        refTypeId.copy(pkt, off);  off += refTypeIdSize;
        pkt.writeInt32BE(classBytes.length, off); off += 4;
        classBytes.copy(pkt, off);

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
//  Java 컴파일 → .tomcat/webapps/ROOT/WEB-INF/classes
// ══════════════════════════════════════════════════════════
async function compileAndDeploy(savedFilePath) {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const cfg        = getConfig();
  const classesDir = path.join(cfg.webappsRoot, 'WEB-INF', 'classes');
  const srcRoot    = path.join(ws, cfg.javaSourceRoot);
  const javaBin    = cfg.javaHome ? path.join(cfg.javaHome, 'bin', 'javac') : 'javac';
  const fname      = path.basename(savedFilePath);

  fs.mkdirSync(classesDir, { recursive: true });

  const cpSep = process.platform === 'win32' ? ';' : ':';
  const cpParts = [classesDir];
  // Tomcat lib/*.jar 자동 포함 (servlet-api 등)
  if (cfg.catalinaHome) {
    cpParts.push(path.join(cfg.catalinaHome, 'lib', '*'));
  }
  // Maven/Gradle 의존성 자동 포함
  const depCp = await resolveDependencyClasspath();
  if (depCp) cpParts.push(depCp);
  cpParts.push(...cfg.classpath);
  const cp    = cpParts.join(cpSep);
  const cmd   = `"${javaBin}" -encoding UTF-8 -cp "${cp}" -sourcepath "${srcRoot}" -d "${classesDir}" "${savedFilePath}"`;

  log(`[Java] 컴파일: ${fname}`);
  log(`[Java] CMD: ${cmd}`);
  refreshDeployBar('deploying', fname);

  try {
    const { stderr } = await execAsync(cmd);
    if (stderr) log(`[Java] stderr: ${stderr}`, 'WARN');
    log(`[Java] 컴파일 성공 → ${classesDir}`);
    refreshDeployBar('ok', fname);

    // JDWP HotSwap: 컨텍스트 재시작 없이 클래스 교체
    if (tomcatRunning) {
      const relPath   = path.relative(srcRoot, savedFilePath);
      const className = relPath.replace(/\.java$/, '').replace(/[/\\]/g, '.');
      const classFile = path.join(classesDir, relPath.replace(/\.java$/, '.class'));

      if (fs.existsSync(classFile)) {
        try {
          const classBytes = fs.readFileSync(classFile);
          const result = await jdwpHotSwap(cfg.debugPort, className, classBytes);
          if (result === 'ok') {
            log(`[HotSwap] ✔ ${className} 클래스 교체 완료 (재시작 없음)`);
          } else {
            log(`[HotSwap] ${className} 미로드 상태 — 다음 접근 시 반영`);
          }
        } catch (err) {
          log(`[HotSwap] ${className} 교체 실패 (구조 변경?) — ${err.message}`, 'WARN');
        }
      }
    }
  } catch (err) {
    log(`[Java] 컴파일 실패:\n${err.message}`, 'ERROR');
    refreshDeployBar('err', fname);
    outputChannel.show(true);
  }
}

// ══════════════════════════════════════════════════════════
//  JSP / Static → .tomcat/webapps/ROOT
// ══════════════════════════════════════════════════════════
async function deployStatic(savedFilePath) {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const cfg        = getConfig();
  const webSrcRoot = path.join(ws, cfg.webContentRoot);
  const rel        = path.relative(webSrcRoot, savedFilePath);

  if (rel.startsWith('..')) return; // 범위 밖

  const dest  = path.join(cfg.webappsRoot, rel);
  const fname = path.basename(savedFilePath);

  fs.mkdirSync(path.dirname(dest), { recursive: true });
  refreshDeployBar('deploying', fname);

  try {
    fs.copyFileSync(savedFilePath, dest);
    log(`[Static] ${rel} → ${dest}`);
    refreshDeployBar('ok', fname);
  } catch (e) {
    log(`[Static] 배포 실패: ${e.message}`, 'ERROR');
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

/**
 * 디렉토리 전체를 대상 경로에 재귀 복사 (동기화)
 */
function copyDirSync(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return 0;
  let count = 0;
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const s = path.join(srcDir, entry.name);
    const d = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      count += copyDirSync(s, d);
    } else {
      fs.mkdirSync(destDir, { recursive: true });
      fs.copyFileSync(s, d);
      count++;
    }
  }
  return count;
}

async function syncAll() {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const cfg        = getConfig();
  const srcRoot    = path.join(ws, cfg.javaSourceRoot);
  const webSrcRoot = path.join(ws, cfg.webContentRoot);
  const classesDir = path.join(cfg.webappsRoot, 'WEB-INF', 'classes');
  const buildTool  = detectBuildTool(ws);

  log('[Sync] 전체 동기화 시작...');

  // ── 1) Java classes 동기화 ──
  if (buildTool === 'maven') {
    // Maven: target/classes 전체 복사 (컴파일된 .class + 리소스)
    const targetClasses = path.join(ws, 'target', 'classes');
    if (fs.existsSync(targetClasses)) {
      fs.mkdirSync(classesDir, { recursive: true });
      const count = copyDirSync(targetClasses, classesDir);
      log(`[Sync] Maven target/classes → WEB-INF/classes (${count}개 파일 복사)`);
    } else {
      log('[Sync] target/classes 없음 — mvn compile 을 먼저 실행하세요', 'WARN');
    }
  } else if (buildTool === 'gradle') {
    // Gradle: build/classes 전체 복사
    const buildClasses = path.join(ws, 'build', 'classes');
    if (fs.existsSync(buildClasses)) {
      fs.mkdirSync(classesDir, { recursive: true });
      const count = copyDirSync(buildClasses, classesDir);
      log(`[Sync] Gradle build/classes → WEB-INF/classes (${count}개 파일 복사)`);
    } else {
      log('[Sync] build/classes 없음 — gradle compileJava 를 먼저 실행하세요', 'WARN');
    }
  } else {
    // 빌드 도구 없음: javac 직접 컴파일
    const javaFiles = collectFiles(srcRoot, ['.java']);
    if (javaFiles.length > 0) {
      fs.mkdirSync(classesDir, { recursive: true });

      const javaBin = cfg.javaHome ? path.join(cfg.javaHome, 'bin', 'javac') : 'javac';
      const cpSep   = process.platform === 'win32' ? ';' : ':';
      const cpParts = [classesDir];
      if (cfg.catalinaHome) cpParts.push(path.join(cfg.catalinaHome, 'lib', '*'));
      cpParts.push(...cfg.classpath);
      const cp = cpParts.join(cpSep);

      const fileList = javaFiles.map(f => `"${f}"`).join(' ');
      const cmd = `"${javaBin}" -encoding UTF-8 -cp "${cp}" -sourcepath "${srcRoot}" -d "${classesDir}" ${fileList}`;

      log(`[Sync] Java ${javaFiles.length}개 파일 컴파일...`);
      try {
        await execAsync(cmd, { maxBuffer: 10 * 1024 * 1024 });
        log(`[Sync] Java 컴파일 완료 (${javaFiles.length}개)`);
      } catch (err) {
        log(`[Sync] Java 컴파일 실패:\n${err.message}`, 'ERROR');
      }
    }
  }

  // ── 2) 의존성 JAR → WEB-INF/lib 복사 ──
  if (buildTool === 'maven' || buildTool === 'gradle') {
    const depCp = await resolveDependencyClasspath();
    if (depCp) {
      const libDir = path.join(cfg.webappsRoot, 'WEB-INF', 'lib');
      fs.mkdirSync(libDir, { recursive: true });
      const cpSep  = process.platform === 'win32' ? ';' : ':';
      const jars   = depCp.split(cpSep).filter(p => p.endsWith('.jar') && fs.existsSync(p));
      let jarCount = 0;
      for (const jar of jars) {
        const dest = path.join(libDir, path.basename(jar));
        try {
          // 이미 동일한 파일이면 스킵 (크기 비교)
          if (fs.existsSync(dest) && fs.statSync(jar).size === fs.statSync(dest).size) continue;
          fs.copyFileSync(jar, dest);
          jarCount++;
        } catch (e) {
          log(`[Sync] JAR 복사 실패: ${path.basename(jar)} → ${e.message}`, 'WARN');
        }
      }
      log(`[Sync] 의존성 JAR → WEB-INF/lib (${jarCount}개 복사, 총 ${jars.length}개)`);
    }
  }

  // ── 3) Static / JSP 전체 복사 ──
  const staticExts = [
    '.jsp','.jspx','.html','.htm',
    '.css','.js','.json','.xml','.properties',
    '.png','.jpg','.jpeg','.gif','.svg','.ico',
    '.woff','.woff2','.ttf','.eot',
  ];
  const staticFiles = collectFiles(webSrcRoot, staticExts);
  let copied = 0;
  for (const src of staticFiles) {
    const rel  = path.relative(webSrcRoot, src);
    const dest = path.join(cfg.webappsRoot, rel);
    try {
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.copyFileSync(src, dest);
      copied++;
    } catch (e) {
      log(`[Sync] 복사 실패: ${rel} → ${e.message}`, 'WARN');
    }
  }
  if (copied > 0) log(`[Sync] 정적 파일 ${copied}개 복사 완료`);

  log('[Sync] 전체 동기화 완료');
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

  const statics = [
    '.jsp','.jspx','.html','.htm',
    '.css','.js','.json','.xml','.properties',
    '.png','.jpg','.jpeg','.gif','.svg','.ico',
    '.woff','.woff2','.ttf','.eot',
  ];
  if (statics.includes(ext)) await deployStatic(fp);
}

// ══════════════════════════════════════════════════════════
//  .vscode/settings.json 초기화
// ══════════════════════════════════════════════════════════
async function ensureWorkspaceSettings() {
  const ws = getWorkspaceRoot();
  if (!ws) return;

  const vscodeDir  = path.join(ws, '.vscode');
  const settingsFile = path.join(vscodeDir, 'settings.json');

  // 이미 tomcatAutoDeploy 설정이 있으면 스킵
  const cfg = vscode.workspace.getConfiguration('tomcatAutoDeploy');
  if (cfg.get('catalinaHome', '')) return;

  // settings.json 파일 읽기 또는 빈 객체
  let settings = {};
  if (fs.existsSync(settingsFile)) {
    try {
      const content = fs.readFileSync(settingsFile, 'utf-8');
      settings = JSON.parse(content);
    } catch {}
    // 이미 tomcatAutoDeploy 키가 있으면 스킵
    if (Object.keys(settings).some(k => k.startsWith('tomcatAutoDeploy.'))) return;
  }

  // 기본 설정 추가
  settings['tomcatAutoDeploy.catalinaHome'] = '';
  settings['tomcatAutoDeploy.javaHome'] = '';
  settings['tomcatAutoDeploy.port'] = 8080;
  settings['tomcatAutoDeploy.debugPort'] = 5005;
  settings['tomcatAutoDeploy.javaSourceRoot'] = 'src/main/java';
  settings['tomcatAutoDeploy.webContentRoot'] = 'src/main/webapp';
  settings['tomcatAutoDeploy.classpath'] = [];

  fs.mkdirSync(vscodeDir, { recursive: true });
  fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2), 'utf-8');
  log('[Init] .vscode/settings.json에 기본 설정 생성');

  // 파일 열기
  const doc = await vscode.workspace.openTextDocument(settingsFile);
  await vscode.window.showTextDocument(doc);
  vscode.window.showWarningMessage('catalinaHome 설정이 필요합니다. .vscode/settings.json을 확인하세요.');
}

// ══════════════════════════════════════════════════════════
//  activate
// ══════════════════════════════════════════════════════════
function activate(context) {
  outputChannel = vscode.window.createOutputChannel('Tomcat Auto Deploy');
  outputChannel.show(true);

  let buildTime = '개발 모드';
  try {
    const info = JSON.parse(fs.readFileSync(path.join(__dirname, 'build-info.json'), 'utf-8'));
    buildTime = new Date(info.buildTime).toLocaleString('ko-KR');
  } catch {}
  log(`Tomcat Auto Deploy v0.0.1 활성화 (빌드: ${buildTime})`);

  // .vscode/settings.json 기본 설정 초기화
  ensureWorkspaceSettings();

  sbTomcat = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 102);
  sbDeploy = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
  refreshDeployBar('idle');
  context.subscriptions.push(sbTomcat, sbDeploy);

  // 고아 프로세스 감지 (이전 세션에서 남은 Tomcat)
  if (!detectOrphanProcess()) {
    refreshTomcatBar('stopped');
  }

  // 사이드바 TreeView 등록
  tomcatTreeProvider = new TomcatTreeProvider();
  const treeView = vscode.window.createTreeView('tomcatServerView', {
    treeDataProvider: tomcatTreeProvider,
    showCollapseAll: false,
  });
  context.subscriptions.push(treeView);

  context.subscriptions.push(vscode.workspace.onDidSaveTextDocument(onSaved));

  // pom.xml / build.gradle 변경 시 의존성 classpath 캐시 무효화
  const depWatcher = vscode.workspace.createFileSystemWatcher('**/{pom.xml,build.gradle,build.gradle.kts}');
  depWatcher.onDidChange(() => invalidateDepClasspath());
  depWatcher.onDidCreate(() => invalidateDepClasspath());
  depWatcher.onDidDelete(() => invalidateDepClasspath());
  context.subscriptions.push(depWatcher);

  const cmds = {
    'tomcatAutoDeploy.start':       startTomcat,
    'tomcatAutoDeploy.stop':        stopTomcat,
    'tomcatAutoDeploy.restart':     async () => { await stopTomcat(); await new Promise(r => setTimeout(r, 2000)); await startTomcat(); },
    'tomcatAutoDeploy.openBrowser': () => vscode.env.openExternal(vscode.Uri.parse(`http://localhost:${getConfig().port}`)),
    'tomcatAutoDeploy.showOutput':  () => outputChannel.show(),
    'tomcatAutoDeploy.configure':   () => vscode.commands.executeCommand('workbench.action.openWorkspaceSettings', { query: 'tomcatAutoDeploy' }),
  };

  for (const [id, fn] of Object.entries(cmds)) {
    context.subscriptions.push(vscode.commands.registerCommand(id, fn));
  }

  // Extension 종료 시 Tomcat 정리
  context.subscriptions.push({ dispose: () => {
    if (tomcatProcess && tomcatProcess.pid) {
      if (process.platform === 'win32') {
        try { require('child_process').execSync(`taskkill /F /T /PID ${tomcatProcess.pid}`, { stdio: 'ignore', shell: true }); } catch {}
      } else {
        tomcatProcess.kill('SIGTERM');
      }
    }
  }});

  vscode.window.showInformationMessage(
    'Tomcat Auto Deploy v0.0.1 준비됨 — 상태바에서 ▶/■ 클릭',
    '▶ 시작', '⚙ 설정'
  ).then(sel => {
    if (sel === '▶ 시작') startTomcat();
    if (sel === '⚙ 설정') vscode.commands.executeCommand('tomcatAutoDeploy.configure');
  });
}

function deactivate() {
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
