// 6. js/app.js
import { getAppData } from './davao-data.js';
import { DbService } from './firebase-config.js';

let appData;
let state = {
    selectedMaterial: null,
    checkoutTab: null
};

document.addEventListener("DOMContentLoaded", async () => {
    appData = await getAppData();
    initUI();
    attachListeners();
});

function initUI() {
    // Populate Barangays
    const brgySelects = document.querySelectorAll('.brgy-select');
    let brgyHTML = appData.barangays.map(b => `<option value="${b.name}" data-fee="${b.fee}">${b.name}</option>`).join('');
    brgySelects.forEach(select => {
        select.innerHTML = brgyHTML;
    });

    // Populate Materials (Tab 1)
    const matGrid = document.getElementById('material-list');
    matGrid.innerHTML = appData.materials.filter(m => m.inStock).map((m, i) => `
        <div class="mat-card ${i===0?'selected':''}" data-id="${m.id}" data-price="${m.price}" data-name="${m.name}">
            <h4>${m.name}</h4>
            <p>₱${m.price.toLocaleString()}/load</p>
        </div>
    `).join('');
    state.selectedMaterial = appData.materials.filter(m => m.inStock)[0];

    // Initialize Dates to tomorrow
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    document.getElementById('supply-date').value = dateStr;
    document.getElementById('hauling-date').value = dateStr;
    document.getElementById('rental-date').value = dateStr;

    calcSupply();
    calcHauling();
    calcRental();
}

function attachListeners() {
    // Tab Navigation
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetSection = document.getElementById(btn.dataset.target);
            if (!targetSection) {
                console.error('Missing tab section:', btn.dataset.target);
                return;
            }
            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            targetSection.classList.add('active');
        });
    });

    // Material Selection
    document.getElementById('material-list').addEventListener('click', (e) => {
        const card = e.target.closest('.mat-card');
        if (!card) return;
        document.querySelectorAll('.mat-card').forEach(c => c.classList.remove('selected'));
        card.classList.add('selected');
        state.selectedMaterial = {
            id: card.dataset.id,
            name: card.dataset.name,
            price: parseFloat(card.dataset.price)
        };
        calcSupply();
    });

    // Steppers
    const bindStepper = (minusId, plusId, inputId, callback) => {
        document.getElementById(minusId).addEventListener('click', () => {
            let v = parseInt(document.getElementById(inputId).value);
            if (v > 1) { document.getElementById(inputId).value = v - 1; callback(); }
        });
        document.getElementById(plusId).addEventListener('click', () => {
            let v = parseInt(document.getElementById(inputId).value);
            document.getElementById(inputId).value = v + 1; callback();
        });
    };
    bindStepper('supply-minus', 'supply-plus', 'supply-qty', calcSupply);
    bindStepper('hauling-minus', 'hauling-plus', 'hauling-qty', calcHauling);
    bindStepper('rental-minus', 'rental-plus', 'rental-qty', calcRental);
    bindStepper('rental-haul-minus', 'rental-haul-plus', 'rental-haul-qty', calcRental);

    // Dynamic Selects & Checkboxes
    document.getElementById('supply-brgy').addEventListener('change', calcSupply);
    
    document.getElementById('hauling-brgy').addEventListener('change', calcHauling);
    document.getElementById('hauling-backhoe').addEventListener('change', (e) => {
        document.getElementById('hauling-backhoe-row').style.display = e.target.checked ? 'flex' : 'none';
        calcHauling();
    });

    document.getElementById('rental-brgy').addEventListener('change', calcRental);
    document.getElementById('rental-hauling').addEventListener('change', (e) => {
        document.getElementById('rental-hauling-options').style.display = e.target.checked ? 'flex' : 'none';
        document.getElementById('rental-haul-row').style.display = e.target.checked ? 'flex' : 'none';
        calcRental();
    });

    // Volume Calculator
    document.getElementById('btn-apply-calc').addEventListener('click', () => {
        const l = parseFloat(document.getElementById('calc-l').value || 0);
        const w = parseFloat(document.getElementById('calc-w').value || 0);
        const d = parseFloat(document.getElementById('calc-d').value || 0);
        const cuM = l * w * (d / 100);
        const loads = Math.ceil(cuM / 2.8);
        document.getElementById('calc-result').innerText = cuM.toFixed(2);
        document.getElementById('calc-loads').innerText = loads || 1;
        document.getElementById('supply-qty').value = loads || 1;
        calcSupply();
    });

    // Photo Preview
    document.getElementById('hauling-photos').addEventListener('change', function(e) {
        const preview = document.getElementById('photo-preview');
        preview.innerHTML = '';
        [...this.files].slice(0, 3).forEach(file => {
            const img = document.createElement('img');
            img.src = URL.createObjectURL(file);
            preview.appendChild(img);
        });
    });

    // Checkout Form Submit
    document.getElementById('checkout-form').addEventListener('submit', handleCheckoutSubmit);
}

function getFee(selectId) {
    const sel = document.getElementById(selectId);
    return parseFloat(sel.options[sel.selectedIndex]?.dataset.fee || 0);
}

function calcSupply() {
    if(!state.selectedMaterial) return;
    const qty = parseInt(document.getElementById('supply-qty').value);
    const matCost = state.selectedMaterial.price * qty;
    const delFee = getFee('supply-brgy');
    const total = matCost + delFee;
    
    document.getElementById('supply-mat-cost').innerText = `₱${matCost.toLocaleString()}`;
    document.getElementById('supply-del-fee').innerText = `₱${delFee.toLocaleString()}`;
    document.getElementById('supply-total').innerText = `₱${total.toLocaleString()}`;
    document.getElementById('supply-vol-estimate').innerText = `Approx. ${(qty*2.8).toFixed(1)} - ${(qty*3.0).toFixed(1)} cu.m.`;
}

