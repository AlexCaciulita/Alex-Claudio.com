// ===== DOM ELEMENTS =====
const topNav = document.getElementById('topNav');
const mobileMenuToggle = document.getElementById('mobileMenuToggle');
const mobileMenu = document.getElementById('mobileMenu');
const heroCarousel = document.getElementById('heroCarousel');
const heroSlides = document.querySelectorAll('.hero-slide');
const heroDots = document.querySelectorAll('.hero-dot');
const heroPrev = document.getElementById('heroPrev');
const heroNext = document.getElementById('heroNext');
const contactForm = document.getElementById('contactForm');
const submitButtonEl = document.getElementById('submitButton');
const leadForm = document.getElementById('leadForm');
const leadSubmitButton = document.getElementById('leadSubmit');
const leadSuccessPanel = document.getElementById('leadSuccess');
const leadErrorPanel = document.getElementById('leadError');
const testimonialSlider = document.getElementById('testimonialSlider');
const testimonialSlides = document.querySelectorAll('.testimonial-slide');
const testimonialDots = document.querySelectorAll('.testimonial-dot');
const testimonialPrev = document.getElementById('testimonialPrev');
const testimonialNext = document.getElementById('testimonialNext');
const portfolioGallery = document.getElementById('portfolioGallery');
const lightboxOverlay = document.getElementById('lightboxOverlay');
const lightboxImage = document.getElementById('lightboxImage');
const lightboxClose = document.getElementById('lightboxClose');
const lightboxPrev = document.getElementById('lightboxPrev');
const lightboxNext = document.getElementById('lightboxNext');

// ===== NAVIGATION SCROLL EFFECT =====
function handleNavScroll() {
    const scrollY = window.scrollY;
    
    if (scrollY > 80) {
        topNav.classList.add('scrolled');
    } else {
        topNav.classList.remove('scrolled');
    }
}

// ===== MOBILE MENU =====
function toggleMobileMenu() {
    mobileMenu.classList.toggle('active');
    mobileMenuToggle.setAttribute('aria-expanded', mobileMenu.classList.contains('active').toString());
    
    // Toggle hamburger animation
    const spans = mobileMenuToggle.querySelectorAll('span');
    if (mobileMenu.classList.contains('active')) {
        spans[0].style.transform = 'rotate(45deg) translate(5px, 5px)';
        spans[1].style.opacity = '0';
        spans[2].style.transform = 'rotate(-45deg) translate(7px, -6px)';
    } else {
        spans[0].style.transform = 'none';
        spans[1].style.opacity = '1';
        spans[2].style.transform = 'none';
    }
}

function closeMobileMenu() {
    mobileMenu.classList.remove('active');
    mobileMenuToggle.setAttribute('aria-expanded', 'false');
    const spans = mobileMenuToggle.querySelectorAll('span');
    spans[0].style.transform = 'none';
    spans[1].style.opacity = '1';
    spans[2].style.transform = 'none';
}

