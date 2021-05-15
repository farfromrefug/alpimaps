import CameraControls from 'camera-controls';
import Stats from 'stats.js';
import * as THREE from 'three';
import * as Geo from './geo-three.module';
import { Pass } from 'three/examples/jsm/postprocessing/Pass';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass';
import { Sky } from 'three/examples/jsm/objects/Sky';

import CustomOutlinePass from './CustomOutlinePass';

//@ts-ignore
global.THREE = THREE;

CameraControls.install({ THREE });

//@ts-ignore
const stats = new Stats();
const devicePixelRatio = window.devicePixelRatio; // Change to 1 on retina screens to see blurry canvas.
stats.showPanel(0); // 0: fps, 1: ms, 2: mb, 3+: custom
document.body.appendChild(stats.dom);

function ArraySortOn(array, key) {
    return array.sort(function (a, b) {
        if (a[key] < b[key]) {
            return -1;
        } else if (a[key] > b[key]) {
            return 1;
        }
        return 0;
    });
}

let debug = false;
const debugFeaturePoints = false;
let debugGPUPicking = false;
let readFeatures = true;
let drawLines = true;
let pointBufferTargetScale = 10;
let elevationDecoder = [6553.6 * 255, 25.6 * 255, 0.1 * 255, -10000];

export function setTerrarium(value: boolean) {
    if (value) {
        elevationDecoder = [256 * 255, 1 * 255, (1 / 256) * 255, -32768];
    } else {
        elevationDecoder = [6553.6 * 255, 25.6 * 255, 0.1 * 255, -10000];
    }
    if (map) {
        applyOnNodes((node) => {
            node.material.userData.elevationDecoder.value = elevationDecoder;
        });
    }
}
const canvas = document.getElementById('canvas') as HTMLCanvasElement;
const canvas3 = document.getElementById('canvas3') as HTMLCanvasElement;
const canvas4 = document.getElementById('canvas4') as HTMLCanvasElement;
const ctx2d = canvas4.getContext('2d');

let pixelsBuffer;
let AA = true;
if (devicePixelRatio > 1) {
    AA = false;
}
const renderer = new THREE.WebGLRenderer({
    canvas,
    logarithmicDepthBuffer: true,
    antialias: AA,
    alpha: true,
    powerPreference: 'high-performance'
});
// renderer.setClearColor(0xffffff, 1); // the default
const rendereroff = new THREE.WebGLRenderer({
    canvas: canvas3,
    antialias: false,
    alpha: false,
    powerPreference: 'high-performance'
});
const pointBufferTarget = new THREE.WebGLRenderTarget(0, 0);

const scene = new THREE.Scene();

function createSky() {
    // Add Sky
    const sky = new Sky();
    sky.scale.setScalar(1e8);

    // GUI
    const effectController = {
        turbidity: 0,
        rayleigh: 0.5,
        mieCoefficient: 0.005,
        mieDirectionalG: 0.7,
        inclination: 0.48,
        azimuth: 0.25,
        exposure: 0.5
    };

    const uniforms = sky.material.uniforms;
    uniforms['turbidity'].value = effectController.turbidity;
    uniforms['rayleigh'].value = effectController.rayleigh;
    uniforms['mieCoefficient'].value = effectController.mieCoefficient;
    uniforms['mieDirectionalG'].value = effectController.mieDirectionalG;

    const theta = Math.PI * (effectController.inclination - 0.5);
    const phi = 2 * Math.PI * (effectController.azimuth - 0.5);

    const sun = new THREE.Vector3();
    sun.x = Math.cos(phi);
    sun.y = Math.sin(phi) * Math.sin(theta);
    sun.z = Math.sin(phi) * Math.cos(theta);
    uniforms['sunPosition'].value.copy(sun);

    return sky;
}

const ambientLight = new THREE.AmbientLight(0x777777);
const directionalLight = new THREE.DirectionalLight(0x777777);
directionalLight.position.set(100, 10000, 700);
const sky = createSky();
// scene.add(sky);
// scene.add(ambientLight);
// scene.add(directionalLight);
sky.visible = debug;
ambientLight.visible = debug;
directionalLight.visible = debug;

