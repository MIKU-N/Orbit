function makeScenicDataUrl(svgBody: string): string {
  const full = `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 1600 900' preserveAspectRatio='xMidYMid slice'>${svgBody}</svg>`;
  return `url("data:image/svg+xml;utf8,${encodeURIComponent(full)}")`;
}

export interface PresetWallpaper {
  name: string;
  thumb: string;
  bg: string;
}

export const PRESET_WALLPAPERS: PresetWallpaper[] = [
  {
    name: '极光',
    thumb: 'linear-gradient(135deg,#0f172a,#134e4a,#312e81)',
    bg: makeScenicDataUrl(
      `<defs><linearGradient id='sky' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#060b19'/><stop offset='45%' stop-color='#0f1e3a'/><stop offset='100%' stop-color='#1e293b'/></linearGradient><radialGradient id='a1' cx='32%' cy='28%' r='52%'><stop offset='0%' stop-color='#34d399' stop-opacity='0.65'/><stop offset='48%' stop-color='#06b6d4' stop-opacity='0.28'/><stop offset='100%' stop-color='#06b6d4' stop-opacity='0'/></radialGradient><radialGradient id='a2' cx='72%' cy='24%' r='45%'><stop offset='0%' stop-color='#818cf8' stop-opacity='0.6'/><stop offset='55%' stop-color='#c084fc' stop-opacity='0.2'/><stop offset='100%' stop-color='#c084fc' stop-opacity='0'/></radialGradient></defs><rect width='1600' height='900' fill='url(#sky)'/><ellipse cx='520' cy='240' rx='640' ry='260' fill='url(#a1)'/><ellipse cx='1150' cy='210' rx='560' ry='230' fill='url(#a2)'/><path d='M0 640 L260 440 L480 560 L790 360 L1080 540 L1340 410 L1600 560 L1600 900 L0 900 Z' fill='#0c1424' opacity='0.82'/><path d='M0 720 L310 540 L620 670 L980 510 L1290 650 L1600 570 L1600 900 L0 900 Z' fill='#070c17'/>`,
    ),
  },
  {
    name: '暮色',
    thumb: 'linear-gradient(135deg,#1e1b4b,#9d174d,#f59e0b)',
    bg: makeScenicDataUrl(
      `<defs><linearGradient id='s2' x1='0' y1='0' x2='0.2' y2='1'><stop offset='0%' stop-color='#17153b'/><stop offset='42%' stop-color='#4c1d57'/><stop offset='74%' stop-color='#be4b6b'/><stop offset='100%' stop-color='#f59e6c'/></linearGradient><radialGradient id='sun' cx='50%' cy='64%' r='36%'><stop offset='0%' stop-color='#fde68a' stop-opacity='0.85'/><stop offset='45%' stop-color='#fb923c' stop-opacity='0.35'/><stop offset='100%' stop-color='#fb923c' stop-opacity='0'/></radialGradient></defs><rect width='1600' height='900' fill='url(#s2)'/><circle cx='800' cy='560' r='420' fill='url(#sun)'/><path d='M0 610 Q420 510 820 595 T1600 560 L1600 900 L0 900 Z' fill='#281433' opacity='0.75'/><path d='M0 700 Q380 620 790 695 T1600 660 L1600 900 L0 900 Z' fill='#140c21' opacity='0.92'/>`,
    ),
  },
  {
    name: '峡湾',
    thumb: 'linear-gradient(135deg,#0c4a6e,#38bdf8,#e0f2fe)',
    bg: makeScenicDataUrl(
      `<defs><linearGradient id='s3' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#0b2942'/><stop offset='48%' stop-color='#1e608a'/><stop offset='82%' stop-color='#7dd3fc'/><stop offset='100%' stop-color='#bae6fd'/></linearGradient></defs><rect width='1600' height='900' fill='url(#s3)'/><path d='M0 540 L290 360 L580 510 L920 330 L1270 490 L1600 370 L1600 900 L0 900 Z' fill='#164564' opacity='0.65'/><path d='M0 660 L410 520 L840 650 L1260 510 L1600 620 L1600 900 L0 900 Z' fill='#0d2d44' opacity='0.82'/>`,
    ),
  },
  {
    name: '松林',
    thumb: 'linear-gradient(135deg,#052e16,#0f766e,#6ee7b7)',
    bg: makeScenicDataUrl(
      `<defs><linearGradient id='s4' x1='0' y1='0' x2='1' y2='1'><stop offset='0%' stop-color='#041f1a'/><stop offset='50%' stop-color='#0d4a44'/><stop offset='100%' stop-color='#1e6b5c'/></linearGradient><radialGradient id='g4' cx='56%' cy='36%' r='45%'><stop offset='0%' stop-color='#a7f3d0' stop-opacity='0.48'/><stop offset='100%' stop-color='#a7f3d0' stop-opacity='0'/></radialGradient></defs><rect width='1600' height='900' fill='url(#s4)'/><circle cx='900' cy='320' r='520' fill='url(#g4)'/><path d='M0 620 Q360 480 760 590 T1600 540 L1600 900 L0 900 Z' fill='#072d27' opacity='0.78'/><path d='M0 730 Q450 640 900 725 T1600 680 L1600 900 L0 900 Z' fill='#031714'/>`,
    ),
  },
  {
    name: '霓虹',
    thumb: 'linear-gradient(135deg,#1d4ed8,#7e22ce,#ec4899)',
    bg: makeScenicDataUrl(
      `<defs><radialGradient id='m1' cx='22%' cy='26%' r='52%'><stop offset='0%' stop-color='#3b82f6' stop-opacity='0.9'/><stop offset='100%' stop-color='#3b82f6' stop-opacity='0'/></radialGradient><radialGradient id='m2' cx='78%' cy='32%' r='48%'><stop offset='0%' stop-color='#a855f7' stop-opacity='0.88'/><stop offset='100%' stop-color='#a855f7' stop-opacity='0'/></radialGradient><radialGradient id='m3' cx='52%' cy='78%' r='54%'><stop offset='0%' stop-color='#ec4899' stop-opacity='0.75'/><stop offset='100%' stop-color='#ec4899' stop-opacity='0'/></radialGradient></defs><rect width='1600' height='900' fill='#0b1024'/><rect width='1600' height='900' fill='url(#m1)'/><rect width='1600' height='900' fill='url(#m2)'/><rect width='1600' height='900' fill='url(#m3)'/>`,
    ),
  },
];
