export default function ThemeScript() {
  const script = `
    (function() {
      try {
        var themes = {
          light:  '#ffffff',
          dark:   '#18181a',
          snow:   '#f0f8ff',
          neon:   '#060610',
          sunset: '#130800',
          forest: '#060e08',
          gold:   '#080600',
          ocean:  '#010a14',
        };
        var seasonal = {
          snow:   [12, 1],
          forest: [3, 4, 5],
          ocean:  [6, 7, 8],
        };
        var month   = new Date().getMonth() + 1;
        var saved   = localStorage.getItem('theme') || 'light';
        var manual  = localStorage.getItem('theme_manual') === '1';
        var active  = saved;
        if (!manual) {
          for (var key in seasonal) {
            if (seasonal[key].indexOf(month) !== -1) { active = key; break; }
          }
        }
        document.documentElement.setAttribute('data-theme', active);
        var meta = document.querySelector('meta[name="theme-color"]');
        if (!meta) {
          meta = document.createElement('meta');
          meta.setAttribute('name', 'theme-color');
          document.head.appendChild(meta);
        }
        meta.setAttribute('content', themes[active] || themes.light);
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
