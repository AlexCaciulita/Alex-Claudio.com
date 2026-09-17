(function (window, document) {
    window.dataLayer = window.dataLayer || [];
    window.gtag = window.gtag || function () { window.dataLayer.push(arguments); };
    window.gtag('js', new Date());
    window.gtag('config', 'AW-979140720');
    window.gtag('config', 'G-G8EKXJ67NS');

    if (!window.fbq) {
        const fbq = window.fbq = function () {
            fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
        };
        window._fbq = fbq;
        fbq.push = fbq;
        fbq.loaded = true;
        fbq.version = '2.0';
        fbq.queue = [];
        fbq('init', '2033560380692618');
        fbq('track', 'PageView');
    }

    let started = false;
    function loadTags() {
        if (started) return;
        started = true;
        for (const src of [
            'https://www.googletagmanager.com/gtag/js?id=AW-979140720',
            'https://connect.facebook.net/en_US/fbevents.js'
        ]) {
            const script = document.createElement('script');
            script.async = true;
            script.src = src;
            document.head.appendChild(script);
        }
    }

    function scheduleTags() {
        if (window.requestIdleCallback) window.requestIdleCallback(loadTags, { timeout: 2000 });
        else window.setTimeout(loadTags, 0);
    }
    if (document.readyState === 'complete') scheduleTags();
    else window.addEventListener('load', scheduleTags, { once: true });
    window.addEventListener('pagehide', loadTags, { once: true });
})(window, document);
