// Halloween on the arcade: a harvest moon, bats crossing the sky, cobwebs in the top
// corners with a spider letting itself down, low fog and two glowing jack-o'-lanterns,
// all in the fixed background layer (.liquid-bg), behind the cards and text.
// Only when <html> has the "halloween" class (set in the head: all of October, or
// ?season=halloween); otherwise this does nothing. Styles are in index.html.
(function () {
    'use strict';
    if (!document.documentElement.classList.contains('halloween')) { return; }
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

    var BAT = '<svg viewBox="0 0 64 28"><path fill="#120a18" d="M32 10c2-4 4-5 4-5l1 3c4-1 9-5 14-6-1 3-1 5 1 7 3-1 6-1 9 1-4 1-6 4-7 8-3-2-6-2-9 0-2-2-5-3-8-1-2 1-4 3-5 6-1-3-3-5-5-6-3-2-6-1-8 1-3-2-6-2-9 0-1-4-3-7-7-8 3-2 6-2 9-1 2-2 2-4 1-7 5 1 10 5 14 6l1-3s2 1 4 5z"/></svg>';
    var WEB = '<svg viewBox="0 0 200 200" fill="none" stroke="#e8e2f5" stroke-width="1.2"><path d="M0 0L200 120M0 0L150 200M0 0L60 200M0 0L200 40"/><path d="M0 34Q20 30 34 0M0 70Q40 62 70 0M0 110Q62 98 112 0M0 152Q86 136 158 0M0 196Q112 176 200 4"/></svg>';
    var SPIDER = '<svg viewBox="0 0 40 40"><g stroke="#140c1c" stroke-width="2.4" fill="none"><path d="M14 18L4 10M14 21L2 21M14 24L4 32M26 18L36 10M26 21L38 21M26 24L36 32"/></g><ellipse cx="20" cy="22" rx="8" ry="10" fill="#140c1c"/><circle cx="20" cy="11" r="5" fill="#140c1c"/><circle cx="18" cy="10" r="1.2" fill="#ff5a3c"/><circle cx="22" cy="10" r="1.2" fill="#ff5a3c"/></svg>';
    var PUMPKIN = '<svg viewBox="0 0 64 64"><path d="M30 6c2-3 6-3 7 0l-1 9h-5z" fill="#4d7c2a"/><ellipse cx="19" cy="38" rx="14" ry="20" fill="#d9590c"/><ellipse cx="45" cy="38" rx="14" ry="20" fill="#d9590c"/><ellipse cx="32" cy="38" rx="15" ry="22" fill="#f07418"/><path d="M18 30l7-6 5 7zM46 30l-7-6-5 7z" fill="#ffd34d"/><path d="M29 37h6l-3 5z" fill="#ffd34d"/><path d="M14 44c6 7 30 7 36 0l-5 6-4-3-4 4-5-4-5 4-4-4-4 3z" fill="#ffd34d"/></svg>';

    el('hw-moon');
    // Bats: each crosses at its own height and pace, and they don't all set off at once.
    for (var i = 0; i < 6; i++) {
        var b = el('hw-bat', '<span>' + BAT + '</span>');
        var dur = 16 + Math.random() * 14;
        b.style.top = (6 + Math.random() * 38) + 'vh';
        b.style.width = (30 + Math.random() * 26) + 'px';
        b.style.animationDuration = dur + 's';
        b.style.animationDelay = (-Math.random() * dur) + 's';
        b.querySelector('svg').style.animationDuration = (0.22 + Math.random() * 0.18) + 's';
    }
    el('hw-web hw-web--l', WEB);
    el('hw-web hw-web--r', WEB);
    el('hw-spider', SPIDER);
    el('hw-fog');
    el('hw-pumpkin hw-pumpkin--l', PUMPKIN);
    el('hw-pumpkin hw-pumpkin--r', PUMPKIN);
}());
