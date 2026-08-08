// GitHub-as-backend for the flower book.
//
// Two jobs:
//   1. window.omelette.writeFile — the injection point image-slot.js already
//      looks for. Defining it turns on the drop/crop/replace UI; leaving it
//      undefined makes the page read-only. That IS the auth gate: a visitor
//      without a token gets a viewer, no code required.
//   2. window.bookStore — captions, dates, locations, slide order and custom
//      months, committed as one small book.json.
//
// Photos are committed as separate files under photos/. Only their URLs go
// into the JSON, so the state files stay a few KB no matter how many photos
// the book holds.
(function () {
  'use strict';

  var CFG = window.BOOK_CONFIG || {};
  var STATE_FILE = '.image-slots.state.json';
  var BOOK_FILE = 'book.json';

  if (!CFG.owner || !CFG.repo) {
    console.error('[host] BOOK_CONFIG.owner/repo not set — edit config.js. Running read-only.');
  }

  var RAW = 'https://raw.githubusercontent.com/' + CFG.owner + '/' + CFG.repo + '/' + CFG.branch;
  var API = 'https://api.github.com/repos/' + CFG.owner + '/' + CFG.repo + '/contents/';

  // ── Token ───────────────────────────────────────────────────────────────
  // Arrives once as #key=<token>, then lives in localStorage. Stripped from
  // the address bar immediately so it isn't shoulder-surfed or copied into a
  // shared link by accident.
  var token = null;
  var m = /[#&]key=([^&]+)/.exec(location.hash);
  if (m) {
    token = decodeURIComponent(m[1]);
    try {
      localStorage.setItem('gh-edit-token', token);
    } catch (e) {}
    history.replaceState(null, '', location.pathname + location.search);
  } else {
    try {
      token = localStorage.getItem('gh-edit-token');
    } catch (e) {}
  }
  var canEdit = !!(token && CFG.owner && CFG.repo);

  // ── GitHub Contents API ─────────────────────────────────────────────────
  // No sha cache: every write re-reads the current sha from GitHub right
  // before it PUTs. A cached sha goes stale the moment anything else (another
  // tab, another device, an edit on github.com) commits in between, and that
  // staleness is exactly what produces the 409 this file used to see.
  function b64FromText(str) {
    // btoa is latin1-only; captions contain ♡ and other non-ASCII.
    // Chunked because String.fromCharCode.apply blows the stack somewhere
    // north of ~65k args, and a book with many captions gets there.
    var bytes = new TextEncoder().encode(str);
    var out = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(out);
  }

  function ghHeaders() {
    return {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'Content-Type': 'application/json'
    };
  }

  function getSha(path) {
    // Always hits the API — no cache. This is the fix: reusing a sha from an
    // earlier read/write is exactly how a write ends up 409ing against a
    // version of the file it never saw.
    return fetch(API + path + '?ref=' + encodeURIComponent(CFG.branch), { headers: ghHeaders() })
      .then(function (r) {
        return r.ok ? r.json() : null;
      })
      .then(function (j) {
        return j && j.sha ? j.sha : null;
      })
      .catch(function () {
        return null;
      });
  }

  function putFileOnce(path, b64, message) {
    return getSha(path).then(function (sha) {
      var body = { message: message, content: b64, branch: CFG.branch };
      if (sha) body.sha = sha;
      return fetch(API + path, {
        method: 'PUT',
        headers: ghHeaders(),
        body: JSON.stringify(body)
      }).then(function (r) {
        if (!r.ok) {
          return r.text().then(function (t) {
            var err = new Error('GitHub ' + r.status + ' on ' + path + ': ' + t.slice(0, 200));
            err.status = r.status;
            throw err;
          });
        }
        return r.json();
      });
    });
  }

  function putFile(path, b64, message, attempt) {
    attempt = attempt || 1;
    // A 409 (sha conflict) means someone else — another tab, another device,
    // a direct github.com edit — committed between our GET and our PUT.
    // getSha() always re-reads on every call (including retries), so a retry
    // is a genuine "try again with what's actually there now", not a repeat
    // of the same stale guess. Retry a few times with a short backoff in
    // case of a fast back-to-back race, then give up loudly instead of
    // quietly dropping the user's edit.
    return putFileOnce(path, b64, message).catch(function (err) {
      if (err && err.status === 409 && attempt < 4) {
        var delay = 300 * attempt;
        return new Promise(function (resolve) {
          setTimeout(resolve, delay);
        }).then(function () {
          return putFile(path, b64, message, attempt + 1);
        });
      }
      if (err && err.status === 409) {
        err.message =
          'Save conflict on ' +
          path +
          ': someone else saved changes at the same time. ' +
          'Reload the page to get the latest version before editing again.';
      }
      throw err;
    });
  }

  // ── Photo extraction ────────────────────────────────────────────────────
  // image-slot hands us the whole slot map with freshly dropped images still
  // inline as data: URLs. Split each one out to its own committed file and
  // leave only the URL behind.
  function extractPhotos(state) {
    var jobs = [];
    Object.keys(state).forEach(function (id) {
      var v = state[id];
      var u = typeof v === 'string' ? v : v && v.u;
      if (!u || u.indexOf('data:') !== 0) return;

      var comma = u.indexOf(',');
      var meta = u.slice(0, comma);
      var b64 = u.slice(comma + 1);
      var ext = (/image\/([a-z0-9]+)/i.exec(meta) || [, 'webp'])[1];
      // Timestamped filename so each upload is an immutable URL. Replacing a
      // photo writes a new path instead of fighting raw.githubusercontent's
      // cache on the old one.
      var safeId = id.replace(/[^a-zA-Z0-9._-]/g, '_');
      var path = 'photos/' + safeId + '-' + Date.now() + '.' + ext;

      jobs.push(
        putFile(path, b64, 'photo: ' + safeId).then(function () {
          var url = RAW + '/' + path;
          if (typeof state[id] === 'string') state[id] = url;
          else state[id].u = url;
        })
      );
    });
    // ponytail: superseded photo files stay in the tree. Git keeps them in
    // history regardless, so deleting only trims the checkout — not worth an
    // extra API round trip per replacement. Prune by hand if it ever matters.
    return Promise.all(jobs);
  }

  // ── Write queue ─────────────────────────────────────────────────────────
  // Commits are serialized: two overlapping PUTs to the same path race on the
  // blob sha and the loser 409s.
  var chain = Promise.resolve();
  function enqueue(fn) {
    chain = chain.then(fn).catch(function (err) {
      console.error('[host] write failed:', err);
      var msg =
        err && err.status === 409 ? 'save conflict — reload page' : 'save failed — see console';
      setStatus(msg, true);
    });
    return chain;
  }

  function saveState(json) {
    var state;
    try {
      state = JSON.parse(json);
    } catch (e) {
      return Promise.resolve();
    }
    setStatus('saving photo…');
    return (
      extractPhotos(state)
        .then(function () {
          return putFile(
            STATE_FILE,
            b64FromText(JSON.stringify(state, null, 2)),
            'update photo slots'
          );
        })
        // Resolve with the rewritten state (data: URLs swapped for their
        // committed URLs) so image-slot.js's save() can adopt it back into
        // its own copy — otherwise it keeps resending every earlier photo's
        // full original bytes on every later save, forever, for the rest of
        // the page's lifetime.
        .then(function () {
          setStatus('saved');
          return state;
        })
    );
  }

  // ── image-slot host bridge ──────────────────────────────────────────────
  if (canEdit) {
    window.omelette = {
      writeFile: function (path, contents) {
        if (String(path).indexOf(STATE_FILE) === -1) return Promise.resolve();
        return enqueue(function () {
          return saveState(contents);
        });
      }
    };

    // image-slot's "Replace" button dispatches this expecting a host-owned
    // picker (Unsplash search + local import, in the design-tool runtime this
    // component was built for). Nothing here ever listened for it, so
    // Replace silently did nothing. A native file input feeding the same
    // _ingest() drag-and-drop already uses is the local-import half of that
    // contract, without needing an Unsplash integration.
    document.addEventListener('image-slot:pick', function (e) {
      var slot = e.target;
      if (!slot || typeof slot._ingest !== 'function') return;
      var input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/png,image/jpeg,image/webp,image/avif';
      input.addEventListener('change', function () {
        var f = input.files && input.files[0];
        if (f) slot._ingest(f);
      });
      input.click();
    });
  }

  // ── Read shim ───────────────────────────────────────────────────────────
  // image-slot fetches the sidecar relative to the page, which on Pages means
  // the last *built* copy — up to a minute stale after a commit. Point that
  // one relative read at raw.githubusercontent instead so a fresh photo shows
  // on the next reload rather than the next build. Absolute URLs (our own API
  // calls, which also end in the same filename) are left alone.
  var origFetch = window.fetch.bind(window);
  window.fetch = function (input, init) {
    var u = typeof input === 'string' ? input : (input && input.url) || '';
    if (!/^https?:/i.test(u) && u.indexOf(STATE_FILE) !== -1) {
      return origFetch(RAW + '/' + STATE_FILE + '?t=' + Date.now(), init)
        .then(function (r) {
          return r.ok ? r : origFetch(input, init);
        })
        .catch(function () {
          return origFetch(input, init);
        });
    }
    return origFetch(input, init);
  };

  // ── book.json (captions, dates, order, custom months) ───────────────────
  var book = {};
  var readyCbs = [];
  var isReady = false;
  var saveTimer = null;

  function flushBook() {
    saveTimer = null;
    if (!canEdit) return;
    setStatus('saving…');
    enqueue(function () {
      return putFile(BOOK_FILE, b64FromText(JSON.stringify(book, null, 2)), 'update book').then(
        function () {
          setStatus('saved');
        }
      );
    });
  }

  window.bookStore = {
    canEdit: canEdit,
    get: function (key, fallback) {
      return Object.prototype.hasOwnProperty.call(book, key) ? book[key] : fallback;
    },
    set: function (key, val) {
      book[key] = val;
      if (!canEdit) return;
      // Typing a caption fires per keystroke; one commit per burst.
      clearTimeout(saveTimer);
      saveTimer = setTimeout(flushBook, 1500);
    },
    ready: function (cb) {
      if (isReady) cb(book);
      else readyCbs.push(cb);
    }
  };

  origFetch(RAW + '/' + BOOK_FILE + '?t=' + Date.now())
    .then(function (r) {
      return r.ok ? r.json() : {};
    })
    .catch(function () {
      return {};
    })
    .then(function (j) {
      book = j && typeof j === 'object' ? j : {};
      isReady = true;
      readyCbs.forEach(function (cb) {
        try {
          cb(book);
        } catch (e) {
          console.error(e);
        }
      });
      readyCbs = [];
    });

  // ── Status pill ─────────────────────────────────────────────────────────
  var statusEl = null;
  var statusTimer = null;
  function setStatus(text, sticky) {
    if (!canEdit) return;
    if (!statusEl) {
      statusEl = document.createElement('div');
      statusEl.style.cssText =
        'position:fixed;top:10px;right:12px;z-index:9999;font:600 12px Quicksand,sans-serif;' +
        'padding:5px 12px;border-radius:999px;background:oklch(0.55 0.06 145);color:#fff;' +
        'box-shadow:0 2px 8px rgba(0,0,0,.18);pointer-events:none;transition:opacity .3s';
      document.body.appendChild(statusEl);
    }
    statusEl.textContent = text;
    statusEl.style.background = sticky ? 'oklch(0.5 0.15 25)' : 'oklch(0.55 0.06 145)';
    statusEl.style.opacity = '1';
    clearTimeout(statusTimer);
    if (!sticky)
      statusTimer = setTimeout(function () {
        statusEl.style.opacity = '0';
      }, 1800);
  }

  if (canEdit) {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function () {
        setStatus('edit mode');
      });
    } else {
      setStatus('edit mode');
    }
  }
})();
