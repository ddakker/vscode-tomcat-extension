# Tomcat Auto Deploy — 아키텍처 계획서

> 이 문서는 "Tomcat Auto Deploy" 에디터 확장의 전체 아키텍처를 정리한다.
> 현재 VS Code 확장으로 구현되어 있으며, 다른 에디터로의 포팅이나 기능 확장 시 참고 자료로 활용한다.

---

## 1. 프로젝트 개요

| 항목 | 내용 |
|------|------|
| **이름** | Tomcat Auto Deploy |
| **버전** | 0.0.1 |
| **언어** | JavaScript (순수, TypeScript/번들러 없음) |
| **구조** | 단일 파일 (`extension.js`, ~1,500줄) |
| **UI 언어** | 한국어 |
| **핵심 기능** | Java 파일 저장 → 자동 컴파일 → JDWP HotSwap으로 실행 중인 Tomcat에 즉시 반영 |
| **지원 플랫폼** | Windows, Linux, macOS |

---

## 2. 핵심 아키텍처 다이어그램

```
┌─────────────────────────────────────────────────────────────────┐
│                           Editor                                │
│                                                                 │
│  ┌──────────┐  ┌───────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Status   │  │ TreeView  │  │ Output     │  │ Commands    │  │
│  │ Bar ×2   │  │ (Sidebar) │  │ Channel ×2 │  │ (9개)       │  │
│  └────┬─────┘  └─────┬─────┘  └─────┬──────┘  └──────┬──────┘  │
│       └───────────────┴──────────────┴─────────────────┘        │
│                              │                                  │
│                    ┌─────────▼──────────┐                       │
│                    │   Core Engine      │                       │
│                    │   (extension.js)   │                       │
│                    └─────────┬──────────┘                       │
└──────────────────────────────┼──────────────────────────────────┘
                               │
          ┌────────────────────┼────────────────────┐
          │                    │                    │
  ┌───────▼───────┐   ┌───────▼───────┐   ┌───────▼───────┐
  │  Tomcat       │   │  javac        │   │  JDWP         │
  │  Process      │   │  Compiler     │   │  HotSwap      │
  │  Management   │   │               │   │  (TCP:5005)   │
  │               │   │  ┌──────────┐ │   │               │
  │  catalina.sh  │   │  │ Maven/   │ │   │  RedefineClass│
  │  jpda run     │   │  │ Gradle   │ │   │  Protocol     │
  │               │   │  │ Resolver │ │   │               │
  └───────────────┘   │  └──────────┘ │   └───────────────┘
                      └───────────────┘
          │                    │                    │
          └────────────────────┼────────────────────┘
                               │
                    ┌──────────▼──────────┐
                    │  .vscode/tomcat/    │
                    │  (CATALINA_BASE)    │
                    │                     │
                    │  conf/server.xml    │
                    │  conf/context.xml   │
                    │  webapps/ROOT/      │
                    │    WEB-INF/classes/ │
                    │    WEB-INF/lib/     │
                    │  logs/             │
                    │  dep-classpath.txt  │
                    └─────────────────────┘
```

---

## 3. 핵심 흐름 (Data Flow)

### 3.1 전체 라이프사이클

```
Extension 활성화
    │
    ├─ ensureWorkspaceSettings()     // .vscode/settings.json 초기화
    ├─ detectOrphanProcess()         // 이전 세션 고아 프로세스 감지
    ├─ UI 초기화 (StatusBar, TreeView, Commands)
    │
    ▼
사용자 "시작" 클릭
    │
    ├─ findProcessByCatalinaBase()   // 기존 프로세스 중복 감지
    ├─ initTomcatBase()              // .vscode/tomcat/ 디렉토리 생성
    ├─ syncAll()                     // 전체 동기화 (classes + deps + static)
    ├─ spawn("catalina.sh jpda run") // Tomcat 기동 (JDWP 디버그 모드)
    ├─ waitForTomcat()               // HTTP 폴링 (최대 30초)
    └─ startLocalhostLogWatch()      // 로그 실시간 모니터링
    │
    ▼
파일 저장 이벤트 (onDidSaveTextDocument)
    │
    ├─ .java 파일 → compileAndDeploy()
    │     ├─ javac 컴파일 (-source/-target 자동 감지)
    │     └─ jdwpHotSwap() → JDWP TCP 연결 → RedefineClasses
    │
    └─ 정적 파일 (.jsp/.html/.css/.js) → deployStatic()
          └─ 파일 복사 → .vscode/tomcat/webapps/ROOT/
    │
    ▼
사용자 "중지" 클릭
    │
    ├─ SIGTERM → 3초 대기 → SIGKILL (Unix)
    ├─ taskkill /F /T (Windows)
    └─ PID 파일 정리, 상태 리셋
```