function calcHauling() {
    const qty = parseInt(document.getElementById('hauling-qty').value);
    const baseFee = appData.rates.haulingBase * qty;
    const addBackhoe = document.getElementById('hauling-backhoe').checked;
    const backhoeFee = addBackhoe ? appData.rates.backhoeAddon : 0;
    const locFee = getFee('hauling-brgy');
    const total = baseFee + backhoeFee + locFee;

    document.getElementById('hauling-fee').innerText = `₱${baseFee.toLocaleString()}`;
    document.getElementById('hauling-backhoe-fee').innerText = `₱${backhoeFee.toLocaleString()}`;
    document.getElementById('hauling-loc-fee').innerText = `₱${locFee.toLocaleString()}`;
    document.getElementById('hauling-total').innerText = `₱${total.toLocaleString()}`;
}

function calcRental() {
    const days = parseInt(document.getElementById('rental-qty').value);
    const baseFee = appData.rates.backhoeDaily * days;
    const mobFee = getFee('rental-brgy');
    const addHaul = document.getElementById('rental-hauling').checked;
    const haulQty = parseInt(document.getElementById('rental-haul-qty').value);
    const haulFee = addHaul ? (appData.rates.haulingAddon * haulQty) : 0;
    const total = baseFee + mobFee + haulFee;

    document.getElementById('rental-base').innerText = `₱${baseFee.toLocaleString()}`;
    document.getElementById('rental-mob').innerText = `₱${mobFee.toLocaleString()}`;
    document.getElementById('rental-haul-fee').innerText = `₱${haulFee.toLocaleString()}`;
    document.getElementById('rental-total').innerText = `₱${total.toLocaleString()}`;
}

window.prepareCheckout = function(tab) {
    state.checkoutTab = tab;
    document.getElementById('checkout-modal').style.display = 'flex';
};

window.closeModal = function(id) {
    document.getElementById(id).style.display = 'none';
};

async function handleCheckoutSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.innerText = "Processing...";

    const ticketId = 'GBC-' + Math.floor(100000 + Math.random() * 900000);
    const cust = {
        name: document.getElementById('cust-name').value,
        phone: document.getElementById('cust-phone').value,
        address: document.getElementById('cust-address').value,
        notes: document.getElementById('cust-notes').value,
    };

    let orderData = { ticketId, customer: cust, status: 'pending', type: state.checkoutTab };
    let summaryText = `*GBC ORDER TICKET: ${ticketId}*\nName: ${cust.name}\nPhone: ${cust.phone}\nAddress: ${cust.address}\n\n*ORDER DETAILS:*\n`;

    if (state.checkoutTab === 'supply') {
        const qty = document.getElementById('supply-qty').value;
        const brgy = document.getElementById('supply-brgy').value;
        const date = document.getElementById('supply-date').value;
        const total = document.getElementById('supply-total').innerText;
        orderData.details = { material: state.selectedMaterial.name, qty, brgy, date, total };
        summaryText += `Service: Supply Delivery\nItem: ${state.selectedMaterial.name}\nLoads: ${qty}\nBarangay: ${brgy}\nDate: ${date}\n*Total Est: ${total}*`;
    } 
    else if (state.checkoutTab === 'hauling') {
        const type = document.getElementById('hauling-type').value;
        const qty = document.getElementById('hauling-qty').value;
        const brgy = document.getElementById('hauling-brgy').value;
        const date = document.getElementById('hauling-date').value;
        const hasBackhoe = document.getElementById('hauling-backhoe').checked;
        const total = document.getElementById('hauling-total').innerText;
        orderData.details = { type, qty, hasBackhoe, brgy, date, total };
        summaryText += `Service: Garbage Hauling\nType: ${type}\nLoads: ${qty}\nBackhoe Included: ${hasBackhoe?'Yes':'No'}\nBarangay: ${brgy}\nDate: ${date}\n*Total Est: ${total}*`;
    }
    else if (state.checkoutTab === 'rental') {
        const job = document.getElementById('rental-job').value;
        const days = document.getElementById('rental-qty').value;
        const brgy = document.getElementById('rental-brgy').value;
        const date = document.getElementById('rental-date').value;
        const hasHaul = document.getElementById('rental-hauling').checked;
        const total = document.getElementById('rental-total').innerText;
        orderData.details = { job, equipment: 'PC30 Backhoe', days, hasHaul, brgy, date, total };
        summaryText += `Service: Equipment Rental\nUnit: PC30 Backhoe\nJob: ${job}\nDays: ${days}\nHauling Added: ${hasHaul?'Yes':'No'}\nBarangay: ${brgy}\nStart Date: ${date}\n*Total Est: ${total}*`;
    }

    if (cust.notes) summaryText += `\n\nNotes: ${cust.notes}`;

    await DbService.saveOrder(orderData);

    closeModal('checkout-modal');
    document.getElementById('receipt-ticket').innerText = ticketId;
    document.getElementById('receipt-summary').innerText = summaryText;
    document.getElementById('receipt-modal').style.display = 'flex';

    // Setup Messenger / WhatsApp Links
    const encodedText = encodeURIComponent(summaryText);
    document.getElementById('btn-whatsapp').onclick = () => {
        window.open(`https://wa.me/639174347647?text=${encodedText}`, '_blank');
    };
    document.getElementById('btn-messenger').onclick = () => {
        navigator.clipboard.writeText(summaryText).then(() => {
            alert("Order details copied to clipboard! Paste them in the chat.");
            window.open(`https://m.me/`, '_blank'); // Needs specific FB page ID in prod
        });
    };
}