import { assetsOf } from "../data/assets.js";

// ShaderLib (shader index, variant selection) and UnityProgram: runs the game's own compiled shaders
// (HLSLcc GLSL ES 3.00, GLES3 variants) in WebGL2, with Unity's pass render state (passState, applyState).
//
// Each packed .glsl file holds both stages as `#ifdef VERTEX ... #endif` and
// `#ifdef FRAGMENT ... #endif`. WebGL2 (GLSL ES 3.00) has no `layout(binding=)` /
// uniform `layout(location=)`, so UNITY_SUPPORTS_UNIFORM_LOCATION is switched off,
// which the HLSLcc prelude already handles (UBOs become plain std140 blocks).
//
// Uniform values are looked up by Unity property name through a chain of property
// sheets, highest priority first (MaterialPropertyBlock > Material > globals), the
// same precedence Unity uses. HLSLcc matrix uniforms `hlslcc_mtx4x4<name>[4]` map to
// property <name> (column-major 16 floats). A uniform no sheet provides is an error:
// every value the game would set must be set explicitly.

export const GL = {
  BLEND: null, COMPARE: null, STENCIL_OP: null, BLEND_OP: null,
  init(gl) {
    // UnityEngine.Rendering.BlendMode
    this.BLEND = [gl.ZERO, gl.ONE, gl.DST_COLOR, gl.SRC_COLOR, gl.ONE_MINUS_DST_COLOR, gl.SRC_ALPHA,
                  gl.ONE_MINUS_SRC_COLOR, gl.DST_ALPHA, gl.ONE_MINUS_DST_ALPHA, gl.SRC_ALPHA_SATURATE,
                  gl.ONE_MINUS_SRC_ALPHA];
    // UnityEngine.Rendering.BlendOp (first five)
    this.BLEND_OP = [gl.FUNC_ADD, gl.FUNC_SUBTRACT, gl.FUNC_REVERSE_SUBTRACT, gl.MIN, gl.MAX];
    // UnityEngine.Rendering.CompareFunction (0 = Disabled)
    this.COMPARE = [null, gl.NEVER, gl.LESS, gl.EQUAL, gl.LEQUAL, gl.GREATER, gl.NOTEQUAL, gl.GEQUAL, gl.ALWAYS];
    // UnityEngine.Rendering.StencilOp
    this.STENCIL_OP = [gl.KEEP, gl.ZERO, gl.REPLACE, gl.INCR, gl.DECR, gl.INVERT, gl.INCR_WRAP, gl.DECR_WRAP];
  },
};