const debugMapCheckBox = document.getElementById('debugMap');
debugMapCheckBox.onchange = function (event) {
    debug = (event.target as HTMLInputElement).checked;
    sky.visible = debug;
    render();
};
const debugGPUPickingCheckbox = document.getElementById('debugGPUPicking');
debugGPUPickingCheckbox.onchange = function (event) {
    debugGPUPicking = (event.target as HTMLInputElement).checked;
    canvas3.style.visibility = debugGPUPicking ? 'visible' : 'hidden';
    render();
};
const readFeaturesCheckbox = document.getElementById('readFeatures');
readFeaturesCheckbox.onchange = function (event) {
    readFeatures = (event.target as HTMLInputElement).checked;

    canvas4.style.visibility = readFeatures && drawLines ? 'visible' : 'hidden';
    render();
};
const drawLinesCheckbox = document.getElementById('drawLines');
drawLinesCheckbox.onchange = function (event) {
    drawLines = (event.target as HTMLInputElement).checked;
    canvas4.style.visibility = readFeatures && drawLines ? 'visible' : 'hidden';
    render();
};

class EmptyProvider extends Geo.MapProvider {
    constructor() {
        super();
        this.name = 'local';
        this.minZoom = 0;
        this.maxZoom = 20;
    }

    fetchTile(zoom, x, y) {
        return Promise.resolve(null);
    }
}
class LocalHeightProvider extends Geo.MapProvider {
    constructor() {
        super();
        this.name = 'local';
        this.minZoom = 5;
        this.maxZoom = 11;
    }

    async fetchTile(zoom, x, y) {
        const result = await Promise.all([
            new Geo.CancelablePromise((resolve, reject) => {
                const image = document.createElement('img');
                image.onload = () => resolve(image);
                image.onerror = () => resolve();
                image.crossOrigin = 'Anonymous';
                image.src = `http://127.0.0.1:8080?source=height&x=${x}&y=${y}&z=${zoom}`;
            })
        ]);
        return result[0] as any;
    }
}

const exageration = 1.7;

let currentColor = 0xffffff;
const featuresByColor = {};

class MaterialHeightShader extends Geo.MapHeightNode {
    /**
     * Empty texture used as a placeholder for missing textures.
     *
     * @static
     * @attribute EMPTY_TEXTURE
     * @type {Texture}
     */
    static EMPTY_TEXTURE = new THREE.Texture();

    /**
     * Size of the grid of the geometry displayed on the scene for each tile.
     *
     * @static
     * @attribute GEOMETRY_SIZE
     * @type {number}
     */
    static GEOMETRY_SIZE = 200;

    static geometries = {};
    frustumCulled;
    exageration;
    static getGeometry(level) {
        let size = MaterialHeightShader.GEOMETRY_SIZE;
        if (level < 11) {
            size /= Math.pow(2, 11 - level);
            // size /= 11 - level;
            size = Math.max(16, size);
        }
        let geo = MaterialHeightShader.geometries[size];
        if (!MaterialHeightShader.geometries[size]) {
            geo = MaterialHeightShader.geometries[size] = new Geo.MapNodeGeometry(1, 1, size, size);
        }
        return geo;
    }

    static getSoftGeometry(level) {
        return MaterialHeightShader.getGeometry(level - 1);
    }

    constructor(parentNode, mapView, location, level, x, y) {
        let material = new THREE.MeshPhongMaterial({
            map: MaterialHeightShader.EMPTY_TEXTURE,
            color: 0xffffff,
            side: THREE.DoubleSide
        });
        material = MaterialHeightShader.prepareMaterial(material, level);
        super(parentNode, mapView, location, level, x, y, material, MaterialHeightShader.GEOMETRY);

        this.frustumCulled = false;
        this.exageration = exageration;
    }

