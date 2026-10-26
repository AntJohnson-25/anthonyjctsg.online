// three.js is an ES module here (the Meshy characters need GLTFLoader). The game's classic scripts read it
// from globalThis.THREE; this module runs first (module and defer scripts run in document order).
import * as THREE from "three";
import { GLTFLoader } from "../vendor/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "../vendor/jsm/utils/BufferGeometryUtils.js";

globalThis.THREE = THREE;
globalThis.WD = globalThis.WD || {};
globalThis.WD.GLTFLoader = GLTFLoader;
globalThis.WD.mergeGeometries = mergeGeometries;   // world.js batches the level's detail by material
