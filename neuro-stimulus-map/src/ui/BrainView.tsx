import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { meshIndex, networkById, regionById } from '../evidence/db';
import type { MeshResult } from '../pipeline/mapping';
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
  { key: 'A', label: 'Anterior', mni: [0, 82, 0] },
  { key: 'P', label: 'Posterior', mni: [0, -118, 0] },
  { key: 'S', label: 'Superior', mni: [0, -20, 88] },
];

interface Props {
  results: Map<string, MeshResult>;
  mode: ViewMode;
  selected: string | null;
  onSelect: (meshId: string | null) => void;
  theme: 'light' | 'dark';
  isDemo: boolean;
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

export function BrainView({ results, mode, selected, onSelect, theme, isDemo }: Props) {
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
  const three = useRef<{
    renderer: THREE.WebGLRenderer;
    scene: THREE.Scene;
    camera: THREE.PerspectiveCamera;
    controls: OrbitControls;
    root: THREE.Group;
    cerebra: THREE.Mesh[];
    yeo: THREE.Mesh[];
    plane: THREE.Plane;
    render: () => void;
  } | null>(null);

  // --- one-time scene setup ---
  useEffect(() => {
    const mount = mountRef.current!;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
    } catch {
      setStatus('error');
      setError('WebGL is not available in this browser, so the 3D view cannot be shown. The region list in the explanation panel still lists every association.');
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
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
        labelPos.set(...a.mni).applyMatrix4(root.matrixWorld);
        // hide labels on the far side of the brain (e.g. "R" when viewing the left hemisphere)
        const far = labelPos.distanceTo(camera.position) > camera.position.length() + 30;
        labelPos.project(camera);
        el.style.transform = `translate(${((labelPos.x + 1) / 2) * w}px, ${((1 - labelPos.y) / 2) * h}px) translate(-50%, -50%)`;
        el.style.opacity = labelPos.z < 1 && !far ? '1' : '0';
      }
    };
    controls.addEventListener('change', render);

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
      new Promise<THREE.Mesh[]>((resolve, reject) =>
        loader.load(
          url,
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
          undefined,
          (e) => reject(e),
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
        three.current = { renderer, scene, camera, controls, root, cerebra, yeo, plane, render };
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
    t.scene.background = new THREE.Color(theme === 'dark' ? '#1a1a19' : '#fcfcfb');
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
      const grade = r?.grade;
      mat.color.set(grade ? palette[grade] : palette.none);
      (mat.userData.uniforms as { uStripes: { value: number } }).uStripes.value = grade === 'contested' ? 1 : 0;
      const cortical = info?.kind === 'region' ? regionById.get(info.id)?.kind === 'cortical' : info?.kind === 'network';
      const glass = deep === 'glass' && cortical;
      mat.transparent = glass;
      mat.opacity = glass ? (grade ? 0.35 : 0.12) : 1;
      mat.depthWrite = !glass;
      mat.clippingPlanes = clipOn ? [t.plane] : [];
      mat.emissive.set(m.name === selected ? (theme === 'dark' ? '#ffffff' : '#ffffff') : '#000000');
      mat.emissiveIntensity = m.name === selected ? 0.28 : 0;
      mat.needsUpdate = true;
      m.renderOrder = glass ? 2 : 1;
    };
    for (const m of t.cerebra) {
      const info = meshIndex.get(m.name);
      const cortical = info && regionById.get(info.id)?.kind === 'cortical';
      apply(m, mode === 'anatomy' || !cortical);
    }
    for (const m of t.yeo) apply(m, mode === 'networks');
    t.render();
  }, [results, mode, selected, theme, showL, showR, deep, axis, cut, status, palette]);

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
    const r = results.get(meshId);
    return `${hemi}${base ?? meshId}${r ? ` — ${GRADE_LABEL[r.grade]}` : ' — no verified association for this segment'}`;
  };

  return (
    <div className="brain">
      <div className="brain-toolbar" role="toolbar" aria-label="Brain view controls">
        <div className="seg-group" aria-label="Camera view">
          {Object.keys(VIEWS).map((v) => (
            <button key={v} type="button" className="chip" onClick={() => setView(v as keyof typeof VIEWS)}>
              {v}
            </button>
          ))}
        </div>
        <div className="seg-group" aria-label="Hemispheres">
          <label className="check">
            <input type="checkbox" checked={showL} onChange={(e) => setShowL(e.target.checked)} /> Left hemisphere
          </label>
          <label className="check">
            <input type="checkbox" checked={showR} onChange={(e) => setShowR(e.target.checked)} /> Right hemisphere
          </label>
        </div>
        <div className="seg-group" aria-label="Internal structures">
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
              <label className="range">
                <input
                  type="range"
                  min={AXIS_RANGE[axis][0]}
                  max={AXIS_RANGE[axis][1]}
                  value={Math.max(AXIS_RANGE[axis][0], Math.min(AXIS_RANGE[axis][1], cut))}
                  onChange={(e) => setCut(+e.target.value)}
                  aria-label={`Cut position in millimetres (${AXIS_RANGE[axis][3]})`}
                />
                <span className="mono">{axis.toUpperCase()} = {cut} mm</span>
              </label>
            </>
          )}
        </div>
      </div>
      <div
        className="brain-canvas"
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
        {status === 'loading' && <div className="brain-msg">Loading atlas meshes…</div>}
        {status === 'error' && <div className="brain-msg error">{error}</div>}
        <div className="brain-stamp" aria-hidden="true">
          {isDemo ? 'DEMO DATA · ' : ''}Research-based association map · not a brain scan
        </div>
      </div>
    </div>
  );
}