    static prepareMaterial(material, level) {
        material.userData = {
            heightMap: { value: MaterialHeightShader.EMPTY_TEXTURE },
            drawNormals: { value: 0 },
            drawBlack: { value: 0 },
            zoomlevel: { value: level },
            exageration: { value: exageration },
            elevationDecoder: { value: elevationDecoder }
        };

        material.onBeforeCompile = (shader) => {
            // Pass uniforms from userData to the
            for (const i in material.userData) {
                shader.uniforms[i] = material.userData[i];
            }
            // Vertex variables
            shader.vertexShader =
                `
            uniform bool drawNormals;
            uniform float exageration;
            uniform float zoomlevel;
            uniform sampler2D heightMap;
            uniform vec4 elevationDecoder;

            float getPixelElevation(vec4 e) {
            // Convert encoded elevation value to meters
            return ((e.r * elevationDecoder.x + e.g * elevationDecoder.y  + e.b * elevationDecoder.z) + elevationDecoder.w) * exageration;
        }
            float getElevation(vec2 coord) {
            vec4 e = texture2D(heightMap, coord);
            return getPixelElevation(e);
            }
            float getElevationMean(vec2 coord, float width, float height) {
            float x0 = coord.x;
            float x1= coord.x;
            float y0 = coord.y;
            float y1= coord.y;
            if (x0 <= 0.0) {
                x1 = 1.0 / width;
            }
            if (x0 >= 1.0) {
                x1 = 1.0 - 1.0 / width;
            }
            if (y0 <= 0.0) {
                y1 = 1.0 / height;
            }
            if (y0 >= 1.0) {
                y1 = 1.0 - 1.0 / height;
            }
            if (x0 == x1 && y0 == y1) {
                    vec4 e = texture2D(heightMap, coord);
                return getPixelElevation(e);
            } else {
                vec4 e1 = texture2D(heightMap, vec2(x0,y0));
                vec4 e2 = texture2D(heightMap, vec2(x1,y1));
                return 2.0 * getPixelElevation(e1) -  getPixelElevation(e2);
            }
            }
            ` + shader.vertexShader;
            shader.fragmentShader =
                `
            uniform bool drawNormals;
            uniform bool drawBlack;
            ` + shader.fragmentShader;

            // Vertex depth logic
            shader.fragmentShader = shader.fragmentShader.replace(
                '#include <dithering_fragment>',
                `				if(drawBlack) {
                    gl_FragColor = vec4( 0.0,0.0,0.0, 1.0 );
                } else if(drawNormals) {
                    gl_FragColor = vec4( ( 0.5 * vNormal + 0.5 ), 1.0 );
                }
                    `
            );
            shader.vertexShader = shader.vertexShader.replace(
                '#include <fog_vertex>',
                `
                #include <fog_vertex>

                // queried pixels:
                // +-----------+
                // |   |   |   |
                // | a | b | c |
                // |   |   |   |
                // +-----------+
                // |   |   |   |
                // | d | e | f |
                // |   |   |   |
                // +-----------+
                // |   |   |   |
                // | g | h | i |
                // |   |   |   |
                // +-----------+

                // vec4 theight = texture2D(heightMap, vUv);
                ivec2 size = textureSize(heightMap, 0);
                float width = float(size.x);
                float height = float(size.y);
                float e = getElevationMean(vUv, width,height);
                if (drawNormals) {
                    float offset = 1.0 / width;
                    float a = getElevationMean(vUv + vec2(-offset, -offset), width,height);
                    float b = getElevationMean(vUv + vec2(0, -offset), width,height);
                    float c = getElevationMean(vUv + vec2(offset, -offset), width,height);
                    float d = getElevationMean(vUv + vec2(-offset, 0), width,height);
                    float f = getElevationMean(vUv + vec2(offset, 0), width,height);
                    float g = getElevationMean(vUv + vec2(-offset, offset), width,height);
                    float h = getElevationMean(vUv + vec2(0, offset), width,height);
                    float i = getElevationMean(vUv + vec2(offset,offset), width,height);


                    float NormalLength = 500.0 / zoomlevel;

                    vec3 v0 = vec3(0.0, 0.0, 0.0);
                    vec3 v1 = vec3(0.0, NormalLength, 0.0);
                    vec3 v2 = vec3(NormalLength, 0.0, 0.0);
                    v0.z = (e + d + g + h) / 4.0;
                    v1.z = (e + b + a + d) / 4.0;
                    v2.z = (e + h + i + f) / 4.0;
                    vNormal = (normalize(cross(v2 - v0, v1 - v0)));
                }

                vec3 _transformed = position + e * normal;
                vec3 worldNormal = normalize ( mat3( modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz ) * normal );

                gl_Position = projectionMatrix * modelViewMatrix * vec4(_transformed, 1.0);
                `
            );
        };

        return material;
    }
    //@ts-ignore
    material: THREE.MeshPhongMaterial;
    geometry;
    loadTexture() {
        this.geometry = MaterialHeightShader.getGeometry(this.level);
        this.isReady = true;

        this.mapView
            .fetchTile(this.level, this.x, this.y)
            .then((image) => {
                if (image) {
                    const texture = new THREE.Texture(image as any);
                    texture.generateMipmaps = false;
                    texture.format = THREE.RGBFormat;
                    texture.magFilter = THREE.LinearFilter;
                    texture.minFilter = THREE.LinearFilter;
                    texture.needsUpdate = true;

                    this.material.map = texture;
                }

                this.textureLoaded = true;
                this.nodeReady();
            })
            .catch((err) => {
                console.error('GeoThree: Failed to load color node data.', err);
                this.textureLoaded = true;
                this.nodeReady();
            });

        this.loadHeightGeometry();
    }