// ===== HERO CAROUSEL =====
let currentSlide = 0;
let autoplayInterval;
const slideInterval = 4500; // 4.5 seconds as per design system
let currentLightboxIndex = 0;
let currentGalleryOrder = [];
let currentTestimonial = 0;
let testimonialInterval;
const portfolioQuotes = [
    'I specialise in capturing raw, natural, and candid moments, allowing your special day to unfold organically while we discreetly document every detail, emotion, and outpouring of love that will narrate your story.',
    'I love awesome couples who are totally in love; we revel in telling their love stories and can’t wait to be a part of your epic wedding adventure.'
];
// Curated ordering: favorites first, then remaining set.
const portfolioImages = [
    // Hero picks
    '5DM32249.jpg',
    '5DM32274.jpg',
    '5DM32811.jpg',
    '5DM34024.jpg',
    'Sarah&Michael - Wedding Day-278.jpg',
    'Dawn & Richard - Wedding Day-207.jpg',
    'Devin&Laura - Engagement Session  (14).jpg',
    'Nunta Madalina & Catalin - 2 Iulie 2016 (387).jpg',
    'Amy&Paul - Wedding Day-423.jpg',
    'resized.jpg',
    // Rest of the gallery
    '5DM30850.jpg',
    '5DM30897.jpg',
    '5DM31222.jpg',
    '5DM31468.jpg',
    '5DM31542.jpg',
    '5DM31821.jpg',
    '5DM32209.jpg',
    '5DM32240.jpg',
    '5DM32262.jpg',
    '5DM32928.jpg',
    '5DM32943.jpg',
    '5DM33137.jpg',
    '5DM34020.jpg',
    '5DM34202.jpg',
    'Amy&Paul - Wedding Day-179.jpg',
    'Amy&Paul - Wedding Day-424.jpg',
    'Amy&Paul - Wedding Day-426.jpg',
    'Amy&Paul - Wedding Day-437.jpg',
    'Amy&Paul - Wedding Day-485.jpg',
    'Amy&Paul - Wedding Day-491.jpg',
    'Amy&Paul - Wedding Day-595.jpg',
    'Ana&Iulian - Nunta - 22 August 2015 (129).jpg',
    'Ana&Iulian - Nunta - 22 August 2015 (170).jpg',
    'Ana&Iulian - Nunta - 22 August 2015 (193).jpg',
    'Ana&Iulian - Nunta - 22 August 2015 (199).jpg',
    'Ana&Iulian - Nunta - 22 August 2015 (379).jpg',
    'Ana&Iulian - Nunta - 22 August 2015 (397).jpg',
    'Ana&Iulian - Nunta - 22 August 2015 (399).jpg',
    'Ana&Iulian - Nunta - 22 August 2015 (488).jpg',
    'Devin&Laura - Engagement Session  (10).jpg',
    'Devin&Laura - Engagement Session  (102).jpg',
    'Devin&Laura - Engagement Session  (58).jpg',
    'Devin&Laura - Engagement Session  (68).jpg',
    'Diane & Chris - Engagement Session-100.jpg',
    'Diane & Chris - Engagement Session-103.jpg',
    'Diane & Chris - Engagement Session-115.jpg',
    'Diane & Chris - Engagement Session-122.jpg',
    'Diane & Chris - Engagement Session-140.jpg',
    'Diane & Chris - Engagement Session-145.jpg',
    'Iuliana & Florin 27.07 (41).jpg',
    'Iuliana & Florin 27.07 (49).jpg',
    'Iuliana & Florin 27.07 (60).jpg',
    'Nunta Madalina & Catalin - 2 Iulie 2016 (337).jpg',
    'Nunta Madalina & Catalin - 2 Iulie 2016 (354).jpg',
    'Nunta Madalina & Catalin - 2 Iulie 2016 (371).jpg',
    'resized222.jpg',
    'Sarah&Michael - Wedding Day-275.jpg',
    'Sarah&Michael - Wedding Day-286.jpg'
];

function showSlide(index) {
    if (heroSlides.length === 0) return;
    // Remove active class from all slides and dots
    heroSlides.forEach(slide => slide.classList.remove('active'));
    heroDots.forEach(dot => dot.classList.remove('active'));
    
    // Add active class to current slide and dot
    heroSlides[index].classList.add('active');
    heroDots[index].classList.add('active');
    
    currentSlide = index;
}

function nextSlide() {
    if (heroSlides.length === 0) return;
    const nextIndex = (currentSlide + 1) % heroSlides.length;
    showSlide(nextIndex);
}

function prevSlide() {
    if (heroSlides.length === 0) return;
    const prevIndex = (currentSlide - 1 + heroSlides.length) % heroSlides.length;
    showSlide(prevIndex);
}

function startAutoplay() {
    if (!heroCarousel || heroSlides.length === 0) return;
    // Check if user prefers reduced motion
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        return;
    }
    
    autoplayInterval = setInterval(nextSlide, slideInterval);
}

function stopAutoplay() {
    if (autoplayInterval) {
        clearInterval(autoplayInterval);
        autoplayInterval = null;
    }
}

function handleCarouselInteraction() {
    stopAutoplay();
    startAutoplay();
}

// ===== SMOOTH SCROLLING =====
function smoothScrollTo(target) {
    const element = document.querySelector(target);
    if (element) {
        const offsetTop = element.offsetTop - 80; // Account for fixed nav
        window.scrollTo({
            top: offsetTop,
            behavior: 'smooth'
        });
    }
}

