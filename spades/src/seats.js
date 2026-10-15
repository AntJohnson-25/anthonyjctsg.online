// Who's at the table.
//  - Everyone is one of the user's own characters (HS.Body: Mixamo rigs from their
//    other games); you are Ant. Seated with the user's "Seated Idle" clip.
//  - Cards stand in a tray (Hop Spades af347cb): hands rest either side of it, and
//    the player about to play reaches over it (two-bone IK in world space, so it
//    works on any rig, whatever its bone axes).
//  - Reactions: the seated Victory and Clapping clips (upper body only, over the
//    seated pose), plus nod, head shake, head drop, laugh, thumbs up, shrug,
//    facepalm and point, made in code on the same skeleton.
//  - Your own head is hidden (you're looking out of it).
// The table is always at the origin: the villa moves so the table you sit at is there.
globalThis.HS = globalThis.HS || {};
(function (HS) {
  "use strict";
  const THREE = globalThis.THREE;
  const Room = HS.Room, U = HS.U;
  const S = { actors: [null, null, null, null], tags: [], tents: [], strips: [], ready: false, eye: new THREE.Vector3(0, 1.17, 0.8) };
  const HIPS = 0, CHEST = 2, NECK = 3, HEAD = 4;
  const ARM = { R: [5, 6, 7, 8], L: [9, 10, 11, 12] };

  S.avatarStates = function () { return {}; };
  // seats[s][3] is the character id (HS.CAST).
  function bodyKey(st, s) { return "ch:" + st.seats[s][3]; }

  // ------------------------------------------------------------------ an actor
  // Upper-body clips are sampled by hand (only the arms, spine, neck and head)
  // and laid over the seated pose, so a standing "cheer" works in a chair.
  function upperTracks(e, clip) {
    if (!clip || !e.rig) return null;
    const lower = new Set([e.rig[HIPS], e.rig[13], e.rig[14], e.rig[15], e.rig[16], e.rig[17], e.rig[18]].filter(Boolean).map(function (b) { return b.name; }));
    const byName = {};
    e.bones.forEach(function (b) { byName[b.name] = b; });
    const out = [];
    clip.tracks.forEach(function (t) {
      const m = /^(.*)\.quaternion$/.exec(t.name);
      if (!m || lower.has(m[1]) || !byName[m[1]]) return;
      out.push({ bone: byName[m[1]], interp: t.createInterpolant(), q: new THREE.Quaternion() });
    });
    return { dur: clip.duration, tracks: out };
  }
  // The seated base pose, sampled by hand every frame too. (Not an AnimationMixer:
  // a mixer only writes a bone when its value changed since the last frame, so
  // the still legs and hips of a sitting clip were written once, then lost to
  // resetBones() and stood back up.)
  function baseTracks(e, clip) {
    if (!clip) return null;
    const byName = {};
    e.bones.forEach(function (b) { byName[b.name] = b; });
    const out = [];
    clip.tracks.forEach(function (t) {
      const m = /^(.*)\.(quaternion|position|scale)$/.exec(t.name);
      if (!m || !byName[m[1]]) return;
      out.push({ bone: byName[m[1]], prop: m[2], interp: t.createInterpolant() });
    });
    return { dur: clip.duration, tracks: out };
  }
  function pose(a) {
    const c = a.base;
    if (!c) return;
    const tt = c.dur > 0 ? a.clock % c.dur : 0;
    c.tracks.forEach(function (k) { k.bone[k.prop].fromArray(k.interp.evaluate(tt)); });
  }
  function makeActor(e, s, o) {
    const root = new THREE.Group(), body = new THREE.Group();
    root.add(body);
    const scene = e.gltf.scene;
    if (scene.parent) scene.parent.remove(scene);
    body.add(scene);
    const scale = 1;   // HS.Body already made it its own height
    const a = { e: e, s: s, root: root, body: body, key: o.key, bot: o.bot, scale: scale, clock: Math.random() * 10,
      emotes: {}, reacts: [], hold: 0, glance: 0, look: new THREE.Vector3(), eye: new THREE.Vector3(), me: false };
    a.base = baseTracks(e, e.clips["sit-table"] || e.clips.sit || e.clips.idle);
    ["cheer", "clap"].forEach(function (k) { a.emotes[k] = upperTracks(e, e.clips[k]); });
    // Seat it: pose once, then line the hips up over the chair.
    resetBones(e);
    root.updateMatrixWorld(true);
    // How high the ankle bones sit above the soles when standing (where they belong when the foot is flat).
    const ankle = e.rig ? Math.max(0, Math.min(e.rig[15].getWorldPosition(new THREE.Vector3()).y, e.rig[18].getWorldPosition(new THREE.Vector3()).y) - e.minY * scale) : 0;
    pose(a);
    root.position.copy(Room.seatPos(s, Room.SEAT_R + 0.12));
    root.rotation.y = Room.seatYaw(s);
    root.updateMatrixWorld(true);
    a.kick = [0, 0];
    if (e.rig) {
      const hp = e.rig[HIPS].getWorldPosition(new THREE.Vector3());
      root.worldToLocal(hp);
      body.position.set(-hp.x, 0, -hp.z + 0.06);
      root.updateMatrixWorld(true);
      const hipsY = e.rig[HIPS].getWorldPosition(new THREE.Vector3()).y;
      // Sit on the cushion (0.53): lift or lower so the hips are just above it.
      const want = 0.6 - hipsY;
      body.position.y = Math.abs(want) < 0.25 ? want : 0;
      root.updateMatrixWorld(true);
      // Long legs: swing the shins forward until the feet stand on the deck
      // instead of through it (short legs just dangle a little, like people do).
      [[14, 15], [17, 18]].forEach(function (lf, i) {
        const knee = e.rig[lf[0]].getWorldPosition(new THREE.Vector3()), foot = e.rig[lf[1]].getWorldPosition(new THREE.Vector3());
        const L = knee.distanceTo(foot), drop = knee.y - (ankle + 0.005);
        if (foot.y < ankle && L > 0.05 && drop > 0) a.kick[i] = Math.acos(U.clamp(drop / L, -1, 1)) - Math.acos(U.clamp((knee.y - foot.y) / L, -1, 1));
      });
    }
    HS.View.scene.add(root);
    return a;
  }
  function resetBones(e) {
    for (let i = 0; i < e.bones.length; i++) { e.bones[i].quaternion.copy(e.rest[i]); e.bones[i].position.copy(e.restPos[i]); e.bones[i].scale.copy(e.restScale[i]); }
  }
  function drop(a) { if (a && a.root) HS.View.scene.remove(a.root); }

  // ------------------------------------------------------------------ bone helpers (world space)
  const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion(), _p = new THREE.Quaternion(), _v = new THREE.Vector3(), _w = new THREE.Vector3();
  // Rotate a bone by `angle` about a world axis (keeps whatever pose it had).
  function rotWorld(bone, axis, angle) {
    if (!bone || !angle) return;
    bone.updateWorldMatrix(true, false);
    bone.getWorldQuaternion(_q);
    _q2.setFromAxisAngle(axis, angle).multiply(_q);
    bone.parent.getWorldQuaternion(_p);
    bone.quaternion.copy(_p.invert().multiply(_q2));
  }
  // Swing a bone so the direction from it to `tipNow` points along `dirWant` (world).
  // Own scratch vectors: callers pass _v/_w as `dirWant`, and reusing those here
  // overwrote the target mid-sum (forearms swung away from the table).
  const _af = new THREE.Vector3(), _ad = new THREE.Vector3(), _ab = new THREE.Vector3();
  function aim(bone, tipNow, dirWant, w) {
    _ad.copy(dirWant).normalize();
    const from = _af.copy(tipNow).sub(bone.getWorldPosition(_ab)).normalize();
    _q2.setFromUnitVectors(from, _ad);
    bone.getWorldQuaternion(_q);
    const want = _q2.multiply(_q);
    bone.parent.getWorldQuaternion(_p);
    const local = _p.invert().multiply(want);
    if (w >= 1) bone.quaternion.copy(local); else bone.quaternion.slerp(local, w);
    bone.updateWorldMatrix(false, true);
  }
  const _s = new THREE.Vector3(), _e = new THREE.Vector3(), _h = new THREE.Vector3(), _t = new THREE.Vector3(), _d = new THREE.Vector3(), _pl = new THREE.Vector3(), _el = new THREE.Vector3();
  // Two-bone IK: put the hand of chain (upper, lower, hand) at `target`, the elbow toward `pole`.
  function ik(e, side, target, pole, w) {
    const ch = ARM[side];
    const up = e.rig[ch[1]], lo = e.rig[ch[2]], hd = e.rig[ch[3]];
    if (!up || !lo || !hd || w <= 0.001) return;
    up.updateWorldMatrix(true, true);
    up.getWorldPosition(_s); lo.getWorldPosition(_e); hd.getWorldPosition(_h);
    const a = _s.distanceTo(_e), b = _e.distanceTo(_h);
    _d.copy(target).sub(_s);
    let c = _d.length();
    c = U.clamp(c, Math.abs(a - b) + 0.01, a + b - 0.005);
    _d.normalize();
    const cosA = U.clamp((a * a + c * c - b * b) / (2 * a * c), -1, 1), sinA = Math.sqrt(1 - cosA * cosA);
    _pl.copy(pole).sub(_s);
    _pl.addScaledVector(_d, -_pl.dot(_d)).normalize();
    _el.copy(_s).addScaledVector(_d, a * cosA).addScaledVector(_pl, a * sinA);
    const t = _t.copy(_s).addScaledVector(_d, c);
    aim(up, _e, _v.copy(_el).sub(_s), w);
    lo.getWorldPosition(_e); hd.getWorldPosition(_h);
    aim(lo, _h, _w.copy(t).sub(_e), w);
  }

  // ------------------------------------------------------------------ reactions
  // kind -> duration (s). Clip ones fall back to code if an avatar lacks the clip.
  S.REACT = { wave: 2, cheer: 3, shrug: 1.6, nod: 1.3, shake: 1.4, headdrop: 1.6, laugh: 1.8, thumbs: 1.6, clap: 1.8, facepalm: 1.8, point: 1.6, sheepish: 1.3 };
  S.react = function (s, kind, at) {
    const a = S.actors[s];
    if (!a || !a.root || !S.REACT[kind]) return;
    a.reacts = a.reacts.filter(function (r) { return r.t < r.dur; });
    if (a.reacts.length >= 2) a.reacts.shift();
    a.reacts.push({ kind: kind, t: 0, dur: S.REACT[kind], at: at !== undefined ? at : -1 });
  };
  function env(r) { return U.ease(r.t / 0.25) * U.ease((r.dur - r.t) / 0.3); }
  function applyReacts(a, dt) {
    const e = a.e, rig = e.rig;
    if (!rig) return;
    const right = _v.set(1, 0, 0).applyQuaternion(a.root.quaternion).clone(), upW = new THREE.Vector3(0, 1, 0);
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(a.root.quaternion);
    let handsBusy = 0;
    a.reacts.forEach(function (r) {
      r.t += dt;
      if (r.t >= r.dur) return;
      const w = env(r), u = r.t / r.dur;
      const em = a.emotes[r.kind];
      if (em && em.tracks.length) {
        const tt = u * em.dur;
        em.tracks.forEach(function (k) { k.q.fromArray(k.interp.evaluate(tt)); k.bone.quaternion.slerp(k.q, w); });
        handsBusy = Math.max(handsBusy, w);
        return;
      }
      switch (r.kind) {
        case "nod": rotWorld(rig[HEAD], right, -Math.abs(Math.sin(u * Math.PI * 3)) * 0.3 * w); break;
        case "shake": rotWorld(rig[HEAD], upW, Math.sin(u * Math.PI * 6) * 0.38 * w); break;
        case "headdrop":
          rotWorld(rig[CHEST], right, -0.18 * w); rotWorld(rig[NECK], right, -0.25 * w); rotWorld(rig[HEAD], right, -0.25 * w); break;
        case "laugh":
          rotWorld(rig[CHEST], right, (0.2 + Math.abs(Math.sin(u * 30)) * 0.06) * w); rotWorld(rig[HEAD], right, 0.25 * w); break;
        case "sheepish":
        case "shrug":
          rotWorld(rig[HEAD], fwd, 0.2 * w);
          if (rig[5]) rotWorld(rig[5], fwd, -0.25 * w);
          if (rig[9]) rotWorld(rig[9], fwd, 0.25 * w);
          break;
        default: handsBusy = Math.max(handsBusy, w);
      }
    });
    a.handsBusy = handsBusy;
    a.reacts = a.reacts.filter(function (r) { return r.t < r.dur; });
  }
  // The hand reactions made in code (IK), after the hold pose.
  function applyHandReacts(a) {
    const e = a.e, rig = e.rig;
    if (!rig) return;
    const fwd = new THREE.Vector3(0, 0, -1).applyQuaternion(a.root.quaternion), right = new THREE.Vector3(1, 0, 0).applyQuaternion(a.root.quaternion), up = new THREE.Vector3(0, 1, 0);
    const chest = rig[CHEST].getWorldPosition(new THREE.Vector3()), head = rig[HEAD].getWorldPosition(new THREE.Vector3());
    const sc = a.scale;
    a.reacts.forEach(function (r) {
      if (a.emotes[r.kind] && a.emotes[r.kind].tracks.length) return;
      const w = env(r), u = r.t / r.dur;
      const tgt = new THREE.Vector3(), pole = new THREE.Vector3();
      if (r.kind === "thumbs") {
        tgt.copy(chest).addScaledVector(right, 0.2 * sc).addScaledVector(fwd, 0.3 * sc).addScaledVector(up, 0.12 * sc);
        pole.copy(chest).addScaledVector(right, 0.5).addScaledVector(up, -0.4);
        ik(e, "R", tgt, pole, w);
      } else if (r.kind === "clap") {
        const gap = (0.03 + Math.abs(Math.sin(u * Math.PI * 7)) * 0.09) * sc;
        ["R", "L"].forEach(function (sd) {
          const k = sd === "R" ? 1 : -1;
          tgt.copy(chest).addScaledVector(fwd, 0.28 * sc).addScaledVector(up, 0.02).addScaledVector(right, k * gap);
          pole.copy(chest).addScaledVector(right, k * 0.6).addScaledVector(up, -0.5);
          ik(e, sd, tgt, pole, w);
        });
      } else if (r.kind === "facepalm") {
        tgt.copy(head).addScaledVector(fwd, 0.1 * sc).addScaledVector(up, 0.06 * sc);
        pole.copy(chest).addScaledVector(right, 0.4).addScaledVector(up, -0.6).addScaledVector(fwd, 0.2);
        ik(e, "R", tgt, pole, w);
        rotWorld(rig[HEAD], right, -0.2 * w);
      } else if (r.kind === "point") {
        const sh = rig[6].getWorldPosition(new THREE.Vector3());
        const dir = (r.at >= 0 ? Room.seatPos(r.at, 0.9).setY(1.1) : new THREE.Vector3(0, Room.TABLE_Y, 0)).sub(sh).normalize();
        tgt.copy(sh).addScaledVector(dir, 0.55 * sc);
        pole.copy(sh).addScaledVector(up, -1).addScaledVector(right, 0.3);
        ik(e, "R", tgt, pole, w);
      }
    });
  }

  // ------------------------------------------------------------------ labels: name tags and bid tents
  // A name pill in the team colour (lime: our side, lilac: theirs); your partner's
  // also wears a lime PARTNER badge on top. Whoever's turn it is goes Paper-white.
  const TEAM = { us: "#c4f35b", them: "#aba7f8" };
  function rr(g, x, y, w, h, r) { g.beginPath(); if (g.roundRect) g.roundRect(x, y, w, h, r); else g.rect(x, y, w, h); }
  function nameTag(name, color, turn, partner) {
    const c = HS.Build.canvas(384, 128), g = c.getContext("2d");
    g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "800 38px 'Segoe UI', system-ui, sans-serif";
    const w = Math.min(370, g.measureText(name).width + 48);
    g.fillStyle = turn ? "rgba(246,245,239,0.96)" : "rgba(20,24,34,0.84)";
    rr(g, 192 - w / 2, 50, w, 64, 32); g.fill();
    g.lineWidth = 6; g.strokeStyle = color; g.stroke();
    g.fillStyle = turn ? "#141822" : "#ffffff"; g.fillText(name, 192, 83, 330);
    if (partner) {
      g.font = "900 22px 'Segoe UI', system-ui, sans-serif";
      const pw = g.measureText("PARTNER").width + 30;
      g.fillStyle = TEAM.us; rr(g, 192 - pw / 2, 14, pw, 32, 16); g.fill();
      g.fillStyle = "#141822"; g.fillText("PARTNER", 192, 31);
    }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  function tentTex(lines, color) {
    const c = HS.Build.canvas(256, 160), g = c.getContext("2d");
    g.fillStyle = "#f6f1e4"; g.fillRect(0, 0, 256, 160);
    g.fillStyle = color; g.fillRect(0, 0, 256, 14); g.fillRect(0, 146, 256, 14);
    g.textAlign = "center"; g.textBaseline = "middle";
    g.fillStyle = "#1b1b22"; g.font = "900 64px 'Segoe UI', system-ui, sans-serif"; g.fillText(lines[0], 128, 66, 236);
    g.fillStyle = "#555"; g.font = "700 30px 'Segoe UI', system-ui, sans-serif"; g.fillText(lines[1], 128, 122, 236);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
    return t;
  }
  function makeLabels() {
    for (let s = 0; s < 4; s++) {
      const tag = new THREE.Sprite(new THREE.SpriteMaterial({ transparent: true, depthWrite: false }));
      tag.scale.set(0.62, 0.207, 1); tag.renderOrder = 20;
      HS.View.scene.add(tag);
      S.tags.push({ sprite: tag, key: "" });
      // A folded tent card on the felt: two leaves leaning together.
      const g = new THREE.Group();
      const mat = new THREE.MeshStandardMaterial({ roughness: 0.6, emissive: 0xffffff, emissiveIntensity: 0.12 });
      const leaf = new THREE.PlaneGeometry(0.11, 0.07);
      const a = new THREE.Mesh(leaf, mat), b = new THREE.Mesh(leaf, mat);
      a.position.set(0, 0.032, 0.012); a.rotation.x = -0.35;
      b.position.set(0, 0.032, -0.012); b.rotation.set(0.35, Math.PI, 0);
      a.castShadow = b.castShadow = true;
      g.add(a); g.add(b);
      const f = HS.Cards.seatFrame(s);
      g.position.copy(f.pos).multiplyScalar(0.39 / Room.SEAT_R).addScaledVector(f.right, -0.22);   // clear of the tray (room.js)
      g.position.y = Room.TABLE_Y;
      g.rotation.y = f.yaw;
      HS.View.scene.add(g);
      S.tents.push({ g: g, mat: mat, key: "" });
      // A glowing strip along the front lip of the seat's tray, in its team colour.
      const strip = new THREE.Mesh(new THREE.BoxGeometry(Room.TRAY_W, 0.005, 0.006), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }));
      strip.position.copy(f.pos).multiplyScalar(Room.TRAY_R / Room.SEAT_R).addScaledVector(f.fwd, -(Room.TRAY_GROOVE + 0.014));
      strip.position.y = Room.TABLE_Y + 0.002 + Room.TRAY_FLOOR + 0.0145;
      strip.rotation.y = f.yaw;
      HS.View.scene.add(strip);
      S.strips.push(strip);
    }
  }

  // ------------------------------------------------------------------ per frame
  // V: { st, seat (ours), dt, t, eyeLook (where we're looking, for our own head), teamColor(s), names }
  S.update = function (V) {
    const st = V.st, dt = V.dt;
    if (!S.tags.length) makeLabels();
    if (!st) {
      S.actors.forEach(drop); S.actors = [null, null, null, null];
      S.tags.forEach(function (t) { t.sprite.visible = false; }); S.tents.forEach(function (t) { t.g.visible = false; });
      S.strips.forEach(function (m) { m.visible = false; });
      return;
    }
    for (let s = 0; s < 4; s++) {
      const x = st.seats[s];
      const key = bodyKey(st, s);
      let a = S.actors[s];
      if (!a || a.key !== key) {
        const id = x[3];
        if (!HS.Body.ready(id)) { HS.Body.load(id); continue; }   // still downloading
        if (a && a.root) drop(a);
        S.actors[s] = makeActor(HS.Body.make(id, HS.heightOf(id)).e, s, { key: key, bot: !!x[1] });
        continue;
      }
      if (!a.root) continue;
      a.me = s === V.seat;
      updateActor(a, V, st);
    }
    labels(V, st);
  };
  const _look = new THREE.Vector3();
  function updateActor(a, V, st) {
    const e = a.e, dt = V.dt;
    resetBones(e);
    a.clock += dt;
    pose(a);
    a.root.updateMatrixWorld(true);
    if (!e.rig) return;
    if (a.kick[0] || a.kick[1]) {
      const right = HS.Cards.seatFrame(a.s).right;
      rotWorld(e.rig[14], right, a.kick[0]); rotWorld(e.rig[15], right, -a.kick[0]);
      rotWorld(e.rig[17], right, a.kick[1]); rotWorld(e.rig[18], right, -a.kick[1]);
    }
    applyReacts(a, dt);
    // The cards stand in the tray: hands rest on the felt either side of it, and
    // whoever is about to play reaches over it with the right hand (not us: our
    // own hand would hide our cards).
    const want = st.ph !== "hand" && st.ph !== "over" ? 1 : 0;
    a.hold += (want - a.hold) * Math.min(1, dt * 3);
    const reach = !a.me && st.ph === "play" && st.tu === a.s ? 1 : 0;
    a.reach = (a.reach || 0) + (reach - (a.reach || 0)) * Math.min(1, dt * 4);
    const hw = a.hold * (1 - (a.handsBusy || 0));
    if (hw > 0.01) {
      const f = HS.Cards.seatFrame(a.s);
      const tray = f.pos.clone().multiplyScalar(Room.TRAY_R / Room.SEAT_R).setY(Room.TABLE_Y);
      const pole = new THREE.Vector3();
      ["R", "L"].forEach(function (sd) {
        const k = sd === "R" ? 1 : -1;
        const t = tray.clone().addScaledVector(f.right, k * (Room.TRAY_W / 2 + 0.07)).addScaledVector(f.fwd, -0.06).setY(Room.TABLE_Y + 0.05);
        if (sd === "R" && a.reach > 0.01) t.lerp(tray.clone().addScaledVector(f.right, 0.06).setY(Room.TABLE_Y + 0.16), a.reach);
        pole.copy(a.root.position).addScaledVector(f.right, k * 0.7).setY(0.3);
        ik(e, sd, t, pole, hw);
      });
    }
    applyHandReacts(a);
    // Heads follow the game: whoever's turn it is, or down at their own cards.
    if (!a.me) {
      const tu = st.tu;
      if (tu >= 0 && tu !== a.s) _look.copy(Room.seatPos(tu, 0.9)).setY(1.15);
      else _look.copy(HS.Cards.seatFrame(a.s).pos).multiplyScalar(Room.TRAY_R / Room.SEAT_R).setY(Room.TABLE_Y + 0.06);   // their own tray
      a.look.lerp(_look, Math.min(1, dt * 2.5));
      const head = e.rig[HEAD];
      const hp = head.getWorldPosition(new THREE.Vector3());
      const dir = a.look.clone().sub(hp).normalize();
      const f = HS.Cards.seatFrame(a.s);
      const yaw = Math.atan2(dir.dot(f.right), dir.dot(f.fwd));
      rotWorld(head, new THREE.Vector3(0, 1, 0), -U.clamp(yaw, -0.8, 0.8) * 0.6);
    }
    // Our own head: hidden (the camera is in it). Its position gives the eye.
    if (a.me) {
      const head = e.rig[HEAD];
      head.getWorldPosition(a.eye);
      head.scale.setScalar(0.001);
      const f = HS.Cards.seatFrame(a.s);
      a.eye.y += 0.075 * a.scale * (e.height / 1.6);
      a.eye.addScaledVector(f.fwd, 0.06);
      S.eye.lerp(a.eye, Math.min(1, dt * 6));
      if (!S.eyeSet) { S.eye.copy(a.eye); S.eyeSet = true; }
    }
  }
  function labels(V, st) {
    for (let s = 0; s < 4; s++) {
      const x = st.seats[s], a = S.actors[s], tag = S.tags[s], tent = S.tents[s];
      // Spectators see team A in lime, team B in lilac.
      const ours = V.seat >= 0 ? s % 2 === V.seat % 2 : s % 2 === 0;
      const color = ours ? TEAM.us : TEAM.them;
      const partner = V.seat >= 0 && s === (V.seat + 2) % 4;
      const turn = st.tu === s && (st.ph === "bid" || st.ph === "play");
      S.strips[s].material.color.set(color); S.strips[s].visible = true;
      // Name tag over the head (not ours).
      const key = x[0] + (turn ? "*" : "") + color + (partner ? "P" : "");
      if (tag.key !== key) { tag.key = key; if (tag.sprite.material.map) tag.sprite.material.map.dispose(); tag.sprite.material.map = nameTag(x[0], color, turn, partner); tag.sprite.material.needsUpdate = true; }
      const hp = a && a.root && a.e && a.e.rig ? a.e.rig[HEAD].getWorldPosition(new THREE.Vector3()) : Room.seatPos(s, 0.85).setY(1.25);
      tag.sprite.position.set(hp.x, hp.y + 0.36, hp.z);
      tag.sprite.visible = s !== V.seat && !V.hideTags;
      // Bid tent.
      const b = st.bids[s];
      const bidTxt = b === null ? (st.ph === "bid" && turn ? "…" : "—") : b === -1 ? "B. NIL" : b === 0 ? "NIL" : "BID " + b;
      const sub = st.ph === "bid" ? (b === null ? (turn ? V.t("thinking") : V.t("waiting")) : V.t("took", st.tk[s])) : V.t("took", st.tk[s]);
      const tkey = bidTxt + "|" + sub + "|" + color;
      if (tent.key !== tkey) { tent.key = tkey; if (tent.mat.map) tent.mat.map.dispose(); tent.mat.map = tentTex([bidTxt, sub], color); tent.mat.emissiveMap = tent.mat.map; tent.mat.needsUpdate = true; }
      tent.g.visible = st.ph !== "over";
    }
  }
  S.headPos = function (s) {
    const a = S.actors[s];
    if (a && a.root && a.e.rig) return a.e.rig[HEAD].getWorldPosition(new THREE.Vector3());
    return Room.seatPos(s, 0.85).setY(1.2);
  };
  S.clear = function () { S.actors.forEach(drop); S.actors = [null, null, null, null]; S.eyeSet = false; };
  HS.Seats = S;
})(globalThis.HS);
