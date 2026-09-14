(function (window, document, scriptTag, source, fbq, firstScript) {
    if (window.fbq) return;

    fbq = window.fbq = function () {
        fbq.callMethod ? fbq.callMethod.apply(fbq, arguments) : fbq.queue.push(arguments);
    };
    if (!window._fbq) window._fbq = fbq;
    fbq.push = fbq;
    fbq.loaded = true;
    fbq.version = '2.0';
    fbq.queue = [];

    firstScript = document.createElement(scriptTag);
    firstScript.async = true;
    firstScript.src = source;
    scriptTag = document.getElementsByTagName(scriptTag)[0];
    scriptTag.parentNode.insertBefore(firstScript, scriptTag);
})(window, document, 'script', 'https://connect.facebook.net/en_US/fbevents.js');

fbq('init', '2033560380692618');
fbq('track', 'PageView');
