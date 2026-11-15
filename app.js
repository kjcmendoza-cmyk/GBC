import { getAppData } from './davao-data.js';
import { DbService } from './firebase-config.js';

// Optional: Put your Facebook Page username here (e.g., 'gbcdavao') so Messenger opens your page directly
const MESSENGER_USERNAME = '';

let appData;
let blockedDates = [];
let map, marker;
let state = {
    selectedMaterial: null,
    checkoutTab: null,
    haulingPhotoBlobs: [],
    location: {
        lat: 7.0731,
        lng: 125.6128,
        address: '',
        mapUrl: ''
    }
};

function getLocalTodayStr() {
    const now = new Date();
    const offset = now.getTimezoneOffset() * 60000;
    return new Date(now.getTime() - offset).toISOString().split('T')[0];
}

function getLocalTomorrowStr() {
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const offset = tomorrow.getTimezoneOffset() * 60000;
    return new Date(tomorrow.getTime() - offset).toISOString().split('T')[0];
}

document.addEventListener("DOMContentLoaded", async () => {
    [appData, blockedDates] = await Promise.all([
        getAppData(),
        DbService.getBlockedDates().catch(() => [])
    ]);

    initUI();
    initMapPicker();
    attachListeners();
    validateAllDates();
});

function initUI() {
    // Populate Barangays
    const brgySelects = document.querySelectorAll('.brgy-select');
    const brgyHTML = appData.barangays
        .map(b => `<option value="${b.name}" data-fee="${b.fee}">${b.name}</option>`)
        .join('');
    brgySelects.forEach(select => {
        select.innerHTML = brgyHTML;
    });

    // Populate Materials (Tab 1)
    const matGrid = document.getElementById('material-list');
    const availableMaterials = appData.materials.filter(m => m.inStock);

    if (availableMaterials.length === 0) {
        matGrid.innerHTML = `<p class="sub-text">All materials are currently out of stock. Please call dispatch for updates.</p>`;
    } else {
        matGrid.innerHTML = availableMaterials.map((m, i) => `
            <div class="mat-card ${i === 0 ? 'selected' : ''}" data-id="${m.id}" data-price="${m.price}" data-name="${m.name}">
                <h4>${m.name}</h4>
                <p>₱${m.price.toLocaleString()}/load</p>
            </div>
        `).join('');
        state.selectedMaterial = availableMaterials[0];
        syncCalculatorWithMaterial(state.selectedMaterial.id);
    }

    // Initialize Dates to tomorrow & prevent selecting past dates
    const todayStr = getLocalTodayStr();
    const tomorrowStr = getLocalTomorrowStr();

    ['supply-date', 'hauling-date', 'rental-date'].forEach(id => {
        const input = document.getElementById(id);
        input.min = todayStr;
        input.value = tomorrowStr;

        const warnEl = document.createElement('small');
        warnEl.id = `${id}-warning`;
        warnEl.style.display = 'none';
        warnEl.style.color = '#B91C1C';
        warnEl.style.fontWeight = '600';
        warnEl.style.marginTop = '0.3rem';
        input.parentElement.appendChild(warnEl);
    });

    // Allow flexible PH phone formats (+639..., spaces, dashes) before JS normalization
    const phoneInput = document.getElementById('cust-phone');
    if (phoneInput) {
        phoneInput.removeAttribute('pattern');
        phoneInput.placeholder = '0917 123 4567 or +639171234567';
    }

    calcSupply();
    calcHauling();
    calcRental();
}

function getBlockedConflict(tab) {
    const dateInput = document.getElementById(`${tab}-date`);
    const selectedDate = dateInput?.value;
    if (!selectedDate) return null;

    const neededResources = [];
    if (tab === 'supply') {
        neededResources.push('truck');
    } else if (tab === 'hauling') {
        neededResources.push('truck');
        if (document.getElementById('hauling-backhoe').checked) {
            neededResources.push('backhoe');
        }
    } else if (tab === 'rental') {
        neededResources.push('backhoe');
        if (document.getElementById('rental-hauling').checked) {
            neededResources.push('truck');
        }
    }

    return blockedDates.find(
        b => b.date === selectedDate && neededResources.includes(b.resource)
    ) || null;
}

