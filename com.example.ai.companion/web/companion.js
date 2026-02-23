/**
 * companion.js – Three.js + @pixiv/three-vrm companion scene.
 *
 * Loaded as an ES module (either directly or inlined by CompanionView.java).
 *
 * Public API exposed on window.companion:
 *   loadVrmBegin()          – start a chunked VRM transfer
 *   loadVrmChunk(b64)       – append a base64 chunk
 *   loadVrmEnd()            – finish transfer and load the model
 *   setState(state)         – set companion state (IDLE|THINKING|HAPPY|…)
 *   react(state, intensity) – play a state reaction with given intensity 0–1
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { VRMLoaderPlugin, VRMUtils } from '@pixiv/three-vrm';

// ─────────────────────────────────────────────────────────────────────────────
// DOM refs
// ─────────────────────────────────────────────────────────────────────────────
const loadingEl = document.getElementById('loading');
const statusEl  = document.getElementById('status');
const noVrmEl   = document.getElementById('no-vrm');
const errorEl   = document.getElementById('error');
const errorMsg  = document.getElementById('error-msg');

// ─────────────────────────────────────────────────────────────────────────────
// Renderer
// ─────────────────────────────────────────────────────────────────────────────
let renderer;
try {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
} catch (e) {
  showError('WebGL initialization failed: ' + e.message);
  throw e;
}
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// ─────────────────────────────────────────────────────────────────────────────
// Scene, camera, lighting
// ─────────────────────────────────────────────────────────────────────────────
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
    30, window.innerWidth / window.innerHeight, 0.1, 100);
camera.position.set(0, 1.25, 4.0);
camera.lookAt(0, 1.0, 0);

scene.add(new THREE.AmbientLight(0x8899cc, 1.8));

const dirLight = new THREE.DirectionalLight(0xc0d8ff, 2.2);
dirLight.position.set(1.5, 3, 2);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xffd6a5, 0.9);
fillLight.position.set(-2, 0.5, -1);
scene.add(fillLight);

// ─────────────────────────────────────────────────────────────────────────────
// Orbit controls (mouse drag to rotate)
// ─────────────────────────────────────────────────────────────────────────────
const controls = new OrbitControls(camera, renderer.domElement);
controls.target.set(0, 1.0, 0);
controls.enablePan = false;
controls.minDistance = 1.0;
controls.maxDistance = 9.0;
controls.maxPolarAngle = Math.PI * 0.82;
controls.update();

// ─────────────────────────────────────────────────────────────────────────────
// Floor + glow ring
// ─────────────────────────────────────────────────────────────────────────────
const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.5, 72),
    new THREE.MeshStandardMaterial({
        color: 0x111130, roughness: 0.9, metalness: 0.1,
        transparent: true, opacity: 0.55
    }));
floor.rotation.x = -Math.PI / 2;
scene.add(floor);

const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.42, 0.48, 72),
    new THREE.MeshBasicMaterial({
        color: 0x4488ff, transparent: true, opacity: 0.6,
        side: THREE.DoubleSide
    }));
ring.rotation.x = -Math.PI / 2;
ring.position.y = 0.005;
scene.add(ring);

// ─────────────────────────────────────────────────────────────────────────────
// Placeholder model (shown when no VRM is loaded)
// ─────────────────────────────────────────────────────────────────────────────
const placeholder = new THREE.Group();

const torso = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.28, 0.7, 8, 16),
    new THREE.MeshStandardMaterial({ color: 0x5577bb, roughness: 0.5, metalness: 0.3 }));
torso.position.y = 0.82;
placeholder.add(torso);

const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.21, 20, 20),
    new THREE.MeshStandardMaterial({ color: 0xffccaa, roughness: 0.5 }));
head.position.y = 1.55;
placeholder.add(head);

const eyeGeo = new THREE.SphereGeometry(0.038, 8, 8);
const eyeMat = new THREE.MeshBasicMaterial({ color: 0x222233 });
const eyeL = new THREE.Mesh(eyeGeo, eyeMat);
eyeL.position.set(-0.085, 1.565, 0.185);
const eyeR = new THREE.Mesh(eyeGeo, eyeMat);
eyeR.position.set( 0.085, 1.565, 0.185);
placeholder.add(eyeL, eyeR);

scene.add(placeholder);

// ─────────────────────────────────────────────────────────────────────────────
// State
// ─────────────────────────────────────────────────────────────────────────────
/** @type {import('@pixiv/three-vrm').VRM|null} */
let vrm = null;