    loadHeightGeometry() {
        if (this.mapView.heightProvider === null) {
            throw new Error('GeoThree: MapView.heightProvider provider is null.');
        }
        return this.mapView.heightProvider
            .fetchTile(this.level, this.x, this.y)
            .then(async (image) => {
                this.onHeightImage(image);
            })
            .finally(() => {
                this.heightLoaded = true;
                this.nodeReady();
            });
    }

    async onHeightImage(image) {
        if (image) {
            new Geo.CancelablePromise((resolve, reject) => {
                const url = `http://127.0.0.1:8080?source=peaks&x=${this.x}&y=${this.y}&z=${this.level}`;
                try {
                    Geo.XHRUtils.get(
                        url,
                        async (data) => {
                            // console.log('test', data)
                            let result = JSON.parse(data).features;
                            result = result.filter((f) => f.properties.name && f.properties.class === 'peak');
                            if (result.length > 0) {
                                const features = [];
                                const exageration = this.exageration;
                                const colors = [];
                                const points = [];
                                // var sizes = [];
                                const elevations = [];
                                const vec = new THREE.Vector3(0, 0, 0);
                                result.forEach((f, index) => {
                                    const coords = Geo.UnitsUtils.datumsToSpherical(f.geometry.coordinates[1], f.geometry.coordinates[0]);
                                    vec.set(coords.x, 0, -coords.y);
                                    f.localCoords = (this as any as THREE.Mesh).worldToLocal(vec);
                                    if (Math.abs(f.localCoords.x) <= 0.5 && Math.abs(f.localCoords.z) <= 0.5) {
                                        const id = f.geometry.coordinates.join(',');
                                        f.id = id;
                                        f.pointIndex = features.length;
                                        features.push(f);
                                        f.level = this.level;
                                        f.x = this.x;
                                        f.y = this.y;
                                        const color = (f.color = currentColor--);
                                        featuresByColor[color] = f;
                                        f.localCoords.y = f.properties.ele * exageration;
                                        colors.push(((color >> 16) & 255) / 255, ((color >> 8) & 255) / 255, (color & 255) / 255);
                                        points.push(f.localCoords.x, f.localCoords.y, f.localCoords.z);
                                        elevations.push(f.properties.ele);
                                    }
                                });
                                if (points.length > 0) {
                                    const geometry = new THREE.BufferGeometry();
                                    geometry.setAttribute('position', new THREE.Float32BufferAttribute(points, 3));
                                    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
                                    geometry.setAttribute('elevation', new THREE.Float32BufferAttribute(elevations, 1));
                                    const mesh = new THREE.Points(
                                        geometry,
                                        new THREE.ShaderMaterial({
                                            vertexShader: `
                                                attribute float elevation;
                                                attribute vec4 color;
                                                varying vec4 vColor;
                                                void main() {
                                                    vColor = color;
                                                    vec4 mvPosition = modelViewMatrix * vec4( position, 1.0 );
                                                    // gl_PointSize =  floor(elevation / 1000.0) * 2.0;
                                                //  gl_PointSize = gl_Position.z  + 1.0;
                                                    gl_Position = projectionMatrix * mvPosition;
                                                    gl_Position.z -= (elevation / 1000.0 - floor(elevation / 1000.0)) * gl_Position.z / 1000.0;
                                                }
                                            `,
                                            fragmentShader: `
                                                varying vec4 vColor;
                                                void main() {
                                                    gl_FragColor = vec4( vColor );
                                                }
                                                `,
                                            transparent: true
                                        })
                                    );
                                    (mesh as any).features = features;

                                    mesh.updateMatrix();
                                    mesh.updateMatrixWorld(true);
                                    this.objectsHolder.add(mesh);
                                }
                            }

                            render();
                        },
                        resolve
                    );
                } catch (err) {
                    console.error(err);
                }
            });
        }
        if (image) {
            const texture = new THREE.Texture(image);
            texture.generateMipmaps = false;
            texture.format = THREE.RGBFormat;
            texture.magFilter = THREE.NearestFilter;
            texture.minFilter = THREE.NearestFilter;
            texture.needsUpdate = true;

            this.material.userData.heightMap.value = texture;
        }
    }