function validateTabDate(tab) {
    const warnEl = document.getElementById(`${tab}-date-warning`);
    if (!warnEl) return null;

    const conflict = getBlockedConflict(tab);
    if (conflict) {
        const resName = conflict.resource === 'backhoe' ? 'PC30 Backhoe' : 'Dump Truck';
        const reason = conflict.notes ? ` (${conflict.notes})` : '';
        warnEl.innerText = `⚠️ ${resName} is unavailable on ${conflict.date}${reason}. Please choose another date.`;
        warnEl.style.display = 'block';
    } else {
        warnEl.style.display = 'none';
    }
    return conflict;
}

function validateAllDates() {
    validateTabDate('supply');
    validateTabDate('hauling');
    validateTabDate('rental');
}

function initMapPicker() {
    if (typeof L === 'undefined') return;

    const davaoCenter = [7.0731, 125.6128];
    map = L.map('davao-map').setView(davaoCenter, 13);

    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '&copy; OpenStreetMap contributors',
        maxZoom: 19
    }).addTo(map);

    marker = L.marker(davaoCenter, { draggable: true }).addTo(map);

    marker.on('dragend', () => {
        const pos = marker.getLatLng();
        updatePinnedLocation(pos.lat, pos.lng, true);
    });

    map.on('click', (e) => {
        marker.setLatLng(e.latlng);
        updatePinnedLocation(e.latlng.lat, e.latlng.lng, true);
    });

    document.getElementById('btn-use-gps').addEventListener('click', () => {
        if (!navigator.geolocation) {
            alert("Geolocation is not supported by your browser.");
            return;
        }
        const label = document.getElementById('map-pinned-label');
        label.innerText = "Locating your GPS position...";
        navigator.geolocation.getCurrentPosition(
            (pos) => {
                const { latitude, longitude } = pos.coords;
                map.setView([latitude, longitude], 16);
                marker.setLatLng([latitude, longitude]);
                updatePinnedLocation(latitude, longitude, true);
            },
            () => {
                label.innerText = "Unable to access GPS. Please search or tap the map.";
            },
            { enableHighAccuracy: true }
        );
    });

    const searchInput = document.getElementById('map-search-input');
    const resultsList = document.getElementById('map-search-results');
    let debounceTimer;

    searchInput.addEventListener('input', () => {
        clearTimeout(debounceTimer);
        const query = searchInput.value.trim();
        if (query.length < 3) {
            resultsList.style.display = 'none';
            return;
        }

        debounceTimer = setTimeout(async () => {
            try {
                const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(query + ' Davao')}&lat=7.0731&lon=125.6128&limit=5`;
                const res = await fetch(url);
                const data = await res.json();

                resultsList.innerHTML = '';
                if (!data.features || data.features.length === 0) {
                    resultsList.style.display = 'none';
                    return;
                }

                data.features.forEach(feat => {
                    const [lng, lat] = feat.geometry.coordinates;
                    const p = feat.properties;
                    const displayName = [p.name, p.street, p.district, p.city].filter(Boolean).join(', ');

                    const li = document.createElement('li');
                    li.textContent = displayName;
                    li.addEventListener('click', () => {
                        searchInput.value = displayName;
                        resultsList.style.display = 'none';
                        map.setView([lat, lng], 16);
                        marker.setLatLng([lat, lng]);
                        updatePinnedLocation(lat, lng, false, displayName);
                    });
                    resultsList.appendChild(li);
                });
                resultsList.style.display = 'block';
            } catch (err) {
                console.error("Map search error:", err);
            }
        }, 350);
    });

    document.addEventListener('click', (e) => {
        if (!e.target.closest('.map-search-wrap')) {
            resultsList.style.display = 'none';
        }
    });
}

async function updatePinnedLocation(lat, lng, reverseLookup = true, presetAddress = '') {
    const label = document.getElementById('map-pinned-label');
    const mapUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    let resolvedAddress = presetAddress;

    if (reverseLookup) {
        label.innerText = "Fetching street address...";
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            const data = await res.json();
            resolvedAddress = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        } catch {
            resolvedAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }
    }

    state.location = { lat, lng, address: resolvedAddress, mapUrl };
    label.innerHTML = `<strong>Pinned:</strong> ${resolvedAddress}`;

    const custAddressEl = document.getElementById('cust-address');
    if (custAddressEl) custAddressEl.value = resolvedAddress;

    autoMatchBarangayFee(resolvedAddress);
}

function autoMatchBarangayFee(addressText) {
    const lower = addressText.toLowerCase();
    const keywords = ['poblacion', 'agdao', 'buhangin', 'talomo', 'toril', 'tugbok', 'calinan', 'waan'];
    const matched = keywords.find(k => lower.includes(k));
    if (!matched) return;

    document.querySelectorAll('.brgy-select').forEach(select => {
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value.toLowerCase().includes(matched)) {
                select.selectedIndex = i;
                break;
            }
        }
    });

    calcSupply();
    calcHauling();
    calcRental();
}

function compressImage(file, maxDimension = 1200, quality = 0.75) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        const objectUrl = URL.createObjectURL(file);

        img.onload = () => {
            URL.revokeObjectURL(objectUrl);
            let { width, height } = img;
            if (width > maxDimension || height > maxDimension) {
                if (width > height) {
                    height = Math.round((height * maxDimension) / width);
                    width = maxDimension;
                } else {
                    width = Math.round((width * maxDimension) / height);
                    height = maxDimension;
                }
            }

            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            ctx.drawImage(img, 0, 0, width, height);

            canvas.toBlob(
                (blob) => (blob ? resolve(blob) : reject(new Error('Image compression failed'))),
                'image/jpeg',
                quality
            );
        };

        img.onerror = () => {
            URL.revokeObjectURL(objectUrl);
            reject(new Error('Invalid image file'));
        };

        img.src = objectUrl;
    });
}

function attachListeners() {
    // Tab Navigation + Move Map Widget to Active Tab
    document.querySelectorAll('.tab-btn').forEach(btn => {
        btn.addEventListener('click', () => {
            const targetSection = document.getElementById(btn.dataset.target);
            if (!targetSection) return;

            document.querySelectorAll('.tab-btn').forEach(b => b.classList.remove('active'));
            document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
            btn.classList.add('active');
            targetSection.classList.add('active');

            const slot = targetSection.querySelector('.map-slot');
            const mapWrapper = document.getElementById('map-picker-wrapper');
            if (slot && mapWrapper && map) {
                slot.appendChild(mapWrapper);
                setTimeout(() => map.invalidateSize(), 50);
            }
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
        syncCalculatorWithMaterial(state.selectedMaterial.id);
        runVolumeCalc();
        calcSupply();
    });

    // Steppers
    const bindStepper = (minusId, plusId, inputId, callback) => {
        document.getElementById(minusId).addEventListener('click', () => {
            const v = parseInt(document.getElementById(inputId).value, 10);
            if (v > 1) {
                document.getElementById(inputId).value = v - 1;
                callback();
            }
        });
        document.getElementById(plusId).addEventListener('click', () => {
            const input = document.getElementById(inputId);
            const v = parseInt(input.value, 10);
            const max = input.max ? parseInt(input.max, 10) : Infinity;
            if (v < max) {
                input.value = v + 1;
                callback();
            }
        });
    };
    bindStepper('supply-minus', 'supply-plus', 'supply-qty', calcSupply);
    bindStepper('hauling-minus', 'hauling-plus', 'hauling-qty', calcHauling);
    bindStepper('rental-minus', 'rental-plus', 'rental-qty', calcRental);
    bindStepper('rental-haul-minus', 'rental-haul-plus', 'rental-haul-qty', calcRental);

    // Date change validation
    document.getElementById('supply-date').addEventListener('change', () => validateTabDate('supply'));
    document.getElementById('hauling-date').addEventListener('change', () => validateTabDate('hauling'));
    document.getElementById('rental-date').addEventListener('change', () => validateTabDate('rental'));

    // Dynamic Selects & Checkboxes
    document.getElementById('supply-brgy').addEventListener('change', calcSupply);

    document.getElementById('hauling-brgy').addEventListener('change', calcHauling);
    document.getElementById('hauling-backhoe').addEventListener('change', (e) => {
        document.getElementById('hauling-backhoe-row').style.display = e.target.checked ? 'flex' : 'none';
        calcHauling();
        validateTabDate('hauling');
    });

    document.getElementById('rental-brgy').addEventListener('change', calcRental);
    document.getElementById('rental-hauling').addEventListener('change', (e) => {
        document.getElementById('rental-hauling-options').style.display = e.target.checked ? 'flex' : 'none';
        document.getElementById('rental-haul-row').style.display = e.target.checked ? 'flex' : 'none';
        calcRental();
        validateTabDate('rental');
    });

    // Volume Calculator
    ['calc-l', 'calc-w', 'calc-d', 'calc-l-unit', 'calc-w-unit', 'calc-d-unit', 'calc-purpose'].forEach(id => {
        const el = document.getElementById(id);
        el.addEventListener('input', runVolumeCalc);
        el.addEventListener('change', runVolumeCalc);
    });

    document.getElementById('btn-apply-calc').addEventListener('click', () => {
        const purpose = document.getElementById('calc-purpose').value;
        if (purpose === 'filling' && state.selectedMaterial?.id !== 'escombro') {
            const escombroCard = document.querySelector('.mat-card[data-id="escombro"]');
            if (escombroCard) escombroCard.click();
        } else if (purpose === 'concrete' && state.selectedMaterial?.id === 'escombro') {
            const gravelCard = document.querySelector('.mat-card[data-id="gravel"]');
            if (gravelCard) gravelCard.click();
        }

        const loads = runVolumeCalc();
        document.getElementById('supply-qty').value = loads;
        calcSupply();
    });

    // Hauling Photo Compression & Preview
    document.getElementById('hauling-photos').addEventListener('change', async function () {
        const preview = document.getElementById('photo-preview');
        preview.innerHTML = '';
        state.haulingPhotoBlobs = [];

        const files = [...this.files].slice(0, 3);
        for (const file of files) {
            try {
                const compressedBlob = await compressImage(file);
                state.haulingPhotoBlobs.push(compressedBlob);

                const img = document.createElement('img');
                img.src = URL.createObjectURL(compressedBlob);
                preview.appendChild(img);
            } catch (err) {
                console.error("Photo compression error:", err);
            }
        }
    });

    // Checkout Form Submit
    document.getElementById('checkout-form').addEventListener('submit', handleCheckoutSubmit);
}

function toMeters(val, unit) {
    if (unit === 'ft') return val * 0.3048;
    if (unit === 'in') return val * 0.0254;
    if (unit === 'cm') return val * 0.01;
    return val;
}

function syncCalculatorWithMaterial(matId) {
    const purposeEl = document.getElementById('calc-purpose');
    if (!purposeEl) return;

    if (matId === 'escombro') {
        purposeEl.value = 'filling';
    } else if (purposeEl.value === 'filling') {
        purposeEl.value = 'concrete';
    }
}

function runVolumeCalc() {
    const lRaw = parseFloat(document.getElementById('calc-l').value || 0);
    const wRaw = parseFloat(document.getElementById('calc-w').value || 0);
    const dRaw = parseFloat(document.getElementById('calc-d').value || 0);

    const l = toMeters(lRaw, document.getElementById('calc-l-unit').value);
    const w = toMeters(wRaw, document.getElementById('calc-w-unit').value);
    const d = toMeters(dRaw, document.getElementById('calc-d-unit').value);

    const purpose = document.getElementById('calc-purpose').value;
    const breakdown = document.getElementById('calc-breakdown');

    if (!l || !w || !d) {
        breakdown.innerHTML = 'Enter dimensions above to estimate loads.';
        return 1;
    }

    const rawVol = l * w * d;

    if (purpose === 'concrete') {
        const sandVol = rawVol * 0.50;
        const gravelVol = rawVol * 1.00;
        const sandLoads = Math.max(1, Math.ceil(sandVol / 2.8));
        const gravelLoads = Math.max(1, Math.ceil(gravelVol / 2.8));

        const isSand = state.selectedMaterial?.id === 'sand';
        const targetLoads = isSand ? sandLoads : gravelLoads;
        const targetLabel = isSand ? 'Washed Sand' : 'Crushed Gravel';

        breakdown.innerHTML = `
            Total Concrete: <strong>${rawVol.toFixed(2)} cu.m.</strong><br>
            • Washed Sand: <strong>${sandVol.toFixed(2)} cu.m.</strong> (${sandLoads} load${sandLoads > 1 ? 's' : ''})<br>
            • Crushed Gravel: <strong>${gravelVol.toFixed(2)} cu.m.</strong> (${gravelLoads} load${gravelLoads > 1 ? 's' : ''})<br>
            <span style="display:inline-block; margin-top:4px; color:var(--purple-dark);">
                ↳ <strong>Apply</strong> sets <strong>${targetLoads} load${targetLoads > 1 ? 's' : ''}</strong> of <strong>${targetLabel}</strong> (order the other aggregate separately or add a note).
            </span>
        `;
        return targetLoads;
    }

    const factor = purpose === 'filling' ? 1.25 : 1.10;
    const label = purpose === 'filling' ? 'incl. 25% compaction' : 'incl. 10% leveling';
    const reqVol = rawVol * factor;
    const loads = Math.max(1, Math.ceil(reqVol / 2.8));

    breakdown.innerHTML = `Required (${label}): <strong>${reqVol.toFixed(2)} cu.m.</strong> (<strong>${loads} load${loads > 1 ? 's' : ''}</strong>)`;
    return loads;
}

function getFee(selectId) {
    const sel = document.getElementById(selectId);
    return parseFloat(sel.options[sel.selectedIndex]?.dataset.fee || 0);
}

function calcSupply() {
    if (!state.selectedMaterial) return;
    const qty = parseInt(document.getElementById('supply-qty').value, 10);
    const matCost = state.selectedMaterial.price * qty;
    const delFee = getFee('supply-brgy');
    const total = matCost + delFee;

    document.getElementById('supply-mat-cost').innerText = `₱${matCost.toLocaleString()}`;
    document.getElementById('supply-del-fee').innerText = `₱${delFee.toLocaleString()}`;
    document.getElementById('supply-total').innerText = `₱${total.toLocaleString()}`;
    document.getElementById('supply-vol-estimate').innerText = `Approx. ${(qty * 2.8).toFixed(1)} - ${(qty * 3.0).toFixed(1)} cu.m.`;
}

function calcHauling() {
    const qty = parseInt(document.getElementById('hauling-qty').value, 10);
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
    const days = parseInt(document.getElementById('rental-qty').value, 10);
    const baseFee = appData.rates.backhoeDaily * days;
    const mobFee = getFee('rental-brgy');
    const addHaul = document.getElementById('rental-hauling').checked;
    const haulQty = parseInt(document.getElementById('rental-haul-qty').value, 10);
    const haulFee = addHaul ? (appData.rates.haulingAddon * haulQty) : 0;
    const total = baseFee + mobFee + haulFee;

    document.getElementById('rental-base').innerText = `₱${baseFee.toLocaleString()}`;
    document.getElementById('rental-mob').innerText = `₱${mobFee.toLocaleString()}`;
    document.getElementById('rental-haul-fee').innerText = `₱${haulFee.toLocaleString()}`;
    document.getElementById('rental-total').innerText = `₱${total.toLocaleString()}`;
}

window.prepareCheckout = function (tab) {
    if (tab === 'supply' && !state.selectedMaterial) {
        alert("No material is currently available to order.");
        return;
    }

    const conflict = validateTabDate(tab);
    if (conflict) {
        const resName = conflict.resource === 'backhoe' ? 'PC30 Backhoe' : 'Dump Truck';
        alert(`Sorry, the ${resName} is unavailable on ${conflict.date}. Please select another date.`);
        return;
    }

    state.checkoutTab = tab;
    document.getElementById('checkout-modal').style.display = 'flex';
};

window.closeModal = function (id) {
    document.getElementById(id).style.display = 'none';
};

function normalizePhPhone(raw) {
    const digits = raw.replace(/\D/g, '');
    if (/^09\d{9}$/.test(digits)) return digits;
    if (/^639\d{9}$/.test(digits)) return '0' + digits.slice(2);
    return null;
}

async function handleCheckoutSubmit(e) {
    e.preventDefault();
    const btn = e.target.querySelector('button[type="submit"]');

    const normalizedPhone = normalizePhPhone(document.getElementById('cust-phone').value);
    if (!normalizedPhone) {
        alert("Please enter a valid 11-digit Philippine mobile number (e.g., 0917 123 4567).");
        return;
    }

    btn.disabled = true;
    btn.innerText = "Processing...";

    try {
        const ticketId = 'GBC-' + Math.floor(100000 + Math.random() * 900000);
        const cust = {
            name: document.getElementById('cust-name').value.trim(),
            phone: normalizedPhone,
            address: document.getElementById('cust-address').value.trim(),
            notes: document.getElementById('cust-notes').value.trim()
        };

        let photoUrls = [];
        if (state.checkoutTab === 'hauling' && state.haulingPhotoBlobs.length > 0) {
            btn.innerText = `Uploading photos (${state.haulingPhotoBlobs.length})...`;
            photoUrls = await Promise.all(
                state.haulingPhotoBlobs.map((blob, idx) =>
                    DbService.uploadHaulingPhoto(blob, ticketId, idx + 1)
                )
            );
            btn.innerText = "Saving ticket...";
        }

        const orderData = {
            ticketId,
            customer: cust,
            location: state.location,
            photos: photoUrls,
            status: 'pending',
            type: state.checkoutTab
        };

        let summaryText = `*GBC ORDER TICKET: ${ticketId}*\nName: ${cust.name}\nPhone: ${cust.phone}\nAddress: ${cust.address}\n\n*ORDER DETAILS:*\n`;

        if (state.checkoutTab === 'supply') {
            const qty = document.getElementById('supply-qty').value;
            const brgy = document.getElementById('supply-brgy').value;
            const date = document.getElementById('supply-date').value;
            const total = document.getElementById('supply-total').innerText;
            orderData.details = { material: state.selectedMaterial.name, qty, brgy, date, total };
            summaryText += `Service: Supply Delivery\nItem: ${state.selectedMaterial.name}\nLoads: ${qty}\nBarangay: ${brgy}\nDate: ${date}\n*Total Est: ${total}*`;
        } else if (state.checkoutTab === 'hauling') {
            const type = document.getElementById('hauling-type').value;
            const qty = document.getElementById('hauling-qty').value;
            const brgy = document.getElementById('hauling-brgy').value;
            const date = document.getElementById('hauling-date').value;
            const hasBackhoe = document.getElementById('hauling-backhoe').checked;
            const total = document.getElementById('hauling-total').innerText;
            orderData.details = { type, qty, hasBackhoe, brgy, date, total };
            summaryText += `Service: Garbage Hauling\nType: ${type}\nLoads: ${qty}\nBackhoe Included: ${hasBackhoe ? 'Yes' : 'No'}\nBarangay: ${brgy}\nDate: ${date}\n*Total Est: ${total}*`;
            if (photoUrls.length > 0) {
                summaryText += `\nSite Photos: ${photoUrls.length} attached`;
            }
        } else if (state.checkoutTab === 'rental') {
            const job = document.getElementById('rental-job').value;
            const days = document.getElementById('rental-qty').value;
            const brgy = document.getElementById('rental-brgy').value;
            const date = document.getElementById('rental-date').value;
            const hasHaul = document.getElementById('rental-hauling').checked;
            const haulQty = parseInt(document.getElementById('rental-haul-qty').value, 10);
            const total = document.getElementById('rental-total').innerText;
            orderData.details = {
                job,
                equipment: 'PC30 Backhoe',
                days,
                hasHaul,
                haulQty: hasHaul ? haulQty : 0,
                brgy,
                date,
                total
            };
            const haulText = hasHaul ? `Yes (${haulQty} load${haulQty > 1 ? 's' : ''})` : 'No';
            summaryText += `Service: Equipment Rental\nUnit: PC30 Backhoe\nJob: ${job}\nDays: ${days}\nHauling Added: ${haulText}\nBarangay: ${brgy}\nStart Date: ${date}\n*Total Est: ${total}*`;
        }

        if (cust.notes) summaryText += `\n\nNotes: ${cust.notes}`;
        if (state.location.mapUrl) summaryText += `\n📍 Map Pin: ${state.location.mapUrl}`;

        await DbService.saveOrder(orderData);

        closeModal('checkout-modal');
        document.getElementById('receipt-ticket').innerText = ticketId;
        document.getElementById('receipt-summary').innerText = summaryText;
        document.getElementById('receipt-modal').style.display = 'flex';

        const encodedText = encodeURIComponent(summaryText);
        document.getElementById('btn-whatsapp').onclick = () => {
            window.open(`https://wa.me/639174347647?text=${encodedText}`, '_blank');
        };
        document.getElementById('btn-messenger').onclick = () => {
            const messengerUrl = MESSENGER_USERNAME
                ? `https://m.me/${MESSENGER_USERNAME}`
                : `https://m.me/`;
            navigator.clipboard.writeText(summaryText).then(() => {
                alert("Order details copied to clipboard! Paste them in the chat.");
                window.open(messengerUrl, '_blank');
            }).catch(() => {
                window.open(messengerUrl, '_blank');
            });
        };
    } catch (err) {
        console.error("Checkout error:", err);
        alert("Unable to submit booking: " + err.message);
    } finally {
        btn.disabled = false;
        btn.innerText = "Generate Order Ticket";
    }
}