// ===== FORM HANDLING =====
async function handleFormSubmit(event) {
    event.preventDefault();

    // Honeypot check
    const honey = document.getElementById('company');
    if (honey && honey.value) {
        return; // silently drop bots
    }

    const data = Object.fromEntries(new FormData(contactForm));

    // Inline validation
    const errors = {};
    if (!data.names) errors.names = 'Please enter your names.';
    if (!validateEmail(data.email || '')) errors.email = 'Please enter a valid email.';
    if (!data.event_date) errors.event_date = 'Please select your event date.';
    if (!data.location) errors.location = 'Please enter a location.';
    if (!data.message) errors.message = 'Please share a bit about your event.';

    // At least one service
        const servicesChecked = Array.from(document.querySelectorAll('input[name="services"]:checked'));
    if (servicesChecked.length === 0) errors.services = 'Choose at least one service.';

    // Render errors
    clearDsErrors();
    Object.entries(errors).forEach(([key, msg]) => setDsError(key, msg));
    if (Object.keys(errors).length > 0) {
        showFormError('Please review the highlighted fields.');
        return;
    }

    // Budget pattern
    const budget = (data.budget || '').trim();
    if (budget && !/^[0-9,$\.\-\s]+$/.test(budget)) {
        setDsError('budget', 'Use numbers and , . - only.');
        showFormError('Please correct the budget format.');
        return;
    }

    // Captcha token presence (client-side)
    // Captcha disabled

    // Submit
    const originalText = submitButtonEl.textContent;
    submitButtonEl.textContent = 'Sending...';
    submitButtonEl.disabled = true;

    try {
        const formData = new FormData(contactForm);
        const encodedData = new URLSearchParams();
        formData.forEach((value, key) => {
            encodedData.append(key, value.toString());
        });

        const response = await fetch('/', {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: encodedData.toString()
        });

        if (response.ok) {
            contactForm.reset();
            submitButtonEl.textContent = originalText;
            submitButtonEl.disabled = false;
            showFormSuccess('We received your inquiry and will respond soon.');
            trackFormSubmission();
        } else {
            throw new Error('Form submission failed');
        }
    } catch (error) {
        console.error('Submission error:', error);
        submitButtonEl.textContent = originalText;
        submitButtonEl.disabled = false;
        showFormError('Something went wrong. Please try again.');
    }
}

// ===== TESTIMONIAL SLIDER =====
function showTestimonial(index) {
    if (!testimonialSlides.length) return;
    testimonialSlides.forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
    });
    testimonialDots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
    });
    currentTestimonial = index;
}

function nextTestimonial() {
    if (!testimonialSlides.length) return;
    const nextIndex = (currentTestimonial + 1) % testimonialSlides.length;
    showTestimonial(nextIndex);
}

function prevTestimonial() {
    if (!testimonialSlides.length) return;
    const prevIndex = (currentTestimonial - 1 + testimonialSlides.length) % testimonialSlides.length;
    showTestimonial(prevIndex);
}

function startTestimonialAutoplay() {
    if (!testimonialSlides.length) return;
    if (testimonialInterval) clearInterval(testimonialInterval);
    testimonialInterval = setInterval(nextTestimonial, 6500);
}

function stopTestimonialAutoplay() {
    if (testimonialInterval) {
        clearInterval(testimonialInterval);
        testimonialInterval = null;
    }
}

function renderPortfolioGallery() {
    if (!portfolioGallery || !Array.isArray(portfolioImages)) return;

    currentGalleryOrder = [...portfolioImages];
    portfolioGallery.innerHTML = '';

    // Insert quotes at fixed spots: after first row, and mid of fourth row.
    const quoteInsertions = [3, 8]; // zero-based counts of images already placed
    let nextQuoteIndex = 0;
    let imagesPlaced = 0;

    currentGalleryOrder.forEach((file, idx) => {
        if (nextQuoteIndex < quoteInsertions.length && imagesPlaced === quoteInsertions[nextQuoteIndex]) {
            portfolioGallery.appendChild(createQuoteFigure(portfolioQuotes[nextQuoteIndex]));
            nextQuoteIndex += 1;
        }

        const figure = document.createElement('figure');
        figure.className = 'portfolio-photo masonry-item';

        const img = document.createElement('img');
        img.loading = 'lazy';
        img.src = `../Portofolio/${encodeURIComponent(file)}`;
        img.alt = createAltFromFilename(file);
        img.dataset.index = idx.toString();
        img.addEventListener('click', () => openLightbox(idx));

        figure.appendChild(img);
        portfolioGallery.appendChild(figure);
        imagesPlaced += 1;
    });

    // Append any remaining quotes if gallery shorter than expected.
    while (nextQuoteIndex < portfolioQuotes.length) {
        portfolioGallery.appendChild(createQuoteFigure(portfolioQuotes[nextQuoteIndex]));
        nextQuoteIndex += 1;
    }
}

