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
