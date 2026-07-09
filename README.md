[한국어](README_ko.md)

# Tomcat Auto Deploy

A VS Code extension that **automatically compiles and deploys** your Java web application to a local Tomcat server every time you save a file — with zero restarts.

Save a `.java` file, and it gets compiled and hot-swapped into the running JVM instantly. Save a `.jsp`, `.html`, `.css`, or `.js` file, and it's copied to the deployment directory right away. No need to restart Tomcat, no need to redeploy the WAR.

> [!TIP]
Develop without restarting Tomcat — class hot-deploy works right in VS Code.  
Hot Swap is based on the standard JVM JDWP HotSwap mechanism, which is more limited in scope compared to JRebel.  
Upon recompilation, only the bytecode of changed method bodies is replaced in-place, using the standard JVM JDWP debug hot swap mechanism.  
(Adding new fields, changing method signatures, or modifying class structure requires a full application restart.)

## How It Works

```
You save a .java file
        │
        ▼
   javac compiles it
        │
        ▼
   JDWP HotSwap replaces the class
   in the running JVM (no restart)
        │
        ▼
   Changes are live immediately
```

For static files (JSP, HTML, CSS, JS, images, etc.), saving simply copies the file to the Tomcat deployment directory — changes are reflected on the next browser refresh.

## Features

- **Instant Java HotSwap** — Compile on save + JDWP class replacement, no Tomcat restart needed
- **Static file deployment** — JSP, HTML, CSS, JS files are deployed immediately on save
- **Incremental compilation** — Only recompiles `.java` files that are newer than their `.class` counterparts
- **Build & Deploy** — Run `mvn compile` or `gradle classes` first, then deploy (auto-triggered on javac failure at startup)
- **Generated sources support** — ANTLR, QueryDSL, and other build-tool-generated sources under `target/generated-sources` are automatically included
- **Maven & Gradle support** — Dependencies are automatically resolved and added to the classpath
- **Java version detection** — Reads `source`/`target` from `pom.xml` or `build.gradle` to ensure bytecode compatibility
- **Multi-instance support** — Run several Tomcat instances on different ports simultaneously, each controlled individually from the sidebar. When they share a deployment target, files are synced once and only HotSwap runs per instance — no duplicated work
- **Selective sync** — Choose between full deploy, build & deploy, or web/resource-only sync as needed
- **Tomcat lifecycle management** — Start, stop, restart, force kill from the status bar or sidebar
- **Orphan process & folder detection** — Finds leftover Tomcat processes from a previous session and instance folders no longer in your settings
- **Real-time log streaming** — Tomcat stdout and `localhost.log` displayed in dedicated output panels
- **Cross-platform** — Windows, Linux, macOS

## Installation

### From VS Code Marketplace

- **Inside VS Code:** Open the Extensions panel (`Ctrl+Shift+X`) and search for `Tomcat Auto Deploy`
- **Web:** Search for `Tomcat Auto Deploy` on the [Visual Studio Marketplace](https://marketplace.visualstudio.com/vscode)

### Build from Source

#### 1. Package

```bash
# Linux / macOS
./package.sh

# Windows
package.bat
```

#### 2. Install in VS Code

**Option A) Install from UI:**

1. Open the Extensions panel in VS Code (`Ctrl+Shift+X`)
2. Click the `···` menu at the top
3. Select **Install from VSIX...**
4. Choose the generated `.vsix` file

**Option B) Install from command line:**

```bash
code --install-extension tomcat-auto-deploy-0.10.1.vsix
```

## Getting Started

### 1. Set `catalinaHome`

On first activation, the extension creates a settings template in `.vscode/settings.json`. You only need to set one thing — the path to your Tomcat installation:

```json
{
  "tomcatAutoDeploy.catalinaHome": "/path/to/apache-tomcat-9.x"
}
```

### 2. Start Tomcat

