// The worker transports JSON to Rust. It contains no grading or scoring rules.
import { parseJustJudgementTypes } from "./replay-preset.js";
let session;
const decode = new TextDecoder();
async function verified(url, identity) {
  const response = await fetch(url, { credentials: "omit" });
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${url}`);
  const bytes = await response.arrayBuffer();
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))].map(x => x.toString(16).padStart(2, "0")).join("");
  if (!/^[0-9a-f]{64}$/i.test(identity.sha256 ?? "") || hash !== identity.sha256.toLowerCase()) throw new Error(`SHA-256 mismatch: ${url}`);
  if (identity.bytes !== undefined && identity.bytes !== bytes.byteLength) throw new Error(`Size mismatch: ${url}`);
  return bytes;
}
self.onmessage = async ({data:message}) => {
  const {id,op,args=[]}=message;
  try {
    if (op === "init") {
      const [site,reference]=args;
      if (reference.format !== "nnnotes.replay-manifest/1") throw new Error("Unsupported replay manifest");
      const manifestUrl = new URL(reference.manifestUrl,site).href;
      const manifest = JSON.parse(decode.decode(await verified(manifestUrl,reference)));
      if (manifest.format !== reference.format || manifest.engine?.requestFormat !== "ournotes.replay/1") throw new Error("Unsupported replay engine");
      const resolve = item => new URL(item.url,manifestUrl).href;
      const [data,js,wasm]=await Promise.all([verified(resolve(manifest.deckData),manifest.deckData),verified(resolve(manifest.engine.js),manifest.engine.js),verified(resolve(manifest.engine.wasm),manifest.engine.wasm)]);
      const moduleUrl=URL.createObjectURL(new Blob([js],{type:"text/javascript"}));
      const dataJson=decode.decode(data);
      const justJudgementTypes=parseJustJudgementTypes(JSON.parse(dataJson));
      try {
        const engine=await import(moduleUrl);
        await engine.default({module_or_path:wasm});
        session=new engine.ReplaySession(dataJson);
      } finally { URL.revokeObjectURL(moduleUrl); }
      self.postMessage({id,result:{model:manifest.engine.model,justJudgementTypes}});
      return;
    }
    if (!session) throw new Error("Replay engine is not loaded");
    if (!["describeChart","template","run"].includes(op)) throw new Error("Unsupported replay operation");
    self.postMessage({id,result:JSON.parse(session[op](...args))});
  } catch(error) { self.postMessage({id,error:String(error?.message??error)}); }
};