    /**
     * Overrides normal raycasting, to avoid raycasting when isMesh is set to false.
     *
     * Switches the geometry for a simpler one for faster raycasting.
     *
     * @method raycast
     */
    raycast(raycaster, intersects) {
        if (this.isMesh === true) {
            const oldGeometry = this.geometry;
            this.geometry = Geo.MapPlaneNode.GEOMETRY;

            const result = THREE.Mesh.prototype.raycast.call(this, raycaster, intersects);

            this.geometry = oldGeometry;

            return result;
        }

        return false;
    }
}

function onControlUpdate() {
    map.lod.updateLOD(map, camera, renderer, scene);
    render();
}
const lod = new Geo.LODFrustum();
lod.subdivideDistance = 40;
lod.simplifyDistance = 140;

let map;
function createMap() {
    if (map !== undefined) {
        scene.remove(map);
    }
    const provider = debug ? new Geo.DebugProvider() : new EmptyProvider();
    provider.minZoom = 5;
    provider.maxZoom = 11;
    map = new Geo.MapView(null, provider, new LocalHeightProvider(), render);
    map.lod = lod;
    //@ts-ignore
    map.scale.set(Geo.UnitsUtils.EARTH_PERIMETER, Geo.MapHeightNode.USE_DISPLACEMENT ? Geo.MapHeightNode.MAX_HEIGHT : 1, Geo.UnitsUtils.EARTH_PERIMETER);
    map.root = new MaterialHeightShader(null, map, Geo.MapNode.ROOT, 0, 0, 0);
    map.add(map.root);
    map.mode = Geo.MapView.HEIGHT_SHADER;
    map.updateMatrixWorld(true);
    scene.add(map);
}

createMap();
const FAR = 200000;
const TEXT_HEIGHT = 180;

const camera = new THREE.PerspectiveCamera(40, window.innerWidth / window.innerHeight, 1000, FAR);
let currentPosition;
let elevation = 1000;
const EPS = 1e-5;
const tempVector = new THREE.Vector3();
camera.position.set(0, 0, EPS);
const controls = new CameraControls(camera, canvas);
controls.azimuthRotateSpeed = -0.15; // negative value to invert rotation direction
controls.polarRotateSpeed = -0.15; // negative value to invert rotation direction
controls.minZoom = 1;
controls.truckSpeed = (1 / EPS) * 20000;
controls.mouseButtons.wheel = CameraControls.ACTION.ZOOM;
controls.touches.two = CameraControls.ACTION.TOUCH_ZOOM_TRUCK;
controls.verticalDragToForward = true;
controls.saveState();

export function setPosition(coords) {
    currentPosition = Geo.UnitsUtils.datumsToSpherical(coords.lat, coords.lon);
    if (coords.altitude) {
        elevation = coords.altitude;
    }
    controls.moveTo(currentPosition.x, elevation, -currentPosition.y);
    controls.update(clock.getDelta());
}
export function setElevation(newValue) {
    elevation = newValue;
    controls.getTarget(tempVector);
    controls.moveTo(tempVector.x, elevation, tempVector.z);
    controls.update(clock.getDelta());
}
controls.addEventListener('update', () => {
    onControlUpdate();
});
const clock = new THREE.Clock();
controls.addEventListener('control', () => {
    const delta = clock.getDelta();
    controls.update(delta);
});