const clock = new THREE.Clock();
let elapsed = 0;

// Base transform restored after each animation
const basePos = new THREE.Vector3();
const baseRot = new THREE.Euler();

// Animation state machine
const anim = {
    active:    false,
    type:      '',
    startTime: 0,
    duration:  1.0,
    startPos:  new THREE.Vector3(),
    startRot:  new THREE.Euler(),
};
let animLocked = false;

// ─────────────────────────────────────────────────────────────────────────────
// Available animations (triggered on click or setState)
// ─────────────────────────────────────────────────────────────────────────────
const CLICK_ANIMATIONS = ['spin', 'jump', 'shake', 'nod', 'dance', 'wave', 'bounce', 'wiggle'];

const ANIM_DURATION = {
    spin: 1.2, jump: 0.9, shake: 0.7, nod: 0.9,
    dance: 2.2, wave: 1.6, bounce: 1.1, wiggle: 0.8,
    thinking: 0, responding: 0, happy: 0, error: 0,   // continuous states
};

// ─────────────────────────────────────────────────────────────────────────────
// VRM loader (GLTFLoader + VRMLoaderPlugin)
// ─────────────────────────────────────────────────────────────────────────────
const gltfLoader = new GLTFLoader();
gltfLoader.register(parser => new VRMLoaderPlugin(parser));

// Chunked-transfer buffers
let _chunks = [];

function _loadVrmFromBase64(b64) {
    setStatus('Decoding VRM…');
    try {
        const bin  = atob(b64);
        const buf  = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        const blob = new Blob([buf], { type: 'application/octet-stream' });
        const url  = URL.createObjectURL(blob);
        _loadVrmFromUrl(url, true);
    } catch (e) {
        setStatus('Decode error: ' + e.message);
        showLoading(false);
    }
}

function _loadVrmFromUrl(url, revokeAfter = false) {
    showLoading(true);
    setStatus('Loading VRM model…');

    if (vrm) {
        scene.remove(vrm.scene);
        VRMUtils.deepDispose(vrm.scene);
        vrm = null;
    }
    noVrmEl.style.display = 'none';
    placeholder.visible = false;

    gltfLoader.load(
        url,
        gltf => {
            const loaded = gltf.userData.vrm;
            if (!loaded) {
                setStatus('File is not a valid VRM.');
                placeholder.visible = true;
                showLoading(false);
                return;
            }

            // Normalize VRM 0.x orientation
            VRMUtils.rotateVRM0(loaded);
            vrm = loaded;
            scene.add(vrm.scene);

            // Center at origin
            const box = new THREE.Box3().setFromObject(vrm.scene);
            const c   = box.getCenter(new THREE.Vector3());
            vrm.scene.position.sub(c);
            vrm.scene.position.y = -box.min.y + c.y;

            basePos.copy(vrm.scene.position);
            baseRot.copy(vrm.scene.rotation);

            showLoading(false);
            setStatus('Click the model to trigger animations!');
            if (revokeAfter) URL.revokeObjectURL(url);
        },
        xhr => {
            const pct = xhr.total
                ? ((xhr.loaded / xhr.total) * 100).toFixed(0) + '%'
                : (xhr.loaded / 1024).toFixed(0) + ' KB';
            setStatus('Loading: ' + pct);
        },
        err => {
            setStatus('Failed: ' + (err.message || err));
            placeholder.visible = true;
            showLoading(false);
            if (revokeAfter) URL.revokeObjectURL(url);
        }
    );
}

