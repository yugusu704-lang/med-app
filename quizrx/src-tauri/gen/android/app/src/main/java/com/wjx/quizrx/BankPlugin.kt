package com.wjx.quizrx

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import java.io.File
import java.io.FileOutputStream

@InvokeArg
class CopyBankArgs { lateinit var destination: String }

/** Asset streams respect ZIP compression and offsets. No storage permission. */
@TauriPlugin
class BankPlugin(private val activity: Activity) : Plugin(activity) {
    @Command
    fun copyBankAsset(invoke: Invoke) {
        val args = invoke.parseArgs(CopyBankArgs::class.java)
        Thread {
            try {
                val destination = File(args.destination).canonicalFile
                // Tauri app_data_dir resolves Android's dataDir, the parent of
                // filesDir. Both paths remain inside this application's sandbox.
                val privateRoot = File(activity.applicationInfo.dataDir).canonicalFile
                require(destination.path.startsWith(privateRoot.path + File.separator)) {
                    "Destination must be in the application's private files"
                }
                destination.parentFile?.mkdirs()
                var count = 0L
                activity.assets.open("quizbank.db").use { input ->
                    FileOutputStream(destination, false).use { output ->
                        count = input.copyTo(output, 65536)
                        output.fd.sync()
                    }
                }
                invoke.resolve(JSObject().put("copiedBytes", count))
            } catch (error: Exception) {
                invoke.reject(error.message ?: "Cannot copy bundled question bank")
            }
        }.start()
    }
}