function shuffleArray(array) {
    const arr = [...array];
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function createAltFromFilename(name) {
    return name
        .replace(/\.[^/.]+$/, '')
        .replace(/[-_]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

function openLightbox(index) {
    if (!lightboxOverlay || !lightboxImage) return;
    currentLightboxIndex = index;
    updateLightboxImage();
    lightboxOverlay.classList.remove('hidden');
    document.body.classList.add('lightbox-open');
}

function createQuoteFigure(message) {
    const figure = document.createElement('figure');
    figure.className = 'portfolio-quote masonry-item';

    const card = document.createElement('div');
    card.className = 'portfolio-quote-card';

    const text = document.createElement('p');
    text.className = 'portfolio-quote-text';
    text.textContent = message;

    card.appendChild(text);
    figure.appendChild(card);
    return figure;
}

function closeLightbox() {
    if (!lightboxOverlay) return;
    lightboxOverlay.classList.add('hidden');
    document.body.classList.remove('lightbox-open');
}

function updateLightboxImage() {
    if (!lightboxImage || !currentGalleryOrder.length) return;
    const file = currentGalleryOrder[currentLightboxIndex];
    lightboxImage.src = `../Portofolio/${encodeURIComponent(file)}`;
    lightboxImage.alt = createAltFromFilename(file);
}

function showPrevLightbox() {
    if (!currentGalleryOrder.length) return;
    currentLightboxIndex = (currentLightboxIndex - 1 + currentGalleryOrder.length) % currentGalleryOrder.length;
    updateLightboxImage();
}

function showNextLightbox() {
    if (!currentGalleryOrder.length) return;
    currentLightboxIndex = (currentLightboxIndex + 1) % currentGalleryOrder.length;
    updateLightboxImage();
}

// ===== LAZY LOADING =====
function lazyLoadImages() {
    const images = document.querySelectorAll('img[data-src]');
    
    const imageObserver = new IntersectionObserver((entries, observer) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                const img = entry.target;
                img.src = img.dataset.src;
                img.classList.remove('lazy');
                imageObserver.unobserve(img);
            }
        });
    });
    
    images.forEach(img => imageObserver.observe(img));
}

// ===== PORTFOLIO TILE HOVER EFFECTS =====
function initPortfolioHoverEffects() {
    const portfolioTiles = document.querySelectorAll('.portfolio-tile');
    
    portfolioTiles.forEach(tile => {
        const image = tile.querySelector('.tile-image');
        const overlay = tile.querySelector('.tile-overlay');
        
        tile.addEventListener('mouseenter', () => {
            if (image) {
                image.style.transform = 'scale(1.03)';
            }
            if (overlay) {
                overlay.style.transform = 'translateY(-8px)';
            }
        });
        
        tile.addEventListener('mouseleave', () => {
            if (image) {
                image.style.transform = 'scale(1)';
            }
            if (overlay) {
                overlay.style.transform = 'translateY(0)';
            }
        });
    });
}

// ===== ACCESSIBILITY ENHANCEMENTS =====
function enhanceAccessibility() {
    const hasCarouselControls = heroSlides.length > 1 && heroPrev && heroNext;
    if (hasCarouselControls) {
        // Add ARIA labels to carousel controls
        heroPrev.setAttribute('aria-label', 'Previous slide');
        heroNext.setAttribute('aria-label', 'Next slide');
        
        // Add keyboard navigation for carousel
        document.addEventListener('keydown', (event) => {
            if (event.key === 'ArrowLeft') {
                prevSlide();
                handleCarouselInteraction();
            } else if (event.key === 'ArrowRight') {
                nextSlide();
                handleCarouselInteraction();
            }
        });
    }
    
    // Add focus management for mobile menu
    const mobileNavLinks = document.querySelectorAll('.mobile-nav-link');
    mobileNavLinks.forEach(link => {
        link.addEventListener('click', closeMobileMenu);
    });
}

// ===== PERFORMANCE OPTIMIZATIONS =====
function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

const debouncedNavScroll = debounce(handleNavScroll, 10);