export const splitStages = (src) => {
  const lines = src.split("\n");
  const out = {};
  let depth = 0, cur = null, buf = [];
  for (const ln of lines) {
    const t = ln.trim();
    if (depth === 0 && (t === "#ifdef VERTEX" || t === "#ifdef FRAGMENT")) {
      cur = t === "#ifdef VERTEX" ? "vertex" : "fragment";
      depth = 1; buf = [];
      continue;
    }
    if (cur) {
      if (/^#\s*if/.test(t)) depth++;
      else if (/^#\s*endif/.test(t)) {
        depth--;
        if (depth === 0) { out[cur] = buf.join("\n"); cur = null; continue; }
      }
      buf.push(ln);
    }
  }
  if (!out.vertex || !out.fragment) throw new Error("variant lacks a VERTEX or FRAGMENT block");
  for (const k of ["vertex", "fragment"]) {
    const s = out[k].replace(/^\s+/, "");
    if (!s.startsWith("#version 300 es")) throw new Error(`${k} stage does not start with #version 300 es`);
    const n = (s.match(/#define UNITY_SUPPORTS_UNIFORM_LOCATION 1/g) || []).length;
    if (n > 1) throw new Error("unexpected uniform-location prelude");
    out[k] = s.replace("#define UNITY_SUPPORTS_UNIFORM_LOCATION 1", "#define UNITY_SUPPORTS_UNIFORM_LOCATION 0");
  }
  return out;
};

export class UnityProgram {
  constructor(gl, label, src) {
    this.gl = gl;
    this.label = label;
    const st = splitStages(src);
    const sh = (type, text) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, text);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
        throw new Error(`${label}: ${gl.getShaderInfoLog(s)}`);
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, sh(gl.VERTEX_SHADER, st.vertex));
    gl.attachShader(p, sh(gl.FRAGMENT_SHADER, st.fragment));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(`${label}: ${gl.getProgramInfoLog(p)}`);
    this.program = p;

    this.attribs = {};
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_ATTRIBUTES); i < n; i++) {
      const a = gl.getActiveAttrib(p, i);
      this.attribs[a.name] = gl.getAttribLocation(p, a.name);
    }

    // uniform blocks (std140): one CPU buffer + GL buffer per block
    this.blocks = [];
    const nBlocks = gl.getProgramParameter(p, gl.ACTIVE_UNIFORM_BLOCKS);
    const inBlock = new Set();
    for (let b = 0; b < nBlocks; b++) {
      const name = gl.getActiveUniformBlockName(p, b);
      const size = gl.getActiveUniformBlockParameter(p, b, gl.UNIFORM_BLOCK_DATA_SIZE);
      const idx = [...gl.getActiveUniformBlockParameter(p, b, gl.UNIFORM_BLOCK_ACTIVE_UNIFORM_INDICES)];
      idx.forEach((i) => inBlock.add(i));
      const offs = gl.getActiveUniforms(p, idx, gl.UNIFORM_OFFSET);
      const strides = gl.getActiveUniforms(p, idx, gl.UNIFORM_ARRAY_STRIDE);
      const members = idx.map((i, k) => {
        const u = gl.getActiveUniform(p, i);
        return { name: u.name.replace(/\[0\]$/, ""), type: u.type, size: u.size,
                 offset: offs[k], stride: strides[k] };
      });
      gl.uniformBlockBinding(p, b, b);
      this.blocks.push({ name, binding: b, data: new Float32Array(size / 4), buffer: gl.createBuffer(),
                         members });
    }

    this.uniforms = [];
    this.samplers = [];
    for (let i = 0, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i < n; i++) {
      if (inBlock.has(i)) continue;
      const u = gl.getActiveUniform(p, i);
      const name = u.name.replace(/\[0\]$/, "");
      const loc = gl.getUniformLocation(p, u.name);
      if (u.type === gl.SAMPLER_2D || u.type === gl.SAMPLER_3D || u.type === gl.SAMPLER_2D_ARRAY ||
          u.type === gl.SAMPLER_CUBE || u.type === gl.SAMPLER_2D_SHADOW)
        this.samplers.push({ name, loc, unit: this.samplers.length, type: u.type });
      else
        this.uniforms.push({ name, loc, type: u.type, size: u.size });
    }
  }

  static propertyName(uniformName) {
    return uniformName.startsWith("hlslcc_mtx4x4") ? uniformName.slice("hlslcc_mtx4x4".length) : uniformName;
  }

  static lookup(sheets, name, label) {
    for (const s of sheets) if (s && name in s) return s[name];
    throw new Error(`${label}: no value for shader property '${name}'`);
  }

  static floats(v, n) {
    if (typeof v === "number") return [v];
    if (v instanceof Float32Array || Array.isArray(v)) return v;
    if (v && typeof v === "object" && "x" in v) return [v.x, v.y ?? 0, v.z ?? 0, v.w ?? 0].slice(0, n);
    if (v && typeof v === "object" && "r" in v) return [v.r, v.g, v.b, v.a];
    throw new Error(`bad uniform value ${JSON.stringify(v)}`);
  }

  // Upload every uniform/sampler of this program from the property sheets.
  apply(sheets) {
    const gl = this.gl;
    gl.useProgram(this.program);
    for (const u of this.uniforms) {
      const v = UnityProgram.lookup(sheets, UnityProgram.propertyName(u.name), this.label);
      const f = UnityProgram.floats(v, 4);
      switch (u.type) {
        case gl.FLOAT: gl.uniform1fv(u.loc, f.length === u.size ? f : Float32Array.from(f).subarray(0, u.size)); break;
        case gl.FLOAT_VEC2: gl.uniform2fv(u.loc, f); break;
        case gl.FLOAT_VEC3: gl.uniform3fv(u.loc, f); break;
        case gl.FLOAT_VEC4: gl.uniform4fv(u.loc, f); break;
        case gl.INT: gl.uniform1iv(u.loc, Int32Array.from(f)); break;
        case gl.INT_VEC4: gl.uniform4iv(u.loc, Int32Array.from(f)); break;
        case gl.UNSIGNED_INT: gl.uniform1uiv(u.loc, Uint32Array.from(f)); break;
        case gl.UNSIGNED_INT_VEC4: gl.uniform4uiv(u.loc, Uint32Array.from(f)); break;
        default: throw new Error(`${this.label}: uniform type 0x${u.type.toString(16)} (${u.name})`);
      }
    }
    for (const b of this.blocks) {
      for (const m of b.members) {
        if (m.name.startsWith("Xhlslcc_UnusedX")) continue;
        const v = UnityProgram.lookup(sheets, UnityProgram.propertyName(m.name), this.label);
        const f = UnityProgram.floats(v, 4);
        const base = m.offset / 4;
        if (m.size > 1 || f.length > 4) {                 // arrays (incl. matrix columns): vec4 per element
          const step = (m.stride || 16) / 4;
          for (let e = 0; e < m.size; e++)
            for (let c = 0; c < 4; c++) b.data[base + e * step + c] = f[e * 4 + c] ?? 0;
        } else {
          for (let c = 0; c < f.length; c++) b.data[base + c] = f[c];
        }
      }
      gl.bindBuffer(gl.UNIFORM_BUFFER, b.buffer);
      gl.bufferData(gl.UNIFORM_BUFFER, b.data, gl.DYNAMIC_DRAW);
      gl.bindBufferBase(gl.UNIFORM_BUFFER, b.binding, b.buffer);
    }
    for (const s of this.samplers) {
      const t = UnityProgram.lookup(sheets, s.name, this.label);
      if (!t || !t.glTexture) throw new Error(`${this.label}: sampler ${s.name} needs a texture`);
      gl.activeTexture(gl.TEXTURE0 + s.unit);
      gl.bindTexture(gl.TEXTURE_2D, t.glTexture);
      gl.uniform1i(s.loc, s.unit);
    }
  }
};

