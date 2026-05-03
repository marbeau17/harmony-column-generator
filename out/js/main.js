// Scroll to Top
(function() {
  var btn = document.querySelector('.scroll-to-top');
  if (!btn) return;

  window.addEventListener('scroll', function() {
    if (window.scrollY > 300) {
      btn.style.opacity = '1';
      btn.style.pointerEvents = 'auto';
    } else {
      btn.style.opacity = '0';
      btn.style.pointerEvents = 'none';
    }
  });

  btn.addEventListener('click', function() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
})();

// CTA Tracking
(function() {
  document.querySelectorAll('.harmony-cta a, [data-cta-position] a').forEach(function(link) {
    link.addEventListener('click', function() {
      if (typeof gtag === 'function') {
        var position = this.closest('[data-cta-position]');
        gtag('event', 'cta_click', {
          event_category: 'CTA',
          event_label: position ? position.dataset.ctaPosition : 'unknown',
          transport_type: 'beacon'
        });
      }
    });
  });
})();

// Scroll Depth Tracking
(function() {
  var markers = [25, 50, 75, 100];
  var fired = {};

  window.addEventListener('scroll', function() {
    var scrollPercent = Math.round((window.scrollY / (document.body.scrollHeight - window.innerHeight)) * 100);
    markers.forEach(function(mark) {
      if (scrollPercent >= mark && !fired[mark]) {
        fired[mark] = true;
        if (typeof gtag === 'function') {
          gtag('event', 'scroll_depth', {
            event_category: 'Engagement',
            event_label: mark + '%'
          });
        }
      }
    });
  });
})();