Click the **Tomcat** button in the status bar, or run `Tomcat: Start` from the Command Palette (`Ctrl+Shift+P`).

The extension will:
1. Initialize a local Tomcat base directory (`.vscode/tomcat/`)
2. Sync all compiled classes, dependencies, and static files
3. Start Tomcat in JPDA debug mode (for HotSwap)
4. Open your browser when Tomcat is ready

### 3. Edit and Save

Just write code and save. That's it.

- **Java files** → compiled → hot-swapped into the running JVM
- **JSP / HTML / CSS / JS** → copied to the deployment directory

## Settings

All settings live under `tomcatAutoDeploy.*` in your workspace settings (`.vscode/settings.json`).

You can also open the settings GUI via Command Palette → `Tomcat: Open Settings` or the gear icon in the sidebar.

![Settings](config.png)

| Setting | Required | Default | Description |
|---------|----------|---------|-------------|
| `catalinaHome` | **Yes** | — | Path to your Tomcat installation (CATALINA_HOME) |
| `javaHome` | Recommended | env var | Path to JDK (uses `JAVA_HOME` if not set) |
| `instanceName` | | `default` | Default instance name (used for the `.vscode/tomcat/<name>/` folder) |
| `servers` | | `[]` | Multi-instance list — leave empty for a single instance (see [Multiple Instances](#multiple-instances)) |
| `port` | | 8080 | HTTP port — debug/redirect ports are auto-calculated based on this value |
| `debugPort` | | 5005 | JPDA debug port — auto-calculated from HTTP port when manual config is off |
| `redirectPort` | | 8443 | SSL redirect port — auto-calculated from HTTP port when manual config is off |
| `contextPath` | | `/` | Web application context path |
| `javaSourceRoot` | | `src/main/java` | Java source root (relative to workspace) |
| `webContentRoot` | | `src/main/webapp` | Static files root (relative to workspace) |
| `resourceRoot` | | `src/main/resources` | Resource path — `.xml`, `.properties`, etc. deployed to `WEB-INF/classes` (relative to workspace) |
| `manualPortConfig` | | `false` | Manual port config — when checked, debug/redirect ports are set manually. When unchecked, auto-calculated from HTTP port |
| `classpath` | | `[]` | Additional JAR paths to include in compilation |
| `javaOpts` | | `""` | Extra JVM options passed to Tomcat (separated by newlines) |

## Multiple Instances

You can run several Tomcat instances on different ports at the same time. When `servers` is empty, a single instance runs from the flat settings (`port`/`debugPort`); fill in the list and each entry becomes its own instance. You can also add one via the `+` button (`Add Instance`) in the sidebar.

```json
{
  "tomcatAutoDeploy.servers": [
    { "name": "default", "port": 8080 },
    { "name": "staging", "port": 8081 }
  ]
}
```

Per-instance keys: `name`, `port` (required), `debugPort`, `redirectPort`, `javaHome`, `catalinaHome`, `javaOpts`.

- Omitted ports are auto-calculated — debug `5005 + (port - 8080)`, redirect `8443 + (port - 8080)`
- Omitted `javaHome` / `catalinaHome` / `javaOpts` fall back to the shared settings
- Each instance gets its own base under `.vscode/tomcat/<name>/`
- When instances share a deployment target, files are synced once and only HotSwap runs per instance

## Commands

Available from the Command Palette (`Ctrl+Shift+P`) and the sidebar:

| Command | Description |
|---------|-------------|
| Tomcat: Start | Start Tomcat in debug mode |
| Tomcat: Stop | Gracefully stop Tomcat |
| Tomcat: Force Stop | Kill the Tomcat process immediately |
| Tomcat: Restart | Stop and start Tomcat |
| Tomcat: Start All | Start every instance |
| Tomcat: Stop All | Stop every instance |
| Tomcat: Pick Instance | Select the target instance for save-on-deploy and the status bar |
| Tomcat: Add Instance | Add a new instance to the `servers` setting |
| Tomcat: Remove Instance | Remove the selected instance from the `servers` setting |
| Tomcat: Delete Orphan Folder | Delete a `.vscode/tomcat/<name>/` folder no longer in your settings |
| Tomcat: Open Browser | Open `http://localhost:{port}` in your browser |
| Tomcat: Show Output | Show the main log panel |
| Tomcat: Localhost Log | Show Tomcat's `localhost.log` in a dedicated panel |
| Tomcat: Open server.xml | Open the generated `server.xml` for editing |
| Tomcat: Open context.xml | Open the generated `context.xml` for editing |
| Tomcat: Deploy All | Re-run full sync (`Ctrl+Alt+D`) |
| Tomcat: Build & Deploy | Run Maven/Gradle compile, then full sync (available when stopped, Maven/Gradle projects only) |
| Tomcat: Sync Web/Resources | Deploy static files (JSP/HTML/CSS/JS/images) only, without recompiling Java |
| Tomcat: Open Settings | Open workspace settings filtered to this extension |

## Status Bar

| Display | Meaning |
|---------|---------|
| `▶ Tomcat` | Stopped — click to start |
| `● Tomcat` (orange) | Running — click to stop |
| `✔ Deploy: Foo.java` | File compiled and deployed successfully |
| `✖ Deploy: Foo.java` (red) | Compilation failed — check the Output panel |

## Sidebar

The Tomcat panel in the Activity Bar provides quick access to all server controls, log panels, and settings. Multiple instances appear as individual tree items, each with its own start/stop/restart/force-stop/open-browser/open-config actions. An instance whose HotSwap failed is flagged with an error icon and a "restart required" hint.

![Sidebar](sidebar.png)

## HotSwap Limitations

JDWP HotSwap is a JVM feature with inherent limitations. Understanding what it can and cannot do will save you from confusion:

**Works (no restart needed):**
- Changing code inside a method body
- Modifying log statements, fixing bugs, tweaking logic

**Doesn't work (Tomcat restart required):**
- Adding or removing methods
- Adding or removing fields
- Changing method signatures
- Changing class hierarchy (extends/implements)
- Adding or removing lambda expressions (they compile to synthetic methods)

When HotSwap fails, you'll see a warning in the Output panel, and the affected instance in the sidebar tree is flagged with an error icon and a "restart required" hint. Just restart Tomcat to pick up the changes.

## Build Tool Integration

### Maven

- Dependencies are resolved via `mvn dependency:build-classpath` and cached
- Java `source`/`target` version is read from `pom.xml` (properties or `maven-compiler-plugin` config)
- Generated sources under `target/generated-sources/` (ANTLR, QueryDSL, etc.) are automatically included in compilation
- If javac fails at startup, the extension automatically runs `mvn compile` and retries
- Changing `pom.xml` automatically invalidates the dependency cache

### Gradle

- Dependencies are resolved via a temporary init script that prints `compileClasspath`
- Java version is read from `sourceCompatibility`/`targetCompatibility` or `javaToolchain`
- Generated sources under `build/generated/sources/` are automatically included in compilation
- If javac fails at startup, the extension automatically runs `gradle classes` and retries
- Changing `build.gradle` or `build.gradle.kts` automatically invalidates the dependency cache

### No Build Tool

If there's no `pom.xml` or `build.gradle`, the extension compiles all `.java` files directly with `javac`.

## Good to Know

- The `.vscode/tomcat/` directory is the local Tomcat base — add it to `.gitignore`
- Tomcat's `servlet-api` and other libraries are automatically included in the classpath
- Compilation errors are shown in the Output panel (`Tomcat Auto Deploy`)
- If VS Code crashes, the extension will detect the orphan Tomcat process on next startup and offer to kill it
- The `javaOpts` setting includes encoding options such as `-Dfile.encoding=UTF-8` by default (editable as needed)

## License

This project is licensed under the [Apache License 2.0](LICENSE).


