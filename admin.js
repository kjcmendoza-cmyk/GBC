import { DbService, AuthService, DEMO_MODE } from './firebase-config.js';
import { getAppData } from './davao-data.js';

let appData;
let dashboardInitialized = false;

const DETAIL_LABELS = {
    material: 'Material',
    type: 'Waste Type',
    job: 'Job Type',
    equipment: 'Unit',
    qty: 'Loads',
    days: 'Days',
    hasBackhoe: 'Backhoe Included',
    hasHaul: 'Hauling Added',
    haulQty: 'Hauling Loads',
    brgy: 'Barangay',
    date: 'Scheduled Date',
    total: 'Total Estimate'
};

function escapeHtml(str) {
    return String(str ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

document.addEventListener("DOMContentLoaded", () => {
    // Prevent selecting past dates when blocking
    const blockDateInput = document.getElementById('block-date');
    if (blockDateInput) {
        blockDateInput.min = new Date().toISOString().split('T')[0];
    }

    // Real Firebase Auth state listener
    AuthService.onAuthChange((user) => {
        if (user) {
            showDashboard();
        } else {
            document.getElementById('login-screen').style.display = 'flex';
            document.getElementById('admin-dashboard').style.display = 'none';
        }
    });

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const email = document.getElementById('admin-email').value.trim();
        const password = document.getElementById('admin-password').value;
        const errEl = document.getElementById('login-error');
        errEl.style.display = 'none';

        try {
            await AuthService.login(email, password);
            if (DEMO_MODE) {
                localStorage.setItem('gbc_admin_auth', 'true');
                showDashboard();
            }
        } catch (error) {
            errEl.innerText = "Login Failed: " + error.message;
            errEl.style.display = 'block';
        }
    });

    document.getElementById('btn-logout').addEventListener('click', async () => {
        await AuthService.logout();
        localStorage.removeItem('gbc_admin_auth');
        location.reload();
    });
});

async function showDashboard() {
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-dashboard').style.display = 'block';

    appData = await getAppData();
    populateSettings();
    await Promise.all([loadOrders(), loadBlockedDates()]);

    if (dashboardInitialized) return;
    dashboardInitialized = true;

    // Tab Navigation
    document.querySelectorAll('.admin-tab-nav .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.admin-tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('#admin-dashboard .tab-content').forEach(c => c.classList.remove('active'));
            e.currentTarget.classList.add('active');
            document.getElementById(e.currentTarget.dataset.target).classList.add('active');
        });
    });

    document.getElementById('status-filter').addEventListener('change', loadOrders);

    // Manual Block Date Submit
    document.getElementById('block-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        btn.innerText = "Blocking...";

        try {
            const resource = document.getElementById('block-resource').value;
            const date = document.getElementById('block-date').value;
            const notes = document.getElementById('block-notes').value.trim();

            await DbService.addBlockedDate({ resource, date, notes });
            e.target.reset();
            closeModal('block-date-modal');
            await loadBlockedDates();
        } catch (err) {
            alert("Failed to block date: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "Block Date";
        }
    });

    // Settings Submit
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        btn.innerText = "Saving...";

        try {
            appData.fleet.trucks = parseInt(document.getElementById('set-trucks').value, 10);
            appData.fleet.backhoes = parseInt(document.getElementById('set-backhoes').value, 10);
            appData.rates.haulingBase = parseInt(document.getElementById('set-hauling').value, 10);
            appData.rates.backhoeDaily = parseInt(document.getElementById('set-backhoe-daily').value, 10);
            appData.rates.backhoeAddon = parseInt(document.getElementById('set-backhoe-addon').value, 10);

            appData.materials.forEach((m, idx) => {
                m.price = parseInt(document.getElementById(`set-mat-${idx}`).value, 10);
                m.inStock = document.getElementById(`set-stock-${idx}`).checked;
            });

            await DbService.saveSettings(appData);
            alert("Settings saved successfully!");
        } catch (err) {
            alert("Error saving settings: " + err.message);
        } finally {
            btn.disabled = false;
            btn.innerText = "Save All Settings";
        }
    });
}

async function loadBlockedDates() {
    const container = document.getElementById('blocked-dates-list');
    try {
        const blocks = await DbService.getBlockedDates();
        if (!blocks.length) {
            container.innerHTML = '';
            return;
        }

        container.innerHTML = `
            <div style="background:#FFFBEB; border:1px solid #FDE68A; border-radius:10px; padding:0.75rem 0.9rem;">
                <strong style="display:block; font-size:0.82rem; color:#92400E; margin-bottom:0.45rem;">Blocked Schedule Dates:</strong>
                <div style="display:flex; flex-wrap:wrap; gap:0.45rem;">
                    ${blocks.map(b => {
                        const resLabel = b.resource === 'backhoe' ? 'PC30 Backhoe' : 'Dump Truck';
                        const noteText = b.notes ? ` (${escapeHtml(b.notes)})` : '';
                        return `
                            <span style="display:inline-flex; align-items:center; gap:0.4rem; background:white; border:1px solid #FCD34D; border-radius:999px; padding:0.25rem 0.65rem; font-size:0.78rem; color:#78350F;">
                                <strong>${resLabel}:</strong> ${escapeHtml(b.date)}${noteText}
                                <button type="button" onclick="removeBlockedDate('${escapeHtml(b.id)}')" style="border:none; background:none; color:#B91C1C; font-weight:800; cursor:pointer; font-size:0.9rem; line-height:1;" title="Unblock">&times;</button>
                            </span>
                        `;
                    }).join('')}
                </div>
            </div>
        `;
    } catch (err) {
        console.error("Error loading blocked dates:", err);
    }
}

