# Tomcat Auto Deploy

Java 파일을 저장하면 자동으로 컴파일하고, 실행 중인 Tomcat에 즉시 반영하는 VS Code 확장 프로그램입니다.
Tomcat 재기동이나 컨텍스트 재시작 없이 변경사항이 바로 적용됩니다.

## 주요 기능

- `.java` 저장 → 자동 컴파일 → JDWP HotSwap으로 즉시 반영 (재시작 없음)
- `.jsp`, `.html`, `.css`, `.js` 등 저장 → 즉시 배포
- Maven/Gradle 의존성 자동 인식 (classpath, WEB-INF/lib)
- Tomcat 시작/중지/재시작 상태바 버튼
- Windows, Linux, macOS 지원

## 설치

```bash
npm install -g @vscode/vsce
vsce package
```

VS Code → Extensions → `...` → Install from VSIX

## 설정

최초 활성화 시 `.vscode/settings.json`에 기본 설정이 자동 생성됩니다.
`catalinaHome`만 설정하면 바로 사용할 수 있습니다.

명령 팔레트의 `Tomcat: 설정 열기` 또는 사이드바의 설정 버튼을 클릭하면 Workspace Settings GUI가 열립니다.

```json
{
  "tomcatAutoDeploy.catalinaHome": "D:/dev/apache-tomcat-9.0.115",
  "tomcatAutoDeploy.javaHome": "D:/dev/java/jdk-11.0.2"
}
```

| 설정 | 필수 | 기본값 | 설명 |
|------|------|--------|------|
| `catalinaHome` | **필수** | - | Tomcat 설치 경로 |
| `javaHome` | 권장 | 환경변수 | JAVA_HOME 경로 |
| `port` | - | 8080 | HTTP 포트 |
| `debugPort` | - | 5005 | JPDA 디버그 포트 |
| `javaSourceRoot` | - | `src/main/java` | Java 소스 루트 |
| `webContentRoot` | - | `src/main/webapp` | 정적 파일 루트 |
| `classpath` | - | `[]` | 추가 classpath JAR 경로 |

## 사용 방법

1. `catalinaHome` 설정 후, 상태바의 `▶ Tomcat` 클릭 또는 명령 팔레트에서 `Tomcat: 시작`
2. Java 파일을 수정하고 저장하면 자동으로 컴파일 및 HotSwap 반영
3. JSP/HTML/CSS/JS 파일은 저장 즉시 배포

### 명령 팔레트 (Ctrl+Shift+P)

| 명령 | 설명 |
|------|------|
| `Tomcat: 시작` | Tomcat 기동 |
| `Tomcat: 중지` | Tomcat 종료 |
| `Tomcat: 재시작` | 중지 후 재시작 |
| `Tomcat: 브라우저 열기` | localhost:port 열기 |
| `Tomcat: Output 보기` | 로그 패널 열기 |
| `Tomcat: 설정 열기` | 설정 페이지 열기 |

### 상태바

| 표시 | 의미 |
|------|------|
| `▶ Tomcat` | 중지 상태 — 클릭하면 시작 |
| `■ Tomcat` (주황) | 실행 중 — 클릭하면 중지 |
| `✓ 배포완료: xxx.java` | 배포 성공 |
| `✗ 배포실패: xxx.java` (빨강) | 배포 실패 — Output에서 오류 확인 |

## HotSwap 제약사항

- **메서드 본문 변경**: 즉시 반영 (재시작 없음)
- **구조 변경** (필드/메서드 추가·삭제, 클래스 상속 변경 등): Tomcat 재시작 필요

## 주의사항

- `.tomcat/` 폴더는 `.gitignore`에 추가 권장
- Maven/Gradle 프로젝트는 servlet-api 등이 자동으로 classpath에 추가됨
- Maven 프로젝트는 최초 `mvn compile` 실행 필요 (`target/classes` 생성)
- 컴파일 오류는 Output 채널(`Tomcat Auto Deploy`)에서 확인
