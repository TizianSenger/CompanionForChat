package com.example.ai.companion;

import java.io.File;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.util.Base64;

import org.eclipse.core.runtime.IStatus;
import org.eclipse.core.runtime.Status;
import org.eclipse.jface.action.Action;
import org.eclipse.jface.action.IToolBarManager;
import org.eclipse.jface.action.Separator;
import org.eclipse.jface.dialogs.ErrorDialog;
import org.eclipse.jface.preference.IPreferenceStore;
import org.eclipse.swt.SWT;
import org.eclipse.swt.browser.Browser;
import org.eclipse.swt.browser.BrowserFunction;
import org.eclipse.swt.browser.ProgressAdapter;
import org.eclipse.swt.browser.ProgressEvent;
import org.eclipse.swt.layout.FillLayout;
import org.eclipse.swt.widgets.Composite;
import org.eclipse.swt.widgets.Display;
import org.eclipse.swt.widgets.FileDialog;
import org.eclipse.ui.IActionBars;
import org.eclipse.ui.part.ViewPart;
import org.osgi.framework.Bundle;

/**
 * Eclipse ViewPart that embeds an SWT Browser showing a Three.js WebGL scene
 * with an optional VRM avatar.
 *
 * <ul>
 *   <li>Toolbar: "Select VRM File" and "Reload"</li>
 *   <li>Click on the avatar → random procedural animation</li>
 *   <li>Java↔JS bridge: {@code companion.setState(state)} / {@code companion.react(state, intensity)}</li>
 * </ul>
 */
public class CompanionView extends ViewPart {

    public static final String ID = "com.example.ai.companion.CompanionView";

    /** Chunk size for base64-encoded VRM data sent to the browser (512 KB). */
    private static final int CHUNK_SIZE = 512 * 1024;

    private Browser browser;
    private String pendingVrmPath;

    // ─────────────────────────────────────────────────────────────────────────
    // ViewPart lifecycle
    // ─────────────────────────────────────────────────────────────────────────

    @Override
    public void createPartControl(Composite parent) {
        parent.setLayout(new FillLayout());

        browser = createBrowser(parent);

        // JS → Java logging bridge
        new BrowserFunction(browser, "javaLog") {
            @Override
            public Object function(Object[] args) {
                if (args.length > 0) {
                    System.out.println("[Companion] " + args[0]);
                }
                return null;
            }
        };

        contributeToToolBar();
        loadPage();

        // If a VRM was previously saved, load it once the page is ready
        IPreferenceStore store = Activator.getDefault().getPreferenceStore();
        String saved = store.getString(Activator.PREF_SELECTED_VRM);
        if (saved != null && !saved.isBlank()) {
            pendingVrmPath = saved;
            browser.addProgressListener(new ProgressAdapter() {
                @Override
                public void completed(ProgressEvent event) {
                    browser.removeProgressListener(this);
                    if (pendingVrmPath != null) {
                        sendVrmToBrowser(pendingVrmPath);
                        pendingVrmPath = null;
                    }
                }
            });
        }
    }

