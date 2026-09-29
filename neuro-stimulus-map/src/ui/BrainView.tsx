import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { meshIndex, networkById, regionById } from '../evidence/db';
import type { MeshResult } from '../pipeline/mapping';
import { heatRGB } from '../heat/colors';
import { heatWord } from '../heat/model';
import { fetchBinary } from '../util/hosted';
import { GRADE_COLORS, GRADE_LABEL } from './colors';

export type ViewMode = 'anatomy' | 'networks';
type Deep = 'none' | 'glass' | 'cutaway';
type Axis = 'x' | 'y' | 'z';

const AXIS_RANGE: Record<Axis, [number, number, string, string]> = {
  x: [-75, 75, 'Sagittal (left-right)', 'Keeps everything to the left of the plane'],
  y: [-110, 75, 'Coronal (front-back)', 'Keeps everything behind the plane'],
  z: [-55, 80, 'Axial (top-bottom)', 'Keeps everything below the plane'],
};

const VIEWS: Record<string, { pos: [number, number, number]; up: [number, number, number] }> = {
  Left: { pos: [-1, 0, 0], up: [0, 1, 0] },
  Right: { pos: [1, 0, 0], up: [0, 1, 0] },
  Front: { pos: [0, 0, -1], up: [0, 1, 0] },
  Back: { pos: [0, 0, 1], up: [0, 1, 0] },
  Top: { pos: [0, 1, 0], up: [0, 0, -1] },
  Bottom: { pos: [0, -1, 0], up: [0, 0, 1] },
};

/** MNI anchor points for orientation labels (RAS millimetres). */
const ANCHORS: { key: string; label: string; mni: [number, number, number] }[] = [
  { key: 'L', label: 'L', mni: [-82, -20, 5] },
  { key: 'R', label: 'R', mni: [82, -20, 5] },
  { key: 'A', label: 'Front', mni: [0, 82, 0] },
  { key: 'P', label: 'Back', mni: [0, -118, 0] },
  { key: 'S', label: 'Top', mni: [0, -20, 88] },
];

interface Props {
  results: Map<string, MeshResult>;
  mode: ViewMode;
  selected: string | null;
  onSelect: (meshId: string | null) => void;
  /** Bring the explanation panel into view (useful when panels are stacked on phones). */
  onDetails?: () => void;
  theme: 'light' | 'dark';
  isDemo: boolean;
  /** Turn the view to show this mesh (set when an area is chosen from the list). */
  focusOn?: { meshId: string; seq: number } | null;
  /** Changes when new media or the demo is loaded; the view then returns to its default. */
  resetKey?: string;
  /** When set, the brain shows the estimated heat map for the current playback time instead of evidence grades. */
  heat?: HeatSource | null;
}

export interface HeatSource {
  /** current playback time (s) */
  now(): number;
  playing(): boolean;
  at(t: number, out: Map<string, number>): Map<string, number>;
  /** Colour for a mesh (0..1 RGB) instead of the heat ramp, e.g. the brain system lighting it. */
  tint?(meshId: string): [number, number, number] | undefined;
  /** Hover text for a mesh (after its name). */
  describe?(meshId: string, v: number): string;
  /** Show deep structures through a see-through cortex by default. */
  inside?: boolean;
}

function makeMaterial(): THREE.MeshStandardMaterial {
  const m = new THREE.MeshStandardMaterial({ roughness: 0.78, metalness: 0, side: THREE.DoubleSide });
  const uniforms = { uStripes: { value: 0 } };
  m.onBeforeCompile = (shader) => {
    shader.uniforms.uStripes = uniforms.uStripes;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform float uStripes;')
      .replace(
        '#include <color_fragment>',
        '#include <color_fragment>\nif (uStripes > 0.5) { float s = step(0.5, fract((vWPos.x + vWPos.y - vWPos.z) / 5.0)); diffuseColor.rgb *= mix(0.55, 1.0, s); }',
      );
  };
  m.userData.uniforms = uniforms;
  return m;
}