// ===== EVENT LISTENERS =====
document.addEventListener('DOMContentLoaded', () => {
    // Navigation
    if (mobileMenuToggle) {
        mobileMenuToggle.setAttribute('aria-expanded', 'false');
        mobileMenuToggle.addEventListener('click', toggleMobileMenu);
    }
    window.addEventListener('scroll', debouncedNavScroll);
    
    // Hero carousel
    const hasCarousel = heroCarousel && heroSlides.length > 1;
    if (hasCarousel) {
        heroDots.forEach((dot, index) => {
            dot.addEventListener('click', () => {
                showSlide(index);
                handleCarouselInteraction();
            });
        });
        
        if (heroPrev) {
            heroPrev.addEventListener('click', () => {
                prevSlide();
                handleCarouselInteraction();
            });
        }
        
        if (heroNext) {
            heroNext.addEventListener('click', () => {
                nextSlide();
                handleCarouselInteraction();
            });
        }
        
        // Pause autoplay on hover
        heroCarousel.addEventListener('mouseenter', stopAutoplay);
        heroCarousel.addEventListener('mouseleave', startAutoplay);
    }
    
    // Smooth scrolling for navigation links
    document.querySelectorAll('a[href^="#"], a[href^="/#"]').forEach(link => {
        link.addEventListener('click', (event) => {
            const href = link.getAttribute('href') || '';
            const isRootHash = href.startsWith('/#');
            const hash = isRootHash ? href.slice(1) : href;

            // Only intercept if we're already on the home page; otherwise allow navigation
            if (isRootHash && window.location.pathname !== '/' && window.location.pathname !== '') {
                return;
            }

            event.preventDefault();
            smoothScrollTo(hash);
        });
    });
    
    // Contact form enhancements
    if (contactForm) {
        // Add visible focus ring to inputs via JS for browsers that ignore :focus-visible
        document.querySelectorAll('.ds-input, .ds-textarea, .ds-select').forEach(el => {
            el.addEventListener('focus', () => { el.style.boxShadow = '0 0 0 2px rgba(209,165,116,0.35)' })
            el.addEventListener('blur', () => { el.style.boxShadow = 'none' })
        })
        // Live enable/disable submit for required fields
        const requiredSelectors = ['#names', '#email', '#event_date', '#location', '#message'];
        const requiredInputs = requiredSelectors.map(sel => document.querySelector(sel)).filter(Boolean);
        const evaluateValidity = () => {
            const allFilled = requiredInputs.every(inp => (inp.value || '').trim().length > 0) && validateEmail((document.getElementById('email')?.value)||'');
            if (submitButtonEl) submitButtonEl.disabled = !allFilled;
        };
        requiredInputs.forEach(inp => inp.addEventListener('input', evaluateValidity));
        evaluateValidity();

        // Phone mask (very light)
        const phone = document.getElementById('phone');
        if (phone) {
            phone.addEventListener('input', () => {
                phone.value = phone.value
                    .replace(/[^\d+()\-\s]/g, '')
                    .replace(/\s+/g, ' ');
            });
        }

        // Toggle free-text for Other service
        const otherCb = document.getElementById('servicesOther');
        const otherText = document.getElementById('servicesOtherText');
        if (otherCb && otherText) {
            const syncOther = () => {
                if (otherCb.checked) {
                    otherText.classList.remove('hidden');
                } else {
                    otherText.classList.add('hidden');
                    otherText.value = '';
                }
            };
            otherCb.addEventListener('change', syncOther);
            syncOther();
        }

        // Captcha temporarily disabled; no-op handler
        window.onCaptchaSuccess = function() {};

        // Submit handler
        contactForm.addEventListener('submit', handleFormSubmit);
    }

    // Lead capture form (wedding show)
    if (leadForm) {
        const leadHoneypot = document.getElementById('leadCompany');
        const leadInputs = ['leadName', 'leadEmail', 'leadPhone'].map((id) => document.getElementById(id)).filter(Boolean);

        const resetLeadAlerts = () => {
            if (leadSuccessPanel) leadSuccessPanel.classList.add('hidden');
            if (leadErrorPanel) leadErrorPanel.classList.add('hidden');
        };

        const clearLeadErrors = () => {
            resetLeadAlerts();
            document.querySelectorAll('#leadForm .ds-help').forEach((el) => {
                el.textContent = '';
                el.classList.remove('ds-error-text');
            });
            leadInputs.forEach((input) => input?.removeAttribute('aria-invalid'));
        };

        const setLeadError = (fieldId, message) => {
            setDsError(fieldId, message);
        };

        const evaluateLeadValidity = () => {
            const [nameEl, emailEl, phoneEl] = leadInputs;
            const ready =
                nameEl &&
                emailEl &&
                phoneEl &&
                nameEl.value.trim().length > 0 &&
                validateEmail(emailEl.value || '') &&
                (phoneEl.value || '').trim().length >= 7;
            if (leadSubmitButton) leadSubmitButton.disabled = !ready;
        };

        leadInputs.forEach((inp) => inp?.addEventListener('input', evaluateLeadValidity));
        evaluateLeadValidity();

        leadForm.addEventListener('submit', async (event) => {
            event.preventDefault();
            if (leadHoneypot && leadHoneypot.value) return;

            clearLeadErrors();
            const name = document.getElementById('leadName')?.value.trim() || '';
            const email = document.getElementById('leadEmail')?.value.trim() || '';
            const phone = document.getElementById('leadPhone')?.value.trim() || '';

            let hasError = false;
            if (!name) { setLeadError('leadName', 'Please share your name.'); hasError = true; }
            if (!email || !validateEmail(email)) { setLeadError('leadEmail', 'Add a valid email so I can send details.'); hasError = true; }
            if (!phone || !/^[0-9+()\-\.\s]{7,}$/.test(phone)) { setLeadError('leadPhone', 'Add a phone number I can text or call.'); hasError = true; }

            if (hasError) {
                if (leadErrorPanel) leadErrorPanel.classList.remove('hidden');
                if (leadErrorPanel?.querySelector('p')) leadErrorPanel.querySelector('p').textContent = 'Please check the highlighted fields.';
                if (leadSubmitButton) leadSubmitButton.disabled = false;
                return;
            }

            if (leadSubmitButton) {
                leadSubmitButton.textContent = 'Submitting...';
                leadSubmitButton.disabled = true;
            }

            const formData = new FormData(leadForm);
            const encoded = new URLSearchParams();
            formData.forEach((value, key) => encoded.append(key, value.toString()));

            try {
                const response = await fetch('/lead/', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: encoded.toString()
                });

                if (!response.ok) throw new Error('Lead submission failed');

                leadForm.reset();
                evaluateLeadValidity();
                if (leadSuccessPanel) leadSuccessPanel.classList.remove('hidden');
                if (leadSubmitButton) {
                    leadSubmitButton.textContent = 'Submit';
                    leadSubmitButton.disabled = false;
                }
            } catch (error) {
                console.error('Lead form error:', error);
                if (leadErrorPanel) leadErrorPanel.classList.remove('hidden');
                if (leadSubmitButton) {
                    leadSubmitButton.textContent = 'Submit';
                    leadSubmitButton.disabled = false;
                }
            }
        });
    }
    
    // Initialize features
    renderPortfolioGallery();
    if (hasCarousel) startAutoplay();
    lazyLoadImages();
    initPortfolioHoverEffects();

    // Lightbox controls
    if (lightboxOverlay) {
        lightboxOverlay.addEventListener('click', (e) => {
            if (e.target === lightboxOverlay) {
                closeLightbox();
            }
        });
    }
    if (lightboxClose) lightboxClose.addEventListener('click', closeLightbox);
    if (lightboxPrev) lightboxPrev.addEventListener('click', showPrevLightbox);
    if (lightboxNext) lightboxNext.addEventListener('click', showNextLightbox);

    document.addEventListener('keydown', (e) => {
        const isOpen = lightboxOverlay && !lightboxOverlay.classList.contains('hidden');
        if (!isOpen) return;
        if (e.key === 'Escape') closeLightbox();
        if (e.key === 'ArrowLeft') showPrevLightbox();
        if (e.key === 'ArrowRight') showNextLightbox();
    });
    enhanceAccessibility();

    // Testimonials slider
    if (testimonialSlider && testimonialSlides.length) {
        showTestimonial(0);
        testimonialDots.forEach((dot, idx) => {
            dot.addEventListener('click', () => {
                showTestimonial(idx);
                stopTestimonialAutoplay();
                startTestimonialAutoplay();
            });
        });
        if (testimonialPrev) {
            testimonialPrev.addEventListener('click', () => {
                prevTestimonial();
                stopTestimonialAutoplay();
                startTestimonialAutoplay();
            });
        }
        if (testimonialNext) {
            testimonialNext.addEventListener('click', () => {
                nextTestimonial();
                stopTestimonialAutoplay();
                startTestimonialAutoplay();
            });
        }
        testimonialSlider.addEventListener('mouseenter', stopTestimonialAutoplay);
        testimonialSlider.addEventListener('mouseleave', startTestimonialAutoplay);
        startTestimonialAutoplay();
    }

    // Handle window resize
    window.addEventListener('resize', debounce(() => {
        // Recalculate any layout-dependent features
    }, 250));
});

