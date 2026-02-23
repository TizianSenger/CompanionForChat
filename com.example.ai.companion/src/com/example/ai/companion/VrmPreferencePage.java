package com.example.ai.companion;

import org.eclipse.jface.preference.FieldEditorPreferencePage;
import org.eclipse.jface.preference.FileFieldEditor;
import org.eclipse.ui.IWorkbench;
import org.eclipse.ui.IWorkbenchPreferencePage;

/**
 * Preference page: Window → Preferences → AI Companion.
 *
 * Lets the user browse to a default VRM file that will be loaded
 * automatically when the Companion view is opened.
 */
public class VrmPreferencePage extends FieldEditorPreferencePage
        implements IWorkbenchPreferencePage {

    public VrmPreferencePage() {
        super(GRID);
        setPreferenceStore(Activator.getDefault().getPreferenceStore());
        setDescription("Configure the AI Companion VRM avatar model.");
    }

    @Override
    protected void createFieldEditors() {
        addField(new FileFieldEditor(
                Activator.PREF_SELECTED_VRM,
                "VRM Model File:",
                getFieldEditorParent()));
    }

    @Override
    public void init(IWorkbench workbench) {
        // nothing to initialise
    }
}
