/* ==========================================================================
   Visit counter and privacy-friendly analytics (GoatCounter: no cookies,
   no personal data).

   Setup (once):
   1. Create a free site on https://www.goatcounter.com and pick a code,
      e.g. "gioelegreco"  ->  https://gioelegreco.goatcounter.com
   2. In GoatCounter: Settings -> tick "Allow adding visitor counts on your website".
   3. Put the code below. Until then this file does nothing.
   ========================================================================== */
(function () {
    var CODE = 'giocoelegre';          // <- your GoatCounter code, e.g. 'gioelegreco'

    if (!CODE) return;

    // 1. Count the visit
    var s = document.createElement('script');
    s.async = true;
    s.src = '//gc.zgo.at/count.js';
    s.setAttribute('data-goatcounter', 'https://' + CODE + '.goatcounter.com/count');
    document.head.appendChild(s);

    // 2. Show the total number of views, bottom right (home and project pages only)
    var b = document.body;
    if (!(document.getElementById('top') || b.classList.contains('paper'))) return;
    var el = document.createElement('div');
    el.className = 'visit-counter';
    el.hidden = true;
    el.setAttribute('title', 'Total page views');
    el.innerHTML = '<i class="far fa-eye" aria-hidden="true"></i> <span>Visits</span> <b></b>';
    b.appendChild(el);
    var xhr = new XMLHttpRequest();
    xhr.addEventListener('load', function () {
        try {
            var n = JSON.parse(this.responseText).count;
            if (n) { el.querySelector('b').textContent = n; el.hidden = false; }
        } catch (e) { /* counter stays hidden */ }
    });
    xhr.open('GET', 'https://' + CODE + '.goatcounter.com/counter/TOTAL.json');
    xhr.send();
})();
