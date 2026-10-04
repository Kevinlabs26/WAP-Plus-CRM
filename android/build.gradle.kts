buildscript {
    configurations.classpath {
        resolutionStrategy.activateDependencyLocking()
        resolutionStrategy.eachDependency {
            val safeVersion = when {
                requested.group == "io.netty" && requested.version?.startsWith("4.1.") == true -> "4.1.137.Final"
                requested.group == "org.bouncycastle" -> "1.85"
                requested.group == "com.google.protobuf" -> "3.25.5"
                requested.group == "org.apache.commons" && requested.name == "commons-compress" -> "1.26.0"
                requested.group == "org.apache.commons" && requested.name == "commons-lang3" -> "3.18.0"
                requested.group == "commons-io" -> "2.15.1"
                requested.group == "org.bitbucket.b_c" && requested.name == "jose4j" -> "0.9.6"
                requested.group == "org.jdom" && requested.name == "jdom2" -> "2.0.6.1"
                else -> null
            }
            if (safeVersion != null) {
                useVersion(safeVersion)
                because("Fix security advisories in the AGP build classpath without changing APK dependencies")
            }
        }
    }
}

plugins {
    id("com.android.application") version "8.7.2" apply false
    id("org.jetbrains.kotlin.android") version "2.4.20" apply false
    id("org.jetbrains.kotlin.plugin.compose") version "2.4.20" apply false
}
