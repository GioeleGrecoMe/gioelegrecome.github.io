// Footer year
var yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Navigation bar gets a background once the page scrolls
(function () {
    var nav = document.getElementById('navbar');
    if (!nav) return;
    function update() { nav.classList.toggle('scrolled', window.scrollY > 40); }
    window.addEventListener('scroll', update, { passive: true });
    update();
})();

// Carousels: side arrows scroll one "page" (3 cards on desktop).
// Carousels marked data-loop scroll endlessly: the cards are repeated before and after,
// and after every scroll the position is silently moved back to the middle copy.
(function () {
    document.querySelectorAll('.carousel').forEach(function (c) {
        var track = c.querySelector('.carousel__track');
        var prev = c.querySelector('.carousel__btn--prev');
        var next = c.querySelector('.carousel__btn--next');
        var originals = Array.prototype.slice.call(track.children);
        var n = originals.length;
        var loop = c.hasAttribute('data-loop') && n > 3;

        function clones() {
            return originals.map(function (el) {
                var k = el.cloneNode(true);
                k.setAttribute('aria-hidden', 'true');
                k.inert = true;
                k.classList.add('is-clone');
                return k;
            });
        }
        function setWidth() { return track.children[n].offsetLeft - track.children[0].offsetLeft; }
        function jump(left) {
            track.style.scrollBehavior = 'auto';
            track.style.scrollSnapType = 'none';
            track.scrollLeft = left;
            void track.offsetWidth;
            track.style.scrollSnapType = '';
            track.style.scrollBehavior = '';
        }
        function step() {
            var card = track.querySelector('.card');
            var gap = parseFloat(getComputedStyle(track).columnGap) || 24;
            var unit = card.offsetWidth + gap;
            return unit * Math.max(1, Math.round(track.clientWidth / unit));
        }
        function go(dir) { track.scrollBy({ left: dir * step(), behavior: 'smooth' }); }

        if (loop) {
            clones().forEach(function (k) { track.insertBefore(k, originals[0]); });
            clones().forEach(function (k) { track.appendChild(k); });
            jump(setWidth());
            var timer;
            var normalize = function () {
                var s = setWidth(), p = track.scrollLeft;
                if (p < s - 1) jump(p + s);
                else if (p >= 2 * s - 1) jump(p - s);
            };
            track.addEventListener('scroll', function () { clearTimeout(timer); timer = setTimeout(normalize, 140); }, { passive: true });
            window.addEventListener('resize', function () { jump(setWidth()); });
            prev.disabled = false;
            next.disabled = false;
        } else {
            var update = function () {
                prev.disabled = track.scrollLeft <= 2;
                next.disabled = track.scrollLeft >= track.scrollWidth - track.clientWidth - 2;
            };
            track.addEventListener('scroll', update, { passive: true });
            window.addEventListener('resize', update);
            update();
        }

        prev.addEventListener('click', function () { go(-1); });
        next.addEventListener('click', function () { go(1); });
        track.addEventListener('keydown', function (e) {
            if (e.key === 'ArrowRight') { go(1); e.preventDefault(); }
            if (e.key === 'ArrowLeft') { go(-1); e.preventDefault(); }
        });
    });
})();
