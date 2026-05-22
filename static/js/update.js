// Shows a modal when the background updater has staged a new version, and lets
// the user apply it now. If they skip it, the staged update auto-applies on the
// next launch (handled server-side at startup). Loaded on every page via base.html.
(function () {
    let shown = false;
    let pendingVersion = null;

    function openModal(version) {
        const overlay = document.getElementById("update-modal-overlay");
        if (!overlay) return;
        document.getElementById("update-modal-version").textContent =
            version ? `Version ${version}` : "A new version";
        overlay.classList.add("open");
    }

    function closeModal() {
        document.getElementById("update-modal-overlay")?.classList.remove("open");
    }

    function dismiss() {
        // Don't nag again this session for the same version.
        if (pendingVersion) sessionStorage.setItem("updateDismissed", pendingVersion);
        closeModal();
    }

    async function check() {
        if (shown) return;
        try {
            const res = await fetch("/api/update/status").then(r => r.json());
            if (!res.update_available) return;
            pendingVersion = String(res.new_version);
            if (sessionStorage.getItem("updateDismissed") === pendingVersion) return;
            shown = true;
            openModal(res.new_version);
        } catch (e) {
            /* offline, or running from source — nothing to do */
        }
    }

    async function applyNow() {
        const btn = document.getElementById("update-modal-now");
        btn.disabled = true;
        btn.textContent = "Updating…";
        const res = await fetch("/api/update/apply", { method: "POST" })
            .then(r => r.json()).catch(() => null);
        if (res && res.error) {
            btn.disabled = false;
            btn.textContent = "Update & Restart";
            alert(res.error);
            return;
        }
        const body = document.querySelector("#update-modal-overlay .modal-body");
        if (body) {
            body.innerHTML = "<p style='font-size:13px;color:var(--on-surface);line-height:1.6'>" +
                "Updating… the app will close and reopen in a few seconds.</p>";
        }
    }

    document.addEventListener("DOMContentLoaded", () => {
        document.getElementById("update-modal-close")?.addEventListener("click", dismiss);
        document.getElementById("update-modal-later")?.addEventListener("click", dismiss);
        document.getElementById("update-modal-now")?.addEventListener("click", applyNow);
        check();
        // Catch updates that finish downloading while the app is open.
        setInterval(check, 30000);
    });
})();