// Render state of a shader pass, resolved against material floats.
export const passState = (state, matFloats) => {
  const val = (v) => (v.name && v.name !== "<noninit>") ? UnityProgram.lookup([matFloats], v.name, "state") : v.val;
  const b = state.rtBlend0;
  const out = {
    src: val(b.srcBlend), dst: val(b.destBlend), srcA: val(b.srcBlendAlpha), dstA: val(b.destBlendAlpha),
    op: val(b.blendOp), opA: val(b.blendOpAlpha), colMask: val(b.colMask),
    zTest: val(state.zTest), zWrite: val(state.zWrite), cull: val(state.culling),
    offsetFactor: val(state.offsetFactor), offsetUnits: val(state.offsetUnits),
    stencilRef: val(state.stencilRef), stencilRead: val(state.stencilReadMask), stencilWrite: val(state.stencilWriteMask),
    stencilFront: ["comp", "pass", "fail", "zFail"].map((k) => val(state.stencilOpFront[k])),
    stencilBack: ["comp", "pass", "fail", "zFail"].map((k) => val(state.stencilOpBack[k])),
  };
  if (state.rtSeparateBlend) throw new Error("per-target blend not implemented");
  if (val(state.alphaToMask)) throw new Error("alpha-to-mask not implemented");
  return out;
};

export const applyState = (gl, s) => {
  const G = GL;
  const noBlend = s.src === 1 && s.dst === 0 && s.srcA === 1 && s.dstA === 0;
  if (noBlend) gl.disable(gl.BLEND);
  else {
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(G.BLEND[s.src], G.BLEND[s.dst], G.BLEND[s.srcA], G.BLEND[s.dstA]);
    gl.blendEquationSeparate(G.BLEND_OP[s.op], G.BLEND_OP[s.opA]);
  }
  const cm = s.colMask;   // Unity ColorWriteMask: A=1 B=2 G=4 R=8
  gl.colorMask(!!(cm & 8), !!(cm & 4), !!(cm & 2), !!(cm & 1));
  if (s.zTest === 0 || s.zTest === 8 && !s.zWrite) gl.disable(gl.DEPTH_TEST);
  else { gl.enable(gl.DEPTH_TEST); gl.depthFunc(G.COMPARE[s.zTest]); }
  gl.depthMask(!!s.zWrite);
  if (s.cull === 0) gl.disable(gl.CULL_FACE);
  else { gl.enable(gl.CULL_FACE); gl.cullFace(s.cull === 1 ? gl.FRONT : gl.BACK); }
  if (s.offsetFactor || s.offsetUnits) {
    gl.enable(gl.POLYGON_OFFSET_FILL); gl.polygonOffset(s.offsetFactor, s.offsetUnits);
  } else gl.disable(gl.POLYGON_OFFSET_FILL);
  const stencilOff = s.stencilFront[0] === 8 && s.stencilBack[0] === 8 &&
                     s.stencilFront.slice(1).every((x) => x === 0) && s.stencilBack.slice(1).every((x) => x === 0);
  if (stencilOff) gl.disable(gl.STENCIL_TEST);
  else {
    gl.enable(gl.STENCIL_TEST);
    for (const [face, ops] of [[gl.FRONT, s.stencilFront], [gl.BACK, s.stencilBack]]) {
      gl.stencilFuncSeparate(face, G.COMPARE[ops[0]], s.stencilRef, s.stencilRead);
      gl.stencilOpSeparate(face, G.STENCIL_OP[ops[2]], G.STENCIL_OP[ops[3]], G.STENCIL_OP[ops[1]]);
    }
    gl.stencilMask(s.stencilWrite);
  }
};

