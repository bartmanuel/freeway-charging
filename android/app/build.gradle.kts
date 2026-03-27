import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Load API keys from local.properties (never committed)
val localProps = Properties().apply {
    rootProject.file("local.properties").takeIf { it.exists() }
        ?.inputStream()?.use { load(it) }
}

android {
    namespace = "app.letsjustdrive.auto"
    compileSdk = 34

    defaultConfig {
        applicationId = "app.letsjustdrive.auto"
        minSdk = 23
        targetSdk = 34
        versionCode = 1
        versionName = "1.0"

        buildConfigField(
            "String", "GOOGLE_MAPS_API_KEY",
            "\"${localProps["GOOGLE_MAPS_API_KEY"] ?: ""}\""
        )
        buildConfigField(
            "String", "WORKER_BASE_URL",
            "\"https://freeway-charge-api.bartmanuel.workers.dev\""
        )
    }

    buildTypes {
        release {
            isMinifyEnabled = true
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

    kotlinOptions {
        jvmTarget = "17"
    }

    buildFeatures {
        buildConfig = true
    }
}

dependencies {
    // Car App Library — template-based rendering for Android Auto (phone projection)
    implementation("androidx.car.app:app:1.4.0")
    implementation("androidx.car.app:app-projected:1.4.0")

    // HTTP client for Cloudflare Workers API and Google Places
    implementation("com.squareup.okhttp3:okhttp:4.12.0")

    // Coroutines
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-android:1.7.3")

    // Lifecycle — gives Screen a coroutineScope
    implementation("androidx.lifecycle:lifecycle-runtime-ktx:2.7.0")
}
