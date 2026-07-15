// Settings page logic, extracted from an inline <script> block for CSP
// compliance. Tab links carry data-tab; the save button has an id.
document.addEventListener('DOMContentLoaded', function () {
    var links = document.querySelectorAll('.tab-link[data-tab]');

    function switchTab(tabId) {
        document.querySelectorAll('.tab-pane').forEach(function (el) {
            el.style.display = 'none';
        });
        var pane = document.getElementById('tab-' + tabId);
        if (pane) pane.style.display = 'block';

        links.forEach(function (el) {
            el.classList.toggle('active', el.getAttribute('data-tab') === tabId);
        });
    }

    links.forEach(function (el) {
        el.addEventListener('click', function () {
            switchTab(el.getAttribute('data-tab'));
        });
    });

    var saveBtn = document.getElementById('btnSaveSettings');
    if (saveBtn) {
        saveBtn.addEventListener('click', function () {
            // Placeholder page: no real settings persist yet. (A legacy
            // handler stored an unused "geminiApiKey" in localStorage; that
            // dead code was removed rather than carried forward.)
            var originalText = saveBtn.textContent;
            saveBtn.textContent = 'Saved!';
            setTimeout(function () {
                saveBtn.textContent = originalText;
            }, 2000);
        });
    }
});