### 3.2 HotSwap 상세 흐름

```
.java 저장
    │
    ▼
javac -encoding UTF-8 -source 8 -target 8 -cp "..." File.java
    │
    ├─ 실패 → 에러 로그, Output 채널 표시
    │
    ▼ 성공
.class 파일 읽기 (Buffer)
    │
    ▼
JDWP TCP 연결 (localhost:5005, 타임아웃 5초)
    │
    ├─ 핸드셰이크: "JDWP-Handshake" 송수신
    ├─ VirtualMachine.IDSizes (1,7) → referenceTypeIDSize 획득
    ├─ VirtualMachine.ClassesBySignature (1,2) → referenceTypeID 조회
    │     └─ count=0 → 'not_loaded' (아직 미로드, 스킵)
    └─ VirtualMachine.RedefineClasses (1,18) → 바이트코드 교체
          ├─ 성공 → 'ok' (재시작 없이 즉시 반영)
          └─ 에러 70~73 → 구조 변경 (메서드 추가/삭제 등), 수동 재시작 필요
```

### 3.3 의존성 Classpath 해석 흐름

```
컴파일 시 classpath 구성 순서:
    1. WEB-INF/classes (컴파일 출력)
    2. CATALINA_HOME/lib/* (servlet-api 등)
    3. Maven/Gradle 의존성 (자동 해석, 캐시됨)
    4. 사용자 수동 classpath 설정

Maven 해석:
    mvn dependency:build-classpath
        -Dmdep.outputFile=.vscode/tomcat/dep-classpath.txt -q
    → dep-classpath.txt 읽기 → 캐시

Gradle 해석:
    cp-init.gradle (임시 init script 생성)
    gradle -q --init-script cp-init.gradle __printCp
    → dep-classpath.txt 읽기 → 캐시 → init script 삭제

캐시 무효화:
    FileSystemWatcher → pom.xml / build.gradle 변경 감지
    → invalidateDepClasspath() → 다음 컴파일에서 재해석
```

---

## 4. 모듈 구성 (함수 단위)

### 4.1 모듈 분류

현재 단일 파일(`extension.js`)이지만, 논리적으로 아래 모듈로 분리할 수 있다.
다른 언어/에디터로 포팅 시 이 구조를 참고하여 모듈을 분리하면 된다.

```
tomcat-auto-deploy/
├── config          // 설정 읽기/초기화 (getConfig, ensureWorkspaceSettings)
├── ui/
│   ├── status_bar  // 상태바 관리 (refreshTomcatBar, refreshDeployBar)
│   ├── tree_view   // 사이드바 TreeView (TomcatTreeProvider)
│   └── commands    // 9개 커맨드 등록/핸들러
├── tomcat/
│   ├── lifecycle   // 기동/중지/재시작 (startTomcat, stopTomcat, forceStopTomcat)
│   ├── init        // CATALINA_BASE 초기화 (initTomcatBase)
│   ├── process     // 프로세스 관리 (PID, orphan 감지, kill)
│   └── log_watch   // localhost 로그 모니터링
├── compiler/
│   ├── javac       // Java 컴파일 (compileAndDeploy)
│   ├── hotswap     // JDWP HotSwap 프로토콜 구현
│   └── static_deploy // 정적 파일 배포 (deployStatic)
├── build_tool/
│   ├── detect      // 빌드 도구 감지 (detectBuildTool, detectJavaVersion)
│   ├── maven       // Maven classpath 해석, mvn 경로 탐색
│   └── gradle      // Gradle classpath 해석, gradle 경로 탐색
└── sync            // 전체 동기화 (syncAll, collectFiles, copyDir)
```

