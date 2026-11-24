import org.jetbrains.intellij.platform.gradle.IntelliJPlatformType
import org.jetbrains.intellij.platform.gradle.TestFrameworkType
plugins {
    id("java")
    id("org.jetbrains.kotlin.jvm") version "2.0.21"
    id("org.jetbrains.intellij.platform") version "2.1.0"
}
group = "com.prreview"
version = "0.1.0"
repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}
dependencies {
    intellijPlatform {
        // Build against the community platform; the plugin only uses base APIs,
        // so it runs in every JetBrains IDE from 2023.3 up.
        create(IntelliJPlatformType.IntellijIdeaCommunity, "2023.3.5")
        pluginVerifier()
        zipSigner()
        testFramework(TestFrameworkType.Platform)
    }
}
intellijPlatform {
    pluginConfiguration {
        ideaVersion {
            sinceBuild = "233"
        }
    }
}

tasks {
    // The engine bundle is copied in with scripts/bundle-server.mjs; the plugin
    // finds it at <plugin>/server/src/cli.js, exactly like VS Code.
    buildSearchableOptions {
        enabled = false
    }

    // Without this the engine stays out of the zip: the plugin would install and
    // then have nothing to start, which is the one thing it is for.
    processResources {
        from("server") {
            into("server")
        }
    }
}