// ─────────────────────────────────────────────────────────────────────────────
// Public API (window.companion)
// ─────────────────────────────────────────────────────────────────────────────
window.companion = {

    /** Begin a chunked VRM transfer. */
    loadVrmBegin() {
        _chunks = [];
        showLoading(true);
        setStatus('Receiving VRM data…');
    },

    /** Append a base64 chunk. */
    loadVrmChunk(chunk) {
        _chunks.push(chunk);
    },

    /** Finish transfer and load the model. */
    loadVrmEnd() {
        const b64 = _chunks.join('');
        _chunks = [];
        _loadVrmFromBase64(b64);
    },

    /**
     * Load a VRM directly from a URL (e.g. for testing).
     * @param {string} url
     */
    loadVrmFromUrl(url) {
        _loadVrmFromUrl(url);
    },

    /**
     * Set companion state – maps IDE/LLM events to animations.
     * @param {'IDLE'|'THINKING'|'RESPONDING'|'HAPPY'|'CONFUSED'|'ERROR'|'TIRED'|'FOCUSED'} state
     */
    setState(state) {
        setStatus(state);
        switch (state.toUpperCase()) {
            case 'THINKING':   playAnimation('nod');    break;
            case 'RESPONDING': playAnimation('wave');   break;
            case 'HAPPY':      playAnimation('jump');   break;
            case 'ERROR':      playAnimation('shake');  break;
            case 'TIRED':      playAnimation('wiggle'); break;
            case 'FOCUSED':    playAnimation('dance');  break;
            case 'CONFUSED':   playAnimation('spin');   break;
            default:           /* IDLE – let idle loop handle it */
        }
    },

    /**
     * Trigger a reaction with intensity (0–1).
     * @param {string} state
     * @param {number} intensity
     */
    react(state, intensity) {
        this.setState(state);
    },
};

// ─────────────────────────────────────────────────────────────────────────────
// Click → random animation
// ─────────────────────────────────────────────────────────────────────────────
const raycaster = new THREE.Raycaster();
const mouse     = new THREE.Vector2();

renderer.domElement.addEventListener('click', e => {
    mouse.x =  (e.clientX / window.innerWidth)  * 2 - 1;
    mouse.y = -(e.clientY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouse, camera);

    const target = vrm ? vrm.scene : placeholder;
    if (raycaster.intersectObject(target, true).length > 0) {
        const name = CLICK_ANIMATIONS[Math.floor(Math.random() * CLICK_ANIMATIONS.length)];
        playAnimation(name);
    }
});

// ─────────────────────────────────────────────────────────────────────────────
// Animation system (procedural, no external clips needed)
// ─────────────────────────────────────────────────────────────────────────────
function playAnimation(type) {
    if (animLocked) return;
    const obj = vrm ? vrm.scene : placeholder;
    if (!obj) return;

    animLocked = true;
    anim.active    = true;
    anim.type      = type;
    anim.startTime = elapsed;
    anim.duration  = ANIM_DURATION[type] ?? 1.0;
    anim.startPos.copy(obj.position);
    anim.startRot.copy(obj.rotation);

    if (typeof javaLog === 'function') javaLog('anim:' + type);
    setStatus('▶ ' + type);
}

function updateAnimation() {
    if (!anim.active) return;
    const obj = vrm ? vrm.scene : placeholder;
    if (!obj) return;

    const t = Math.min((elapsed - anim.startTime) / anim.duration, 1.0);
    const e = easeInOut(t);

    switch (anim.type) {
        case 'spin':
            obj.rotation.y = anim.startRot.y + e * Math.PI * 2;
            break;

        case 'jump': {
            const h = Math.sin(t * Math.PI) * 0.55;
            obj.position.y = anim.startPos.y + h;
            const s = 1 + Math.sin(t * Math.PI) * 0.15;
            obj.scale.set(1 / s, s, 1 / s);
            break;
        }

        case 'shake':
            obj.rotation.y = anim.startRot.y + Math.sin(t * Math.PI * 8) * 0.35 * (1 - t);
            break;

        case 'nod':
            _boneOrFallback('head', bone => {
                bone.rotation.x = Math.sin(t * Math.PI * 3) * 0.35 * (1 - t * 0.4);
            }, () => {
                obj.rotation.x = Math.sin(t * Math.PI * 3) * 0.18 * (1 - t);
            });
            break;

        case 'dance': {
            const dt = t * Math.PI * 5;
            obj.rotation.y = anim.startRot.y + Math.sin(dt) * 0.45;
            obj.position.y = anim.startPos.y + Math.abs(Math.sin(dt * 0.5)) * 0.22;
            break;
        }

        case 'wave':
            _boneOrFallback('rightUpperArm', bone => {
                bone.rotation.z = -(Math.PI / 4) - Math.sin(t * Math.PI * 4) * 0.55 * Math.sin(t * Math.PI);
            }, () => {
                obj.rotation.z = Math.sin(t * Math.PI * 4) * 0.22 * Math.sin(t * Math.PI);
            });
            break;

        case 'bounce': {
            const b = Math.abs(Math.sin(t * Math.PI * 4)) * (1 - t);
            obj.position.y = anim.startPos.y + b * 0.32;
            break;
        }

        case 'wiggle':
            obj.rotation.z = anim.startRot.z + Math.sin(t * Math.PI * 6) * 0.2 * (1 - t);
            obj.position.y = anim.startPos.y + Math.sin(t * Math.PI * 6) * 0.08 * (1 - t);
            break;
    }

    if (t >= 1.0) {
        // Restore transforms
        obj.position.copy(basePos);
        obj.rotation.copy(baseRot);
        obj.scale.set(1, 1, 1);

        // Reset VRM pose
        if (vrm?.humanoid) vrm.humanoid.resetNormalizedPose();

        anim.active = false;
        animLocked  = false;
        setStatus('Click the model to trigger animations!');
    }
}

