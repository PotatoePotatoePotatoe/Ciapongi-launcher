// Definicje motywow launchera — kazdy motyw podmienia CSS Variables na :root
export const THEMES = {
  'dark-violet': {
    label: 'Dark Violet',
    description: 'Domyslny motyw – fioletowo-cyjanowy',
    preview: ['#8b5cf6', '#06b6d4'],
    vars: {
      '--color-bg': '#0a0a0f',
      '--color-surface': 'rgba(255,255,255,0.04)',
      '--color-surface-hover': 'rgba(255,255,255,0.07)',
      '--color-primary': '#8b5cf6',
      '--color-primary-glow': 'rgba(139,92,246,0.25)',
      '--color-secondary': '#06b6d4',
      '--color-secondary-glow': 'rgba(6,182,212,0.25)',
      '--gradient-primary': 'linear-gradient(135deg, #8b5cf6, #06b6d4)',
      '--color-sidebar-bg': 'rgba(15,15,25,0.95)',
      '--blur-enabled': 'blur(20px)',
    }
  },
  'midnight-blue': {
    label: 'Midnight Blue',
    description: 'Spokojny, chlodny blekit',
    preview: ['#3b82f6', '#22d3ee'],
    vars: {
      '--color-bg': '#070b14',
      '--color-surface': 'rgba(255,255,255,0.04)',
      '--color-surface-hover': 'rgba(255,255,255,0.07)',
      '--color-primary': '#3b82f6',
      '--color-primary-glow': 'rgba(59,130,246,0.25)',
      '--color-secondary': '#22d3ee',
      '--color-secondary-glow': 'rgba(34,211,238,0.25)',
      '--gradient-primary': 'linear-gradient(135deg, #3b82f6, #22d3ee)',
      '--color-sidebar-bg': 'rgba(7,11,20,0.95)',
      '--blur-enabled': 'blur(20px)',
    }
  },
  'crimson': {
    label: 'Crimson',
    description: 'Intensywna czerwien z pomaranczem',
    preview: ['#ef4444', '#f97316'],
    vars: {
      '--color-bg': '#100808',
      '--color-surface': 'rgba(255,255,255,0.04)',
      '--color-surface-hover': 'rgba(255,255,255,0.07)',
      '--color-primary': '#ef4444',
      '--color-primary-glow': 'rgba(239,68,68,0.25)',
      '--color-secondary': '#f97316',
      '--color-secondary-glow': 'rgba(249,115,22,0.25)',
      '--gradient-primary': 'linear-gradient(135deg, #ef4444, #f97316)',
      '--color-sidebar-bg': 'rgba(16,8,8,0.95)',
      '--blur-enabled': 'blur(20px)',
    }
  },
  'emerald': {
    label: 'Emerald',
    description: 'Soczysty zielono-turkusowy',
    preview: ['#10b981', '#14b8a6'],
    vars: {
      '--color-bg': '#060f0b',
      '--color-surface': 'rgba(255,255,255,0.04)',
      '--color-surface-hover': 'rgba(255,255,255,0.07)',
      '--color-primary': '#10b981',
      '--color-primary-glow': 'rgba(16,185,129,0.25)',
      '--color-secondary': '#14b8a6',
      '--color-secondary-glow': 'rgba(20,184,166,0.25)',
      '--gradient-primary': 'linear-gradient(135deg, #10b981, #14b8a6)',
      '--color-sidebar-bg': 'rgba(6,15,11,0.95)',
      '--blur-enabled': 'blur(20px)',
    }
  },
  'pure-black': {
    label: 'Pure Black',
    description: 'Czysty OLED — zero tla, maksymalny kontrast',
    preview: ['#ffffff', '#555555'],
    vars: {
      '--color-bg': '#000000',
      '--color-surface': 'rgba(255,255,255,0.03)',
      '--color-surface-hover': 'rgba(255,255,255,0.06)',
      '--color-primary': '#e5e7eb',
      '--color-primary-glow': 'rgba(229,231,235,0.15)',
      '--color-secondary': '#9ca3af',
      '--color-secondary-glow': 'rgba(156,163,175,0.15)',
      '--gradient-primary': 'linear-gradient(135deg, #e5e7eb, #9ca3af)',
      '--color-sidebar-bg': 'rgba(0,0,0,0.98)',
      '--blur-enabled': 'blur(8px)',
    }
  }
};

export const THEME_IDS = Object.keys(THEMES);
export const DEFAULT_THEME = 'dark-violet';