### 4.2 전체 함수 목록

| 모듈 | 함수 | 줄 | 역할 |
|------|------|----|------|
| **설정** | `getConfig()` | 120 | 워크스페이스 설정 읽기 (10개 속성 + 3개 계산값) |
| | `getWorkspaceRoot()` | 141 | 워크스페이스 루트 경로 반환 |
| | `ensureWorkspaceSettings()` | 1390 | 최초 실행 시 `.vscode/settings.json` 템플릿 생성 |
| **로깅** | `log(msg, level)` | 149 | 타임스탬프 포함 Output 채널 로그 |
| **UI** | `refreshTomcatBar(state)` | 157 | Tomcat 상태바 업데이트 (stopped/starting/running/stopping) |
| | `refreshDeployBar(state, fname)` | 179 | Deploy 상태바 업데이트 (idle/deploying/ok/err) |
| | `TomcatTreeProvider` (class) | 30 | 사이드바 TreeView 프로바이더 |
| **프로세스** | `getPidFile()` | 200 | PID 파일 경로 (.vscode/tomcat/tomcat.pid) |
| | `savePid(pid)` | 204 | PID 파일 쓰기 |
| | `readPid()` | 208 | PID 파일 읽기 |
| | `removePidFile()` | 212 | PID 파일 삭제 |
| | `isProcessAlive(pid)` | 216 | 프로세스 생존 확인 (Windows: tasklist, Unix: kill -0) |
| | `forceKillPid(pid)` | 230 | 강제 종료 (Windows: taskkill, Unix: SIGKILL) |
| | `findProcessByCatalinaBase(base)` | 252 | CATALINA_BASE로 Java 프로세스 PID 검색 |
| | `detectOrphanProcess()` | 302 | 이전 세션 고아 프로세스 감지 |
| **Tomcat** | `initTomcatBase()` | 322 | .vscode/tomcat/ 구조 초기화 (server.xml, context.xml 등) |
| | `startTomcat()` | 481 | Tomcat JPDA 모드 기동 |
| | `waitForTomcat(port, timeout)` | 583 | HTTP 폴링으로 기동 완료 대기 |
| | `stopTomcat()` | 604 | 정상 종료 (SIGTERM → SIGKILL) |
| | `forceStopTomcat()` | 733 | 즉시 강제 종료 |
| | `startLocalhostLogWatch()` | 670 | localhost.log 실시간 tail 모니터링 |
| | `stopLocalhostLogWatch()` | 722 | 로그 모니터링 중지 |
| **빌드 도구** | `detectBuildTool(ws)` | 767 | pom.xml/build.gradle 존재 여부로 빌드 도구 감지 |
| | `detectJavaVersion(ws)` | 779 | pom.xml/build.gradle에서 source/target 버전 추출 |
| | `findWinExe(dir, baseName)` | 849 | Windows 실행 파일 탐색 (.cmd/.bat/.exe) |
| | `findMvnCmd(ws)` | 860 | Maven 실행 경로 탐색 (wrapper → 환경변수 → PATH) |
| | `findGradleCmd(ws)` | 893 | Gradle 실행 경로 탐색 (wrapper → 환경변수 → PATH) |
| | `resolveDependencyClasspath()` | 921 | Maven/Gradle 의존성 classpath 해석 (캐시) |
| | `invalidateDepClasspath()` | 990 | classpath 캐시 무효화 |
| **컴파일** | `compileAndDeploy(filePath)` | 1108 | .java 컴파일 + HotSwap |
| | `deployStatic(filePath)` | 1180 | 정적 파일 복사 |
| | `jdwpHotSwap(port, class, bytes)` | 998 | JDWP 프로토콜로 클래스 교체 |
| **동기화** | `syncAll()` | 1264 | 기동 시 전체 동기화 |
| | `collectFiles(dir, ext)` | 1209 | 재귀 파일 수집 |
| | `copyDirSync(src, dest)` | 1226 | 재귀 디렉토리 복사 |
| | `copyDirSyncWithSkip(src, dest, skip)` | 1246 | 특정 디렉토리 제외 복사 |
| **이벤트** | `onSaved(doc)` | 1368 | 파일 저장 이벤트 라우터 (.java → compile, 정적 → copy) |
| **진입점** | `activate(context)` | 1437 | 확장 활성화 (모든 초기화) |
| | `deactivate()` | 1523 | 확장 비활성화 (프로세스 정리) |