// Shader index + variant selection + program cache. `base` is a packed shader
// directory (shaders.json + <name>/gles3/*.glsl + <name>.json).
export class ShaderLib {
  constructor(gl, base = "shaders", assets = assetsOf(gl)) {
    this.gl = gl;
    this.base = base;
    this.assets = assets;
    GL.init(gl);
    this.index = new Map(assets.json(`${base}/shaders.json`).map((r) => [r.name, r]));
    this.parsed = new Map();
    this.cache = new Map();
  }

  info(name) {
    if (!this.parsed.has(name)) {
      const rec = this.index.get(name);
      if (!rec) throw new Error(`shader not packed: ${name}`);
      this.parsed.set(name, this.assets.json(`${this.base}/${rec.parsed}`));
    }
    return this.parsed.get(name);
  }

  // Unity picks the variant whose keyword set equals the enabled keywords that
  // the pass declares; keywords the pass does not use are ignored.
  program(name, pass, keywords = [], subShader = 0) {
    const rec = this.index.get(name);
    if (!rec) throw new Error(`shader not packed: ${name}`);
    const vs = rec.variants.filter((v) => v.subShader === subShader && v.pass === pass);
    if (!vs.length) throw new Error(`${name}: no GLES3 variants for subshader ${subShader} pass ${pass}`);
    const known = new Set(vs.flatMap((v) => v.keywords));
    const want = [...new Set(keywords.filter((k) => known.has(k)))].sort();
    const v = vs.find((x) => x.keywords.length === want.length && [...x.keywords].sort().every((k, i) => k === want[i]));
    if (!v) throw new Error(`${name} pass ${pass}: no variant for [${want.join(" ")}]`);
    if (!this.cache.has(v.file)) {
      const label = `${name}#${subShader}.${pass}[${want.join(" ")}]`;
      this.cache.set(v.file, new UnityProgram(this.gl, label, this.assets.text(`${this.base}/${v.file}`)));
    }
    return this.cache.get(v.file);
  }

  state(name, pass, matFloats, subShader = 0) {
    return passState(this.info(name).subShaders[subShader].passes[pass].state, matFloats);
  }

  // Shader property defaults (what CoreUtils.CreateEngineMaterial / an unset
  // material property yields). Unity ShaderPropertyType: 0 Color, 1 Vector,
  // 2 Float, 3 Range, 4 Texture, 5 Int. Texture defaults resolve through
  // `textures` (name -> texture, e.g. white/black/gray/bump).
  defaults(name, textures) {
    const out = {};
    for (const p of this.info(name).properties) {
      const d = [p["m_DefValue[0]"], p["m_DefValue[1]"], p["m_DefValue[2]"], p["m_DefValue[3]"]];
      if (p.m_Type === 0 || p.m_Type === 1) out[p.m_Name] = d;
      else if (p.m_Type === 2 || p.m_Type === 3 || p.m_Type === 5) out[p.m_Name] = d[0];
      else if (p.m_Type === 4) {
        const t = textures[p.m_DefTexture.m_DefaultName || "gray"];
        if (!t) throw new Error(`${name}: default texture '${p.m_DefTexture.m_DefaultName}'`);
        out[p.m_Name] = t;
      } else throw new Error(`${name}: property type ${p.m_Type}`);
    }
    return out;
  }
};
