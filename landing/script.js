// ============================================
// derot Landing Page — script.js
// ============================================

(function () {
  'use strict';

  // --- Theme Toggle ---
  const toggle = document.getElementById('themeToggle');
  const root = document.documentElement;

  function getStoredTheme() {
    return localStorage.getItem('derot-landing-theme');
  }

  function setTheme(theme) {
    root.setAttribute('data-theme', theme);
    localStorage.setItem('derot-landing-theme', theme);
  }

  // Initialize theme: stored preference > system preference > light
  const stored = getStoredTheme();
  if (stored) {
    setTheme(stored);
  } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
    setTheme('dark');
  }

  toggle.addEventListener('click', function () {
    const current = root.getAttribute('data-theme');
    setTheme(current === 'dark' ? 'light' : 'dark');
  });

  // Listen for system theme changes
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function (e) {
    if (!getStoredTheme()) {
      setTheme(e.matches ? 'dark' : 'light');
    }
  });

  // --- Hero Quote ---
  var HERO_QUOTES = [
    { text: "The secret of getting ahead is getting started.", author: "Mark Twain" },
    { text: "Deep work is the ability to focus without distraction on a cognitively demanding task.", author: "Cal Newport" },
    { text: "The happiness of your life depends upon the quality of your thoughts.", author: "Marcus Aurelius" },
    { text: "It is not that we have a short time to live, but that we waste a great deal of it.", author: "Seneca" },
    { text: "Discipline equals freedom.", author: "Jocko Willink" },
    { text: "A wealth of information creates a poverty of attention.", author: "Herbert A. Simon" },
    { text: "The obstacle is the way.", author: "Ryan Holiday" },
    { text: "Free education is abundant, all over the internet. It's the desire to learn that's scarce.", author: "Naval Ravikant" },
    { text: "Concentrate all your thoughts upon the work at hand. The sun's rays do not burn until brought to a focus.", author: "Alexander Graham Bell" },
    { text: "You will never reach your destination if you stop and throw stones at every dog that barks.", author: "Winston Churchill" },
    { text: "The mind is sharper and keener in seclusion and uninterrupted solitude.", author: "Nikola Tesla" },
    { text: "Waste no more time arguing about what a good man should be. Be one.", author: "Marcus Aurelius" },
    { text: "If a man knows not to which port he sails, no wind is favorable.", author: "Seneca" },
    { text: "The world as we have created it is a process of our thinking. It cannot be changed without changing our thinking.", author: "Albert Einstein" },
    { text: "Who you are, what you think, feel, and do, what you love — is the sum of what you focus on.", author: "Cal Newport" },
    { text: "Ego is the enemy of what you want and of what you have.", author: "Ryan Holiday" },
    { text: "Learn to be indifferent to what makes no difference.", author: "Marcus Aurelius" },
    { text: "Luck is what happens when preparation meets opportunity.", author: "Seneca" },
    { text: "The most important trick to be happy is to realize that happiness is a choice that you make.", author: "Naval Ravikant" },
    { text: "Be tolerant with others and strict with yourself.", author: "Marcus Aurelius" }
  ];

  var quote = HERO_QUOTES[Math.floor(Math.random() * HERO_QUOTES.length)];
  var heroQuoteEl = document.getElementById('heroQuote');
  if (heroQuoteEl) {
    heroQuoteEl.innerHTML = '<span class="hero-quote-text">' + quote.text + '</span><cite class="hero-quote-author">\u2014 ' + quote.author + '</cite>';
  }

  // --- Scroll Fade-Up Animations ---
  var fadeEls = document.querySelectorAll('.fade-up');

  if ('IntersectionObserver' in window) {
    var observer = new IntersectionObserver(
      function (entries) {
        entries.forEach(function (entry) {
          if (entry.isIntersecting) {
            entry.target.classList.add('visible');
            observer.unobserve(entry.target);
          }
        });
      },
      { threshold: 0.15, rootMargin: '0px 0px -40px 0px' }
    );

    fadeEls.forEach(function (el) {
      observer.observe(el);
    });
  } else {
    // Fallback: show everything immediately
    fadeEls.forEach(function (el) {
      el.classList.add('visible');
    });
  }
})();
