/*
 * A type-to-search box for the trip pages (no build step, no library). Typing filters a list; the
 * arrow keys and Enter pick; anything not on the list can be kept as typed ("Use ... (new)").
 *
 *   TripsCombo.attach(input, {
 *       items: [{id, name, hint}] or a function returning a Promise of that list (fetched once),
 *       idInput: a hidden input that gets the picked item's id (cleared when the text is typed),
 *       allowNew: true to offer "Use what I typed",
 *       newLabel: function (text) { return 'Add "' + text + '"'; },
 *       onPick: function (item or null, text) {},
 *   });
 */
(function () {
    'use strict';
    var uid = 0;
    function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
    function key(s) { return String(s || '').toLowerCase().replace(/[^a-z0-9]/g, ''); }

    function attach(input, opts) {
        if (input.dataset.combo) return;
        input.dataset.combo = '1';
        opts = opts || {};
        var list = null, loading = null, shown = [], active = -1, id = 'trip-combo-' + (++uid);
        var wrap = document.createElement('div');
        wrap.className = 'trip-combo';
        input.parentNode.insertBefore(wrap, input);
        wrap.appendChild(input);
        var box = document.createElement('ul');
        box.className = 'trip-combo-list';
        box.id = id;
        box.setAttribute('role', 'listbox');
        box.hidden = true;
        wrap.appendChild(box);
        input.setAttribute('role', 'combobox');
        input.setAttribute('aria-autocomplete', 'list');
        input.setAttribute('aria-controls', id);
        input.setAttribute('aria-expanded', 'false');
        input.setAttribute('autocomplete', 'off');

        function load() {
            if (list) return Promise.resolve(list);
            if (Array.isArray(opts.items)) { list = opts.items; return Promise.resolve(list); }
            loading = loading || opts.items().then(function (l) { list = l; return l; });
            return loading;
        }
        function close() { box.hidden = true; input.setAttribute('aria-expanded', 'false'); active = -1; }
        function render() {
            var q = input.value.trim(), words = q.toLowerCase().split(/\s+/).filter(Boolean);
            var matches = list.filter(function (it) {
                var hay = (it.name + ' ' + (it.hint || '') + ' ' + (it.id || '')).toLowerCase();
                return words.every(function (w) { return hay.indexOf(w) >= 0; });
            }).slice(0, 12);
            shown = matches.map(function (it) { return { item: it }; });
            var exact = list.some(function (it) { return key(it.name) === key(q); });
            if (opts.allowNew && q && !exact) shown.push({ text: q });
            if (!shown.length) { box.innerHTML = '<li class="trip-combo-empty">Nothing matches.</li>'; }
            else {
                box.innerHTML = shown.map(function (s, i) {
                    return '<li role="option" id="' + id + '-' + i + '" data-i="' + i + '"' + (i === active ? ' aria-selected="true" class="on"' : '') + '>'
                        + (s.item ? esc(s.item.name) + (s.item.hint ? ' <span>' + esc(s.item.hint) + '</span>' : '')
                            : '<em>' + esc(opts.newLabel ? opts.newLabel(s.text) : 'Use "' + s.text + '"') + '</em>') + '</li>';
                }).join('');
            }
            box.hidden = false;
            input.setAttribute('aria-expanded', 'true');
            if (active >= 0) input.setAttribute('aria-activedescendant', id + '-' + active); else input.removeAttribute('aria-activedescendant');
        }
        function pick(s) {
            if (s.item) {
                input.value = s.item.name;
                if (opts.idInput) opts.idInput.value = s.item.id;
            } else {
                input.value = s.text;
                if (opts.idInput) opts.idInput.value = '';
            }
            close();
            input.dispatchEvent(new Event('change', { bubbles: true }));
            if (opts.onPick) opts.onPick(s.item || null, input.value);
        }
        function open() { load().then(function () { if (document.activeElement === input) render(); }); }

        input.addEventListener('focus', open);
        input.addEventListener('input', function () { if (opts.idInput) opts.idInput.value = ''; active = -1; open(); });
        input.addEventListener('keydown', function (e) {
            if (box.hidden && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { open(); e.preventDefault(); return; }
            if (box.hidden) return;
            if (e.key === 'ArrowDown') { active = Math.min(shown.length - 1, active + 1); render(); e.preventDefault(); }
            else if (e.key === 'ArrowUp') { active = Math.max(-1, active - 1); render(); e.preventDefault(); }
            else if (e.key === 'Enter' && active >= 0) { pick(shown[active]); e.preventDefault(); }
            // Closes the list only, not a dialog the box is in.
            else if (e.key === 'Escape') { close(); e.preventDefault(); e.stopPropagation(); }
        });
        // A mousedown (not click) so the pick lands before the input loses focus.
        box.addEventListener('mousedown', function (e) {
            var li = e.target.closest('[data-i]');
            if (li) { e.preventDefault(); pick(shown[+li.dataset.i]); }
        });
        input.addEventListener('blur', function () {
            setTimeout(close, 100);
            // Typed a name that is on the list: link it, so it's never added twice.
            if (list && opts.idInput && !opts.idInput.value && input.value.trim()) {
                var hit = list.find(function (it) { return key(it.name) === key(input.value); });
                if (hit) { input.value = hit.name; opts.idInput.value = hit.id; }
            }
        });
        return { reload: function () { list = null; loading = null; } };
    }

    window.TripsCombo = { attach: attach };
})();
