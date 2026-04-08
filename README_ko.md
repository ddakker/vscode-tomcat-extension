[English](README.md)

# Tomcat Auto Deploy

Java 웹 애플리케이션을 파일 저장 시마다 로컬 Tomcat 서버에 **자동 컴파일 및 배포**하는 VS Code 확장 프로그램입니다. 재시작 없이 즉시 반영됩니다.

`.java` 파일을 저장하면 컴파일 후 실행 중인 JVM에 즉시 HotSwap됩니다. `.jsp`, `.html`, `.css`, `.js` 파일을 저장하면 배포 디렉토리에 바로 복사됩니다. Tomcat 재시작이나 WAR 재배포가 필요 없습니다.

> [!TIP]
VS Code에서도 클래스 핫디플로이를 통해서 Tomcat 재기동 없이 개발해보세요.  
핫 스왑(Hot Swap)의 경우 JVM 표준 방식인 JDWP HotSwap의 구조적 한계로 인해JRebel보다 지원 범위가 제한될 수 있습니다.  
메서드 바디 변경 후 재컴파일 시 해당 클래스의 바이트코드만 교체되며, 이는 JVM 표준 JDWP 디버그 핫 스왑 동작 방식과 동일합니다.  
(신규 필드 추가, 메서드 시그니처 변경, 클래스 구조 변경은 지원되지 않습니다.)

## 동작 방식

```
.java 파일 저장
      │
      ▼
 javac로 컴파일
      │
      ▼
 JDWP HotSwap으로 실행 중인
 JVM의 클래스 교체 (재시작 없음)
      │
      ▼
 변경사항 즉시 반영
```

정적 파일(JSP, HTML, CSS, JS, 이미지 등)은 저장 시 Tomcat 배포 디렉토리에 복사되며, 브라우저 새로고침으로 확인할 수 있습니다.

## 주요 기능

- **즉시 Java HotSwap** — 저장 시 컴파일 + JDWP 클래스 교체, Tomcat 재시작 불필요
- **정적 파일 배포** — JSP, HTML, CSS, JS 파일 저장 시 즉시 배포
- **증분 컴파일** — `.class`보다 새로운 `.java` 파일만 재컴파일하여 시작/배포 속도 향상
- **빌드 후 배포** — `mvn compile` 또는 `gradle classes` 실행 후 배포 (시작 시 javac 실패하면 자동 실행)
- **생성 소스 지원** — ANTLR, QueryDSL 등 빌드 도구가 생성한 `target/generated-sources` 하위 소스 자동 포함
- **Maven & Gradle 지원** — 의존성 자동 해석 및 classpath 추가
- **Java 버전 감지** — `pom.xml`이나 `build.gradle`에서 `source`/`target` 버전 자동 인식
- **Tomcat 생명주기 관리** — 상태바 또는 사이드바에서 시작, 중지, 재시작, 강제 종료
- **고아 프로세스 감지** — 이전 세션에서 남은 Tomcat 프로세스 자동 탐지
- **실시간 로그 스트리밍** — Tomcat stdout 및 `localhost.log`를 전용 출력 패널에 표시
- **크로스 플랫폼** — Windows, Linux, macOS 지원

## 설치

### VS Code 마켓플레이스에서 설치

- **VS Code 내:** Extensions 패널(`Ctrl+Shift+X`)에서 `Tomcat Auto Deploy`를 검색하여 설치
- **웹:** [Visual Studio Marketplace](https://marketplace.visualstudio.com/vscode)에서 `Tomcat Auto Deploy`를 검색하여 설치

### 직접 빌드하여 설치

#### 1. 패키징

```bash
# Linux / macOS
./package.sh

# Windows
package.bat
```

#### 2. VS Code에 설치

**방법 A) UI에서 설치:**

1. VS Code에서 Extensions 패널 열기 (`Ctrl+Shift+X`)
2. 상단의 `···` 메뉴 클릭
3. **VSIX에서 설치...** 선택
4. 생성된 `.vsix` 파일 선택

