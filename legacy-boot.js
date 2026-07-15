// Synchronous boot script (loaded in <head>): applies persisted theme and
// sidebar state before first paint to avoid a flash of the wrong theme.
// Extracted from inline <script> blocks so the API can serve a strict
// Content-Security-Policy (script-src 'self').
if (localStorage.getItem('themeMode') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
}
if (localStorage.getItem('sidebarCollapsed') === 'true') {
    document.documentElement.classList.add('sidebar-collapsed');
}

// Delegated navigation for elements carrying data-href (replaces inline
// onclick="window.location.href=..." attributes, which CSP blocks).
document.addEventListener('click', function (e) {
    var target = e.target.closest('[data-href]');
    if (target) {
        window.location.href = target.getAttribute('data-href');
    }
});
