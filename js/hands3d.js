// 3D hands: a skinned mesh (WebXR "generic hand", MIT) posed by rotating its
// finger bones. The model's bones are a flat list (made for VR tracking), so
// we do the forward kinematics ourselves: rotating a joint carries every bone
// beyond it. Same stage API as hands.js (lockIn / startShake / reveal / reset).
import * as THREE from 'three';
import {GLTFLoader} from 'three/addons/loaders/GLTFLoader.js';

const MODEL_BASE =
  'https://cdn.jsdelivr.net/npm/@webxr-input-profiles/assets@1.0.20/dist/profiles/generic-hand/';

const FINGERS = ['index', 'middle', 'ring', 'pinky'];
const SEGMENTS = ['metacarpal', 'phalanx-proximal', 'phalanx-intermediate', 'phalanx-distal', 'tip'];
const fingerBones = (f) => SEGMENTS.map((s) => `${f}-finger-${s}`);
const THUMB = ['thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'];

// Bend per joint (radians) at curl = 1: knuckle, middle joint, fingertip joint.
const CURL = [1.5, 1.9, 1.2];

// curl per finger [index, middle, ring, pinky]; spread per finger (radians,
// + = toward the pinky side); thumb fold 0..1.
const POSES = {
  open:     {curl: [0, 0, 0, 0],     spread: [-0.1, -0.03, 0.04, 0.12], thumb: 0},
  paper:    {curl: [0, 0, 0, 0],     spread: [-0.1, -0.03, 0.04, 0.12], thumb: 0},
  rock:     {curl: [1, 1, 1, 1],     spread: [0, 0, 0, 0],              thumb: 1},
  scissors: {curl: [0, 0, 1, 1],     spread: [-0.2, 0.2, 0, 0],         thumb: 1},
};

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

class Hand3D {
  constructor(gltf, {cuffColor, side}) {
    this.side = side;
    this.root = new THREE.Group();
    this.pivot = new THREE.Group();
    this.root.add(this.pivot);
    this.pivot.add(gltf.scene);

    this.bones = {};
    gltf.scene.traverse((o) => {
      if (o.isBone) this.bones[o.name] = o;
      if (o.isSkinnedMesh) this.mesh = o;
    });
    this.mesh.frustumCulled = false;
    this.material = new THREE.MeshStandardMaterial({color: 0xe8b890, roughness: 0.55, metalness: 0});
    this.mesh.material = this.material;
    this.baseColor = this.material.color.clone();

    this.rest = {};
    for (const [n, b] of Object.entries(this.bones)) {
      this.rest[n] = {p: b.position.clone(), q: b.quaternion.clone()};
    }
    this.#measure();
    this.#orient();

    // sleeve, so the hand does not float
    const cuff = new THREE.Mesh(
      new THREE.CylinderGeometry(0.036, 0.046, 0.075, 32),
      new THREE.MeshStandardMaterial({color: cuffColor, roughness: 0.7}),
    );
    cuff.position.set(0, -0.032, -0.004);
    this.root.add(cuff);

    this.curlAngles = [...CURL];
    this.thumbOffset = {p: 0.045, d: -0.006, a: 0.004};
    this.cur = structuredClone(POSES.open);
    this.target = structuredClone(POSES.open);
    this.appear = 0;
    this.appearTarget = 0;
    this.lift = 0;
    this.applyPose();
  }

  // Work out hand axes from the rest pose so left and right models both work.
  #measure() {
    const P = (n) => this.rest[n].p;
    const d = V();
    for (const f of FINGERS) {
      const b = fingerBones(f);
      d.add(P(b[4]).clone().sub(P(b[0])));
    }
    d.normalize(); // wrist -> fingertips

    const a = P('pinky-finger-phalanx-proximal').clone().sub(P('index-finger-phalanx-proximal'));
    a.addScaledVector(d, -a.dot(d)).normalize(); // index -> pinky

    const drift = V();
    for (const f of FINGERS) {
      const b = fingerBones(f);
      drift.add(P(b[4]).clone().sub(P(b[1])));
    }
    drift.addScaledVector(d, -drift.dot(d));
    drift.addScaledVector(a, -drift.dot(a));
    const p = drift.normalize(); // palm side: where relaxed fingers drift