---

## 5. 설정 체계

### 5.1 사용자 설정 (VS Code Workspace Settings)

`.vscode/settings.json`의 `tomcatAutoDeploy.*` 네임스페이스:

| 설정 | 타입 | 기본값 | 필수 | 설명 |
|------|------|--------|------|------|
| `catalinaHome` | string | `""` | **필수** | Tomcat 설치 경로 (CATALINA_HOME) |
| `javaHome` | string | `""` | 권장 | JAVA_HOME (비어있으면 환경변수) |
| `port` | number | `8080` | - | HTTP 포트 |
| `debugPort` | number | `5005` | - | JPDA 디버그 포트 (HotSwap용) |
| `redirectPort` | number | `8443` | - | HTTPS redirect 포트 |
| `contextPath` | string | `"/"` | - | 웹 애플리케이션 컨텍스트 경로 |
| `javaSourceRoot` | string | `"src/main/java"` | - | Java 소스 루트 (워크스페이스 상대경로) |
| `webContentRoot` | string | `"src/main/webapp"` | - | 정적 파일 루트 (워크스페이스 상대경로) |
| `classpath` | string[] | `[]` | - | 추가 classpath JAR 경로 목록 |
| `javaOpts` | string | `""` | - | 추가 JVM 옵션 (여러 줄 가능) |

### 5.2 계산된 내부 값 (getConfig에서 파생)

| 값 | 산출 방식 |
|----|-----------|
| `catalinaBase` | `{workspace}/.vscode/tomcat` |
| `warDir` | `{catalinaBase}/webapps/ROOT` (contextPath `/`일 때) 또는 `{catalinaBase}/war` |
| `confDir` | `{catalinaBase}/conf` |

---

## 6. CATALINA_BASE 디렉토리 구조

`initTomcatBase()`가 생성하는 `.vscode/tomcat/` 구조:

```
.vscode/tomcat/                     ← CATALINA_BASE
├── conf/
│   ├── server.xml                  ← <Server port="-1">, HTTP/redirect 포트 설정
│   ├── context.xml                 ← reloadable="false" (HotSwap 사용)
│   ├── web.xml                     ← CATALINA_HOME에서 복사
│   └── logging.properties          ← CATALINA_HOME에서 복사
├── webapps/
│   └── ROOT/                       ← 또는 contextPath에 따라 war/
│       ├── WEB-INF/
│       │   ├── classes/            ← javac 컴파일 출력
│       │   └── lib/                ← Maven/Gradle 의존성 JAR 복사
│       ├── *.jsp
│       ├── *.html, *.css, *.js
│       └── ...
├── logs/
│   └── localhost.YYYY-MM-DD.log    ← 실시간 모니터링 대상
├── work/
├── temp/
├── tomcat.pid                      ← Tomcat PID 파일
└── dep-classpath.txt               ← Maven/Gradle 의존성 classpath 캐시
```

### server.xml 주요 설정

```xml
<Server port="-1" shutdown="SHUTDOWN">
  <Service name="Catalina">
    <Connector port="{port}" redirectPort="{redirectPort}" />
    <Engine name="Catalina" defaultHost="localhost">
      <Host name="localhost" appBase="webapps" unpackWARs="true" autoDeploy="false">
        <Context path="{contextPath}" docBase="{warDir}" reloadable="false" />
      </Host>
    </Engine>
  </Service>
</Server>
```

- `port="-1"`: shutdown 포트 비활성화 (PID로 직접 종료)
- `reloadable="false"`: 디스크 감시 비활성화 (JDWP HotSwap 사용)
- `autoDeploy="false"`: Tomcat 자체 자동 배포 비활성화

---

## 7. JDWP HotSwap 프로토콜 상세

### 7.1 프로토콜 흐름

