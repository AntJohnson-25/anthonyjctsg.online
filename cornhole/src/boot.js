// three.js is an ES module here (the characters need GLTFLoader). The game's classic scripts read it
// from globalThis.THREE; this module runs first (module and defer scripts run in document order).
import * as THREE from "three";
import { loadAvatar } from "./avatar.js";
import { mergeGeometries } from "../vendor/jsm/utils/BufferGeometryUtils.js";

globalThis.THREE = THREE;
globalThis.SB = globalThis.SB || {};
globalThis.SB.Avatar = { load: loadAvatar, maxTex: 2048 };
globalThis.SB.Merge = mergeGeometries;
