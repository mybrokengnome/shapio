import type { ThemeDefinition } from '@shapio/cms/config';

/**
 * An admin colour theme (light only): warm paper and walnut. It appears in the theme menu after the built-in
 * themes. Every UI token is set; the brand tokens are left out, so the Shapio logo colours are used.
 * `shapio extensions check` warns about any pair below WCAG AA contrast.
 */
export const sepiaTheme: ThemeDefinition = {
  key: 'sepia',
  name: 'Sepia',
  description: 'Warm paper and walnut. Light only.',
  light: {
    background: '#f6efe3',
    foreground: '#2b2118',
    card: '#fffaf2',
    'card-foreground': '#2b2118',
    popover: '#fffaf2',
    'popover-foreground': '#2b2118',
    primary: '#7a3e12',
    'primary-foreground': '#fffaf2',
    'primary-hover': '#5f300d',
    secondary: '#efe5d4',
    'secondary-foreground': '#2b2118',
    muted: '#f1e8d9',
    'muted-foreground': '#64503d',
    accent: '#eadbc2',
    'accent-foreground': '#2b2118',
    destructive: '#a61b1b',
    'destructive-foreground': '#fffaf2',
    'destructive-muted': '#f9dcd5',
    success: '#276b33',
    'success-muted': '#dcefd9',
    warning: '#8a4b06',
    'warning-muted': '#f7e6c4',
    info: '#2f5a8a',
    'info-muted': '#dde7f2',
    border: '#e2d5c1',
    input: '#8c7a66',
    ring: '#7a3e12',
    link: '#7a3e12',
    overlay: '#2b2118',
    sidebar: '#efe4d2',
    'sidebar-foreground': '#2b2118',
    'sidebar-primary': '#7a3e12',
    'sidebar-primary-foreground': '#fffaf2',
    'sidebar-accent': '#fffaf2',
    'sidebar-accent-foreground': '#2b2118',
    'sidebar-border': '#e2d5c1',
    'sidebar-ring': '#7a3e12',
  },
};
