(() => {
  const body = document.body;
  if (!body || !body.classList.contains('atelier')) return;

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const canObserve = 'IntersectionObserver' in window;

  if (!reduceMotion && canObserve) {
    document.documentElement.classList.add('atelier-motion');

    const revealTargets = Array.from(document.querySelectorAll('[data-reveal]'));
    const groups = new Map();
    revealTargets.forEach((el) => {
      const parent = el.parentElement;
      const index = groups.get(parent) || 0;
      groups.set(parent, index + 1);
      el.style.setProperty('--reveal-delay', `${Math.min(index, 4) * 110}ms`);
    });

    const revealObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        entry.target.classList.add('is-in');
        revealObserver.unobserve(entry.target);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -8% 0px' });

    revealTargets.forEach((el) => revealObserver.observe(el));
  }

  const interludeImage = document.querySelector('.interlude-media img');
  if (interludeImage && !reduceMotion) {
    const section = interludeImage.closest('.interlude');
    let ticking = false;
    const update = () => {
      ticking = false;
      const rect = section.getBoundingClientRect();
      const viewport = window.innerHeight || 1;
      if (rect.bottom < 0 || rect.top > viewport) return;
      const progress = (rect.top + rect.height / 2 - viewport / 2) / viewport;
      interludeImage.style.setProperty('--parallax', `${(progress * 90).toFixed(1)}px`);
    };
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      window.requestAnimationFrame(update);
    };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });
  }

  const sticky = document.getElementById('stickyInquire');
  const hero = document.getElementById('hero');
  const contact = document.getElementById('contact');
  const footer = document.querySelector('.footer');
  if (sticky && hero && contact && canObserve) {
    const state = { pastHero: false, hidden: new Set() };
    const sync = () => body.classList.toggle('show-sticky', state.pastHero && state.hidden.size === 0);
    new IntersectionObserver(([entry]) => {
      state.pastHero = !entry.isIntersecting;
      sync();
    }, { threshold: 0.05 }).observe(hero);
    const hideWhenVisible = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) state.hidden.add(entry.target);
        else state.hidden.delete(entry.target);
      });
      sync();
    }, { threshold: 0 });
    [contact, footer].filter(Boolean).forEach((el) => hideWhenVisible.observe(el));
  }
})();