**방법 B) 명령어로 설치:**

```bash
code --install-extension tomcat-auto-deploy-0.9.4.vsix
```

## 시작하기

### 1. `catalinaHome` 설정

최초 활성화 시 `.vscode/settings.json`에 설정 템플릿이 자동 생성됩니다. Tomcat 설치 경로만 지정하면 됩니다:

```json
{
  "tomcatAutoDeploy.catalinaHome": "/path/to/apache-tomcat-9.x"
}
```

### 2. Tomcat 시작

상태바의 **Tomcat** 버튼을 클릭하거나 명령 팔레트(`Ctrl+Shift+P`)에서 `Tomcat: 시작`을 실행합니다.

확장 프로그램이 다음을 수행합니다:
1. 로컬 Tomcat 베이스 디렉토리(`.vscode/tomcat/`) 초기화
2. 컴파일된 클래스, 의존성, 정적 파일 전체 동기화
3. JPDA 디버그 모드로 Tomcat 시작 (HotSwap용)
4. Tomcat 준비 완료 시 브라우저 열기

### 3. 편집하고 저장

코드를 작성하고 저장하세요. 그게 전부입니다.

- **Java 파일** → 컴파일 → 실행 중인 JVM에 HotSwap
- **JSP / HTML / CSS / JS** → 배포 디렉토리에 복사

## 설정

모든 설정은 워크스페이스 설정(`.vscode/settings.json`)의 `tomcatAutoDeploy.*` 하위에 있습니다.

명령 팔레트 → `Tomcat: 설정 열기` 또는 사이드바의 톱니바퀴 아이콘으로도 설정 GUI를 열 수 있습니다.

![설정](config.png)

| 설정 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `catalinaHome` | **필수** | — | Tomcat 설치 경로 (CATALINA_HOME) |
| `javaHome` | 권장 | 환경변수 | JDK 경로 (미설정 시 `JAVA_HOME` 사용) |
| `port` | | 8080 | HTTP 포트 — 디버그/리다이렉트 포트는 이 값 기준으로 자동 계산 |
| `debugPort` | | 5005 | JPDA 디버그 포트 — 수동 설정 해제 시 HTTP 포트 기준 자동 계산 |
| `redirectPort` | | 8443 | SSL 리다이렉트 포트 — 수동 설정 해제 시 HTTP 포트 기준 자동 계산 |
| `contextPath` | | `/` | 웹 애플리케이션 컨텍스트 경로 |
| `javaSourceRoot` | | `src/main/java` | Java 소스 루트 (워크스페이스 상대경로) |
| `webContentRoot` | | `src/main/webapp` | 정적 파일 루트 (워크스페이스 상대경로) |
| `resourceRoot` | | `src/main/resources` | 리소스 경로 — `.xml`, `.properties` 등 `WEB-INF/classes`에 배포 (워크스페이스 상대경로) |
| `manualPortConfig` | | `false` | 포트 수동 설정 — 체크 시 디버그/리다이렉트 포트를 직접 지정. 해제 시 HTTP 포트 기준 자동 계산 |
| `classpath` | | `[]` | 컴파일에 포함할 추가 JAR 경로 목록 |
| `javaOpts` | | `""` | Tomcat에 전달할 추가 JVM 옵션 (줄바꿈으로 구분) |

## 명령어

명령 팔레트(`Ctrl+Shift+P`) 및 사이드바에서 사용 가능:

