package com.prreview.jetbrains
import com.intellij.openapi.actionSystem.AnAction
import com.intellij.openapi.actionSystem.AnActionEvent
/** Tools > Stop the Review Server. */
class StopReviewAction : AnAction() {
    override fun actionPerformed(event: AnActionEvent) {
        ReviewServer.stop()
    }

    override fun update(event: AnActionEvent) {
        event.presentation.isEnabled = ReviewServer.isOpen
    }
}
