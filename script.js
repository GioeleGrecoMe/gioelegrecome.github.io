// Footer year
var yearEl = document.getElementById('year');
if (yearEl) yearEl.textContent = new Date().getFullYear();

// Navbar background once the page scrolls past the hero top
(function () {
    var nav = document.getElementById('navbar');
    if (!nav) return;
    function update() { nav.classList.toggle('scrolled', window.scrollY > 40); }
    window.addEventListener('scroll', update, { passive: true });
    update();
})();

// Reveal-on-scroll
(function () {
    var items = document.querySelectorAll('.reveal');
    if (!('IntersectionObserver' in window)) {
        items.forEach(function (el) { el.classList.add('is-visible'); });
        return;
    }
    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting) {
                entry.target.classList.add('is-visible');
                io.unobserve(entry.target);
            }
        });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    items.forEach(function (el) { io.observe(el); });
})();

// Hero waveform
(function () {
    var canvas = document.getElementById('signalCanvas');
    if (!canvas) return;
    var hero = canvas.parentElement;
    var ctx = canvas.getContext('2d');
    var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0, t = 0, running = true;

    var waves = [
        { amp: 34, freq: 0.0065, speed: 0.010, color: 'rgba(56, 189, 248, 0.32)', width: 1.6 },
        { amp: 52, freq: 0.0045, speed: 0.007, color: 'rgba(125, 211, 252, 0.18)', width: 1.2 },
        { amp: 22, freq: 0.012,  speed: 0.016, color: 'rgba(147, 197, 253, 0.22)', width: 1 }
    ];

    function resize() {
        w = hero.offsetWidth; h = hero.offsetHeight;
        canvas.width = w * dpr; canvas.height = h * dpr;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function draw() {
        ctx.clearRect(0, 0, w, h);
        var base = h * 0.78;
        waves.forEach(function (wv, i) {
            ctx.beginPath();
            ctx.strokeStyle = wv.color;
            ctx.lineWidth = wv.width;
            for (var x = 0; x <= w; x += 3) {
                var env = 0.55 + 0.45 * Math.sin(x * 0.0016 + t * 0.004 + i);
                var y = base + env * wv.amp * Math.sin(x * wv.freq + t * wv.speed + i * 1.7)
                        + 6 * Math.sin(x * 0.03 + t * 0.03);
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

    // Pause the animation when the hero is off-screen
    if ('IntersectionObserver' in window && !reduce) {
        new IntersectionObserver(function (e) {
            var vis = e[0].isIntersecting;
            if (vis && !running) { running = true; loop(); }
            else if (!vis) { running = false; }
        }).observe(hero);
    }
})();


// Publication filters
(function () {
    var btns = document.querySelectorAll('.filter');
    if (!btns.length) return;
    var pubs = document.querySelectorAll('.pub');
    function apply(kind) {
        pubs.forEach(function (li) { li.hidden = kind !== 'all' && li.getAttribute('data-kind') !== kind; });
        document.querySelectorAll('.pubs').forEach(function (ol) {
            var any = Array.prototype.some.call(ol.children, function (li) { return !li.hidden; });
            ol.hidden = !any;
            var h = ol.previousElementSibling;
            if (h && h.classList.contains('pubs__year')) h.hidden = !any;
        });
    }
    btns.forEach(function (b) {
        b.addEventListener('click', function () {
            btns.forEach(function (x) { x.classList.remove('is-active'); });
            b.classList.add('is-active');
            apply(b.getAttribute('data-filter'));
        });
    });
})();

// Nav scroll-spy and back-to-top
(function () {
    var links = document.querySelectorAll('.site-nav__links a[href^="#"]');
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var secs = Object.keys(map).map(function (id) { return document.getElementById(id); }).filter(Boolean);
    function spy() {
        var y = window.scrollY + 120, cur = null;
        secs.forEach(function (s) { if (s.offsetTop <= y) cur = s.id; });
        links.forEach(function (a) { a.classList.remove('is-active'); });
        if (cur && map[cur]) map[cur].classList.add('is-active');
    }
    var toTop = document.querySelector('.to-top');
    function top() { if (toTop) toTop.classList.toggle('is-visible', window.scrollY > 700); }
    window.addEventListener('scroll', function () { spy(); top(); }, { passive: true });
    spy(); top();
})();