| 단계 | JDWP 명령 | cmdSet | cmd | 설명 |
|------|-----------|--------|-----|------|
| 0 | 핸드셰이크 | - | - | `"JDWP-Handshake"` 14바이트 송수신 |
| 1 | IDSizes | 1 | 7 | `referenceTypeIDSize` (보통 8바이트) 획득 |
| 2 | ClassesBySignature | 1 | 2 | `"Lcom/example/MyClass;"` → referenceTypeID |
| 3 | RedefineClasses | 1 | 18 | referenceTypeID + .class 바이트코드 → JVM 내 교체 |

### 7.2 패킷 구조

```
JDWP Request Header (11 bytes):
  [4] length (전체 패킷 크기)
  [4] id     (요청 ID, 순차 증가)
  [1] flags  (0x00 = request)
  [1] cmdSet (command set)
  [1] cmd    (command)

JDWP Reply Header (11 bytes):
  [4] length
  [4] id     (대응하는 요청 ID)
  [1] flags  (0x80 = reply)
  [2] errCode (0 = 성공, 60~72 = 에러)
```

### 7.3 RedefineClasses 페이로드

```
  [4] classCount (항상 1)
  [N] referenceTypeID (IDSizes에서 받은 크기)
  [4] classfileLength
  [M] classfile bytes (.class 파일 내용)
```

### 7.4 에러 코드

| 코드 | 이름 | 의미 |
|------|------|------|
| 0 | 성공 | 클래스 교체 완료 |
| 60 | INVALID_CLASS_FORMAT | 잘못된 클래스 파일 |
| 62 | FAILS_VERIFICATION | 검증 실패 |
| 63 | ADD_METHOD_NOT_IMPLEMENTED | 메서드 추가 불가 |
| 64 | SCHEMA_CHANGE_NOT_IMPLEMENTED | 스키마 변경 불가 |
| 66 | HIERARCHY_CHANGE_NOT_IMPLEMENTED | 클래스 계층 변경 불가 |
| 67 | DELETE_METHOD_NOT_IMPLEMENTED | 메서드 삭제 불가 |
| 70 | CLASS_MODIFIERS_CHANGE | 클래스 modifier 변경 불가 |
| 71 | METHOD_MODIFIERS_CHANGE | 메서드 modifier 변경 불가 |
| 72 | CLASS_ATTRIBUTE_CHANGE | 클래스 속성 변경 불가 (source/target 불일치 시 발생) |

### 7.5 HotSwap 제한사항 (JVM 한계)

HotSwap이 **가능한** 변경:
- 메서드 본문 내부 코드 변경 (로직, 로그 추가/삭제 등)
- 상수 값 변경

HotSwap이 **불가능한** 변경 (Tomcat 재시작 필요):
- 메서드 추가/삭제/시그니처 변경
- 필드 추가/삭제
- 클래스 상속 구조 변경
- 인터페이스 구현 변경
- Lambda 추가/삭제 (synthetic 메서드 변경됨)
- **source/target 레벨 불일치** (Java 8 빌드 → Java 11 javac = BootstrapMethods 속성 변경)

---

## 8. 플랫폼별 분기 처리

### 8.1 분기 지점 요약

| 기능 | Windows | Unix (Linux/macOS) |
|------|---------|-------------------|
| **Tomcat 실행** | `catalina.bat jpda run` | `catalina.sh jpda run` |
| **spawn 옵션** | `shell: true` | `shell: true, detached: true` |
| **classpath 구분자** | `;` (세미콜론) | `:` (콜론) |
| **프로세스 종료** | `taskkill /F /T /PID {pid}` | `SIGTERM` → 3초 → `SIGKILL` |
| **종료 대상** | 단일 프로세스 (taskkill tree) | 프로세스 그룹 (`-pid`) + 개별 폴백 |
| **프로세스 존재 확인** | `tasklist /FI "PID eq {pid}"` | `process.kill(pid, 0)` |
| **CATALINA_BASE 검색** | PowerShell `Get-CimInstance` | `pgrep -f` → `ps -eo pid,args` 폴백 |
| **빌드 도구 실행 파일** | `.cmd` → `.bat` → `.exe` 순서 | 확장자 없음 |
| **Extension 종료 시** | `taskkill /F /T` | `SIGTERM` |

