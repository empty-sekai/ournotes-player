// Unity-convention math: mat4, quat and a Transform node. Matrices are column-major Float32Array(16):
// m[col * 4 + row], which is also the layout HLSLcc's `hlslcc_mtx4x4<name>[4]` column arrays expect.

export const mat4 = {
  identity() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },

  mul(a, b) {
    const o = new Float32Array(16);
    for (let c = 0; c < 4; c++)
      for (let r = 0; r < 4; r++) {
        let s = 0;
        for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
        o[c * 4 + r] = s;
      }
    return o;
  },

  // Unity Matrix4x4.TRS(t, q, s)
  trs(t, q, s) {
    const { x, y, z, w } = q;
    const m = new Float32Array(16);
    m[0] = (1 - 2 * (y * y + z * z)) * s.x; m[1] = (2 * (x * y + z * w)) * s.x; m[2] = (2 * (x * z - y * w)) * s.x;
    m[4] = (2 * (x * y - z * w)) * s.y; m[5] = (1 - 2 * (x * x + z * z)) * s.y; m[6] = (2 * (y * z + x * w)) * s.y;
    m[8] = (2 * (x * z + y * w)) * s.z; m[9] = (2 * (y * z - x * w)) * s.z; m[10] = (1 - 2 * (x * x + y * y)) * s.z;
    m[12] = t.x; m[13] = t.y; m[14] = t.z; m[15] = 1;
    return m;
  },

  // inverse of a rigid transform (rotation + translation, unit scale)
  inverseRigid(m) {
    const o = new Float32Array(16);
    for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) o[c * 4 + r] = m[r * 4 + c];
    for (let r = 0; r < 3; r++) o[12 + r] = -(o[r] * m[12] + o[4 + r] * m[13] + o[8 + r] * m[14]);
    o[15] = 1;
    return o;
  },

  // Unity Matrix4x4.Perspective (OpenGL clip space, what GLES uses unchanged)
  perspective(fovYDeg, aspect, near, far) {
    const f = 1 / Math.tan((fovYDeg * Math.PI / 180) / 2);
    const m = new Float32Array(16);
    m[0] = f / aspect; m[5] = f;
    m[10] = -(far + near) / (far - near); m[11] = -1;
    m[14] = -(2 * far * near) / (far - near);
    return m;
  },

  transformPoint(m, p) {
    return { x: m[0] * p.x + m[4] * p.y + m[8] * p.z + m[12],
             y: m[1] * p.x + m[5] * p.y + m[9] * p.z + m[13],
             z: m[2] * p.x + m[6] * p.y + m[10] * p.z + m[14] };
  },

  scale(x, y, z) { const m = mat4.identity(); m[0] = x; m[5] = y; m[10] = z; return m; },
};

export const quat = {
  identity() { return { x: 0, y: 0, z: 0, w: 1 }; },

  mul(a, b) {
    return {
      x: a.w * b.x + a.x * b.w + a.y * b.z - a.z * b.y,
      y: a.w * b.y - a.x * b.z + a.y * b.w + a.z * b.x,
      z: a.w * b.z + a.x * b.y - a.y * b.x + a.z * b.w,
      w: a.w * b.w - a.x * b.x - a.y * b.y - a.z * b.z,
    };
  },

  axisAngle(ax, ay, az, deg) {
    const h = deg * Math.PI / 360, s = Math.sin(h);
    return { x: ax * s, y: ay * s, z: az * s, w: Math.cos(h) };
  },

  // Unity Quaternion.Euler: rotation about Z, then X, then Y (q = qy * qx * qz)
  euler(ex, ey, ez) {
    const q = quat;
    return q.mul(q.mul(q.axisAngle(0, 1, 0, ey), q.axisAngle(1, 0, 0, ex)), q.axisAngle(0, 0, 1, ez));
  },
};

// A Unity-like Transform node (local TRS, parent chain).
export class Transform {
  constructor(name, parent = null) {
    this.name = name;
    this.parent = null;
    this.children = [];
    this.localPosition = { x: 0, y: 0, z: 0 };
    this.localRotation = quat.identity();
    this.localEuler = null;              // set when driven through localEulerAngles
    this.localScale = { x: 1, y: 1, z: 1 };
    if (parent) this.setParent(parent);
  }

  setParent(p) {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = p;
    if (p) p.children.push(this);
  }

  // Unity Transform.localEulerAngles setter
  setLocalEuler(x, y, z) {
    this.localEuler = { x, y, z };
    this.localRotation = quat.euler(x, y, z);
  }

  localMatrix() { return mat4.trs(this.localPosition, this.localRotation, this.localScale); }

  localToWorld() {
    const l = this.localMatrix();
    return this.parent ? mat4.mul(this.parent.localToWorld(), l) : l;
  }

  worldPosition() { const m = this.localToWorld(); return { x: m[12], y: m[13], z: m[14] }; }

  find(path) {
    let t = this;
    for (const part of path.split("/")) {
      t = t.children.find((c) => c.name === part);
      if (!t) throw new Error(`transform not found: ${path}`);
    }
    return t;
  }
};
