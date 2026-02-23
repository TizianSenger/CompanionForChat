# AI Companion – Eclipse Plugin

A visual 3D avatar companion for Eclipse IDE.  
The avatar is rendered in an embedded WebView using **Three.js** and **@pixiv/three-vrm**.  
It displays a VRM model, plays a gentle idle animation, and reacts with random animations when clicked.

---

## Features

| Feature | Status |
|---|---|
| SWT Browser WebGL scene (Three.js) | ✅ |
| VRM model loading from local file | ✅ |
| Toolbar button to select a `.vrm` file | ✅ |
| Procedural click animations (8 variants) | ✅ |
| Idle breathing / head movement | ✅ |
| VRM blinking (expression manager) | ✅ |
| Java → JS bridge (`setState` / `react`) | ✅ |
| Chunked base64 transfer for large VRM files | ✅ |
| Orbit controls (mouse drag to orbit) | ✅ |
| Preference page for default VRM path | ✅ |

---

## Requirements

| Requirement | Notes |
|---|---|
| **Eclipse for RCP and RAP Developers** 2023-09 or later | Includes SWT with Chromium support |
| **Java 21** | Configured as the project JRE |
| **Internet access** (first run) | Three.js and @pixiv/three-vrm are loaded from jsDelivr CDN |

For **offline use**, download the following files and place them in `web/`, then update the paths in `web/index.html`:

```
web/three.module.js        ← https://cdn.jsdelivr.net/npm/three@0.163.0/build/three.module.js
web/addons/                ← https://cdn.jsdelivr.net/npm/three@0.163.0/examples/jsm/
web/three-vrm.module.js    ← https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@2.1.2/lib/three-vrm.module.js
```

---

## Opening the Project in Eclipse

1. **Import** the project:  
   *File → Import → General → Existing Projects into Workspace*  
   Select the `com.example.ai.companion` folder.

2. **Verify Target Platform** contains `org.eclipse.ui`, `org.eclipse.swt`, and `org.eclipse.jface`  
   (they ship with every Eclipse for RCP and RAP Developers installation).

3. **Open the view**:  
   *Window → Show View → Other… → AI Companion → AI Companion*

4. Click **Select VRM File** in the view toolbar and choose a `.vrm` file.  
   Free VRM avatars are available at [VRoid Hub](https://hub.vroid.com/).

---

## Exporting as a JAR (drop-in plugin)

1. Right-click the project → *Export… → Plug-in Development → Deployable plug-ins and fragments*.
2. Set the destination to `<ECLIPSE_HOME>/dropins/`.
3. Restart Eclipse.

The plugin will be automatically discovered via the dropins mechanism.

```
ECLIPSE_HOME/dropins/
└── com.example.ai.companion_1.0.0.jar
```

---

## Extending the Plugin

### Connecting to an existing LLM plugin

Call these methods from your LLM event listeners:

```java
// Obtain the view
IViewPart view = PlatformUI.getWorkbench()
    .getActiveWorkbenchWindow()
    .getActivePage()
    .findView(CompanionView.ID);

if (view instanceof CompanionView companion) {
    companion.setState("THINKING");   // LLM request started
    companion.setState("RESPONDING"); // Answer received
    companion.react("ERROR", 0.9);    // LLM error
}
```

### Available states

`IDLE` · `THINKING` · `RESPONDING` · `HAPPY` · `CONFUSED` · `ERROR` · `TIRED` · `FOCUSED`

### Click animations

`spin` · `jump` · `shake` · `nod` · `dance` · `wave` · `bounce` · `wiggle`

---

## Architecture

```
Eclipse IDE
│
├── com.example.ai.companion (this plugin)
│   ├── CompanionView (ViewPart)
│   │   └── SWT Browser
│   │       └── index.html  (inlined with companion.js at runtime)
│   │           ├── Three.js scene
│   │           ├── @pixiv/three-vrm  (VRM loader)
│   │           └── companion.js  (state machine + animations)
│   │
│   ├── Activator  (OSGi lifecycle + preference store)
│   └── VrmPreferencePage  (Window → Preferences → AI Companion)
│
└── Your LLM / Stats plugin  →  companion.setState("HAPPY")
```