    this.axes = {d, a, p};
    this.curlAxis = d.clone().cross(p).normalize(); // rotating d about this moves it toward p
    this.spreadSign = Math.sign(p.clone().cross(d).dot(a)) || 1;
  }

  // Rotate the whole model so fingers point up and the palm faces the camera (+z).
  #orient() {
    const {d, p} = this.axes;
    const e3 = d.clone().cross(p);
    const S = new THREE.Matrix4().makeBasis(d, p, e3);
    const T = new THREE.Matrix4().makeBasis(V(0, 1, 0), V(0, 0, 1), V(1, 0, 0));
    const M = new THREE.Matrix4().multiplyMatrices(T, S.clone().transpose());
    this.pivot.quaternion.setFromRotationMatrix(M);
    this.pivot.position.copy(this.rest.wrist.p).applyMatrix4(M).negate();
  }

  #rotate(names, from, pivotPos, axis, angle) {
    return this.#rotateQ(names, from, pivotPos, new THREE.Quaternion().setFromAxisAngle(axis, angle));
  }

  #rotateQ(names, from, pivotPos, q) {
    for (let i = from; i < names.length; i++) {
      const b = this.bones[names[i]];
      b.position.sub(pivotPos).applyQuaternion(q).add(pivotPos);
      b.quaternion.premultiply(q);
    }
    return q;
  }

  applyPose() {
    for (const [n, b] of Object.entries(this.bones)) {
      b.position.copy(this.rest[n].p);
      b.quaternion.copy(this.rest[n].q);
    }
    const {d, p} = this.axes;
    const {curl, spread, thumb} = this.cur;

    FINGERS.forEach((f, i) => {
      const names = fingerBones(f);
      let axis = this.curlAxis.clone();
      const knuckle = this.bones[names[1]].position.clone();
      if (spread[i]) {
        const q = this.#rotate(names, 1, knuckle, p, spread[i] * this.spreadSign);
        axis.applyQuaternion(q);
      }
      for (let j = 1; j <= 3; j++) {
        this.#rotate(names, j, this.bones[names[j]].position.clone(), axis, this.curlAngles[j - 1] * curl[i]);
      }
    });

    if (thumb > 0) {
      // Bend the thumb (CCD inverse kinematics) until its tip rests on the curled fingers.
      const {a} = this.axes;
      const mid = this.rest['middle-finger-phalanx-proximal'].p;
      const goal = mid.clone()
        .addScaledVector(p, this.thumbOffset.p)
        .addScaledVector(d, this.thumbOffset.d)
        .addScaledVector(a, this.thumbOffset.a);
      const aim = this.bones[THUMB[3]].position.clone().lerp(goal, thumb);
      const tipBone = this.bones[THUMB[3]];
      for (let iter = 0; iter < 14; iter++) {
        for (const j of [2, 1, 0]) {
          const pivot = this.bones[THUMB[j]].position.clone();
          const q = new THREE.Quaternion().setFromUnitVectors(
            tipBone.position.clone().sub(pivot).normalize(),
            aim.clone().sub(pivot).normalize(),
          );
          this.#rotateQ(THUMB, j, pivot, q);
        }
      }
    }
  }

  setPose(name) {
    this.target = structuredClone(POSES[name]);
  }

  step(dt) {
    const k = 1 - Math.exp(-dt * 13);
    let moving = false;
    const lerp = (a, b) => { const v = a + (b - a) * k; if (Math.abs(b - v) > 1e-4) moving = true; return Math.abs(b - v) > 1e-4 ? v : b; };
    this.cur.curl = this.cur.curl.map((v, i) => lerp(v, this.target.curl[i]));
    this.cur.spread = this.cur.spread.map((v, i) => lerp(v, this.target.spread[i]));
    this.cur.thumb = lerp(this.cur.thumb, this.target.thumb);
    this.appear = this.appear + (this.appearTarget - this.appear) * (1 - Math.exp(-dt * 10));
    if (moving || this._dirty) { this.applyPose(); this._dirty = false; }
  }

  setResult(result) {
    const m = this.material;
    m.emissive.set(result === 'win' ? 0xffe2b0 : 0x000000);
    m.emissiveIntensity = result === 'win' ? 0.22 : 0;
    m.color.copy(this.baseColor);
    if (result === 'lose') m.color.multiplyScalar(0.55);
    this.resultScale = result === 'win' ? 1.12 : result === 'lose' ? 0.92 : 1;
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const PUMP_S = 0.45;
const MIN_PUMPS = 3;

export class HandStage3D {
  static async create(canvas) {
    const loader = new GLTFLoader();
    const [right, left] = await Promise.all([
      loader.loadAsync(`${MODEL_BASE}right.glb`),
      loader.loadAsync(`${MODEL_BASE}left.glb`),
    ]);
    return new HandStage3D(canvas, {right, left});
  }

  constructor(canvas, {right, left}) {
    this.canvas = canvas;
    this.slow = 1;
    this.renderer = new THREE.WebGLRenderer({canvas, antialias: true, alpha: true});
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.01, 5);
    this.camera.position.set(0, 0.07, 0.62);
    this.camera.lookAt(0, 0.07, 0);

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.1));
    const key = new THREE.DirectionalLight(0xffffff, 2.1);
    key.position.set(0.3, 0.6, 0.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0xaabbff, 1.0);
    rim.position.set(-0.6, 0.3, -0.5);
    this.scene.add(rim);

    this.hands = {
      me: new Hand3D(left, {cuffColor: 0x4f46e5, side: 'me'}),
      them: new Hand3D(right, {cuffColor: 0xe11d74, side: 'them'}),
    };
    this.hands.me.root.position.x = -0.1;
    this.hands.them.root.position.x = 0.1;
    this.hands.me.root.rotation.set(0, 0.28, -0.14);
    this.hands.them.root.rotation.set(0, -0.28, 0.14);
    this.scene.add(this.hands.me.root, this.hands.them.root);

    this.pumpT = 0;
    this.pumping = false;
    this.pending = null;
    this.last = performance.now();
    new ResizeObserver(() => this.#resize()).observe(canvas);
    this.#resize();
    this.reset();
    this.renderer.setAnimationLoop(() => this.#tick());
  }

  #resize() {
    const w = this.canvas.clientWidth || 600;
    const h = this.canvas.clientHeight || 360;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  #tick() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000) / this.slow;
    this.last = now;

    if (this.pumping) this.pumpT += dt;
    if (this.pending && this.pumpT >= this.pending.until) {
      this.pumping = false;
      const {resolve} = this.pending;
      this.pending = null;
      resolve();
    }
    const phase = this.pumping || this.pending ? (this.pumpT % PUMP_S) / PUMP_S : 0;
    const lift = this.pumping ? 0.045 * (1 - Math.cos(phase * Math.PI * 2)) / 2 : 0;

    for (const h of Object.values(this.hands)) {
      h.step(dt);
      const s = Math.max(0.001, h.appear) * (h.resultScale ?? 1);
      h.root.scale.setScalar(s);
      h.root.visible = h.appear > 0.01;
      h.root.position.y = -0.05 * (1 - h.appear) + lift;
    }
    this.renderer.render(this.scene, this.camera);
  }

  setSlow(f) { this.slow = f; }
  #ms(n) { return n * this.slow; }

  reset() {
    this.pumping = false;
    this.pending = null;
    this.pumpT = 0;
    for (const h of Object.values(this.hands)) {
      h.appearTarget = 0;
      h.appear = 0;
      h.setPose('open');
      h.cur = structuredClone(POSES.open);
      h.setResult(null);
      h.resultScale = 1;
      h._dirty = true;
    }
  }

  async lockIn(side) {
    const h = this.hands[side];
    h.setPose('open');
    h.appearTarget = 1;
    await sleep(this.#ms(450));
    h.setPose('rock');
    await sleep(this.#ms(400));
  }

  startShake() {
    if (this.pumping) return;
    this.pumpT = 0;
    this.pumping = true;
  }

  async reveal({mine, theirs, outcome}) {
    if (!this.pumping && !this.pending) this.startShake();
    const periods = Math.max(MIN_PUMPS, Math.ceil(this.pumpT / PUMP_S));
    await new Promise((resolve) => { this.pending = {until: periods * PUMP_S, resolve}; });
    this.hands.me.setPose(mine);
    this.hands.them.setPose(theirs);
    await sleep(this.#ms(350));
    this.hands.me.setResult(outcome);
    this.hands.them.setResult({win: 'lose', lose: 'win', draw: 'draw'}[outcome]);
  }
}
