<script>
  // Tile icons, chosen by the "icon" column of mob.menu
  let { name = 'dot', size = 30 } = $props();

  const paths = {
    cart:   'M3 4h2l2.4 11h11.2L21 8H6.3M9 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2zM18 20a1 1 0 1 0 0-2 1 1 0 0 0 0 2z',
    wallet: 'M3 7h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7zM3 7l12-3v3M16 13h2',
    in:     'M12 3v12M7 10l5 5 5-5M4 20h16',
    out:    'M12 21V9M7 14l5-5 5 5M4 4h16',
    camera: 'M4 8h3l2-3h6l2 3h3v11H4zM12 17a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z',
    list:   'M8 6h12M8 12h12M8 18h12M4 6h.01M4 12h.01M4 18h.01',
    tag:    'M3 12V4h8l10 10-8 8zM7.5 8.5h.01',
    chart:  'M4 20V10M10 20V4M16 20v-7M22 20H2',
    lock:   'M6 11h12v10H6zM8.5 11V7.5a3.5 3.5 0 0 1 7 0V11',
    sync:   'M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4',
    back:   'M15 18l-6-6 6-6',
    dot:    'M12 12h.01'
  };
</script>

<svg viewBox="0 0 24 24" width={size} height={size} fill="none" stroke="currentColor"
     stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
  <path d={paths[name] ?? paths.dot} />
</svg>