| 명령어 | 설명 |
|--------|------|
| Tomcat: 시작 | 디버그 모드로 Tomcat 시작 |
| Tomcat: 중지 | Tomcat 정상 종료 |
| Tomcat: 강제 중지 | Tomcat 프로세스 즉시 종료 |
| Tomcat: 재시작 | Tomcat 중지 후 시작 |
| Tomcat: 브라우저 열기 | `http://localhost:{port}` 브라우저에서 열기 |
| Tomcat: 출력 보기 | 메인 로그 패널 표시 |
| Tomcat: Localhost 로그 | Tomcat의 `localhost.log` 전용 패널에 표시 |
| Tomcat: server.xml 열기 | 생성된 `server.xml` 편집용으로 열기 |
| Tomcat: 배포 | 전체 동기화 재실행 (`Ctrl+Alt+D`) |
| Tomcat: 빌드 후 배포 | Maven/Gradle 컴파일 후 전체 동기화 (중지 상태에서만 표시, Maven/Gradle 프로젝트 전용) |
| Tomcat: 설정 열기 | 확장 프로그램 워크스페이스 설정 열기 |

## 상태바

| 표시 | 의미 |
|------|------|
| `▶ Tomcat` | 중지됨 — 클릭하여 시작 |
| `● Tomcat` (주황색) | 실행 중 — 클릭하여 중지 |
| `✔ Deploy: Foo.java` | 파일 컴파일 및 배포 성공 |
| `✖ Deploy: Foo.java` (빨간색) | 컴파일 실패 — 출력 패널 확인 |

## 사이드바

액티비티 바의 Tomcat 패널에서 서버 제어, 로그 패널, 설정에 빠르게 접근할 수 있습니다.

## HotSwap 제한사항

JDWP HotSwap은 JVM의 기본 기능으로, 고유한 제한사항이 있습니다:

**가능 (재시작 불필요):**
- 메서드 본문 내 코드 변경
- 로그 문구 수정, 버그 수정, 로직 조정

**불가능 (Tomcat 재시작 필요):**
- 메서드 추가 또는 제거
- 필드 추가 또는 제거
- 메서드 시그니처 변경
- 클래스 계층 변경 (extends/implements)
- 람다 표현식 추가 또는 제거 (합성 메서드로 컴파일됨)

HotSwap 실패 시 출력 패널에 경고가 표시됩니다. Tomcat을 재시작하면 변경사항이 반영됩니다.

## 빌드 도구 연동

### Maven

- `mvn dependency:build-classpath`로 의존성 해석 및 캐시
- `pom.xml`에서 Java `source`/`target` 버전 자동 인식 (properties 또는 `maven-compiler-plugin` 설정)
- `target/generated-sources/` 하위 생성 소스 (ANTLR, QueryDSL 등) 자동 포함
- 시작 시 javac 실패하면 자동으로 `mvn compile` 실행 후 재시도
- `pom.xml` 변경 시 의존성 캐시 자동 무효화

### Gradle

- 임시 init script로 `compileClasspath` 해석
- `sourceCompatibility`/`targetCompatibility` 또는 `javaToolchain`에서 Java 버전 인식
- `build/generated/sources/` 하위 생성 소스 자동 포함
- 시작 시 javac 실패하면 자동으로 `gradle classes` 실행 후 재시도
- `build.gradle` 또는 `build.gradle.kts` 변경 시 의존성 캐시 자동 무효화

### 빌드 도구 없음

`pom.xml`이나 `build.gradle`이 없으면 확장 프로그램이 모든 `.java` 파일을 `javac`로 직접 컴파일합니다.

## 알아두면 좋은 것들

- `.vscode/tomcat/` 디렉토리는 로컬 Tomcat 베이스입니다 — `.gitignore`에 추가하세요
- Tomcat의 `servlet-api` 등 라이브러리는 classpath에 자동 포함됩니다
- 컴파일 오류는 출력 패널(`Tomcat Auto Deploy`)에 표시됩니다
- VS Code가 비정상 종료되면 다음 시작 시 고아 Tomcat 프로세스를 감지하고 종료를 제안합니다
- 확장 프로그램은 로그 인코딩 문제 방지를 위해 `-Dfile.encoding=UTF-8`로 Tomcat을 시작합니다

## 라이센스

이 프로젝트는 [Apache License 2.0](LICENSE) 하에 배포됩니다.
