// 7. js/admin.js
import { DbService, AuthService } from './firebase-config.js';
import { getAppData } from './davao-data.js';

let appData;

document.addEventListener("DOMContentLoaded", () => {
    // Simple demo auth check
    if (localStorage.getItem('gbc_admin_auth')) {
        showDashboard();
    }

    document.getElementById('login-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        try {
            await AuthService.login(document.getElementById('admin-email').value, 'password');
            localStorage.setItem('gbc_admin_auth', 'true');
            showDashboard();
        } catch (error) {
            document.getElementById('login-error').innerText = "Login Failed";
            document.getElementById('login-error').style.display = 'block';
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
    loadOrders();
    populateSettings();

    // Tab Logic
    document.querySelectorAll('.admin-header ~ .tab-nav .tab-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            document.querySelectorAll('.admin-header ~ .tab-nav .tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('#admin-dashboard .tab-content').forEach(c => c.classList.remove('active'));
            e.target.classList.add('active');
            document.getElementById(e.target.dataset.target).classList.add('active');
        });
    });

    document.getElementById('status-filter').addEventListener('change', loadOrders);
    
    // Settings Submit
    document.getElementById('settings-form').addEventListener('submit', async (e) => {
        e.preventDefault();
        appData.fleet.trucks = parseInt(document.getElementById('set-trucks').value);
        appData.fleet.backhoes = parseInt(document.getElementById('set-backhoes').value);
        appData.rates.haulingBase = parseInt(document.getElementById('set-hauling').value);
        appData.rates.backhoeDaily = parseInt(document.getElementById('set-backhoe-daily').value);
        appData.rates.backhoeAddon = parseInt(document.getElementById('set-backhoe-addon').value);
        
        appData.materials.forEach((m, idx) => {
            m.price = parseInt(document.getElementById(`set-mat-${idx}`).value);
            m.inStock = document.getElementById(`set-stock-${idx}`).checked;
        });

        await DbService.saveSettings(appData);
        alert("Settings Saved successfully!");
    });
}

async function loadOrders() {
    const filter = document.getElementById('status-filter').value;
    const orders = await DbService.getOrders(filter);
    const container = document.getElementById('orders-list');
    
    container.innerHTML = orders.map(o => `
        <div class="order-card">
            <div class="order-header">
                <span>${o.id} - ${o.type.toUpperCase()}</span>
                <span class="status-badge status-${o.status}">${o.status}</span>
            </div>
            <p><strong>Customer:</strong> ${o.customer.name}</p>
            <p><strong>Phone:</strong> <a href="tel:${o.customer.phone}">${o.customer.phone}</a></p>
            <p><strong>Address:</strong> ${o.customer.address}</p>
            <hr style="margin:10px 0; border:0; border-top:1px solid #E2E8F0;">
            <p><strong>Details:</strong></p>
            <ul style="margin-left: 20px; font-size: 0.9rem;">
                ${Object.entries(o.details).map(([k,v]) => `<li>${k}: <strong>${v}</strong></li>`).join('')}
            </ul>
            <div style="margin-top: 15px; display: flex; gap: 10px;">
                ${o.status === 'pending' ? `<button class="btn btn-primary" style="flex:1; padding: 5px;" onclick="updateStatus('${o.id}', 'confirmed')">Confirm</button>` : ''}
                ${o.status === 'confirmed' ? `<button class="btn btn-whatsapp" style="flex:1; padding: 5px;" onclick="updateStatus('${o.id}', 'completed')">Complete</button>` : ''}
                <button class="btn btn-secondary" style="flex:1; padding: 5px;" onclick="updateStatus('${o.id}', 'cancelled')">Cancel</button>
            </div>
        </div>
    `).join('');
}

window.updateStatus = async function(id, status) {
    await DbService.updateOrderStatus(id, status);
    loadOrders();
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
            <label style="width: 120px;">${m.name}:</label>
            <input type="number" id="set-mat-${idx}" value="${m.price}" required>
            <label style="margin-left:10px;"><input type="checkbox" id="set-stock-${idx}" ${m.inStock ? 'checked' : ''}> In Stock</label>
        </div>
    `).join('');
}