import type { StyleSnapshot } from './resources.ts';

export const STYLE_FONTS = [
  {family:'Inter',file:'Inter-Variable.ttf',license:'inter-OFL.txt',weight:'100 900',source:'https://github.com/google/fonts/tree/main/ofl/inter'},
  {family:'JetBrains Mono',file:'JetBrainsMono-Variable.ttf',license:'jetbrainsmono-OFL.txt',weight:'100 800',source:'https://github.com/google/fonts/tree/main/ofl/jetbrainsmono'},
  {family:'Press Start 2P',file:'PressStart2P-Regular.ttf',license:'pressstart2p-OFL.txt',weight:'400',source:'https://github.com/google/fonts/tree/main/ofl/pressstart2p'},
  {family:'Bodoni Moda',file:'BodoniModa-Variable.ttf',license:'bodonimoda-OFL.txt',weight:'400 900',source:'https://github.com/google/fonts/tree/main/ofl/bodonimoda'},
  {family:'Playfair Display',file:'PlayfairDisplay-Variable.ttf',license:'playfairdisplay-OFL.txt',weight:'400 900',source:'https://github.com/google/fonts/tree/main/ofl/playfairdisplay'},
  {family:'Cinzel',file:'Cinzel-Variable.ttf',license:'cinzel-OFL.txt',weight:'400 900',source:'https://github.com/google/fonts/tree/main/ofl/cinzel'},
  {family:'Noto Serif SC',file:'NotoSerifSC-Variable.ttf',license:'notoserifsc-OFL.txt',weight:'200 900',source:'https://github.com/google/fonts/tree/main/ofl/notoserifsc'},
] as const;
export function fontsForStyle(snapshot?:StyleSnapshot) {
  const families = snapshot ? `${snapshot.tokens.fontFamily},${snapshot.tokens.headingFontFamily}`.split(',').map(value=>value.trim().replace(/^['"]|['"]$/g,'')) : [];
  return STYLE_FONTS.filter(font=>families.includes(font.family));
}
export function styleFontCss(snapshot?:StyleSnapshot, assetBase='/api/assets/'):string {
  if(assetBase!=='/api/assets/' && assetBase!=='./assets/')return '';
  return fontsForStyle(snapshot).map(font=>`@font-face{font-family:"${font.family}";src:url("${assetBase}styles/${font.file}") format("truetype");font-style:normal;font-weight:${font.weight};font-display:swap;}`).join('\n');
}
