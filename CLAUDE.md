# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 프로젝트 개요

Java 파일 저장 시 자동 컴파일 및 로컬 Tomcat 인스턴스에 JDWP HotSwap으로 즉시 반영하는 VS Code 확장 프로그램 ("Tomcat Auto Deploy"). 순수 JavaScript로 작성되어 있으며 (TypeScript, 번들러 없음), UI는 전부 한국어.

## 아키텍처

단일 파일 확장 프로그램 (`extension.js`)으로 VS Code Extension API를 사용. 빌드 단계 없이 `"main": "./extension.js"`로 직접 로드됨.

핵심 흐름:
1. **활성화** (`onStartupFinished`): 명령어, 상태바 아이템, `onDidSaveTextDocument` 리스너, 빌드 파일 변경 감시자 등록, `ensureWorkspaceSettings()`로 `.vscode/settings.json` 초기화
2. **Tomcat 기동** (`startTomcat`): CATALINA_BASE 기준 기존 Java 프로세스 감지(`findProcessByCatalinaBase`) → `initTomcatBase()`로 `.vscode/tomcat/` 디렉토리 초기화 → `syncAll()` 전체 동기화 → `catalina.bat/sh jpda run` (JDWP 디버그 모드, 기본 포트 5005)
3. **저장 시 `.java`** (`compileAndDeploy`): `javac` 컴파일 (Tomcat lib + Maven/Gradle 의존성 자동 classpath) → `.class`를 `WEB-INF/classes/`에 배치 → Tomcat 실행 중이면 JDWP HotSwap으로 해당 클래스만 교체
4. **저장 시 정적 파일** (`deployStatic`): `.jsp`, `.html`, `.css`, `.js` 등 → `webContentRoot` 기준 상대경로 유지하여 `.vscode/tomcat/webapps/ROOT/`에 복사
5. **Tomcat 중지** (`stopTomcat`): Windows `taskkill /F /T`, Unix `SIGTERM` → 프로세스 exit 대기 (최대 10초) → 3초 후 미종료 시 `SIGKILL`

## 개발 명령어

```bash
# 확장 프로그램을 .vsix로 패키징
npm install -g @vscode/vsce
vsce package

# VS Code에서 설치: Extensions → ... → Install from VSIX
```

테스트, 린터 설정, 빌드 단계가 없음. `extension.js`에서 직접 실행됨.

## `.vscode/tomcat/` 디렉토리 구조 (`initTomcatBase`)

`CATALINA_BASE`를 `{workspace}/.vscode/tomcat/`으로 설정. 최초 기동 시 자동 생성:
- `conf/context.xml` — `reloadable="false"` (JDWP HotSwap 사용, 디스크 감시 비활성화)
- `conf/server.xml` — `<Server port="-1">` (shutdown 포트 비활성화), HTTP 포트는 설정값 사용. 기존 server.xml에 `port="-1"`이 없으면 재생성. 기존 context.xml에 `reloadable="true"`가 있으면 재생성
- `conf/web.xml`, `conf/logging.properties` — `CATALINA_HOME`에서 복사
- `webapps/ROOT/WEB-INF/classes/` — 컴파일 결과물
- `webapps/ROOT/WEB-INF/lib/` — Maven/Gradle 의존성 JAR
- `dep-classpath.txt` — Maven/Gradle 의존성 classpath 캐시
- `logs/`, `work/`, `temp/`

Manager 앱, `tomcat-users.xml` 생성, 심볼릭 링크 등은 사용하지 않음.

## 기동 시 전체 동기화 (`syncAll`)

1. **Java classes 동기화**:
   - **Maven** (`pom.xml` 존재): `target/classes` 전체를 `WEB-INF/classes`로 복사 (`.class` + 리소스). `target/classes`가 없으면 경고
   - **Gradle** (`build.gradle`/`build.gradle.kts` 존재): `build/classes` 전체를 `WEB-INF/classes`로 복사
   - **빌드 도구 없음**: `javaSourceRoot` 하위 모든 `.java`를 `javac`로 직접 컴파일
2. **의존성 JAR 동기화** (Maven/Gradle만): `resolveDependencyClasspath()`로 해석된 JAR 경로를 `WEB-INF/lib/`에 복사. 동일 크기 파일은 스킵
3. **정적 파일** (공통): `webContentRoot` 하위 `.jsp`, `.html`, `.css`, `.js`, `.json`, `.xml`, `.properties`, 이미지, 폰트 파일 전체 복사

## 의존성 classpath 자동 해석 (`resolveDependencyClasspath`)

저장 시 개별 컴파일에서 classpath 구성 순서:
1. `WEB-INF/classes` (컴파일 출력)
2. `{catalinaHome}/lib/*` (servlet-api 등 Tomcat 라이브러리)
3. Maven/Gradle 의존성 (자동 해석, 캐시됨)
4. 사용자 수동 `classpath` 설정

**Maven**: `mvn dependency:build-classpath -Dmdep.outputFile=.vscode/tomcat/dep-classpath.txt`
**Gradle**: init script(`cp-init.gradle`)로 `compileClasspath` resolve → `.vscode/tomcat/dep-classpath.txt`

