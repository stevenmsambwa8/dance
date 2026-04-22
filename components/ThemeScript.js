// ThemeScript.jsx
// Place this as the FIRST child inside <head> in your app/layout.js
// It runs before React hydrates, so no flash of wrong theme ever appears.
//
// Usage in app/layout.js:
//   import ThemeScript from '../components/ThemeScript'
//   ...
//   <head>
//     <ThemeScript />
//     ...other head tags
//   </head>

export default function ThemeScript() {
  const script = `
    (function() {
      try {
        var theme = localStorage.getItem('theme') || 'light';
        var colors = { light: '#ffffff', dark: '#18181a' };
        document.documentElement.setAttribute('data-theme', theme);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'theme-color');
          document.head.appendChild(meta);
        }
        meta.setAttribute('content', colors[theme] || colors.light);
      } catch(e) {}
    })();
  `.trim();

  return (
    <script
      dangerouslySetInnerHTML={{ __html: script }}
      suppressHydrationWarning
    />
  );
}
