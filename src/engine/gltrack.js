// GL objects created through a session's context, deleted when the session is disposed (ChartSession, ModelSession).
// Only a WebGL2RenderingContext itself is tracked: its create / delete methods are wrapped on the instance while the
// session lives; a wrapped or proxied context is used as given and nothing is tracked. The objects are held weakly: one
// the session has dropped without deleting it is left to the garbage collector, as without tracking.

export const GL_OBJECTS = [["createBuffer", "deleteBuffer"], ["createTexture", "deleteTexture"],
  ["createFramebuffer", "deleteFramebuffer"], ["createRenderbuffer", "deleteRenderbuffer"],
  ["createProgram", "deleteProgram"], ["createShader", "deleteShader"], ["createVertexArray", "deleteVertexArray"],
  ["createQuery", "deleteQuery"], ["createSampler", "deleteSampler"],
  ["createTransformFeedback", "deleteTransformFeedback"], ["fenceSync", "deleteSync"]];

// returns { release() }: unwraps the methods and deletes every tracked object not deleted yet, newest first
// (nothing is deleted on a lost context)
export const trackGL = (gl) => {
  if (typeof WebGL2RenderingContext !== "function" || !(gl instanceof WebGL2RenderingContext)) return { release() {} };
  const live = new Set(), entry = new WeakMap(), wrapped = [];   // {ref, del} of every object not deleted yet
  const collected = new FinalizationRegistry((e) => live.delete(e));
  for (const [c, d] of GL_OBJECTS) {
    const create = gl[c], del = gl[d];
    if (typeof create !== "function" || typeof del !== "function") continue;
    gl[c] = (...a) => {
      const o = create.apply(gl, a);
      if (o) { const e = { ref: new WeakRef(o), del: d }; live.add(e); entry.set(o, e); collected.register(o, e, e); }
      return o;
    };
    gl[d] = (o) => {
      const e = o && entry.get(o);
      if (e) { live.delete(e); entry.delete(o); collected.unregister(e); }
      return del.call(gl, o);
    };
    wrapped.push(c, d);
  }
  return {
    release() {
      for (const k of wrapped) delete gl[k];
      if (!gl.isContextLost()) for (const e of [...live].reverse()) { const o = e.ref.deref(); if (o) gl[e.del](o); }
      live.clear();
    },
  };
};
