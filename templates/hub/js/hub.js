/* ========================================
   Harmony MC - Hub Page Scripts
   ======================================== */

(function () {
  'use strict';

  /* ----------------------------------------
     Category Filter
     ---------------------------------------- */
  function initCategoryFilter() {
    var filterButtons = document.querySelectorAll('[data-filter]');
    var entries = document.querySelectorAll('.entry[data-theme]');

    if (!filterButtons.length || !entries.length) return;

    function filterEntries(filterValue) {
      entries.forEach(function (entry) {
        if (filterValue === 'all' || entry.getAttribute('data-theme') === filterValue) {
          entry.classList.remove('is-hidden');
        } else {
          entry.classList.add('is-hidden');
        }
      });
    }

    function setActiveButton(clickedBtn) {
      // Only update filter-btn elements (not category badges or sidebar links)
      document.querySelectorAll('.filter-btn').forEach(function (btn) {
        btn.classList.remove('active');
      });
      if (clickedBtn.classList.contains('filter-btn')) {
        clickedBtn.classList.add('active');
      } else {
        // Find matching filter-btn
        var matchValue = clickedBtn.getAttribute('data-filter');
        document.querySelectorAll('.filter-btn').forEach(function (btn) {
          if (btn.getAttribute('data-filter') === matchValue) {
            btn.classList.add('active');
          }
        });
      }
    }

    filterButtons.forEach(function (btn) {
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        var filterValue = this.getAttribute('data-filter');
        filterEntries(filterValue);
        setActiveButton(this);

        // Scroll to top of entry list on mobile
        if (window.innerWidth <= 767) {
          var entryList = document.querySelector('.entry-list');
          if (entryList) {
            entryList.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        }
      });
    });
  }

  /* ----------------------------------------
     Mobile Navigation
     ---------------------------------------- */
  function initMobileNav() {
    var btn = document.getElementById('mobileNavBtn');
    var nav = document.getElementById('mobileNav');

    if (!btn || !nav) return;

    btn.addEventListener('click', function () {
      btn.classList.toggle('is-active');
      nav.classList.toggle('is-open');
      document.body.style.overflow = nav.classList.contains('is-open') ? 'hidden' : '';
    });

    // Close on link click
    nav.querySelectorAll('a').forEach(function (link) {
      link.addEventListener('click', function () {
        btn.classList.remove('is-active');
        nav.classList.remove('is-open');
        document.body.style.overflow = '';
      });
    });

    // Sub-menu toggles
    nav.querySelectorAll('.mobile-submenu-toggle').forEach(function (toggle) {
      toggle.addEventListener('click', function (e) {
        e.preventDefault();
        var subMenu = this.nextElementSibling;
        if (subMenu) {
          subMenu.classList.toggle('is-open');
          this.textContent = subMenu.classList.contains('is-open') ? '-' : '+';
        }
      });
    });

    // Close on escape key
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && nav.classList.contains('is-open')) {
        btn.classList.remove('is-active');
        nav.classList.remove('is-open');
        document.body.style.overflow = '';
      }
    });
  }

  /* ----------------------------------------
     Smooth Scroll
     ---------------------------------------- */
  function initSmoothScroll() {
    document.querySelectorAll('a[href^="#"]').forEach(function (anchor) {
      anchor.addEventListener('click', function (e) {
        var targetId = this.getAttribute('href');
        if (targetId === '#' || targetId.length <= 1) return;

        var target = document.querySelector(targetId);
        if (target) {
          e.preventDefault();
          var headerHeight = document.querySelector('.siteHeader')
            ? document.querySelector('.siteHeader').offsetHeight
            : 0;
          var targetPosition = target.getBoundingClientRect().top + window.pageYOffset - headerHeight - 20;

          window.scrollTo({
            top: targetPosition,
            behavior: 'smooth'
          });
        }
      });
    });
  }

  /* ----------------------------------------
     Scroll to Top Button
     ---------------------------------------- */
  function initScrollToTop() {
    var btn = document.getElementById('scrollToTopBtn');
    if (!btn) return;

    window.addEventListener('scroll', function () {
      if (window.scrollY > 300) {
        btn.classList.add('show');
      } else {
        btn.classList.remove('show');
      }
    });

    btn.addEventListener('click', function () {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  /* ----------------------------------------
     Initialize
     ---------------------------------------- */
  document.addEventListener('DOMContentLoaded', function () {
    initCategoryFilter();
    initMobileNav();
    initSmoothScroll();
    initScrollToTop();
  });
})();