### 8.2 포팅 시 고려사항

플랫폼별 분기는 에디터/언어에 관계없이 동일한 로직이 필요하다.
각 언어에서 제공하는 플랫폼 분기 메커니즘(`#[cfg]`, `process.platform`, `System.getProperty("os.name")` 등)을 활용한다.

핵심 분기 포인트:
- 프로세스 종료: Windows `taskkill` vs Unix `SIGTERM`/`SIGKILL`
- classpath 구분자: `;` vs `:`
- 실행 파일 탐색: `.cmd`/`.bat`/`.exe` vs 확장자 없음
- 프로세스 검색: PowerShell `Get-CimInstance` vs `pgrep`/`ps`

---

## 9. 이벤트 시스템

### 9.1 에디터 이벤트

| 이벤트 | 핸들러 | 동작 |
|--------|--------|------|
| `onDidSaveTextDocument` | `onSaved()` | `.java` → compileAndDeploy, 정적 파일 → deployStatic |
| `FileSystemWatcher` (pom.xml, build.gradle 등) | `invalidateDepClasspath()` | classpath 캐시 무효화 |

### 9.2 프로세스 이벤트

| 이벤트 | 동작 |
|--------|------|
| Tomcat stdout/stderr `data` | `\r?\n`으로 분리, 각 줄 로그 출력 |
| Tomcat `exit` | 상태 리셋, PID 파일 삭제, 상태바 갱신 |
| localhost.log `change` | 새 내용 tail 읽기 → 전용 Output 채널 출력 |

### 9.3 포팅 시 필요한 에디터 API

어떤 에디터로 포팅하든 아래 기능에 대응하는 API가 필요하다:

| 필요 기능 | 현재 VS Code API | 비고 |
|-----------|-------------------|------|
| 파일 저장 감지 | `onDidSaveTextDocument` | 핵심 트리거 |
| 파일 시스템 감시 | `createFileSystemWatcher` | pom.xml/build.gradle 변경 감지 |
| 로그 출력 패널 | `createOutputChannel` | Tomcat stdout + localhost.log |
| 상태 표시 | `createStatusBarItem` | Tomcat 상태 + Deploy 상태 |
| 사이드바 트리 | `createTreeView` | 서버 제어 UI |
| 커맨드 등록 | `registerCommand` | 9개 명령어 |

---

## 10. UI 컴포넌트

### 10.1 상태바 (StatusBar)

**Tomcat 상태바** (`sbTomcat`, priority 102):

| 상태 | 아이콘 | 텍스트 | 배경색 | 클릭 동작 |
|------|--------|--------|--------|-----------|
| stopped | `$(debug-stop)` | Tomcat ■ 중지 | - | `start` |
| starting | `$(sync~spin)` | Tomcat ⟳ 시작 중... | - | - |
| running | `$(vm-running)` | Tomcat ● 실행 중 | statusBarItem.warningBackground | `stop` |
| stopping | `$(sync~spin)` | Tomcat ⟳ 중지 중... | - | - |

**Deploy 상태바** (`sbDeploy`, priority 101):

| 상태 | 텍스트 | 자동 소멸 |
|------|--------|-----------|
| idle | Deploy: — | - |
| deploying | Deploy: ⟳ {파일명} | - |
| ok | Deploy: ✔ {파일명} | 3초 후 idle |
| err | Deploy: ✖ {파일명} | 6초 후 idle |

### 10.2 사이드바 TreeView

```
Tomcat (Activity Bar)
└── 서버
    ├── ● Tomcat 실행 중  (또는 ■ 중지됨)
    ├── ▶ 시작            (중지 상태일 때)
    ├── ■ 중지            (실행 중일 때)
    ├── ✖ 강제 중지       (실행 중일 때)
    ├── ↻ 재시작          (실행 중일 때)
    ├── 🌐 브라우저 열기  (실행 중일 때)
    ├── 📄 Output 보기
    ├── 📋 Localhost 로그
    ├── 📝 server.xml 열기
    └── ⚙ 설정
```

### 10.3 커맨드 팔레트

