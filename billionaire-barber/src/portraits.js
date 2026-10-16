// Portraits for the character select: each character rendered once, standing in its idle
// pose, full length, on a transparent background (a small WebGL canvas of its own,
// thrown away afterwards). Same idea as Wealth Runner 2's runner cards.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  HS.Portraits = {
    // ids -> Promise of { id: dataURL } (waits for the characters' textures first)
    make: function (ids, w, h) {
      return Promise.all(ids.map(function (id) { return HS.Body.texReady(id); })).then(function () { return HS.Portraits.render(ids, w, h); });
    },
    render: function (ids, w, h) {
      w = w || 240; h = h || 360;
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const r = new THREE.WebGLRenderer({ canvas: canvas, alpha: true, antialias: true, preserveDrawingBuffer: true });
      r.outputColorSpace = THREE.SRGBColorSpace;
      r.toneMapping = THREE.ACESFilmicToneMapping; r.toneMappingExposure = 1.1;
      r.setClearColor(0x000000, 0);
      const scene = new THREE.Scene();
      scene.add(new THREE.HemisphereLight(0xfff0e0, 0x6a5a6a, 1.6));
      const key = new THREE.DirectionalLight(0xffd2a8, 2.2); key.position.set(1.5, 3, 3); scene.add(key);
      const rim = new THREE.DirectionalLight(0x9ab8ff, 1.2); rim.position.set(-2, 2.5, -2); scene.add(rim);
      const cam = new THREE.PerspectiveCamera(24, w / h, 0.1, 50);
      const out = {};
      ids.forEach(function (id) {
        const b = HS.Body.make(id, HS.heightOf(id));
        b.play(HS.idleOf(id), { fade: 0, t: 1.2 });
        b.update(0);
        b.root.rotation.y = Math.PI - 0.32;   // facing the camera, turned a touch
        scene.add(b.root);
        const H = b.height;
        cam.position.set(0, H * 0.55, H * 2.55);
        cam.lookAt(0, H * 0.5, 0);
        r.render(scene, cam);
        out[id] = canvas.toDataURL("image/png");
        scene.remove(b.root);
      });
      r.dispose();
      try { r.forceContextLoss(); } catch (e) { /* fine */ }
      return out;
    }
  };
})(globalThis.HS);