const renderTarget = new THREE.WebGLRenderTarget(window.innerWidth, window.innerHeight);
renderTarget.texture.format = THREE.RGBAFormat;
renderTarget.texture.minFilter = THREE.NearestFilter;
renderTarget.texture.magFilter = THREE.NearestFilter;
renderTarget.texture.generateMipmaps = false;
renderTarget.stencilBuffer = false;
renderTarget.depthBuffer = true;
//@ts-ignore
renderTarget.depthTexture = new THREE.DepthTexture();
renderTarget.depthTexture.type = renderer.capabilities.isWebGL2 ? THREE.FloatType : THREE.UnsignedShortType;
const composer = new EffectComposer(renderer, renderTarget);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const customOutline = new CustomOutlinePass(new THREE.Vector2(window.innerWidth, window.innerHeight), scene, camera);
composer.addPass(customOutline);

let minYPx = 0;
document.body.onresize = function () {
    const width = window.innerWidth;
    const height = window.innerHeight;
    const scale = width / height;
    let offWidth;
    let offHeight;
    if (scale > 1) {
        offWidth = 200;
        offHeight = Math.round(offWidth / scale);
    } else {
        offHeight = 200;

        offWidth = Math.round(offHeight * scale);
    }
    pointBufferTargetScale = width / offWidth;

    minYPx = (TEXT_HEIGHT / height) * offHeight;

    canvas4.width = Math.floor(width * devicePixelRatio);
    canvas4.height = Math.floor(height * devicePixelRatio);
    const rendererScaleRatio = 1 + (devicePixelRatio - 1) / 2;

    renderer.setSize(width, height);
    renderer.setPixelRatio(devicePixelRatio);
    renderTarget.setSize(width, height);

    pixelsBuffer = new Uint8Array(offWidth * offHeight * 4);
    rendereroff.setSize(offWidth, offHeight);
    rendereroff.setPixelRatio(1);
    pointBufferTarget.setSize(offWidth, offHeight);

    // renderer2.setSize(width, height);
    // renderer2.setPixelRatio(1);

    composer.setSize(width, height);
    composer.setPixelRatio(devicePixelRatio);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();

    render();
};
//@ts-ignore
document.body.onresize();
controls.update(clock.getDelta());

function toScreenXY(pos3D) {
    const pos = pos3D.clone();
    pos.project(camera);
    const width = window.innerWidth,
        height = window.innerHeight;
    const widthHalf = width / 2,
        heightHalf = height / 2;

    pos.x = pos.x * widthHalf + widthHalf;
    pos.y = -(pos.y * heightHalf) + heightHalf;
    pos.z = camera.position.distanceTo(pos3D);
    return pos;
}

function applyOnNode(node, cb) {
    if (node.isMesh) {
        cb(node);
    }
    node.children.forEach((n) => {
        if (n !== node.objectsHolder) {
            applyOnNode(n, cb);
        }
    });
}
function applyOnNodes(cb) {
    applyOnNode(map.children[0], cb);
}

