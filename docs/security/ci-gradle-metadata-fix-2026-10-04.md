# Android CI 依赖校验修复（2026-10-04）

截图中的 Windows CI 在 `Run Android unit tests` 步骤配置构建依赖时失败。原 `android/gradle/verification-metadata.xml` 缺少以下两个文件的 SHA-256：

| 文件 | 官方 SHA-256 |
| --- | --- |
| `org.junit:junit-bom:5.13.1` 的 `junit-bom-5.13.1.module` | `33c07ab9724790a6e5859ba07d69117ac530439724545a81c4179e3272c75de8` |
| `org.jetbrains.kotlinx:kotlinx-coroutines-bom:1.8.0` 的 `kotlinx-coroutines-bom-1.8.0.pom` | `1239e9dbe1397cd5971342956b2511bc3ace7b641842e4372a088dcfa8b9ad55` |

已从 Maven Central 官方 HTTPS 仓库分别读取原文件（6,994 / 4,291 字节），计算 SHA-256，并仅补入这两个文件的校验记录，记录的 `origin` 为对应的官方完整 URL。既有依赖版本、其他哈希和 CI 的 strict 配置均保留。

验证结果：

1. 在工作区 `.audit-cache/ci-gradle-metadata` 的隔离 Gradle 工程中，用提交前的清单解析这两个 BOM：strict 校验退出码 1，失败文件与截图完全一致。
2. 同一隔离工程换成修复后的清单：strict 校验退出码 0。两次均指定 `--refresh-dependencies`，使用 `mavenCentral()`。
3. 实际 Android 项目运行 `gradlew.bat --dependency-verification strict --refresh-dependencies :app:testDebugUnitTest :app:assembleDebug`：`BUILD SUCCESSFUL in 1m 40s`，41 个任务均为 up-to-date。该结果确认刷新依赖后的配置、校验及任务链通过，编译和测试产物复用了已有输出，并非 41 个任务重新执行。
4. 现有 `tools/security-verify-gradle-artifacts.test.py` 的正常文件、篡改文件和非法重定向检查通过；`git diff --check` 通过。

本地缓存可能导致此前的构建没有请求这两个元数据文件；具体旧缓存的解析路径待确认。独立工程已证实这次错误由校验记录缺失引起。[Gradle 官方依赖校验说明](https://docs.gradle.org/current/userguide/dependency_verification.html)也要求对缺失的依赖元数据记录进行审核和补充。

本次只修复 BridgeCRM Android 校验清单，WhatsApp 浏览器插件没有改动。本地验证已完成；GitHub Actions 的结果需在推送本次修复后通过新运行确认。
