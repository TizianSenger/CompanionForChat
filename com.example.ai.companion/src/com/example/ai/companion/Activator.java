package com.example.ai.companion;

import org.eclipse.jface.preference.IPreferenceStore;
import org.eclipse.ui.plugin.AbstractUIPlugin;
import org.osgi.framework.BundleContext;

/**
 * Plugin activator – manages lifecycle and shared preference store.
 */
public class Activator extends AbstractUIPlugin {

    public static final String PLUGIN_ID = "com.example.ai.companion";

    /** Preference key: path of the currently selected VRM file. */
    public static final String PREF_SELECTED_VRM = "selected_vrm";

    private static Activator plugin;

    @Override
    public void start(BundleContext context) throws Exception {
        super.start(context);
        plugin = this;
    }

    @Override
    public void stop(BundleContext context) throws Exception {
        plugin = null;
        super.stop(context);
    }

    public static Activator getDefault() {
        return plugin;
    }

    @Override
    protected void initializeDefaultPreferences(IPreferenceStore store) {
        store.setDefault(PREF_SELECTED_VRM, "");
    }
}