function readShownFeatures() {
    const width = pointBufferTarget.width;
    const height = pointBufferTarget.height;
    rendereroff.readRenderTargetPixels(pointBufferTarget, 0, 0, width, height, pixelsBuffer);
    const readColors = [];
    let rFeatures = [];
    let lastColor;
    let lastColorNb = 0;
    const tempvector = new THREE.Vector3(0, 0, 0);
    function handleLastColor(index) {
        if (readColors.indexOf(lastColor) === -1) {
            readColors.push(lastColor);
            const feature = featuresByColor[lastColor];
            if (feature) {
                const coords = Geo.UnitsUtils.datumsToSpherical(feature.geometry.coordinates[1], feature.geometry.coordinates[0]);
                tempvector.set(coords.x, feature.properties.ele * exageration, -coords.y);
                const vector = toScreenXY(tempvector);
                if (vector.z / feature.properties.ele <= FAR / 4000) {
                    rFeatures.push({
                        ...feature,
                        x: vector.x,
                        y: vector.y,
                        z: vector.z
                    });
                }
            }
        }
    }
    // ingore to "high" pixels as we wont draw them because we cant draw the label
    const endIndex = pixelsBuffer.length - minYPx * 4 * width;
    for (let index = 0; index < endIndex; index += 4) {
        if (pixelsBuffer[index] !== 0 || pixelsBuffer[index + 1] !== 0 || pixelsBuffer[index + 2] !== 0) {
            const color = (pixelsBuffer[index] << 16) + (pixelsBuffer[index + 1] << 8) + pixelsBuffer[index + 2];
            if (lastColor === color) {
                lastColorNb++;
            } else {
                if (lastColor) {
                    handleLastColor(index - 1);
                }
                lastColor = color;
                lastColorNb = 1;
            }
        } else {
            if (lastColor) {
                handleLastColor(index - 1);
                lastColor = null;
                lastColorNb = 0;
            }
        }
    }
    if (lastColor) {
        handleLastColor(pixelsBuffer.length - 1);
        lastColor = null;
        lastColorNb = 0;
    }
    rFeatures = ArraySortOn(rFeatures, 'x');
    let lastFeature;
    const minDistance = 15;
    const featuresToShow = [];
    rFeatures.forEach((f) => {
        if (!lastFeature) {
            // first
            lastFeature = f;
        } else if (f.x - lastFeature.x < minDistance) {
            let deltaY = f.y - lastFeature.y;
            // const deltaZ = Math.abs(f.z - lastFeature.z);
            // if (deltaZ < 0.01) {
            deltaY = f.properties.ele - lastFeature.properties.ele;
            // }
            if (deltaY > 0) {
                lastFeature = f;
            }
        } else {
            featuresToShow.push(lastFeature);
            lastFeature = f;
        }
    });
    if (lastFeature) {
        featuresToShow.push(lastFeature);
    }

    if (!drawLines) {
        return;
    }
    const toShow = featuresToShow.length;
    ctx2d.clearRect(0, 0, canvas4.width, canvas4.height);
    ctx2d.save();
    ctx2d.scale(devicePixelRatio, devicePixelRatio);
    for (let index = 0; index < toShow; index++) {
        const f = featuresToShow[index];
        const y = f.y;
        if (y >= TEXT_HEIGHT) {
            ctx2d.beginPath();
            ctx2d.fillStyle = 'black';
            ctx2d.moveTo(f.x, TEXT_HEIGHT);
            ctx2d.lineTo(f.x, f.y);
            ctx2d.closePath();
            ctx2d.stroke();
            ctx2d.save();
            ctx2d.translate(f.x, TEXT_HEIGHT);
            ctx2d.rotate(-Math.PI / 4);
            ctx2d.font = 'bold 12px Courier';
            const text = f.properties.name;
            const text2 = f.properties.ele + 'm';
            const textWidth = ctx2d.measureText(text).width;
            const textWidth2 = ctx2d.measureText(text2).width;
            // const res = wrapText(ctx2d, text, 0, 0, 110, 12);
            ctx2d.fillStyle = '#ffffffaa';
            ctx2d.rect(0, 3, textWidth + 5 + textWidth2, -14);
            ctx2d.fill();
            ctx2d.fillStyle = 'black';
            ctx2d.fillText(text, 0, 0);
            ctx2d.font = 'normal 9px Courier';
            ctx2d.fillText(text2, textWidth + 5, 0);
            ctx2d.restore();
        }
    }
    ctx2d.restore();
}

function render() {
    if (!renderer || !composer) {
        return;
    }
    if (readFeatures && pixelsBuffer) {
        applyOnNodes((node) => {
            node.material.userData.drawBlack.value = true;
            node.material.userData.drawNormals.value = false;
            node.objectsHolder.visible = true;
        });
        if (debugGPUPicking) {
            rendereroff.setRenderTarget(null);
            rendereroff.render(scene, camera);
        }
        rendereroff.setRenderTarget(pointBufferTarget);
        rendereroff.render(scene, camera);
        readShownFeatures();
        applyOnNodes((node) => {
            node.material.userData.drawBlack.value = false;
            node.material.userData.drawNormals.value = false;
            node.objectsHolder.visible = debugFeaturePoints;
        });
    } else {
        applyOnNodes((node) => {
            node.material.userData.drawBlack.value = false;
            node.material.userData.drawNormals.value = debug;
            node.objectsHolder.visible = debugFeaturePoints;
        });
    }

    if (debug) {
        renderer.render(scene, camera);
    } else {
        composer.render();
    }
    stats.end();
}