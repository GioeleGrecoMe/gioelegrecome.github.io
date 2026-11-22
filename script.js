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

// Intro waveform: soft animated signal waves behind the introduction
(function () {
    var canvas = document.getElementById('signalCanvas');
    if (!canvas) return;
    var host = canvas.parentElement;
    var ctx = canvas.getContext('2d');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, t = 0, running = true;
    var waves = [
        { amp: 36, freq: 0.0062, speed: 0.010, color: 'rgba(56, 189, 248, 0.46)', width: 1.6 },
        { amp: 52, freq: 0.0042, speed: 0.007, color: 'rgba(125, 211, 252, 0.28)', width: 1.2 },
        { amp: 24, freq: 0.0115, speed: 0.016, color: 'rgba(147, 197, 253, 0.34)', width: 1 }
    ];
    function resize() {
        w = host.offsetWidth; h = host.offsetHeight;
        canvas.width = w * dpr; canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }
    function draw() {
        ctx.clearRect(0, 0, w, h);
        var base = h * 0.8;
        waves.forEach(function (wv, i) {
            ctx.beginPath();
            ctx.strokeStyle = wv.color;
            ctx.lineWidth = wv.width;
            for (var x = 0; x <= w; x += 3) {
                var env = 0.55 + 0.45 * Math.sin(x * 0.0016 + t * 0.004 + i);
                var y = base + env * wv.amp * Math.sin(x * wv.freq + t * wv.speed + i * 1.7) + 6 * Math.sin(x * 0.03 + t * 0.03);
                if (x === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
            }
            ctx.stroke();
        });
    }
    function loop() {
        if (!running) return;
        t += 1;
        draw();
        requestAnimationFrame(loop);
    }
    resize();
    if (reduce) { draw(); } else { loop(); }
    window.addEventListener('resize', function () { resize(); draw(); });
    if ('IntersectionObserver' in window && !reduce) {
        new IntersectionObserver(function (e) {
            var vis = e[0].isIntersecting;
            if (vis && !running) { running = true; loop(); }
            else if (!vis) { running = false; }
        }).observe(host);
    }
})();