    @Override
    public void setFocus() {
        if (browser != null && !browser.isDisposed()) {
            browser.setFocus();
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Browser creation
    // ─────────────────────────────────────────────────────────────────────────

    private Browser createBrowser(Composite parent) {
        // Prefer Chromium (WebGL / ES-modules / importmaps); fall back to default
        try {
            return new Browser(parent, SWT.CHROMIUM);
        } catch (Exception ignored) {
        }
        return new Browser(parent, SWT.NONE);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Toolbar
    // ─────────────────────────────────────────────────────────────────────────

    private void contributeToToolBar() {
        IActionBars bars = getViewSite().getActionBars();
        IToolBarManager toolbar = bars.getToolBarManager();

        toolbar.add(new Action("Select VRM File") {
            @Override
            public void run() {
                selectVrmFile();
            }

            @Override
            public String getToolTipText() {
                return "Select a .vrm model file to display";
            }
        });

        toolbar.add(new Separator());

        toolbar.add(new Action("Reload") {
            @Override
            public void run() {
                loadPage();
            }

            @Override
            public String getToolTipText() {
                return "Reload the companion view";
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Page loading
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Reads {@code web/index.html} and {@code web/companion.js} from the plugin
     * bundle and combines them into a single HTML document that is then set via
     * {@link Browser#setText(String, boolean)}.  This avoids any cross-origin or
     * file-URL issues when the plugin is packaged as a JAR.
     */
    private void loadPage() {
        try {
            Bundle bundle = Activator.getDefault().getBundle();
            String html = readBundleResource(bundle, "web/index.html");
            String js   = readBundleResource(bundle, "web/companion.js");

            // Inline the JS module so no relative src="" lookup is needed
            String combined = html.replace(
                    "<script type=\"module\" src=\"companion.js\"></script>",
                    "<script type=\"module\">\n" + js + "\n</script>");

            browser.setText(combined, true);
        } catch (IOException e) {
            browser.setText(fallbackHtml(), true);
            log("Could not load web resources: " + e.getMessage());
        }
    }

    private static String readBundleResource(Bundle bundle, String path) throws IOException {
        try (InputStream is = bundle.getEntry(path).openStream()) {
            return new String(is.readAllBytes(), StandardCharsets.UTF_8);
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // VRM file selection & transfer
    // ─────────────────────────────────────────────────────────────────────────

    private void selectVrmFile() {
        FileDialog dialog = new FileDialog(browser.getShell(), SWT.OPEN);
        dialog.setFilterNames(new String[]{"VRM Files (*.vrm)", "All Files (*.*)"});
        dialog.setFilterExtensions(new String[]{"*.vrm", "*.*"});
        dialog.setText("Select VRM Model File");

        // Pre-fill with previously used directory
        IPreferenceStore store = Activator.getDefault().getPreferenceStore();
        String last = store.getString(Activator.PREF_SELECTED_VRM);
        if (last != null && !last.isBlank()) {
            dialog.setFilterPath(new File(last).getParent());
        }

        String path = dialog.open();
        if (path != null) {
            store.setValue(Activator.PREF_SELECTED_VRM, path);
            sendVrmToBrowser(path);
        }
    }

    /**
     * Reads the VRM file, base64-encodes it, and transfers it to the browser in
     * 512 KB chunks to avoid JavaScript string-length limits.
     */
    private void sendVrmToBrowser(String filePath) {
        File file = new File(filePath);
        if (!file.exists() || !file.isFile()) {
            return;
        }

        Display.getCurrent().asyncExec(() -> {
            try {
                byte[] bytes = Files.readAllBytes(file.toPath());
                String b64 = Base64.getEncoder().encodeToString(bytes);

                browser.execute("companion.loadVrmBegin()");

                for (int offset = 0; offset < b64.length(); offset += CHUNK_SIZE) {
                    String chunk = b64.substring(offset,
                            Math.min(offset + CHUNK_SIZE, b64.length()));
                    // Escape backslashes and single quotes just in case
                    String safe = chunk.replace("\\", "\\\\").replace("'", "\\'");
                    browser.execute("companion.loadVrmChunk('" + safe + "')");
                }

                browser.execute("companion.loadVrmEnd()");

            } catch (IOException e) {
                showError("Could not load VRM file", e);
            }
        });
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Public API – forward IDE events to the companion
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Sets the companion's visual state (e.g. THINKING, HAPPY, ERROR).
     * Safe to call from any thread.
     */
    public void setState(String state) {
        runInBrowser("companion.setState('" + escapeJs(state) + "')");
    }

    /**
     * Triggers a reaction with an intensity value between 0.0 and 1.0.
     * Safe to call from any thread.
     */
    public void react(String state, double intensity) {
        runInBrowser("companion.react('" + escapeJs(state) + "'," + intensity + ")");
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Helpers
    // ─────────────────────────────────────────────────────────────────────────

    private void runInBrowser(String script) {
        if (browser == null || browser.isDisposed()) return;
        Display display = browser.getDisplay();
        if (display.getThread() == Thread.currentThread()) {
            browser.execute(script);
        } else {
            display.asyncExec(() -> browser.execute(script));
        }
    }

    private static String escapeJs(String s) {
        return s.replace("\\", "\\\\").replace("'", "\\'");
    }

    private void showError(String message, Exception e) {
        Display.getCurrent().asyncExec(() ->
            ErrorDialog.openError(
                browser.getShell(),
                "AI Companion",
                message,
                new Status(IStatus.ERROR, Activator.PLUGIN_ID, e.getMessage(), e)));
    }

    private static void log(String message) {
        System.err.println("[Companion] " + message);
    }

    private static String fallbackHtml() {
        return """
                <!DOCTYPE html>
                <html>
                <body style="background:#1a1a2e;color:#a0c4ff;font-family:sans-serif;
                             display:flex;justify-content:center;align-items:center;
                             height:100vh;margin:0;text-align:center">
                  <div>
                    <h2>AI Companion</h2>
                    <p>Web resources could not be loaded.</p>
                    <p style="font-size:12px;opacity:.7">Check the plugin installation.</p>
                  </div>
                </body>
                </html>
                """;
    }
}
