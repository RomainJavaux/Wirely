import type * as THREE from 'three';
import type { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { getSymbol } from '../../domain/catalog';
import type { Mark3, Scene3D, Wire3 } from '../../domain/view3d/model';
import { GLYPH_ATTRS } from '../items';

type ThreeModule = typeof THREE;

export interface ThreeViewEvents {
  /** Clic sur un appareil (null : clic dans le vide ou sur un mur). */
  pick(id: number | null): void;
  /** Survol d'un appareil, avec la position du pointeur dans la page. */
  hover(id: number | null, clientX: number, clientY: number): void;
  /** Orientation de la caméra (azimut, en radians), pour la boussole. */
  camera(azimuth: number): void;
}

export interface Highlight {
  selectedId: number | null;
  /** Disjoncteur actif : le reste est atténué. null : rien n'est atténué. */
  activeCircuit: number | null;
}

export interface Display {
  wires: boolean;
  ceilingMarks: boolean;
}

const ACCENT = 0x2563eb;
/** Taille minimale d'une plaque (m) : une prise (8 cm) serait illisible à l'échelle d'une pièce. */
const MIN_PLATE = 0.11;
const DIM = 0.2;

interface MarkObject {
  mesh: THREE.Object3D;
  mark: Mark3;
  materials: THREE.Material[];
}

interface WireObject {
  wire: Wire3;
  materials: THREE.Material[];
}

/**
 * Vue 3D (Three.js) du modèle de scène. Tout ce qui dépend de Three.js est ici et chargé à la
 * demande : le reste de l'application n'en dépend pas.
 */
export class ThreeView {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.PerspectiveCamera;
  private readonly controls: OrbitControls;
  private readonly sun: THREE.DirectionalLight;
  private readonly halo: THREE.Mesh;
  private readonly raycaster: THREE.Raycaster;
  private readonly textures = new Map<string, THREE.CanvasTexture>();
  private readonly resizer: ResizeObserver;

  private content: THREE.Group | null = null;
  private wireGroup: THREE.Group | null = null;
  private marks: MarkObject[] = [];
  private wires: WireObject[] = [];
  private pickables: THREE.Object3D[] = [];
  private occluders: THREE.Object3D[] = [];
  private current: Scene3D | null = null;
  private framed = false;
  private raf = 0;
  private disposed = false;
  private highlight: Highlight = { selectedId: null, activeCircuit: null };
  private display: Display = { wires: true, ceilingMarks: true };
  private down: { x: number; y: number; t: number } | null = null;

  static async create(container: HTMLElement, events: ThreeViewEvents): Promise<ThreeView> {
    const three = await import('three');
    const { OrbitControls: Controls } = await import('three/addons/controls/OrbitControls.js');
    return new ThreeView(three, Controls, container, events);
  }

  private constructor(
    private readonly T: ThreeModule,
    Controls: typeof OrbitControls,
    private readonly container: HTMLElement,
    private readonly events: ThreeViewEvents,
  ) {
    this.renderer = new T.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = T.PCFSoftShadowMap;
    const canvas = this.renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.touchAction = 'none';
    container.appendChild(canvas);

    this.scene = new T.Scene();
    this.scene.background = new T.Color('#eef1f6');

    this.camera = new T.PerspectiveCamera(45, 1, 0.1, 300);
    this.camera.position.set(8, 9, 10);

    this.controls = new Controls(this.camera, canvas);
    this.controls.enableDamping = false;
    this.controls.maxPolarAngle = Math.PI / 2 - 0.02;
    this.controls.minDistance = 0.6;
    this.controls.maxDistance = 120;
    this.controls.addEventListener('change', () => {
      this.events.camera(this.controls.getAzimuthalAngle());
      this.requestRender();
    });

    this.scene.add(new T.HemisphereLight(0xffffff, 0xaab3c2, 1.35));
    this.sun = new T.DirectionalLight(0xffffff, 1.0);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.03;
    this.scene.add(this.sun, this.sun.target);

    // Sol de référence : un carreau = 1 m.
    const ground = new T.Mesh(
      new T.PlaneGeometry(300, 300),
      new T.MeshStandardMaterial({ color: '#e3e8ef', roughness: 1 }),
    );
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -0.04;
    ground.receiveShadow = true;
    this.scene.add(ground);
    const grid = new T.GridHelper(120, 120, 0xc5ccd8, 0xd3d9e3);
    grid.position.y = -0.035;
    this.scene.add(grid);

    this.halo = new T.Mesh(
      new T.SphereGeometry(1, 20, 14),
      new T.MeshBasicMaterial({ color: ACCENT, transparent: true, opacity: 0.28, depthTest: false }),
    );
    this.halo.renderOrder = 10;
    this.halo.visible = false;
    this.scene.add(this.halo);

    this.raycaster = new T.Raycaster();

    canvas.addEventListener('pointerdown', (e) => {
      this.down = { x: e.clientX, y: e.clientY, t: performance.now() };
    });
    canvas.addEventListener('pointerup', (e) => {
      const d = this.down;
      this.down = null;
      if (!d || e.button !== 0) return;
      if (Math.hypot(e.clientX - d.x, e.clientY - d.y) > 4 || performance.now() - d.t > 600) return;
      this.events.pick(this.pickAt(e.clientX, e.clientY));
    });
    canvas.addEventListener('pointermove', (e) => {
      if (e.buttons !== 0) return;
      const id = this.pickAt(e.clientX, e.clientY);
      canvas.style.cursor = id === null ? 'grab' : 'pointer';
      this.events.hover(id, e.clientX, e.clientY);
    });
    canvas.addEventListener('pointerleave', () => this.events.hover(null, 0, 0));

    this.resizer = new ResizeObserver(() => this.resize());
    this.resizer.observe(container);
    this.resize();
  }

  // ---------------------------------------------------------------- cycle de rendu

  private resize(): void {
    if (this.disposed) return;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w < 10 || h < 10) return;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  requestRender(): void {
    if (this.raf || this.disposed) return;
    this.raf = requestAnimationFrame(() => {
      this.raf = 0;
      if (this.disposed) return;
      this.renderer.render(this.scene, this.camera);
    });
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizer.disconnect();
    this.clearContent();
    for (const t of this.textures.values()) t.dispose();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  // ---------------------------------------------------------------- contenu

  private clearContent(): void {
    if (!this.content) return;
    this.content.traverse((o) => {
      const mesh = o as THREE.Mesh;
      mesh.geometry?.dispose();
      const m = mesh.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose();
    });
    this.scene.remove(this.content);
    this.content = null;
    this.wireGroup = null;
    this.marks = [];
    this.wires = [];
    this.pickables = [];
    this.occluders = [];
  }

  /** Remplace le contenu de la vue. Le cadrage de la caméra n'est fait qu'au premier appel. */
  setScene(model: Scene3D): void {
    const T = this.T;
    this.clearContent();
    this.current = model;
    const group = new T.Group();
    this.content = group;

    const wallMat = new T.MeshStandardMaterial({ color: '#eceff4', roughness: 0.95 });
    const glassMat = new T.MeshStandardMaterial({ color: '#9ec5ee', transparent: true, opacity: 0.4, roughness: 0.1 });
    const edgeMat = new T.LineBasicMaterial({ color: 0x9aa3b2 });
    const floorMats = new Map<string, THREE.MeshStandardMaterial>();

    for (const b of model.boxes) {
      const geo = new T.BoxGeometry(b.w, b.h, b.d);
      let mat: THREE.Material;
      if (b.role === 'wall') mat = wallMat;
      else if (b.role === 'glass') mat = glassMat;
      else {
        let f = floorMats.get(b.color);
        if (!f) {
          f = new T.MeshStandardMaterial({ color: b.color, roughness: 1 });
          floorMats.set(b.color, f);
        }
        mat = f;
      }
      const mesh = new T.Mesh(geo, mat);
      mesh.position.set(b.cx, b.cy, b.cz);
      mesh.rotation.y = b.rotY;
      mesh.castShadow = b.role === 'wall';
      mesh.receiveShadow = true;
      group.add(mesh);
      if (b.role === 'wall') {
        const edges = new T.LineSegments(new T.EdgesGeometry(geo), edgeMat);
        edges.position.copy(mesh.position);
        edges.rotation.copy(mesh.rotation);
        group.add(edges);
        this.occluders.push(mesh);
      }
    }

    for (const mark of model.marks) {
      const obj = this.buildMark(mark);
      group.add(obj.mesh);
      this.marks.push(obj);
      this.pickables.push(obj.mesh);
    }

    const wireGroup = new T.Group();
    this.wireGroup = wireGroup;
    group.add(wireGroup);
    for (const wire of model.wires) {
      const mat = new T.MeshStandardMaterial({ color: wire.color, roughness: 0.6 });
      for (let i = 1; i < wire.points.length; i++) {
        const seg = this.cylinder(wire.points[i - 1] as [number, number, number], wire.points[i] as [number, number, number], 0.014, mat);
        if (seg) wireGroup.add(seg);
      }
      this.wires.push({ wire, materials: [mat] });
    }

    this.scene.add(group);
    this.fitSun(model);
    if (!this.framed) {
      this.framed = true;
      this.view('iso');
    }
    this.applyDisplay();
    this.applyHighlight();
    this.requestRender();
  }

  private cylinder(a: [number, number, number], b: [number, number, number], radius: number, mat: THREE.Material): THREE.Mesh | null {
    const T = this.T;
    const from = new T.Vector3(...a);
    const to = new T.Vector3(...b);
    const len = from.distanceTo(to);
    if (len < 0.005) return null;
    const mesh = new T.Mesh(new T.CylinderGeometry(radius, radius, len, 8), mat);
    mesh.position.copy(from).add(to).multiplyScalar(0.5);
    mesh.quaternion.setFromUnitVectors(new T.Vector3(0, 1, 0), to.sub(from).normalize());
    mesh.castShadow = false;
    return mesh;
  }

  private buildMark(mark: Mark3): MarkObject {
    const T = this.T;

    if (mark.ceiling) {
      const r = Math.max(mark.w, 0.1) / 2;
      const warm = mark.kind === 'lampe' || mark.kind === 'spot';
      const mat = new T.MeshStandardMaterial({
        color: warm ? '#ffe9a8' : '#f4f6fa',
        emissive: warm ? '#ffcf5a' : '#000000',
        emissiveIntensity: warm ? 0.7 : 0,
        roughness: 0.5,
      });
      const mesh = new T.Mesh(new T.CylinderGeometry(r, r, 0.03, 20), mat);
      mesh.position.set(mark.x, mark.y - 0.01, mark.z);
      mesh.userData.markId = mark.id;
      return { mesh, mark, materials: [mat] };
    }

    const w = Math.max(mark.w, MIN_PLATE);
    const h = Math.max(mark.h, MIN_PLATE);
    const depth = 0.014;
    const side = new T.MeshStandardMaterial({ color: '#d5dae3', roughness: 0.6 });
    const front = new T.MeshStandardMaterial({ map: this.glyphTexture(mark, w, h), roughness: 0.5 });
    const mats = [side, side.clone(), side.clone(), side.clone(), front, side.clone()];
    const mesh = new T.Mesh(new T.BoxGeometry(w, h, depth), mats);
    mesh.castShadow = true;
    mesh.userData.markId = mark.id;

    if (mark.onWall) {
      mesh.position.set(mark.x + mark.nx * depth / 2, mark.y, mark.z + mark.nz * depth / 2);
      mesh.rotation.y = Math.atan2(mark.nx, mark.nz);
    } else {
      mesh.position.set(mark.x, mark.y, mark.z);
    }
    return { mesh, mark, materials: mats };
  }

  /** Face avant d'une plaque : le pictogramme du plan sur fond blanc, cerclé de la couleur de la catégorie. */
  private glyphTexture(mark: Mark3, w: number, h: number): THREE.CanvasTexture {
    const T = this.T;
    const key = `${mark.kind}:${Math.round((w / h) * 20)}`;
    const cached = this.textures.get(key);
    if (cached) return cached;

    const cw = 128;
    const ch = Math.max(48, Math.min(256, Math.round((cw * h) / w)));
    const canvas = document.createElement('canvas');
    canvas.width = cw;
    canvas.height = ch;
    const g = canvas.getContext('2d');
    const draw = (img: HTMLImageElement | null): void => {
      if (!g) return;
      g.fillStyle = '#ffffff';
      g.fillRect(0, 0, cw, ch);
      g.strokeStyle = mark.color;
      g.lineWidth = 9;
      g.strokeRect(4.5, 4.5, cw - 9, ch - 9);
      if (img) g.drawImage(img, 12, 12, cw - 24, ch - 24);
    };
    draw(null);

    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.anisotropy = 4;
    this.textures.set(key, texture);

    const def = getSymbol(mark.kind);
    if (def) {
      const inner = { w: cw - 24, h: ch - 24 };
      const svg =
        `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${def.viewBox ?? '-18 -18 36 36'}" width="${inner.w}" height="${inner.h}" ${GLYPH_ATTRS}>${def.svg}</svg>`;
      const img = new Image();
      img.onload = () => {
        if (this.disposed) return;
        draw(img);
        texture.needsUpdate = true;
        this.requestRender();
      };
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    }
    return texture;
  }

  /** Ajuste la lumière directionnelle (et son ombre) à l'emprise de la scène. */
  private fitSun(model: Scene3D): void {
    const { minX, maxX, minZ, maxZ } = model.bounds;
    const cx = (minX + maxX) / 2;
    const cz = (minZ + maxZ) / 2;
    const r = Math.max(maxX - minX, maxZ - minZ, 4) * 0.8;
    this.sun.position.set(cx + r * 0.45, r * 2.0, cz + r * 0.6);
    this.sun.target.position.set(cx, 0, cz);
    const cam = this.sun.shadow.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 0.5;
    cam.far = r * 6;
    cam.updateProjectionMatrix();
  }

  // ---------------------------------------------------------------- affichage

  setDisplay(display: Display): void {
    this.display = display;
    this.applyDisplay();
    this.requestRender();
  }

  private applyDisplay(): void {
    for (const o of this.marks) o.mesh.visible = this.display.ceilingMarks || !o.mark.ceiling;
    if (this.wireGroup) this.wireGroup.visible = this.display.wires;
  }

  setHighlight(h: Highlight): void {
    this.highlight = h;
    this.applyHighlight();
    this.requestRender();
  }

  private applyHighlight(): void {
    const { selectedId, activeCircuit } = this.highlight;
    const dim = (belongs: boolean): number => (activeCircuit === null || belongs ? 1 : DIM);

    for (const o of this.marks) {
      const opacity = dim(o.mark.breaker === activeCircuit);
      for (const m of o.materials) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
      }
    }
    for (const w of this.wires) {
      const opacity = dim(w.wire.breaker === activeCircuit);
      for (const m of w.materials) {
        m.transparent = opacity < 1;
        m.opacity = opacity;
      }
    }

    const sel = this.marks.find((o) => o.mark.id === selectedId);
    if (sel) {
      const r = Math.max(sel.mark.w, sel.mark.h, MIN_PLATE) * 0.9 + 0.06;
      this.halo.position.copy(sel.mesh.position);
      this.halo.scale.setScalar(r);
      this.halo.visible = true;
    } else {
      this.halo.visible = false;
    }
  }

  // ---------------------------------------------------------------- caméra

  /** Cadre la maison : en perspective ou vue du dessus. */
  view(kind: 'iso' | 'top'): void {
    const b = this.current?.bounds ?? { minX: 0, maxX: 6, minZ: 0, maxZ: 6 };
    const cx = (b.minX + b.maxX) / 2;
    const cz = (b.minZ + b.maxZ) / 2;
    const size = Math.max(b.maxX - b.minX, b.maxZ - b.minZ, 3);
    this.controls.target.set(cx, 0.6, cz);
    if (kind === 'top') this.camera.position.set(cx, size * 1.55, cz + 0.001);
    else this.camera.position.set(cx + size * 0.55, size * 0.95, cz + size * 1.05);
    this.controls.update();
    this.events.camera(this.controls.getAzimuthalAngle());
    this.requestRender();
  }

  /** Se place face à un appareil, à environ 2 m. */
  focus(markId: number): void {
    const o = this.marks.find((m) => m.mark.id === markId);
    if (!o) return;
    const m = o.mark;
    const target = o.mesh.position.clone();
    this.controls.target.copy(target);
    if (m.onWall) this.camera.position.set(target.x + m.nx * 2.4, Math.max(target.y, 0.6) + 0.5, target.z + m.nz * 2.4);
    else this.camera.position.set(target.x + 1.6, Math.max(target.y - 0.3, 1.2), target.z + 2);
    this.controls.update();
    this.events.camera(this.controls.getAzimuthalAngle());
    this.requestRender();
  }

  // ---------------------------------------------------------------- sélection

  private pickAt(clientX: number, clientY: number): number | null {
    const rect = this.renderer.domElement.getBoundingClientRect();
    if (rect.width === 0) return null;
    const ndc = new this.T.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const visible = this.pickables.filter((o) => o.visible);
    const hits = this.raycaster.intersectObjects([...visible, ...this.occluders], false);
    const first = hits[0];
    if (!first) return null;
    const id = first.object.userData.markId;
    return typeof id === 'number' ? id : null;
  }
}
