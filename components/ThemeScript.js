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

        var active = localStorage.getItem('theme') || 'light';

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