package com.wjx.quizrx

import android.os.Bundle
import android.content.Intent
import android.webkit.WebView
import androidx.activity.OnBackPressedCallback
import androidx.activity.enableEdgeToEdge
import org.json.JSONArray

class MainActivity : TauriActivity() {
  // Wry's default callback calls WebView.goBack(), including tab history.
  override val handleBackNavigation = false

  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)
  }

  override fun onWebViewCreate(webView: WebView) {
    super.onWebViewCreate(webView)
    onBackPressedDispatcher.addCallback(this, object : OnBackPressedCallback(true) {
      override fun handleOnBackPressed() {
        webView.evaluateJavascript("window.location.hash") { value ->
          val hash = try { JSONArray("[$value]").optString(0, "") } catch (_: Exception) { "" }
          val path = hash.removePrefix("#").substringBefore('?').trimEnd('/')
          if (path in setOf("", "/quiz", "/subjects", "/search")) {
            // Keep the process available to finish any queued SQLite writes.
            moveTaskToBack(true)
            startActivity(Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_HOME)
              .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
          } else {
            webView.evaluateJavascript("window.dispatchEvent(new Event('quizrx:android-back'))", null)
          }
        }
      }
    })
  }
}