빌드 도구 실행 파일 탐색 순서 (`findMvnCmd`/`findGradleCmd`):
1. 프로젝트 Wrapper (`mvnw`/`gradlew`) — Windows에서 `findWinExe()`로 `.cmd`/`.bat`/`.exe` 순서 시도
2. 환경변수 (`MAVEN_HOME`/`M2_HOME`/`GRADLE_HOME`)의 `bin/` 하위
3. 시스템 PATH (폴백)

`pom.xml`/`build.gradle`/`build.gradle.kts` 변경 시 `FileSystemWatcher`가 `invalidateDepClasspath()` 호출 → 다음 컴파일에서 재해석

## JDWP HotSwap (`jdwpHotSwap`)

Tomcat을 JPDA 디버그 모드로 기동. 환경변수: `JPDA_ADDRESS=localhost:{debugPort}`, `JPDA_TRANSPORT=dt_socket`, `JPDA_SUSPEND=n`. `CATALINA_OPTS`에 `-Dfile.encoding=UTF-8 -Dsun.stdout.encoding=UTF-8 -Dsun.stderr.encoding=UTF-8` 추가 (한글 로그 깨짐 방지).

컴파일 성공 후 (`compileAndDeploy`에서 호출):
1. JDWP 프로토콜로 디버그 포트에 TCP 접속 (타임아웃 5초)
2. `VirtualMachine.IDSizes`(1,7) → `VirtualMachine.ClassesBySignature`(1,2) → `VirtualMachine.RedefineClasses`(1,18)
3. 해당 `.class` 바이트코드만 JVM 내 교체 — 컨텍스트 재시작/Spring Bean 재생성 없음

동작 결과:
- **성공** (`'ok'`): `[HotSwap] ✔ {className} 클래스 교체 완료 (재시작 없음)`
- **미로드** (`'not_loaded'`): 아직 JVM에 로드되지 않은 클래스 → 스킵 (다음 접근 시 디스크에서 로드)
- **구조 변경 실패** (JDWP 에러 코드 70~73 등): 경고 로그만 출력, 수동 재시작 필요

## Tomcat stdout/stderr 처리

`spawn`의 `data` 이벤트는 여러 줄이 한 번에 올 수 있으므로 `\r?\n`으로 분리 후 각 줄마다 `log()` 호출. 빈 줄은 스킵.

## 설정 초기화 (`ensureWorkspaceSettings`)

최초 활성화 시 `catalinaHome`이 비어있으면 `.vscode/settings.json`에 `tomcatAutoDeploy.*` 기본 템플릿을 자동 생성하고 파일을 열어 안내. 이미 설정이 존재하면 스킵.

`configure` 명령은 `workbench.action.openWorkspaceSettings`로 Workspace Settings GUI를 `tomcatAutoDeploy` 필터로 오픈. 변경사항은 `.vscode/settings.json`에 저장됨.

## 주요 설정 속성

VS Code Workspace Settings에서 `tomcatAutoDeploy.*` 하위 — `package.json`의 `contributes.configuration` 참조. 설정은 `.vscode/settings.json`에 저장됨.

| 설정 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `catalinaHome` | **필수** | - | Tomcat 설치 경로 (CATALINA_HOME) |
| `javaHome` | 권장 | 환경변수 | JAVA_HOME 경로 |
| `port` | - | 8080 | HTTP 포트 |
| `debugPort` | - | 5005 | JPDA 디버그 포트 (HotSwap 용) |
| `javaSourceRoot` | - | `src/main/java` | Java 소스 루트 (workspace 상대경로) |
| `webContentRoot` | - | `src/main/webapp` | 정적 파일 루트 (workspace 상대경로) |
| `classpath` | - | `[]` | 추가 classpath JAR 경로 목록 |

## 플랫폼 처리 (Windows / Linux / macOS)

모든 기능이 세 플랫폼에서 동일하게 동작해야 함:

- **Tomcat 실행**: `catalina.bat` vs `catalina.sh`, `shell: true` 전 플랫폼, `detached: !isWin` (Unix에서 프로세스 그룹 리더로 생성)
- **classpath 구분자**: `;` (Windows) vs `:` (Unix)
- **프로세스 종료**: Windows `taskkill /F /T /PID` (`shell: true`), Unix `SIGTERM` → `SIGKILL` (프로세스 그룹 `-pid` + 개별 pid 폴백)
- **프로세스 존재 확인** (`isProcessAlive`): Windows `tasklist /FI "PID eq"`, Unix `process.kill(pid, 0)`
- **CATALINA_BASE 프로세스 검색** (`findProcessByCatalinaBase`): Windows PowerShell `Get-CimInstance Win32_Process`, Unix `pgrep -f` (폴백: `ps -eo pid,args | grep`)
- **빌드 도구 실행 파일** (`findWinExe`): Windows `.cmd`/`.bat`/`.exe` 순서 탐색, Unix 확장자 없음
- **Extension 종료** (`deactivate`/`dispose`): Windows `taskkill`, Unix `SIGTERM`