// ===== UTILITY FUNCTIONS =====
function formatDate(date) {
    return new Intl.DateTimeFormat('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    }).format(date);
}

function validateEmail(email) {
    const re = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return re.test(email);
}

// DS form helpers
function setDsError(fieldId, message) {
    const helpEl = document.getElementById(`${fieldId}Help`) || document.getElementById(`${fieldId}-help`);
    if (helpEl) {
        helpEl.textContent = message;
        helpEl.classList.add('ds-error-text');
    }
    const inputEl = document.getElementById(fieldId);
    if (inputEl) inputEl.setAttribute('aria-invalid', 'true');
}

function clearDsErrors() {
    document.querySelectorAll('.ds-help').forEach(el => {
        el.textContent = '';
        el.classList.remove('ds-error-text');
    });
    document.querySelectorAll('.ds-input, .ds-textarea, .ds-select').forEach(el => el.removeAttribute('aria-invalid'));
}

function showFormSuccess(msg) {
    const s = document.getElementById('formSuccess');
    const e = document.getElementById('formError');
    if (e) e.classList.add('hidden');
    if (s) { s.classList.remove('hidden'); s.querySelector('p').textContent = msg; }
}

function showFormError(msg) {
    const s = document.getElementById('formSuccess');
    const e = document.getElementById('formError');
    if (s) s.classList.add('hidden');
    if (e) { e.classList.remove('hidden'); e.querySelector('p').textContent = msg; }
}

// ===== ERROR HANDLING =====
window.addEventListener('error', (event) => {
    console.error('JavaScript error:', event.error);
});

// ===== ANALYTICS READY (placeholder) =====
function trackEvent(eventName, eventData = {}) {
    // Placeholder for analytics tracking
    console.log('Event tracked:', eventName, eventData);
}

// Track form submissions
function trackFormSubmission() {
    trackEvent('contact_form_submitted', {
        timestamp: new Date().toISOString()
    });
}

// Track portfolio clicks
function trackPortfolioClick(coupleName) {
    trackEvent('portfolio_clicked', {
        couple: coupleName,
        timestamp: new Date().toISOString()
    });
}

// ===== ADDITIONAL ENHANCEMENTS =====

// Add loading states for images
function addImageLoadingStates() {
    const images = document.querySelectorAll('img');
    
    images.forEach(img => {
        img.addEventListener('load', () => {
            img.classList.add('loaded');
        });
        
        img.addEventListener('error', () => {
            img.classList.add('error');
            img.alt = 'Image failed to load';
        });
    });
}

// Add scroll-triggered animations
function initScrollAnimations() {
    const observerOptions = {
        threshold: 0.1,
        rootMargin: '0px 0px -50px 0px'
    };
    
    const observer = new IntersectionObserver((entries) => {
        entries.forEach(entry => {
            if (entry.isIntersecting) {
                entry.target.classList.add('animate-in');
            }
        });
    }, observerOptions);
    
    // Observe elements that should animate on scroll
    const animateElements = document.querySelectorAll('.portfolio-tile, .testimonial-quote, .about-content');
    animateElements.forEach((el, idx) => {
        el.style.setProperty('--animate-delay', `${idx * 80}ms`);
    });
    animateElements.forEach(el => observer.observe(el));
}

// Initialize additional features
document.addEventListener('DOMContentLoaded', () => {
    addImageLoadingStates();
    initScrollAnimations();
});

// ===== EXPORT FOR MODULE USE (if needed) =====
if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
        showSlide,
        nextSlide,
        prevSlide,
        toggleMobileMenu,
        handleFormSubmit,
        smoothScrollTo
    };
}