| 커맨드 | ID | 아이콘 |
|--------|-----|--------|
| Tomcat: 시작 | `tomcatAutoDeploy.start` | `$(play)` |
| Tomcat: 중지 | `tomcatAutoDeploy.stop` | `$(debug-stop)` |
| Tomcat: 강제 중지 | `tomcatAutoDeploy.forceStop` | `$(close)` |
| Tomcat: 재시작 | `tomcatAutoDeploy.restart` | `$(refresh)` |
| Tomcat: 브라우저 열기 | `tomcatAutoDeploy.openBrowser` | `$(globe)` |
| Tomcat: Output 보기 | `tomcatAutoDeploy.showOutput` | `$(output)` |
| Tomcat: Localhost 로그 | `tomcatAutoDeploy.showLocalhostLog` | `$(file-text)` |
| Tomcat: server.xml 열기 | `tomcatAutoDeploy.openServerXml` | `$(file-code)` |
| Tomcat: 설정 열기 | `tomcatAutoDeploy.configure` | `$(gear)` |

---

## 11. 빌드 도구 연동

### 11.1 빌드 도구 감지

```
detectBuildTool(workspace):
    pom.xml 존재?          → 'maven'
    build.gradle 존재?     → 'gradle'
    build.gradle.kts 존재? → 'gradle'
    없음                   → null
```

### 11.2 Java 버전 감지 (`detectJavaVersion`)

**Maven** (pom.xml 파싱 순서):
1. `<maven.compiler.source>` / `<maven.compiler.target>` (properties 블록)
2. `<maven.compiler.release>` (Java 9+ 단일 설정)
3. `maven-compiler-plugin` 내 `<source>` / `<target>`
4. `maven-compiler-plugin` 내 `<release>`

**Gradle** (build.gradle 파싱 순서):
1. `sourceCompatibility` / `targetCompatibility` (문자열/숫자/JavaVersion enum 모두 지원)
2. `javaToolchain { languageVersion = JavaLanguageVersion.of(XX) }`

### 11.3 빌드 도구 실행 파일 탐색

```
Maven (findMvnCmd):
    1. 프로젝트 Wrapper: mvnw (Unix) / mvnw.cmd|.bat|.exe (Windows)
    2. 환경변수: MAVEN_HOME/bin/mvn 또는 M2_HOME/bin/mvn
    3. 시스템 PATH: mvn (Unix) / mvn.cmd (Windows)

Gradle (findGradleCmd):
    1. 프로젝트 Wrapper: gradlew (Unix) / gradlew.cmd|.bat|.exe (Windows)
    2. 환경변수: GRADLE_HOME/bin/gradle
    3. 시스템 PATH: gradle (Unix) / gradle.bat (Windows)
```

---

## 12. 전역 상태 관리

| 변수 | 타입 | 용도 | 생명주기 |
|------|------|------|----------|
| `outputChannel` | OutputChannel | 메인 로그 출력 | activate → deactivate |
| `localhostLogChannel` | OutputChannel | localhost.log 전용 출력 | activate → deactivate |
| `localhostLogWatcher` | FSWatcher | 로그 파일 변경 감시 | startTomcat → stopTomcat |
| `localhostLogOffset` | number | 로그 파일 읽기 오프셋 | startTomcat → stopTomcat |
| `tomcatProcess` | ChildProcess | 현재 Tomcat 프로세스 핸들 | startTomcat → stopTomcat |
| `tomcatRunning` | boolean | Tomcat 실행 상태 플래그 | 전체 |
| `orphanPid` | number \| null | 이전 세션 고아 프로세스 PID | activate → stop |
| `sbTomcat` | StatusBarItem | Tomcat 상태바 | activate → deactivate |
| `sbDeploy` | StatusBarItem | Deploy 상태바 | activate → deactivate |
| `cachedDepClasspath` | string \| null | 의존성 classpath 캐시 | resolveDep → invalidateDep |
| `tomcatTreeProvider` | TomcatTreeProvider | 사이드바 TreeView | activate → deactivate |

### 포팅 시 상태 관리

현재 구현은 JavaScript 모듈 스코프 변수(전역)로 상태를 관리한다.
다른 언어로 포팅 시 하나의 구조체/클래스로 묶어 관리하는 것을 권장한다.

