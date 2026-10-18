package __PKG__;

import android.Manifest;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.Settings;
import androidx.core.app.ActivityCompat;
import androidx.core.content.ContextCompat;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

@CapacitorPlugin(name = "LinguaStorage")
public class LinguaStoragePlugin extends Plugin {

    @PluginMethod
    public void hasAccess(PluginCall call) {
        boolean ok;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
            ok = Environment.isExternalStorageManager();
        } else {
            ok = ContextCompat.checkSelfPermission(getContext(), Manifest.permission.READ_EXTERNAL_STORAGE)
                    == PackageManager.PERMISSION_GRANTED;
        }
        JSObject o = new JSObject();
        o.put("granted", ok);
        call.resolve(o);
    }

    @PluginMethod
    public void requestAccess(PluginCall call) {
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.R) {
                Intent i = new Intent(Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION,
                        Uri.parse("package:" + getContext().getPackageName()));
                i.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                try {
                    getContext().startActivity(i);
                } catch (Exception e) {
                    Intent j = new Intent(Settings.ACTION_MANAGE_ALL_FILES_ACCESS_PERMISSION);
                    j.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    getContext().startActivity(j);
                }
            } else {
                ActivityCompat.requestPermissions(getActivity(),
                        new String[]{Manifest.permission.READ_EXTERNAL_STORAGE}, 4242);
            }
            call.resolve();
        } catch (Exception e) {
            call.reject(String.valueOf(e.getMessage()));
        }
    }

    @PluginMethod
    public void walk(PluginCall call) {
        String path = call.getString("path");
        JSObject out = new JSObject();
        JSArray arr = new JSArray();
        File rootDir = path == null ? null : new File(path);
        if (rootDir == null || !rootDir.isDirectory()) {
            out.put("exists", false);
            out.put("files", arr);
            call.resolve(out);
            return;
        }
        walkDir(rootDir, "", arr);
        out.put("exists", true);
        out.put("files", arr);
        call.resolve(out);
    }

    private void walkDir(File dir, String rel, JSArray arr) {
        File[] list = dir.listFiles();
        if (list == null) return;
        for (File f : list) {
            String name = f.getName();
            String r = rel.isEmpty() ? name : rel + "/" + name;
            if (f.isDirectory()) {
                if (!name.startsWith(".")) walkDir(f, r, arr);
            } else {
                arr.put(r);
            }
        }
    }
}
