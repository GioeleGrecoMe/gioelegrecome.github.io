// Project / paper pages: footer year, lightbox, BibTeX copy, TOC highlight.
(function () {
    var y = document.getElementById('year');
    if (y) y.textContent = new Date().getFullYear();

    // Lightbox for figures
    var lb = document.createElement('div');
    lb.className = 'lb';
    lb.setAttribute('role', 'dialog');
    lb.setAttribute('aria-label', 'Enlarged figure');
    lb.innerHTML = '<img alt="">';
    document.body.appendChild(lb);
    var lbImg = lb.querySelector('img');
    document.addEventListener('click', function (e) {
        var img = e.target.closest('.fig img, .teaser img, .demo-pos img');
        if (img) {
            lbImg.src = img.currentSrc || img.src;
            lbImg.alt = img.alt;
            lb.classList.add('is-open');
            return;
        }
        if (e.target.closest('.lb')) lb.classList.remove('is-open');
    });
    document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') lb.classList.remove('is-open');
    });

    // Copy BibTeX
    document.querySelectorAll('.bib button').forEach(function (btn) {
        btn.addEventListener('click', function () {
            var txt = btn.parentElement.querySelector('pre').innerText;
            var done = function () { btn.textContent = 'Copied'; setTimeout(function () { btn.textContent = 'Copy'; }, 1600); };
            if (navigator.clipboard) navigator.clipboard.writeText(txt).then(done, function () {});
        });
    });

    // Highlight the current section in the table of contents
    var links = document.querySelectorAll('.toc a');
    if (!links.length || !('IntersectionObserver' in window)) return;
    var map = {};
    links.forEach(function (a) { map[a.getAttribute('href').slice(1)] = a; });
    var io = new IntersectionObserver(function (entries) {
        entries.forEach(function (en) {
            if (en.isIntersecting) {
                links.forEach(function (a) { a.classList.remove('is-active'); });
                var a = map[en.target.id];
                if (a) a.classList.add('is-active');
            }
        });
    }, { rootMargin: '-30% 0px -60% 0px' });
    document.querySelectorAll('.ps[id]').forEach(function (s) { io.observe(s); });
})();
