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

    // A cornucopia (horn of plenty) spilling an apple, a pumpkin, a pear and grapes (cornucopia.svg).
    var HORN = '<img src="cornucopia.svg" alt="">';

    var LEAVES = [
        { // maple
            blade: 'M12 1.6L13.4 4.6 14.8 3.8 15 7.2 17.4 5.6 17.6 8.4 21.6 7.6 20.2 10.6 22.6 12 18.8 14.6 19.4 17 14.6 16.2 14 19 12.6 18.2 12.6 19.4 11.4 19.4 11.4 18.2 10 19 9.4 16.2 4.6 17 5.2 14.6 1.4 12 3.8 10.6 2.4 7.6 6.4 8.4 6.6 5.6 9 7.2 9.2 3.8 10.6 4.6Z',
            veins: 'M12 18.6V3.4M12 16L19.8 9M12 16L4.2 9M12 14L17.6 15.6M12 14L6.4 15.6M12 9.2L15.2 6.6M12 9.2L8.8 6.6',
            stem: 'M12 18.4V23'
        },
        { // oak
            blade: 'M12.2 1.6L13.1 1.9L13.8 2.1L14.4 2.4L15 2.6L15.5 2.9L15.9 3.1L16.2 3.4L16.4 3.6L16.5 3.9L16.4 4.1L16.2 4.4L15.8 4.6L14.6 4.9L15.9 5.1L16.8 5.4L17.5 5.6L18 5.9L18.5 6.1L18.8 6.4L19 6.6L19.2 6.9L19.2 7.1L19.1 7.4L18.9 7.6L18.5 7.9L18 8.1L17.4 8.4L16.3 8.6L15.9 8.9L17.1 9.1L17.8 9.4L18.3 9.6L18.6 9.9L18.8 10.1L18.9 10.4L18.9 10.7L18.8 10.9L18.6 11.2L18.3 11.4L17.9 11.7L17.4 11.9L16.8 12.2L16 12.4L14.8 12.7L15.5 12.9L16.1 13.2L16.4 13.4L16.6 13.7L16.6 13.9L16.6 14.2L16.5 14.4L16.3 14.7L16.1 14.9L15.8 15.2L15.4 15.4L15.1 15.7L14.7 15.9L14.2 16.2L13.7 16.4L13.3 16.7L13.6 16.9L13.6 17.2L13.6 17.4L13.5 17.7L13.3 17.9L13.1 18.2L12.9 18.4L12.7 18.7L12.4 18.9L12.2 19.2L11.8 19.2L11.6 18.9L11.3 18.7L11.1 18.4L10.9 18.2L10.7 17.9L10.5 17.7L10.4 17.4L10.4 17.2L10.4 16.9L10.7 16.7L10.3 16.4L9.8 16.2L9.3 15.9L8.9 15.7L8.6 15.4L8.2 15.2L7.9 14.9L7.7 14.7L7.5 14.4L7.4 14.2L7.4 13.9L7.4 13.7L7.6 13.4L7.9 13.2L8.5 12.9L9.2 12.7L8 12.4L7.2 12.2L6.6 11.9L6.1 11.7L5.7 11.4L5.4 11.2L5.2 10.9L5.1 10.7L5.1 10.4L5.2 10.1L5.4 9.9L5.7 9.6L6.2 9.4L6.9 9.1L8.1 8.9L7.7 8.6L6.6 8.4L6 8.1L5.5 7.9L5.1 7.6L4.9 7.4L4.8 7.1L4.8 6.9L5 6.6L5.2 6.4L5.5 6.1L6 5.9L6.5 5.6L7.2 5.4L8.1 5.1L9.4 4.9L8.2 4.6L7.8 4.4L7.6 4.1L7.5 3.9L7.6 3.6L7.8 3.4L8.1 3.1L8.5 2.9L9 2.6L9.6 2.4L10.2 2.1L10.9 1.9L11.8 1.6Z',
            veins: 'M12 19.2V2.6M12 6.7L16.4 4.3M12 6.7L7.6 4.3M12 9.5L17.2 7.1M12 9.5L6.8 7.1M12 12.4L16.9 10M12 12.4L7.1 10M12 15.2L15.6 12.8M12 15.2L8.4 12.8M12 17.6L14.1 15.2M12 17.6L9.9 15.2',
            stem: 'M12 19.2V23'
        },
        { // aspen
            blade: 'M12.2 1.4L13.7 1.7L14.7 2L15.2 2.3L16 2.5L16.3 2.8L16.9 3.1L17.1 3.4L17.6 3.7L17.7 4L18.2 4.2L18.2 4.5L18.6 4.8L18.6 5.1L19 5.4L18.8 5.7L19.2 6L19 6.2L19.3 6.5L19.1 6.8L19.4 7.1L19.1 7.4L19.4 7.7L19.1 7.9L19.3 8.2L19 8.5L19.2 8.8L18.9 9.1L19 9.4L18.7 9.6L18.8 9.9L18.5 10.2L18.6 10.5L18.2 10.8L18.3 11.1L17.9 11.4L18 11.6L17.6 11.9L17.6 12.2L17.3 12.5L17.3 12.8L16.9 13.1L16.9 13.3L16.5 13.6L16.5 13.9L16.1 14.2L16.1 14.5L15.7 14.8L15.6 15.1L15.3 15.3L15.2 15.6L14.9 15.9L14.7 16.2L14.4 16.5L14.3 16.8L14 17L13.8 17.3L13.5 17.6L13.4 17.9L13.1 18.2L12.9 18.5L12.7 18.7L12.5 19L12.2 19.3L12.2 19.6L11.9 19.6L11.8 19.3L11.5 19L11.3 18.7L11.1 18.5L10.9 18.2L10.6 17.9L10.5 17.6L10.2 17.3L10 17L9.7 16.8L9.6 16.5L9.3 16.2L9.1 15.9L8.8 15.6L8.7 15.3L8.4 15.1L8.3 14.8L7.9 14.5L7.9 14.2L7.5 13.9L7.5 13.6L7.1 13.3L7.1 13.1L6.7 12.8L6.7 12.5L6.4 12.2L6.4 11.9L6 11.6L6.1 11.4L5.7 11.1L5.8 10.8L5.4 10.5L5.5 10.2L5.2 9.9L5.3 9.6L5 9.4L5.1 9.1L4.8 8.8L5 8.5L4.7 8.2L4.9 7.9L4.6 7.7L4.9 7.4L4.6 7.1L4.9 6.8L4.7 6.5L5 6.2L4.8 6L5.2 5.7L5 5.4L5.4 5.1L5.4 4.8L5.8 4.5L5.8 4.2L6.3 4L6.4 3.7L6.9 3.4L7.1 3.1L7.7 2.8L8 2.5L8.8 2.3L9.3 2L10.3 1.7L11.9 1.4Z',
            veins: 'M12 19.6V3M12 6.7L17.6 4.1M12 6.7L6.4 4.1M12 8.9L18.3 6.3M12 8.9L5.7 6.3M12 11.2L18 8.6M12 11.2L6 8.6M12 13.6L17.1 11M12 13.6L6.9 11M12 16L15.8 13.4M12 16L8.2 13.4M12 18.3L14.2 15.7M12 18.3L9.8 15.7',
            stem: 'M12 19.6V23'
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
