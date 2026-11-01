// Fall / Thanksgiving on the arcade: a harvest moon, autumn leaves drifting down,
// a warm low haze and two cornucopias, all in the fixed background layer
// (.liquid-bg), behind the cards and text.
// Only when <html> has the "fall" class (set in the head: October and November, or
// ?season=fall / ?season=thanksgiving); otherwise this does nothing. Styles are in
// index.html. Leaf shapes match fall.js on anthonyjctsg.com and ctsg-htx.com, but this
// copy keeps the leaves falling (the arcade background always moves).
(function () {
    'use strict';
    if (!document.documentElement.classList.contains('fall')) { return; }
    var layer = document.querySelector('.liquid-bg');
    if (!layer) { return; }

    function el(cls, html) {
        var d = document.createElement('div');
        d.className = cls;
        d.setAttribute('aria-hidden', 'true');
        if (html) { d.innerHTML = html; }
        layer.appendChild(d);
        return d;
    }
    function rand(min, max) { return min + Math.random() * (max - min); }

    // A cornucopia (horn of plenty) spilling an apple, a small pumpkin, a pear and grapes.
    var HORN = '<svg viewBox="0 0 64 64"><path d="M8 13C4 15 5 21 9 20C12 20 13 23 15 27C20 36 30 43 42 46L46 22C35 22 27 18 21 13C17 10 12 10 8 13Z" fill="#c98a3e" stroke="#7a4a1c" stroke-width="1.5" stroke-linejoin="round"/><path d="M20 15C19 20 19 25 22 30M28 19C27 25 27 32 30 39M36 21C35 28 35 36 37 44" stroke="#7a4a1c" stroke-width="1.4" fill="none" stroke-linecap="round"/><ellipse cx="44" cy="34" rx="4" ry="12" fill="#4a2a10"/><circle cx="53" cy="29" r="6" fill="#c8322a"/><path d="M53 23c0-2 1-3 2-4" stroke="#5a3a1a" stroke-width="1.4" fill="none" stroke-linecap="round"/><path d="M55 20c3-3 7-2 8 0-3 2-6 2-8 0z" fill="#6f9a35"/><ellipse cx="56" cy="50" rx="5" ry="6.5" fill="#e6b13c"/><circle cx="44" cy="54" r="3.2" fill="#6b2f7a"/><circle cx="49" cy="56" r="3.2" fill="#7b3a8c"/><circle cx="46" cy="59" r="3.2" fill="#6b2f7a"/><circle cx="48" cy="43" r="7.5" fill="#e6772a"/><path d="M45 37c-2 4-2 8 0 12M51 37c2 4 2 8 0 12" stroke="#b04c16" stroke-width="1.1" fill="none"/></svg>';

    var LEAVES = [
        { // maple
            blade: 'M12 1.5L13.3 5.2 15.2 4.2 14.7 8.6 17.6 6.2 18.4 8 21.6 7.4 20.4 10.6 22.5 11.6 18.6 14.6 19.4 16.6 14.6 15.9 14.9 18 12.5 17.2 12.5 18.5 11.5 18.5 11.5 17.2 9.1 18 9.4 15.9 4.6 16.6 5.4 14.6 1.5 11.6 3.6 10.6 2.4 7.4 5.6 8 6.4 6.2 9.3 8.6 8.8 4.2 10.7 5.2Z',
            veins: 'M12 17.5V4.5M12 13.5L19.5 8.5M12 13.5L4.5 8.5M12 15.2L17.5 15.6M12 15.2L6.5 15.6',
            stem: 'M12 18.5V23'
        },
        { // oak
            blade: 'M12 1.2C13.6 1.2 14.8 2.4 14.4 3.8 14.2 4.6 13.6 5 13.4 5.4 15.2 4.6 17.4 5.2 17.2 6.8 17 7.8 15.6 8.2 14.8 8.6 17 8.4 19.2 9 18.8 10.8 18.5 12 16.6 12.2 15.6 12.5 17.4 13 18.2 14.2 17.4 15.2 16.6 16.2 15.2 15.8 14.4 15.8 15.4 16.8 15 18 13.8 18.4 13.2 18.6 12.6 18.8 12.4 19.3L11.6 19.3C11.4 18.8 10.8 18.6 10.2 18.4 9 18 8.6 16.8 9.6 15.8 8.8 15.8 7.4 16.2 6.6 15.2 5.8 14.2 6.6 13 8.4 12.5 7.4 12.2 5.5 12 5.2 10.8 4.8 9 7 8.4 9.2 8.6 8.4 8.2 7 7.8 6.8 6.8 6.6 5.2 8.8 4.6 10.6 5.4 10.4 5 9.8 4.6 9.6 3.8 9.2 2.4 10.4 1.2 12 1.2Z',
            veins: 'M12 19V2.8M12 8.2L16.2 6.9M12 8.2L7.8 6.9M12 12L17.6 10.8M12 12L6.4 10.8M12 15.8L16.4 15.1M12 15.8L7.6 15.1',
            stem: 'M12 19.3V23'
        },
        { // elm
            blade: 'M12 1.5C17 5 18.6 10.5 17 15 15.8 18.4 13.6 19.6 12 20 10.4 19.6 8.2 18.4 7 15 5.4 10.5 7 5 12 1.5Z',
            veins: 'M12 19.5V3M12 8L15 6.2M12 8L9 6.2M12 11.5L16 9.5M12 11.5L8 9.5M12 15L15.6 13.4M12 15L8.4 13.4',
            stem: 'M12 20V23'
        }
    ];
    var COLORS = [
        ['#ee8c3a', '#b4471c'],
        ['#e6b13c', '#a8661b'],
        ['#d0492b', '#7f2414'],
        ['#c27434', '#6e3a18'],
        ['#f0c457', '#b97d22']
    ];

    el('fl-moon');
    el('fl-haze');

    // Leaves: each falls in its own slot across the width, at its own depth and pace,
    // already mid-fall on load (negative delays), forever. Skipped for reduced motion.
    if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        var count = window.innerWidth < 640 ? 7 : 13;
        for (var i = 0; i < count; i++) {
            var depth = Math.random();
            var size = Math.round(16 + depth * 22);
            var dur = rand(14, 18) - depth * 5;
            var x = ((i + 0.2 + Math.random() * 0.6) / count) * 100;
            var drift = Math.round(rand(-40, 120) * (0.6 + depth * 0.6));
            var swayDur = rand(1.8, 3.2);
            var flips = Math.random() < 0.45;
            var flutterDur = flips ? rand(1.4, 3) : rand(1.1, 2);
            var leaf = LEAVES[i % LEAVES.length];
            var c = COLORS[i % COLORS.length];
            var id = 'fl-g' + i;
            var s = el('fl-leaf',
                '<i style="opacity:' + (0.55 + depth * 0.4).toFixed(2) + ';--sway:' + Math.round(rand(16, 40)) + 'px;' +
                    '--swing:' + Math.round(rand(22, 50)) + 'deg;animation-duration:' + swayDur.toFixed(2) + 's">' +
                '<svg viewBox="0 0 24 24" style="--axis:' + rand(-0.6, 0.6).toFixed(2) + ';animation:' +
                    (flips ? 'fl-flip ' + flutterDur.toFixed(2) + 's linear infinite' :
                             'fl-rock ' + flutterDur.toFixed(2) + 's ease-in-out infinite alternate') + '">' +
                '<defs><linearGradient id="' + id + '" x1="0" y1="0" x2="1" y2="1">' +
                    '<stop offset="0" stop-color="' + c[0] + '"/><stop offset="1" stop-color="' + c[1] + '"/>' +
                '</linearGradient></defs>' +
                '<path d="' + leaf.blade + '" fill="url(#' + id + ')" stroke="' + c[1] + '" stroke-width=".5" stroke-linejoin="round"/>' +
                '<path d="' + leaf.veins + '" fill="none" stroke="' + c[1] + '" stroke-width=".7" stroke-linecap="round" opacity=".75"/>' +
                '<path d="' + leaf.stem + '" fill="none" stroke="' + c[1] + '" stroke-width="1.1" stroke-linecap="round"/>' +
                '</svg></i>');
            s.style.left = x.toFixed(1) + '%';
            s.style.width = s.style.height = size + 'px';
            s.style.setProperty('--drift', drift + 'px');
            s.style.animationDuration = dur.toFixed(2) + 's';
            s.style.animationDelay = (-Math.random() * dur).toFixed(2) + 's';
        }
    }

    el('fl-horn fl-horn--l', HORN);
    el('fl-horn fl-horn--r', HORN);
}());
