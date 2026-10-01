// A single projective surface has no internal clipping edges. Use shared GPU
// vertices, or inverse-map destination pixels when WebGL2 is unavailable.
let gpu;
function createGPU(){
  const canvas=document.createElement('canvas'),gl=canvas.getContext('webgl2',{alpha:true,premultipliedAlpha:true,antialias:false,preserveDrawingBuffer:true});
  if(!gl||typeof gl.createShader!=='function')return null;
  const shader=(type,source)=>{const s=gl.createShader(type);gl.shaderSource(s,source);gl.compileShader(s);if(!gl.getShaderParameter(s,gl.COMPILE_STATUS))throw Error('UI projection shader: '+gl.getShaderInfoLog(s));return s;};
  const vs=shader(gl.VERTEX_SHADER,`#version 300 es
in vec3 position; in vec2 uv; out vec2 texcoord;
void main(){gl_Position=vec4(position.xy*position.z,0.,position.z);texcoord=uv;}`);
  const fs=shader(gl.FRAGMENT_SHADER,`#version 300 es
precision highp float; in vec2 texcoord; uniform sampler2D source; out vec4 pixel;
void main(){pixel=texture(source,texcoord);}`);
  const program=gl.createProgram();gl.attachShader(program,vs);gl.attachShader(program,fs);gl.linkProgram(program);
  if(!gl.getProgramParameter(program,gl.LINK_STATUS))throw Error('UI projection program: '+gl.getProgramInfoLog(program));
  gl.deleteShader(vs);gl.deleteShader(fs);gl.useProgram(program);
  const buffer=gl.createBuffer(),texture=gl.createTexture();gl.bindBuffer(gl.ARRAY_BUFFER,buffer);
  const p=gl.getAttribLocation(program,'position'),u=gl.getAttribLocation(program,'uv');gl.enableVertexAttribArray(p);gl.enableVertexAttribArray(u);
  gl.vertexAttribPointer(p,3,gl.FLOAT,false,20,0);gl.vertexAttribPointer(u,2,gl.FLOAT,false,20,12);
  gl.bindTexture(gl.TEXTURE_2D,texture);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_S,gl.CLAMP_TO_EDGE);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_WRAP_T,gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MIN_FILTER,gl.LINEAR);gl.texParameteri(gl.TEXTURE_2D,gl.TEXTURE_MAG_FILTER,gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,true);gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL,false);
  gl.disable(gl.BLEND);
  gl.uniform1i(gl.getUniformLocation(program,'source'),0);
  return {canvas,gl,buffer};
}
export function inverseQuad(quad){
  const [a,b,,c]=quad,xa=a.x*a.weight,ya=a.y*a.weight;
  const h=[b.x*b.weight-xa,c.x*c.weight-xa,xa,b.y*b.weight-ya,c.y*c.weight-ya,ya,b.weight-a.weight,c.weight-a.weight,a.weight];
  const [A,B,C,D,E,F,G,H,I]=h,det=A*(E*I-F*H)-B*(D*I-F*G)+C*(D*H-E*G);
  if(Math.abs(det)<1e-12)return null;
  return [(E*I-F*H)/det,(C*H-B*I)/det,(B*F-C*E)/det,(F*G-D*I)/det,(A*I-C*G)/det,(C*D-A*F)/det,(D*H-E*G)/det,(B*G-A*H)/det,(A*E-B*D)/det];
}
/** Destination pixel centers sample once; bilinear RGBA interpolation is premultiplied. */
export function rasterizeProjected(source,sw,sh,quad,frame,output=new Uint8ClampedArray(frame.width*frame.height*4)){
  const inv=inverseQuad(quad);if(!inv)return output;
  for(let y=0;y<frame.height;y++)for(let x=0;x<frame.width;x++){
    const dx=frame.x+(x+.5)/frame.scale,dy=frame.y+(y+.5)/frame.scale,w=inv[6]*dx+inv[7]*dy+inv[8];
    const u=(inv[0]*dx+inv[1]*dy+inv[2])/w,v=(inv[3]*dx+inv[4]*dy+inv[5])/w;
    if(u<0||u>1||v<0||v>1||!Number.isFinite(u)||!Number.isFinite(v))continue;
    const sx=u*sw-.5,sy=v*sh-.5,ix=Math.floor(sx),iy=Math.floor(sy),fx=sx-ix,fy=sy-iy;
    let alpha=0,r=0,g=0,b=0;
    for(let row=0;row<2;row++)for(let col=0;col<2;col++){
      const i=(Math.max(0,Math.min(sh-1,iy+row))*sw+Math.max(0,Math.min(sw-1,ix+col)))*4,k=(col?fx:1-fx)*(row?fy:1-fy),a=source[i+3]*k;
      alpha+=a;r+=source[i]*a;g+=source[i+1]*a;b+=source[i+2]*a;
    }
    const i=(y*frame.width+x)*4;if(alpha>0){output[i]=r/alpha;output[i+1]=g/alpha;output[i+2]=b/alpha;output[i+3]=alpha;}
  }
  return output;
}
export function projectiveSurface(image,quad){
  const minX=Math.floor(Math.min(...quad.map(p=>p.x))),minY=Math.floor(Math.min(...quad.map(p=>p.y)));
  const width=Math.max(1,Math.ceil(Math.max(...quad.map(p=>p.x)))-minX),height=Math.max(1,Math.ceil(Math.max(...quad.map(p=>p.y)))-minY);
  if(gpu===undefined)gpu=createGPU();if(gpu?.gl.isContextLost())gpu=createGPU();
  const limit=gpu?Math.min(4096,gpu.gl.getParameter(gpu.gl.MAX_TEXTURE_SIZE)):4096,scale=Math.min(1,limit/width,limit/height),frame={x:minX,y:minY,width:Math.max(1,Math.ceil(width*scale)),height:Math.max(1,Math.ceil(height*scale)),scale};
  let canvas;
  if(gpu&&image.width<=limit&&image.height<=limit){
    const {gl}=gpu;canvas=gpu.canvas;canvas.width=frame.width;canvas.height=frame.height;gl.viewport(0,0,canvas.width,canvas.height);
    gl.clearColor(0,0,0,0);gl.clear(gl.COLOR_BUFFER_BIT);
    const vertices=quad.flatMap((p,i)=>[(p.x-minX)/width*2-1,1-(p.y-minY)/height*2,p.weight,[0,1,1,0][i],[0,0,1,1][i]]);
    gl.bufferData(gl.ARRAY_BUFFER,new Float32Array(vertices),gl.STREAM_DRAW);
    gl.texImage2D(gl.TEXTURE_2D,0,gl.RGBA,gl.RGBA,gl.UNSIGNED_BYTE,image);gl.drawArrays(gl.TRIANGLE_FAN,0,4);
  }else{
    canvas=document.createElement('canvas');canvas.width=frame.width;canvas.height=frame.height;
    const ctx=canvas.getContext('2d'),source=image.getContext('2d').getImageData(0,0,image.width,image.height),pixels=ctx.createImageData(canvas.width,canvas.height);
    rasterizeProjected(source.data,image.width,image.height,quad,frame,pixels.data);ctx.putImageData(pixels,0,0);
  }
  return {canvas,x:minX,y:minY,width,height};
}
