// 八個桌布風格預設(契約 C5)
// words 必須與 Worker 端 STYLE_WORDS 完全一致 —— 兩邊同步是課程刻意保留的討論點。
// palette:accent = 中央格主色;sub[8] = 八個子目標各自的色,需在深夜藍底上可讀。

export const STYLE_PRESETS = [
  {
    id: 'aurora',
    name: '極光夜空',
    words:
      'dreamlike aurora borealis gradients, deep night sky, soft glowing curtains of teal and violet light, ethereal atmosphere',
    palette: {
      accent: '#7ce8d5',
      sub: ['#5eead4', '#a78bfa', '#76c7ff', '#8be29b', '#c9b8ff', '#67e8f9', '#f0a6e8', '#9fc1ff'],
    },
  },
  {
    id: 'ink',
    name: '水墨山色',
    words:
      'traditional East Asian ink wash painting, misty mountains, flowing brush strokes, vast negative space, monochrome with subtle warm accents',
    palette: {
      accent: '#d8c8a8',
      sub: ['#e8e2d4', '#aebbc9', '#d8c08e', '#93a8b8', '#c9d2dc', '#b3a284', '#8da4ad', '#ddd2bd'],
    },
  },
  {
    id: 'watercolor',
    name: '水彩暈染',
    words:
      'soft watercolor painting, gentle washes of color, blooming pigment edges, light paper texture, airy and hopeful',
    palette: {
      accent: '#f2a9bd',
      sub: ['#a5d8ff', '#b2f2bb', '#ffd8a8', '#fcc2d7', '#d0bfff', '#99e9f2', '#ffec99', '#c0eb75'],
    },
  },
  {
    id: 'neon',
    name: '霓虹夜城',
    words:
      'cyberpunk neon cityscape at night, glowing signs bokeh, rain-slick streets, electric blues and magentas, cinematic',
    palette: {
      accent: '#ff4fd8',
      sub: ['#22d9ff', '#ff6ec7', '#8f7bff', '#3dffb0', '#ffe14d', '#ff7a8a', '#4dc3ff', '#c95eff'],
    },
  },
  {
    id: 'oil',
    name: '古典油畫',
    words:
      'classical oil painting, rich impasto brushwork, dramatic chiaroscuro light, warm golden tones, museum quality',
    palette: {
      accent: '#e0b15e',
      sub: ['#e0a35c', '#d27e57', '#d8bd6e', '#a8b86f', '#c08a7f', '#e6c896', '#a892c2', '#bd9c55'],
    },
  },
  {
    id: 'pixel',
    name: '像素旅途',
    words:
      'retro pixel art landscape, 16-bit style, dithered gradients, nostalgic video game atmosphere, crisp tiles',
    palette: {
      accent: '#7ad65a',
      sub: ['#ff7a7a', '#ffd93d', '#6bcb77', '#5e9cff', '#f08bce', '#5ce1e6', '#ffa94d', '#b59df0'],
    },
  },
  {
    id: 'anime',
    name: '動畫天空',
    words:
      'Japanese anime background art, vibrant skies with dramatic clouds, painterly light rays, Makoto Shinkai inspired scenery',
    palette: {
      accent: '#ffb24d',
      sub: ['#74c0fc', '#ff8d8d', '#ffd43b', '#63e6be', '#f78fb0', '#94a8ff', '#ffc078', '#6fd9e8'],
    },
  },
  {
    id: 'photo',
    name: '攝影散景',
    words:
      'professional photography, shallow depth of field bokeh, golden hour natural light, serene minimalist scene',
    palette: {
      accent: '#e6b35c',
      sub: ['#dca768', '#a9c2a4', '#8fb9cc', '#d4a9b4', '#cfc09a', '#90a8a0', '#a8b9d6', '#c9bdb0'],
    },
  },
];

export function presetById(id) {
  return STYLE_PRESETS.find((p) => p.id === id) || STYLE_PRESETS[0];
}