```
TomcatExtension {
    tomcat_process   // 현재 Tomcat 프로세스 핸들 (nullable)
    tomcat_running   // 실행 상태 플래그
    orphan_pid       // 고아 프로세스 PID (nullable)
    cached_dep_cp    // 의존성 classpath 캐시 (nullable)
    log_offset       // 로그 파일 읽기 오프셋
    // ... 에디터 UI 핸들
}
```

---

## 13. 개발 히스토리

| 커밋 | 메시지 | 주요 내용 |
|------|--------|-----------|
| `d40a38f` | first commit | 전체 확장 초기 구현 (extension.js 1,256줄) |
| `d270375` | 이래저래 | .claude/settings.local.json 제거, .gitignore 정리 |
| `3f11ecb` | .. | .vscodeignore 미세 조정 |
| `7387d86` | .. | package.sh 권한/줄바꿈 수정 |
| `1dedfa5` | 하하 | 대규모 기능 확장 (+243줄): 아이콘, TreeView, contextPath, redirectPort, javaOpts 등 |

---

## 14. 포팅 체크리스트

### 14.1 핵심 구현 항목 (우선순위순)

| 우선순위 | 항목 | 설명 | 에디터 의존성 |
|----------|------|------|---------------|
| **필수** | JDWP HotSwap | TCP 소켓 + 바이너리 프로토콜 (7장 참조) | 없음 (순수 네트워크) |
| **필수** | javac 컴파일 | 외부 프로세스 실행 + classpath 구성 | 없음 (CLI 호출) |
| **필수** | 파일 저장 감지 | 에디터의 save 이벤트 연동 | **에디터 API 필요** |
| **필수** | Tomcat 프로세스 관리 | spawn/kill/orphan 감지 | 없음 (OS 레벨) |
| **필수** | 빌드 도구 연동 | Maven/Gradle classpath 해석 | 없음 (CLI 호출) |
| **필수** | 설정 시스템 | 사용자 설정 읽기/저장 | **에디터 API 필요** |
| 권장 | 로그 모니터링 | 파일 tail + 출력 패널 | **에디터 API 필요** |
| 선택 | UI 컴포넌트 | 상태바, 사이드바 트리 | **에디터 API 필요** |

> **참고**: "에디터 의존성 없음" 항목은 에디터 독립적인 라이브러리/모듈로 구현 가능하다.
> 포팅 시 이 부분을 먼저 구현하고, 에디터 API 연동을 나중에 붙이는 전략이 효율적이다.

### 14.2 에디터 독립 vs 에디터 의존 분리

```
┌─────────────────────────────┐
│     에디터 의존 계층          │  ← 에디터마다 다시 구현
│  (UI, 이벤트, 설정)          │
├─────────────────────────────┤
│     에디터 독립 계층          │  ← 공유 가능
│  (JDWP, javac, 프로세스,     │
│   빌드도구, 파일동기화)       │
└─────────────────────────────┘
```

---

## 15. 알려진 이슈 및 해결책

### 15.1 JDWP 에러 72 (CLASS_ATTRIBUTE_CHANGE)

- **원인**: Maven이 `-source 8 -target 8`로 빌드, extension의 javac가 Java 11 기본으로 컴파일
- **차이**: Java 8은 문자열 연결을 `StringBuilder`로, Java 11은 `invokedynamic` + `StringConcatFactory`로 컴파일
- **해결**: `detectJavaVersion()`으로 pom.xml/build.gradle에서 버전 추출 → javac에 `-source`/`-target` 옵션 전달

### 15.2 고아 프로세스

- **원인**: 에디터 크래시 또는 비정상 종료 시 Tomcat 프로세스가 남음
- **해결**: PID 파일 + `detectOrphanProcess()`로 다음 세션에서 감지 → 사용자에게 강제 종료 옵션 제공

### 15.3 HotSwap 구조 변경 제한

- **JVM 한계**: 메서드 추가/삭제, 필드 변경, Lambda 추가는 HotSwap 불가
- **대응**: 에러 코드 60~72 감지 시 경고 로그 출력, Tomcat 재시작 안내
