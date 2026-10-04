plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("org.jetbrains.kotlin.plugin.compose")
}

android {
    namespace = "com.wapplus.bridge"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.wapplus.bridge"
        minSdk = 26
        targetSdk = 35
        versionCode = 1
        versionName = "0.1.0"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
    }

}

kotlin {
    compilerOptions {
        jvmTarget = org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17
    }
}

dependencies {
    val composeBom = platform("androidx.compose:compose-bom:2024.10.01")
    implementation(composeBom)
    implementation("androidx.compose.ui:ui")
    implementation("androidx.compose.ui:ui-tooling-preview")
    implementation("androidx.compose.material3:material3")
    implementation("androidx.activity:activity-compose:1.9.3")
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.8.7")
    implementation("androidx.core:core-ktx:1.15.0")
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.9.0")
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    debugImplementation("androidx.compose.ui:ui-tooling")
}

dependencyLocking {
    lockAllConfigurations()
}

// AGP's device-test tools have their own classpaths, separate from buildscript and APK dependencies.
configurations.matching { it.name.startsWith("_internal-unified-test-platform-") }.configureEach {
    resolutionStrategy.eachDependency {
        val safeVersion = when {
            requested.group == "io.netty" && requested.version?.startsWith("4.1.") == true -> "4.1.137.Final"
            requested.group == "com.google.protobuf" -> "3.25.5"
            requested.group == "commons-io" -> "2.15.1"
            else -> null
        }
        if (safeVersion != null) {
            useVersion(safeVersion)
            because("Fix advisories in AGP device-test tools")
        }
    }
}
