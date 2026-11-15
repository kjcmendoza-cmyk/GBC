import { DbService, AuthService, DEMO_MODE } from './firebase-config.js';
import { getAppData } from './davao-data.js';

let appData;
let dashboardInitialized = false;
let cachedOrders = [];

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
function getLocalTodayStr() {
    const now = new Date();
    return new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().split('T')[0];
}
document.addEventListener("DOMContentLoaded", () => {
    // Prevent selecting past dates when blocking
    const blockDateInput = document.getElementById('block-date');
    if (blockDateInput) {
        blockDateInput.min = getLocalTodayStr();
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
    await Promise.all([refreshOrders(true), loadBlockedDates()]);

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

    document.getElementById('status-filter').addEventListener('change', renderOrders);
    document.getElementById('date-filter').addEventListener('change', renderOrders);

    let searchTimer;
    document.getElementById('order-search').addEventListener('input', () => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(renderOrders, 200);
    });

    // Manual Block Date Submit
    document.getElementById('block-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        const btn = e.target.querySelector('button');
        btn.disabled = true;
        btn.innerText = "Blocking...";

        try {
            const resource = document.getElementById('block-resource').value;
            const units = document.getElementById('block-units').value;
            const date = document.getElementById('block-date').value;
            const notes = document.getElementById('block-notes').value.trim();

            await DbService.addBlockedDate({ resource, units, date, notes });
            e.target.reset();
            closeModal('block-date-modal');
            await loadBlockedDates();
            await syncFleetAvailability();
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
            appData.rates.haulingAddon = parseInt(document.getElementById('set-hauling-addon').value, 10);
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
    await syncFleetAvailability();
};
function addDaysToDateStr(dateStr, daysToAdd) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + daysToAdd);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

async function syncFleetAvailability() {
    try {
        const [allOrders, blocks] = await Promise.all([
            cachedOrders.length ? Promise.resolve(cachedOrders) : DbService.getOrders('All'),
            DbService.getBlockedDates()
        ]);

        const usage = {};
        const ensureDate = (d) => {
            if (!usage[d]) usage[d] = { trucks: 0, backhoes: 0, fullBlockTruck: false, fullBlockBackhoe: false, notes: {} };
        };

        // Count pending & confirmed orders against fleet capacity
allOrders
    .filter(o => ['pending', 'confirmed'].includes(o.status) && o.details?.date)
    .forEach(o => {
        const start = o.details.date;
        if (o.type === 'supply') {
            ensureDate(start);
            usage[start].trucks += 1;
        } else if (o.type === 'hauling') {
            ensureDate(start);
            usage[start].trucks += 1;
            if (o.details.hasBackhoe) usage[start].backhoes += 1;
        } else if (o.type === 'rental') {
            const days = Math.max(1, parseInt(o.details.days || 1, 10));
            for (let i = 0; i < days; i++) {
                const dayStr = addDaysToDateStr(start, i);
                ensureDate(dayStr);
                usage[dayStr].backhoes += 1;
            }
            if (o.details.hasHaul) {
                ensureDate(start);
                usage[start].trucks += 1;
            }
        }
    });

        // Apply manual blocks
        blocks.forEach(b => {
            if (!b.date) return;
            ensureDate(b.date);
            const isAll = !b.units || b.units === 'all';
            if (b.resource === 'backhoe') {
                if (isAll) usage[b.date].fullBlockBackhoe = true;
                else usage[b.date].backhoes += 1;
                if (b.notes) usage[b.date].notes.backhoe = b.notes;
            } else {
                if (isAll) usage[b.date].fullBlockTruck = true;
                else usage[b.date].trucks += 1;
                if (b.notes) usage[b.date].notes.truck = b.notes;
            }
        });

        await DbService.saveAvailability(usage);
    } catch (err) {
        console.error("Fleet sync error:", err);
    }
}

window.editOrderQuote = async function(id, currentQty, currentTotal) {
    const order = cachedOrders.find(o => o.id === id);

    const newQtyStr = prompt("Enter verified number of loads:", currentQty || 1);
    if (newQtyStr === null) return;
    const newQty = Math.max(1, parseInt(newQtyStr, 10) || 1);

    let updatedMaterial = null;
    if (order?.type === 'supply' && order.details?.material) {
        const currentMat = order.details.material;
        if (currentMat.includes(',')) {
            const editedMat = prompt("Update material load breakdown:", currentMat);
            if (editedMat === null) return;
            updatedMaterial = editedMat.trim() || currentMat;
        } else {
            updatedMaterial = currentMat.replace(
                /\(\d+\s*loads?\)/i,
                `(${newQty} load${newQty > 1 ? 's' : ''})`
            );
        }
    }

    const newTotal = prompt("Enter updated total estimate (e.g. ₱4,500):", currentTotal || "₱0");
    if (newTotal === null || !newTotal.trim()) return;

    try {
        await DbService.updateOrderDetails(id, newQty, newTotal.trim(), updatedMaterial);
        await refreshOrders(false);
    } catch (err) {
        alert("Failed to update order: " + err.message);
    }
};

async function refreshOrders(shouldSyncAvailability = false) {
    const container = document.getElementById('orders-list');
    container.innerHTML = `<p class="sub-text" style="text-align:center; padding: 1rem 0;">Loading orders...</p>`;

    try {
        cachedOrders = await DbService.getOrders('All');
        if (shouldSyncAvailability) {
            await syncFleetAvailability();
        }
        renderOrders();
    } catch (err) {
        container.innerHTML = `<p style="color:#B91C1C; text-align:center;">Failed to load orders: ${escapeHtml(err.message)}</p>`;
    }
}

function renderOrders() {
    const filter = document.getElementById('status-filter').value;
    const dateFilter = document.getElementById('date-filter')?.value || 'all';
    const search = (document.getElementById('order-search')?.value || '').trim().toLowerCase();
    const container = document.getElementById('orders-list');

    let orders = [...cachedOrders];

    if (filter !== 'All') {
        orders = orders.filter(o => o.status === filter);
    }

    const today = getLocalTodayStr();
    const tomorrow = addDaysToDateStr(today, 1);

    if (dateFilter === 'today') orders = orders.filter(o => o.details?.date === today);
    else if (dateFilter === 'tomorrow') orders = orders.filter(o => o.details?.date === tomorrow);
    else if (dateFilter === 'upcoming') orders = orders.filter(o => (o.details?.date || '') >= today);

    if (search) {
        orders = orders.filter(o =>
            (o.ticketId || '').toLowerCase().includes(search) ||
            (o.customer?.name || '').toLowerCase().includes(search) ||
            (o.details?.brgy || '').toLowerCase().includes(search) ||
            (o.customer?.phone || '').includes(search)
        );
    }

    if (orders.length === 0) {
        container.innerHTML = `<p class="sub-text" style="text-align:center; padding: 1.5rem 0;">No orders found matching your filters.</p>`;
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

        const waPhone = (o.customer?.phone || '').replace(/^0/, '63');
        const waMsg = encodeURIComponent(
            `Hello ${o.customer?.name || ''}! Your GBC Davao booking (${o.ticketId}) for ${o.details?.date || 'your scheduled date'} is CONFIRMED. Total Est: ${o.details?.total || ''}. Thank you!`
        );

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
                <div style="margin-top: 14px; display: flex; flex-wrap: wrap; gap: 8px;">
                    ${o.status === 'pending' ? `<button class="btn btn-primary" style="flex:1; padding: 0.55rem;" onclick="updateStatus('${escapeHtml(o.id)}', 'confirmed')">Confirm</button>` : ''}
                    ${o.status === 'confirmed' ? `<button class="btn btn-whatsapp" style="flex:1; padding: 0.55rem;" onclick="updateStatus('${escapeHtml(o.id)}', 'completed')">Complete</button>` : ''}
                    ${o.status === 'confirmed' && waPhone ? `<a href="https://wa.me/${escapeHtml(waPhone)}?text=${waMsg}" target="_blank" rel="noopener" class="btn btn-secondary" style="flex:1; padding: 0.55rem; text-decoration:none;">WhatsApp</a>` : ''}
                    ${(o.status === 'pending' || o.status === 'confirmed') && o.type !== 'rental' ? `<button class="btn btn-purple-outline" style="padding: 0.55rem 0.75rem;" onclick="editOrderQuote('${escapeHtml(o.id)}', '${escapeHtml(o.details?.qty || 1)}', '${escapeHtml(o.details?.total || '')}')">Edit Qty/₱</button>` : ''}
                    ${o.status !== 'completed' && o.status !== 'cancelled' ? `<button class="btn btn-secondary" style="flex:1; padding: 0.55rem;" onclick="updateStatus('${escapeHtml(o.id)}', 'cancelled')">Cancel</button>` : ''}
                </div>
            </div>
        `;
    }).join('');
}

window.updateStatus = async function(id, status) {
    try {
        await DbService.updateOrderStatus(id, status);
        await refreshOrders(true);
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
    document.getElementById('set-hauling-addon').value = appData.rates.haulingAddon ?? 1200;
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