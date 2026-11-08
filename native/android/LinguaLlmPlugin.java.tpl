// Installed into android/ by scripts/patch-llm.mjs (the CI build runs it). Not yet run on a device.
// The MediaPipe version is set in scripts/patch-llm.mjs (SAFINA_MEDIAPIPE).
//
// Capacitor plugin "LinguaLlm": runs a downloaded on-device model (MediaPipe .task / .litertlm file).
// JS side (safina-models.js) calls:  load({path, maxTokens}), generate({prompt, maxTokens}), unload()
//
// Wiring (same way as LinguaStoragePlugin):
//   1. copy this file to android/app/src/main/java/com/lingua/arabic/LinguaLlmPlugin.java
//   2. in MainActivity:   registerPlugin(LinguaLlmPlugin.class);   (before super.onCreate)
//   3. android/app/build.gradle  dependencies:
//        implementation 'com.google.mediapipe:tasks-genai:0.10.24'     // use the newest 0.10.x on Maven Central
//      and make sure minSdkVersion is at least 24 in android/variables.gradle
//   4. optional, for large models:  android:largeHeap="true"  on <application> in AndroidManifest.xml
package com.lingua.arabic;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mediapipe.tasks.genai.llminference.LlmInference;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "LinguaLlm")
public class LinguaLlmPlugin extends Plugin {
    private final ExecutorService worker = Executors.newSingleThreadExecutor();
    private LlmInference llm;

    @PluginMethod
    public void load(final PluginCall call) {
        final String path = call.getString("path");
        final int maxTokens = call.getInt("maxTokens", 1024);
        if (path == null) { call.reject("path is required"); return; }
        worker.execute(() -> {
            try {
                closeModel();
                LlmInference.LlmInferenceOptions options = LlmInference.LlmInferenceOptions.builder()
                        .setModelPath(path)
                        .setMaxTokens(maxTokens)
                        .build();
                llm = LlmInference.createFromOptions(getContext(), options);
                call.resolve();
            } catch (Throwable t) {
                call.reject("Could not load the model: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void generate(final PluginCall call) {
        final String prompt = call.getString("prompt");
        if (prompt == null) { call.reject("prompt is required"); return; }
        worker.execute(() -> {
            try {
                if (llm == null) { call.reject("No model is loaded"); return; }
                String text = llm.generateResponse(prompt);
                JSObject out = new JSObject();
                out.put("text", text);
                call.resolve(out);
            } catch (Throwable t) {
                call.reject("The model failed: " + t.getMessage());
            }
        });
    }

    @PluginMethod
    public void unload(final PluginCall call) {
        worker.execute(() -> { closeModel(); call.resolve(); });
    }

    private void closeModel() {
        if (llm != null) { try { llm.close(); } catch (Throwable ignored) { } llm = null; }
    }

    @Override
    protected void handleOnDestroy() { closeModel(); worker.shutdown(); }
}