window.removeBlockedDate = async function(id) {
    if (!confirm("Remove this blocked date?")) return;
    await DbService.deleteBlockedDate(id);
    await loadBlockedDates();
};

async function loadOrders() {
    const filter = document.getElementById('status-filter').value;
    const container = document.getElementById('orders-list');
    container.innerHTML = `<p class="sub-text" style="text-align:center; padding: 1rem 0;">Loading orders...</p>`;

    try {
        const orders = await DbService.getOrders(filter);

        if (orders.length === 0) {
            container.innerHTML = `<p class="sub-text" style="text-align:center; padding: 1.5rem 0;">No orders found for this filter.</p>`;
            return;
        }

        container.innerHTML = orders.map(o => {
            const detailItems = Object.entries(o.details || {}).map(([k, v]) => {
                const label = DETAIL_LABELS[k] || k;
                const val = typeof v === 'boolean' ? (v ? 'Yes' : 'No') : escapeHtml(v);
                return `<li>${escapeHtml(label)}: <strong>${val}</strong></li>`;
            }).join('');

            const photosHtml = (o.photos && o.photos.length > 0) ? `
                <div style="margin-top:8px;">
                    <strong style="font-size:0.82rem;">Site Photos:</strong>
                    <div class="photo-preview-grid">
                        ${o.photos.map(url => `
                            <a href="${escapeHtml(url)}" target="_blank" rel="noopener">
                                <img src="${escapeHtml(url)}" alt="Waste pile photo">
                            </a>
                        `).join('')}
                    </div>
                </div>
            ` : '';

            return `
                <div class="order-card">
                    <div class="order-header">
                        <span>${escapeHtml(o.ticketId || o.id)} • ${escapeHtml((o.type || '').toUpperCase())}</span>
                        <span class="status-badge status-${escapeHtml(o.status)}">${escapeHtml(o.status)}</span>
                    </div>
                    <p><strong>Customer:</strong> ${escapeHtml(o.customer?.name)}</p>
                    <p><strong>Phone:</strong> <a href="tel:${escapeHtml(o.customer?.phone)}">${escapeHtml(o.customer?.phone)}</a></p>
                    <p><strong>Address:</strong> ${escapeHtml(o.customer?.address)}</p>
                    ${o.customer?.notes ? `<p><strong>Notes:</strong> ${escapeHtml(o.customer.notes)}</p>` : ''}
                    ${o.location?.mapUrl ? `<p style="margin-top:6px;"><a href="${escapeHtml(o.location.mapUrl)}" target="_blank" rel="noopener" style="color:#059669; font-weight:700; text-decoration:none;">📍 View Pinned Location on Map →</a></p>` : ''}
                    <hr style="margin:10px 0; border:0; border-top:1px solid #E2E8F0;">
                    <p><strong>Details:</strong></p>
                    <ul style="margin-left: 20px; font-size: 0.88rem;">
                        ${detailItems}
                    </ul>
                    ${photosHtml}
                    <div style="margin-top: 14px; display: flex; gap: 10px;">
                        ${o.status === 'pending' ? `<button class="btn btn-primary" style="flex:1; padding: 0.55rem;" onclick="updateStatus('${escapeHtml(o.id)}', 'confirmed')">Confirm</button>` : ''}
                        ${o.status === 'confirmed' ? `<button class="btn btn-whatsapp" style="flex:1; padding: 0.55rem;" onclick="updateStatus('${escapeHtml(o.id)}', 'completed')">Complete</button>` : ''}
                        ${o.status !== 'completed' && o.status !== 'cancelled' ? `<button class="btn btn-secondary" style="flex:1; padding: 0.55rem;" onclick="updateStatus('${escapeHtml(o.id)}', 'cancelled')">Cancel</button>` : ''}
                    </div>
                </div>
            `;
        }).join('');
    } catch (err) {
        container.innerHTML = `<p style="color:#B91C1C; text-align:center;">Failed to load orders: ${escapeHtml(err.message)}</p>`;
    }
}

window.updateStatus = async function(id, status) {
    try {
        await DbService.updateOrderStatus(id, status);
        await loadOrders();
    } catch (err) {
        alert("Failed to update status: " + err.message);
    }
};

window.closeModal = function(id) {
    document.getElementById(id).style.display = 'none';
};

function populateSettings() {
    document.getElementById('set-trucks').value = appData.fleet.trucks;
    document.getElementById('set-backhoes').value = appData.fleet.backhoes;
    document.getElementById('set-hauling').value = appData.rates.haulingBase;
    document.getElementById('set-backhoe-daily').value = appData.rates.backhoeDaily;
    document.getElementById('set-backhoe-addon').value = appData.rates.backhoeAddon;

    const matContainer = document.getElementById('materials-settings');
    matContainer.innerHTML = appData.materials.map((m, idx) => `
        <div class="form-group input-row" style="align-items:center;">
            <label style="width: 120px;">${escapeHtml(m.name)}:</label>
            <input type="number" id="set-mat-${idx}" value="${m.price}" min="0" required>
            <label style="margin-left:10px;"><input type="checkbox" id="set-stock-${idx}" ${m.inStock ? 'checked' : ''}> In Stock</label>
        </div>
    `).join('');
}