/** Applies fn to a named humanoid bone; falls back to fallbackFn if not available. */
function _boneOrFallback(boneName, fn, fallbackFn) {
    if (vrm?.humanoid) {
        const bone = vrm.humanoid.getNormalizedBoneNode(boneName);
        if (bone) { fn(bone); return; }
    }
    fallbackFn();
}

// ─────────────────────────────────────────────────────────────────────────────
// Idle animation (breathing / gentle sway)
// ─────────────────────────────────────────────────────────────────────────────
function updateIdle() {
    if (animLocked) return;
    const obj = vrm ? vrm.scene : placeholder;
    if (!obj) return;

    const breathe = Math.sin(elapsed * 1.4) * 0.012;
    obj.position.y = basePos.y + breathe;
    obj.rotation.y = baseRot.y + Math.sin(elapsed * 0.28) * 0.06;

    if (vrm?.humanoid) {
        const headBone = vrm.humanoid.getNormalizedBoneNode('head');
        if (headBone) {
            headBone.rotation.y = Math.sin(elapsed * 0.45) * 0.12;
            headBone.rotation.x = Math.sin(elapsed * 0.65) * 0.06;
        }
    } else {
        // Placeholder – bob the head mesh independently
        head.position.y = 1.55 + breathe * 2.2;
    }

    // Blinking (VRM expression manager)
    if (vrm?.expressionManager) {
        const phase = (elapsed % 4.5) / 4.5;
        const blink = phase > 0.92
            ? Math.sin(((phase - 0.92) / 0.08) * Math.PI)
            : 0;
        vrm.expressionManager.setValue('blink', blink);
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Glow ring pulse
// ─────────────────────────────────────────────────────────────────────────────
function updateRing() {
    const p = 0.5 + Math.sin(elapsed * 1.8) * 0.35;
    ring.material.opacity = 0.25 + p * 0.35;
    const s = 1 + Math.sin(elapsed * 1.8) * 0.04;
    ring.scale.set(s, s, 1);
}

// ─────────────────────────────────────────────────────────────────────────────
// Resize
// ─────────────────────────────────────────────────────────────────────────────
window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
function easeInOut(t) {
    return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
}

function setStatus(msg) {
    if (statusEl) statusEl.textContent = msg;
}

function showLoading(visible) {
    if (!loadingEl) return;
    if (visible) {
        loadingEl.classList.remove('hidden');
        loadingEl.style.display = 'flex';
    } else {
        loadingEl.classList.add('hidden');
        setTimeout(() => { loadingEl.style.display = 'none'; }, 650);
    }
}

function showError(msg) {
    if (errorMsg) errorMsg.textContent = msg;
    if (errorEl)  errorEl.style.display = 'flex';
}

// ─────────────────────────────────────────────────────────────────────────────
// Main render loop
// ─────────────────────────────────────────────────────────────────────────────
function animate() {
    requestAnimationFrame(animate);

    const delta = clock.getDelta();
    elapsed += delta;

    if (vrm) vrm.update(delta);

    updateAnimation();
    updateIdle();
    updateRing();
    controls.update();

    renderer.render(scene, camera);
}

// ─────────────────────────────────────────────────────────────────────────────
// Initialise
// ─────────────────────────────────────────────────────────────────────────────
showLoading(false);
noVrmEl.style.display = 'block';
basePos.copy(placeholder.position);
baseRot.copy(placeholder.rotation);
setStatus('Ready – Select a VRM file from the toolbar');

animate();
