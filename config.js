// Public repo coordinates. No secrets here — this file ships to the browser.
// The edit token lives in localStorage, never in the bundle. See README.md.
window.BOOK_CONFIG = {
  owner: 'AyrtonW321',
  repo: 'flowers',
  branch: 'main'
};

// Serve React from the repo instead of unpkg. support.js checks this map
// before falling back to its hardcoded CDN URLs, so a bad day at unpkg
// can't blank out the site.
window.__resources = {
  'https://unpkg.com/react@18.3.1/umd/react.production.min.js': './vendor/react.js',
  'https://unpkg.com/react-dom@18.3.1/umd/react-dom.production.min.js': './vendor/react-dom.js'
};
