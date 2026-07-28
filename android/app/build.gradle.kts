import java.util.Properties

plugins {
  id("com.android.application")
  id("org.jetbrains.kotlin.android")
  id("org.jetbrains.kotlin.plugin.compose")
  id("org.jetbrains.kotlin.plugin.serialization")
}

val localProperties =
  Properties().apply {
    val file = rootProject.file("local.properties")
    if (file.exists()) file.inputStream().use { load(it) }
  }

fun localProperty(name: String) = localProperties.getProperty(name, "")

android {
  namespace = "com.solarsentinel.widget"
  compileSdk = 35

  defaultConfig {
    applicationId = "com.solarsentinel.widget"
    minSdk = 26
    targetSdk = 35
    versionCode = 1
    versionName = "1.0"

    buildConfigField("String", "BASE_URL", "\"${localProperty("widget.baseUrl")}\"")
    buildConfigField("String", "WEB_APP_URL", "\"${localProperty("widget.webAppUrl")}\"")
    buildConfigField("String", "CF_ACCESS_CLIENT_ID", "\"${localProperty("widget.cfAccessClientId")}\"")
    buildConfigField(
      "String",
      "CF_ACCESS_CLIENT_SECRET",
      "\"${localProperty("widget.cfAccessClientSecret")}\"",
    )
  }

  signingConfigs {
    // Personal sideload key; created outside the repo, referenced via local.properties.
    val keystorePath = localProperty("widget.releaseKeystore")
    if (keystorePath.isNotEmpty()) {
      create("release") {
        storeFile = file(keystorePath)
        storePassword = localProperty("widget.releaseKeystorePassword")
        keyAlias = localProperty("widget.releaseKeyAlias")
        keyPassword = localProperty("widget.releaseKeystorePassword")
      }
    }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      signingConfigs.findByName("release")?.let { signingConfig = it }
    }
  }

  buildFeatures {
    buildConfig = true
    compose = true
  }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions { jvmTarget = "17" }

  sourceSets["main"].java.srcDirs("src/main/kotlin")
}

dependencies {
  implementation("androidx.glance:glance-appwidget:1.1.0")
  implementation("androidx.work:work-runtime-ktx:2.9.1")
  implementation("com.squareup.okhttp3:okhttp:4.12.0")
  implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.1")
  implementation("com.google.android.gms:play-services-location:21.3.0")
  implementation("org.jetbrains.kotlinx:kotlinx-coroutines-play-services:1.8.1")
  implementation("androidx.activity:activity-ktx:1.9.1")

  testImplementation("junit:junit:4.13.2")
  testImplementation("org.jetbrains.kotlin:kotlin-test-junit:2.0.20")
}