export function BrainView({ results, mode, selected, onSelect, onDetails, theme, isDemo, focusOn, resetKey, heat }: Props) {
  const mountRef = useRef<HTMLDivElement>(null);
  const labelRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState('');
  const [hover, setHover] = useState<{ x: number; y: number; name: string } | null>(null);
  const [showL, setShowL] = useState(true);
  const [showR, setShowR] = useState(true);
  const [deep, setDeep] = useState<Deep>('none');
  const [axis, setAxis] = useState<Axis>('y');
  const [cut, setCut] = useState(-5);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const [autoRotate, setAutoRotate] = useState(true);
  // views about deep structures (the emotion view) start with a see-through cortex
  const wantsInside = !!heat?.inside;
  const insideRef = useRef(wantsInside);
  insideRef.current = wantsInside;
  useEffect(() => {
    setDeep(wantsInside ? 'glass' : 'none');
  }, [wantsInside]);
  // smoothed heat currently drawn on each mesh (read by hover labels)
  const heatShown = useRef(new Map<string, number>());
  // read by the render loop, which is set up once
  const hiddenHemi = useRef({ L: false, R: false });
  // close the View menu when tapping or clicking elsewhere
  useEffect(() => {
    const close = (e: PointerEvent) => {
      const m = menuRef.current;
      if (m?.open && !m.contains(e.target as Node)) m.open = false;
    };
    document.addEventListener('pointerdown', close);
    return () => document.removeEventListener('pointerdown', close);
  }, []);
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    root: THREE.Group;
    cerebra: THREE.Mesh[];
    yeo: THREE.Mesh[];
    plane: THREE.Plane;
    halo: THREE.Mesh;
    render: () => void;
  } | null>(null);

  // --- one-time scene setup ---
  useEffect(() => {
    const mount = mountRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      // transparent, so the stage's CSS background shows through
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
    } catch {
      setStatus('error');
      setError('WebGL is not available in this browser, so the 3D view cannot be shown. The region list in the explanation panel still lists every association.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    renderer.localClippingEnabled = true;
    mount.appendChild(renderer.domElement);
    renderer.domElement.setAttribute('aria-label', 'Rotatable 3D brain atlas. Drag to rotate, scroll to zoom, click a region for details.');
    renderer.domElement.setAttribute('role', 'img');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(28, 1, 1, 3000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = false;
    controls.minDistance = 180;
    controls.maxDistance = 900;
    scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 1.4);
    camera.add(key);
    key.position.set(0.4, 0.8, 1);
    scene.add(camera);
    const root = new THREE.Group();
    root.rotation.x = -Math.PI / 2; // MNI RAS (z up) -> three.js (y up)
    scene.add(root);
    const plane = new THREE.Plane();

    const labelPos = new THREE.Vector3();
    const render = () => {
      renderer.render(scene, camera);
      const w = mount.clientWidth;
      const h = mount.clientHeight;
      for (const a of ANCHORS) {
        const el = labelRefs.current[a.key];
        if (!el) continue;
        if ((a.key === 'L' || a.key === 'R') && hiddenHemi.current[a.key]) {
          el.style.opacity = '0';
          continue;
        }
        labelPos.set(...a.mni).applyMatrix4(root.matrixWorld);
        // hide labels on the far side of the brain (e.g. "R" when viewing the left hemisphere)
        const far = labelPos.distanceTo(camera.position) > camera.position.length() + 30;
        labelPos.project(camera);
        // keep labels inside the stage (narrow screens put "Front"/"Back" at the very edge)
        const hw = el.offsetWidth / 2 + 6;
        const hh = el.offsetHeight / 2 + 6;
        const x = Math.min(w - hw, Math.max(hw, ((labelPos.x + 1) / 2) * w));
        const y = Math.min(h - hh, Math.max(hh, ((1 - labelPos.y) / 2) * h));
        el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
        el.style.opacity = labelPos.z < 1 && !far ? '1' : '0';
      }
    };
    controls.addEventListener('change', render);
    controls.autoRotateSpeed = 0.5;
    controls.addEventListener('start', () => setAutoRotate(false));

    const resize = () => {
      const w = mount.clientWidth;
      const h = Math.max(1, mount.clientHeight);
      renderer.setSize(w, h, false);
      renderer.domElement.style.width = '100%';
      renderer.domElement.style.height = '100%';
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      render();
    };
    const ro = new ResizeObserver(resize);
    ro.observe(mount);

    const loader = new GLTFLoader();
    const load = (url: string) =>
      fetchBinary(url).then(
        (buf) =>
          new Promise<THREE.Mesh[]>((resolve, reject) =>
            loader.parse(
              buf,
              '',
              (gltf) => {
                const meshes: THREE.Mesh[] = [];
                gltf.scene.traverse((o) => {
                  if ((o as THREE.Mesh).isMesh) {
                    const m = o as THREE.Mesh;
                    m.geometry.computeVertexNormals();
                    // glTF node names carry the region id; fall back to the parent node's name.
                    if (!meshIndex.has(m.name) && m.parent && meshIndex.has(m.parent.name)) m.name = m.parent.name;
                    m.material = makeMaterial();
                    meshes.push(m);
                  }
                });
                // flatten into root (keep world transforms identity: exporter wrote MNI coordinates)
                for (const m of meshes) {
                  m.removeFromParent();
                  root.add(m);
                }
                resolve(meshes);
              },
              (e) => reject(e),
            ),
          ),
      );
    let disposed = false;
    Promise.all([load('./atlas/cerebra.glb'), load('./atlas/yeo7.glb')])
      .then(([cerebra, yeo]) => {
        if (disposed) return;
        // centre the brain
        const box = new THREE.Box3().setFromObject(root);
        const c = box.getCenter(new THREE.Vector3());
        root.position.sub(c);
        root.updateMatrixWorld(true);
        const halo = new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshBasicMaterial({ side: THREE.BackSide }));
        halo.visible = false;
        halo.renderOrder = 0;
        halo.raycast = () => undefined; // never pickable
        root.add(halo);
        three.current = { renderer, scene, camera, controls, root, cerebra, yeo, plane, halo, render };
        setView('Left');
        setStatus('ready');
      })
      .catch((e) => {
        setStatus('error');
        setError(`The atlas meshes could not be loaded (${e?.message ?? e}).`);
      });

    return () => {
      disposed = true;
      ro.disconnect();
      controls.dispose();
      renderer.dispose();
      mount.removeChild(renderer.domElement);
      three.current = null;
    };
  }, []);

  function setView(name: keyof typeof VIEWS) {
    const v = VIEWS[name];
    setCamera(v.pos, v.up);
  }

  function setCamera(pos: [number, number, number], up: [number, number, number]) {
    const t = three.current;
    if (!t) return;
    t.camera.position.set(...pos).normalize().multiplyScalar(420);
    t.camera.up.set(...up);
    t.controls.target.set(0, 0, 0);
    t.controls.update();
    t.render();
  }

  // Turn to an area chosen from the list: face outer areas; for areas on the inner (medial)
  // surface hide the other hemisphere and look from the midline; make the cortex see-through
  // for deep structures. The automatic changes are undone when the selection is cleared.
  const autoView = useRef(false);
  useEffect(() => {
    const t = three.current;
    if (!t || !focusOn || status !== 'ready') return;
    const m = [...t.cerebra, ...t.yeo].find((x) => x.name === focusOn.meshId);
    const info = meshIndex.get(focusOn.meshId);
    if (!m || !info) return;
    const g = m.geometry;
    if (!g.boundingSphere) g.computeBoundingSphere();
    const local = g.boundingSphere!.center; // MNI millimetres
    const world = local.clone().applyMatrix4(m.matrixWorld);
    const kind = info.kind === 'region' ? regionById.get(info.id)?.kind : 'cortical';
    const medial = kind === 'cortical' && info.kind === 'region' && Math.abs(local.x) < 16 && info.hemi !== 'bilateral';
    setShowL(!(medial && info.hemi === 'R'));
    setShowR(!(medial && info.hemi === 'L'));
    setDeep(kind === 'subcortical' ? 'glass' : 'none');
    autoView.current = true;
    if (medial) {
      const side = info.hemi === 'L' ? 1 : -1; // look at the left hemisphere's inner face from the right
      setCamera([side, 0.25, world.z / 150], [0, 1, 0]);
    } else if (world.length() > 12) {
      const d = world.clone().normalize();
      d.y += 0.25;
      d.normalize();
      setCamera([d.x, d.y, d.z], Math.abs(d.y) > 0.9 ? [0, 0, -1] : [0, 1, 0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusOn?.seq, status]);
  useEffect(() => {
    if (selected || !autoView.current) return;
    autoView.current = false;
    setShowL(true);
    setShowR(true);
    setDeep(insideRef.current ? 'glass' : 'none');
  }, [selected]);

  useEffect(() => {
    if (status !== 'ready') return;
    autoView.current = false;
    setShowL(true);
    setShowR(true);
    setDeep(insideRef.current ? 'glass' : 'none');
    setView('Left');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey]);

  // When a cutaway is chosen, turn the camera towards the cut face so internal structures are visible.
  useEffect(() => {
    if (deep !== 'cutaway') return;
    if (axis === 'y') setCamera([-0.45, 0.35, -1], [0, 1, 0]); // from the front-left, looking at the coronal cut
    else if (axis === 'x') setCamera([1, 0.35, -0.35], [0, 1, 0]); // from the right, looking at the sagittal cut
    else setCamera([-0.3, 1, -0.45], [0, 0, -1]); // from above, looking down at the axial cut
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deep, axis, status]);

  // --- apply colours, visibility, clipping whenever inputs change ---
  const palette = GRADE_COLORS[theme];
  useEffect(() => {
    const t = three.current;
    if (!t) return;
    hiddenHemi.current = { L: !showL, R: !showR };
    const clipOn = deep === 'cutaway';
    const [min, max] = AXIS_RANGE[axis];
    const c = Math.max(min, Math.min(max, cut));
    // keep points with coordinate <= c (x), <= c (y: posterior side), <= c (z: below)
    const n = axis === 'x' ? new THREE.Vector3(-1, 0, 0) : axis === 'y' ? new THREE.Vector3(0, -1, 0) : new THREE.Vector3(0, 0, -1);
    t.plane.set(n, c).applyMatrix4(t.root.matrixWorld);
    const apply = (m: THREE.Mesh, visible: boolean) => {
      const info = meshIndex.get(m.name);
      const hemiOk = !info || info.hemi === 'bilateral' || (info.hemi === 'L' ? showL : showR);
      m.visible = visible && hemiOk;
      const mat = m.material as THREE.MeshStandardMaterial;
      const r = results.get(m.name);
      const grade = heat ? undefined : r?.grade;
      const cortical = info?.kind === 'region' ? regionById.get(info.id)?.kind === 'cortical' : info?.kind === 'network';
      const glass = deep === 'glass' && cortical;
      m.userData.glass = glass;
      if (!heat) {
        mat.color.set(grade ? palette[grade] : palette.none);
        mat.emissive.setRGB(0, 0, 0);
      }
      (mat.userData.uniforms as { uStripes: { value: number } }).uStripes.value = grade === 'contested' ? 1 : 0;
      mat.transparent = glass;
      mat.opacity = glass ? (grade ? 0.35 : 0.12) : 1;
      mat.depthWrite = !glass;
      mat.clippingPlanes = clipOn ? [t.plane] : [];
      mat.needsUpdate = true;
      m.renderOrder = glass ? 2 : 1;
    };
    for (const m of t.cerebra) {
      const info = meshIndex.get(m.name);
      const cortical = info && regionById.get(info.id)?.kind === 'cortical';
      apply(m, mode === 'anatomy' || !cortical);
    }
    for (const m of t.yeo) apply(m, mode === 'networks');

    // Selection: an outline ring ("inverted hull") keeps the region's evidence colour unchanged.
    const target = [...t.cerebra, ...t.yeo].find((m) => m.name === selected && m.visible);
    const halo = t.halo;
    halo.visible = !!target;
    if (target) {
      const g = target.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      const centre = g.boundingSphere!.center;
      const s = 1 + Math.min(0.08, 2.2 / Math.max(8, g.boundingSphere!.radius));
      halo.geometry = g;
      halo.scale.setScalar(s);
      halo.position.copy(centre).multiplyScalar(1 - s);
      const hm = halo.material as THREE.MeshBasicMaterial;
      hm.color.set(theme === 'dark' || heat ? '#ffffff' : '#0b0b0b');
      hm.clippingPlanes = clipOn ? [t.plane] : [];
      hm.needsUpdate = true;
    }
    t.render();
  }, [results, mode, selected, theme, showL, showR, deep, axis, cut, status, palette, heat]);

  // --- heat map animation: follow the playback clock, ease each area up quickly and down slowly ---
  useEffect(() => {
    const t3 = three.current;
    if (!heat || !t3 || status !== 'ready') return;
    const target = new Map<string, number>();
    const shown = heatShown.current;
    shown.clear();
    const meshes = [...t3.cerebra, ...t3.yeo];
    const [r0, g0, b0] = heatRGB(0);
    const paint = (m: THREE.Mesh, v: number) => {
      const mat = m.material as THREE.MeshStandardMaterial;
      const tint = heat.tint?.(m.name);
      let r: number, g: number, b: number;
      if (tint) {
        // a system colour, fading in from the cold surface colour
        const k = Math.min(1, v * 1.4);
        [r, g, b] = [r0 + (tint[0] - r0) * k, g0 + (tint[1] - g0) * k, b0 + (tint[2] - b0) * k];
      } else [r, g, b] = heatRGB(v);
      mat.color.setRGB(r, g, b);
      const glow = v < 0.02 ? 0 : 0.12 + 0.55 * v;
      mat.emissive.setRGB(r * glow, g * glow, b * glow);
      if (m.userData.glass) mat.opacity = v > 0.05 ? 0.3 + 0.45 * v : 0.1;
    };
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      heat.at(heat.now(), target);
      let changed = false;
      for (const m of meshes) {
        if (!m.visible) continue;
        const goal = target.get(m.name) ?? 0;
        const cur = shown.get(m.name);
        const from = cur ?? 0;
        const tau = goal > from ? 0.07 : 0.35;
        const next = cur === undefined ? goal : from + (goal - from) * (1 - Math.exp(-dt / tau));
        if (cur === undefined || Math.abs(next - from) > 0.002) {
          shown.set(m.name, next);
          paint(m, next);
          changed = true;
        }
      }
      t3.controls.autoRotate = autoRotate && heat.playing();
      if (t3.controls.autoRotate) t3.controls.update(); // renders through the 'change' event
      else if (changed) t3.render();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      t3.controls.autoRotate = false;
    };
  }, [heat, status, mode, showL, showR, deep, autoRotate]);

  // --- picking ---
  const raycaster = useMemo(() => new THREE.Raycaster(), []);
  const pick = (ev: { clientX: number; clientY: number }): THREE.Mesh | null => {
    const t = three.current;
    if (!t) return null;
    const rect = t.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((ev.clientX - rect.left) / rect.width) * 2 - 1, -((ev.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(ndc, t.camera);
    const candidates = [...t.cerebra, ...t.yeo].filter((m) => m.visible);
    const hits = raycaster
      .intersectObjects(candidates, false)
      .filter((h) => deep !== 'cutaway' || t.plane.distanceToPoint(h.point) >= 0)
      .sort((a, b) => Number((a.object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.transparent) - Number((b.object as THREE.Mesh<THREE.BufferGeometry, THREE.MeshStandardMaterial>).material.transparent) || a.distance - b.distance);
    return (hits[0]?.object as THREE.Mesh) ?? null;
  };
  const downAt = useRef<{ x: number; y: number } | null>(null);
  const nameFor = (meshId: string) => {
    const info = meshIndex.get(meshId);
    if (!info) return meshId;
    const hemi = info.hemi === 'bilateral' ? '' : info.hemi === 'L' ? 'Left ' : 'Right ';
    const base = info.kind === 'region' ? regionById.get(info.id)?.name : networkById.get(info.id)?.name;
    if (heat?.describe) return `${hemi}${base ?? meshId} — ${heat.describe(meshId, heatShown.current.get(meshId) ?? 0)}`;
    if (heat) return `${hemi}${base ?? meshId} — ${heatWord(heatShown.current.get(meshId) ?? 0).toLowerCase()} estimated heat`;
    const r = results.get(meshId);
    return `${hemi}${base ?? meshId}${r ? ` — ${GRADE_LABEL[r.grade]}` : ' — no verified association for this segment'}`;
  };

  return (
    <div className="brain">
      <div
        className={`brain-canvas ${heat ? 'is-heat' : ''}`}
        ref={mountRef}
        onPointerDown={(e) => (downAt.current = { x: e.clientX, y: e.clientY })}
        onPointerUp={(e) => {
          const d = downAt.current;
          if (d && Math.hypot(e.clientX - d.x, e.clientY - d.y) < 5) {
            const m = pick(e);
            onSelect(m ? m.name : null);
          }
        }}
        onPointerMove={(e) => {
          if (e.buttons) return setHover(null);
          const m = pick(e);
          const rect = (e.currentTarget as HTMLDivElement).getBoundingClientRect();
          setHover(m ? { x: e.clientX - rect.left, y: e.clientY - rect.top, name: nameFor(m.name) } : null);
        }}
        onPointerLeave={() => setHover(null)}
      >
        <details className="view-menu" ref={menuRef} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <summary>View</summary>
          <div className="view-panel" role="group" aria-label="Brain view controls">
            <span className="view-label">Turn to</span>
            <div className="view-grid" aria-label="Camera view">
              {Object.keys(VIEWS).map((v) => (
                <button key={v} type="button" className="chip" onClick={() => setView(v as keyof typeof VIEWS)}>
                  {v}
                </button>
              ))}
            </div>
            <span className="view-label">Show</span>
            <label className="check small">
              <input type="checkbox" checked={showL} onChange={(e) => setShowL(e.target.checked)} /> Left hemisphere
            </label>
            <label className="check small">
              <input type="checkbox" checked={showR} onChange={(e) => setShowR(e.target.checked)} /> Right hemisphere
            </label>
            {heat && (
              <label className="check small">
                <input type="checkbox" checked={autoRotate} onChange={(e) => setAutoRotate(e.target.checked)} /> Rotate slowly while playing
              </label>
            )}
            <span className="view-label">Look inside</span>
            <select value={deep} onChange={(e) => setDeep(e.target.value as Deep)} aria-label="Show internal structures">
              <option value="none">Surface view</option>
              <option value="glass">See-through cortex</option>
              <option value="cutaway">Cutaway plane</option>
            </select>
            {deep === 'cutaway' && (
              <>
                <select value={axis} onChange={(e) => setAxis(e.target.value as Axis)} aria-label="Cut orientation">
                  {(Object.keys(AXIS_RANGE) as Axis[]).map((a) => (
                    <option key={a} value={a}>
                      {AXIS_RANGE[a][2]}
                    </option>
                  ))}
                </select>
                <label className="range small">
                  <input
                    type="range"
                    min={AXIS_RANGE[axis][0]}
                    max={AXIS_RANGE[axis][1]}
                    value={Math.max(AXIS_RANGE[axis][0], Math.min(AXIS_RANGE[axis][1], cut))}
                    onChange={(e) => setCut(+e.target.value)}
                    aria-label={`Cut position in millimetres (${AXIS_RANGE[axis][3]})`}
                  />
                  <span className="mono">
                    {axis.toUpperCase()} = {cut} mm
                  </span>
                </label>
              </>
            )}
          </div>
        </details>
        {ANCHORS.map((a) => (
          <div key={a.key} className={`orient orient-${a.key}`} ref={(el) => void (labelRefs.current[a.key] = el)} aria-hidden="true">
            {a.label}
          </div>
        ))}
        {hover && (
          <div className="hover-tip" style={{ left: hover.x + 12, top: hover.y + 12 }}>
            {hover.name}
          </div>
        )}
        {selected && status === 'ready' && (
          <div className="tap-card" onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
            <strong>{nameFor(selected)}</strong>
            {onDetails && (
              <button type="button" className="btn small" onClick={onDetails}>
                {heat ? 'Why?' : 'Details'}
              </button>
            )}
            <button type="button" className="icon-btn" aria-label="Clear selection" onClick={() => onSelect(null)}>
              ✕
            </button>
          </div>
        )}
        {status === 'loading' && <div className="brain-msg">Loading atlas meshes…</div>}
        {status === 'error' && <div className="brain-msg error">{error}</div>}
        <div className="brain-stamp" aria-hidden="true">
          {isDemo ? 'DEMO DATA · ' : ''}
          <span className="stamp-long">{heat ? 'Estimated from the media and research · not a brain recording' : 'Research-based association map · not a brain scan'}</span>
          <span className="stamp-short">{heat ? 'Estimate · not a brain recording' : 'Not a brain scan'}</span>
        </div>
        {status === 'ready' && !selected && (
          <div className="brain-hint" aria-hidden="true">
            <span className="hint-fine">Drag to rotate · scroll to zoom · click an area</span>
            <span className="hint-coarse">Drag to rotate · pinch to zoom · tap an area</span>
          </div>
        )}
      </div>
    </div>
  );
}
