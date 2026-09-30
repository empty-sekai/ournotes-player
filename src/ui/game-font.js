// Game glyph shapes and advances; CPU distance-field antialiasing is approximate.
const fonts=new Map();
export async function loadGameFont(loadImage,url,resolve){
  if(!fonts.has(url))fonts.set(url,fetch(url).then(r=>{if(!r.ok)throw Error(`UI font metrics: ${r.status} ${url}`);return r.json();}).then(async data=>({...data,atlas:await loadImage(data.textureBase==='metrics'?new URL(data.texture,url).href:resolve(data.texture)),cache:new Map()})).catch(error=>{fonts.delete(url);throw error;}));
  return fonts.get(url);
}
export function hasGameGlyphs(text,asset,font){return font&&asset?.name?.includes('VibeMO')&&[...text].every(c=>c==='\n'||font.characters[c.codePointAt(0)]!==undefined);}
export function gameTextWidth(text,size,font){return [...text].reduce((total,c)=>total+(font.glyphs[font.characters[c.codePointAt(0)]]?.m_Metrics.m_HorizontalAdvance||0),0)*size/font.face.m_PointSize;}
export function drawGameText(ctx,text,x,y,size,color,font){
  const cache=font.cache,width=gameTextWidth(text,size,font),scale=size/font.face.m_PointSize;
  let cursor=x-(ctx.textAlign==='center'?width/2:ctx.textAlign==='right'?width:0);
  const baseline=y+(font.face.m_AscentLine+font.face.m_DescentLine)*scale/2;
  for(const char of text){
    const glyph=font.glyphs[font.characters[char.codePointAt(0)]],m=glyph.m_Metrics,r=glyph.m_GlyphRect;
    if(m.m_Width>0&&m.m_Height>0){
      const key=[char,size,...['r','g','b','a'].map(k=>color[k]??1)].join(':');
      if(!cache.has(key)){
        if(cache.size>2048)cache.delete(cache.keys().next().value);
        const canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(r.m_Width*scale));canvas.height=Math.max(1,Math.round(r.m_Height*scale));const c=canvas.getContext('2d');
        c.drawImage(font.atlas,r.m_X,font.atlas.height-r.m_Y-r.m_Height,r.m_Width,r.m_Height,0,0,canvas.width,canvas.height);
        const pixels=c.getImageData(0,0,canvas.width,canvas.height);
        for(let i=0;i<pixels.data.length;i+=4){const coverage=Math.max(0,Math.min(1,(pixels.data[i+3]/255-.5)*Math.max(2,26*scale)+.5));pixels.data[i]=(color.r??1)*255;pixels.data[i+1]=(color.g??1)*255;pixels.data[i+2]=(color.b??1)*255;pixels.data[i+3]=coverage*(color.a??1)*255;}
        c.putImageData(pixels,0,0);cache.set(key,canvas);
      }
      ctx.drawImage(cache.get(key),cursor+m.m_HorizontalBearingX*scale,baseline-m.m_HorizontalBearingY*scale);
    }
    cursor+=m.m_HorizontalAdvance*scale;
  }
}
