// ENGINE: TMP's vertical anchor and preferred height use the visible text
// descender. A trailing line feed does not add a visible line (see the player
// TMP implementation and its CalculatePreferredValues tests).
export function plainText(text){
  return String(text??'').replace(/\r\n?/g,'\n').replace(/<br\s*\/?\s*>/gi,'\n').replace(/<[^>]*>/g,'');
}
export function visibleLines(lines){
  let count=lines.length;
  while(count&&!lines[count-1].trim())count--;
  return lines.slice(0,count);
}
export function wrappingEnabled(text){
  return text.m_TextWrappingMode!==undefined?[1,2].includes(text.m_TextWrappingMode):text.m_enableWordWrapping!==0;
}
export function textHeight(lines,lineHeight){return visibleLines(lines).length*lineHeight;}
