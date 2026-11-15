import { getAppData } from './davao-data.js';
import { DbService } from './firebase-config.js';

// Optional: Put your Facebook Page username here (e.g., 'gbcdavao') so Messenger opens your page directly
const MESSENGER_USERNAME = 'gbcdavao';

let appData;
let blockedDates = [];
let availability = {};
let map, marker;
let state = {
    materialQtys: {},
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
    [appData, blockedDates, availability] = await Promise.all([
        getAppData(),
        DbService.getBlockedDates().catch(() => []),
        DbService.getAvailability().catch(() => ({}))
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

    // Populate Materials (Tab 1) with individual load steppers
    const matGrid = document.getElementById('material-list');
    const availableMaterials = appData.materials.filter(m => m.inStock);

    if (availableMaterials.length === 0) {
        matGrid.innerHTML = `<p class="sub-text">All materials are currently out of stock. Please call dispatch for updates.</p>`;
    } else {
        availableMaterials.forEach((m, i) => {
            state.materialQtys[m.id] = i === 0 ? 1 : 0;
        });
        renderMaterialCards();
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

function addDaysToDateStr(dateStr, daysToAdd) {
    const [y, m, d] = dateStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d + daysToAdd);
    return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

function getBlockedConflict(tab) {
    const dateInput = document.getElementById(`${tab}-date`);
    const selectedDate = dateInput?.value;
    if (!selectedDate) return null;

    const checks = [];
    if (tab === 'supply') {
        checks.push({ resource: 'truck', date: selectedDate });
    } else if (tab === 'hauling') {
        checks.push({ resource: 'truck', date: selectedDate });
        if (document.getElementById('hauling-backhoe').checked) {
            checks.push({ resource: 'backhoe', date: selectedDate });
        }
    } else if (tab === 'rental') {
        const days = Math.max(1, parseInt(document.getElementById('rental-qty')?.value || 1, 10));
        for (let i = 0; i < days; i++) {
            checks.push({ resource: 'backhoe', date: addDaysToDateStr(selectedDate, i) });
        }
        if (document.getElementById('rental-hauling').checked) {
            checks.push({ resource: 'truck', date: selectedDate });
        }
    }

    const maxTrucks = appData.fleet?.trucks || 4;
    const maxBackhoes = appData.fleet?.backhoes || 2;

    for (const check of checks) {
        const dayUsage = availability[check.date] || {};
        if (check.resource === 'backhoe') {
            const fullBlock = dayUsage.fullBlockBackhoe || blockedDates.some(
                b => b.date === check.date && b.resource === 'backhoe' && (!b.units || b.units === 'all')
            );
            const used = dayUsage.backhoes || 0;
            if (fullBlock || used >= maxBackhoes) {
                return { resource: 'backhoe', date: check.date, notes: dayUsage.notes?.backhoe || 'Fully booked' };
            }
        }
        if (check.resource === 'truck') {
            const fullBlock = dayUsage.fullBlockTruck || blockedDates.some(
                b => b.date === check.date && b.resource === 'truck' && (!b.units || b.units === 'all')
            );
            const used = dayUsage.trucks || 0;
            if (fullBlock || used >= maxTrucks) {
                return { resource: 'truck', date: check.date, notes: dayUsage.notes?.truck || 'Fully booked' };
            }
        }
    }

    return null;
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

let reverseGeocodeTimer;

function updatePinnedLocation(lat, lng, reverseLookup = true, presetAddress = '') {
    const label = document.getElementById('map-pinned-label');
    const mapUrl = `https://www.google.com/maps?q=${lat.toFixed(6)},${lng.toFixed(6)}`;
    clearTimeout(reverseGeocodeTimer);

    if (!reverseLookup) {
        state.location = { lat, lng, address: presetAddress, mapUrl };
        label.innerHTML = `<strong>Pinned:</strong> ${presetAddress}`;
        const custAddressEl = document.getElementById('cust-address');
        if (custAddressEl) custAddressEl.value = presetAddress;
        autoMatchBarangayFee(presetAddress, lat, lng);
        return;
    }

    label.innerText = "Fetching street address...";
    reverseGeocodeTimer = setTimeout(async () => {
        let resolvedAddress;
        try {
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}`);
            const data = await res.json();
            resolvedAddress = data.display_name || `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        } catch {
            resolvedAddress = `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
        }

        state.location = { lat, lng, address: resolvedAddress, mapUrl };
        label.innerHTML = `<strong>Pinned:</strong> ${resolvedAddress}`;

        const custAddressEl = document.getElementById('cust-address');
        if (custAddressEl) custAddressEl.value = resolvedAddress;

        autoMatchBarangayFee(resolvedAddress, lat, lng);
    }, 400);
}

function getDistanceKmFromWaan(lat, lng) {
    const waanLat = 7.1365, waanLng = 125.6050; // Waan, Davao City HQ
    const toRad = deg => (deg * Math.PI) / 180;
    const dLat = toRad(lat - waanLat);
    const dLng = toRad(lng - waanLng);
    const a = Math.sin(dLat / 2) ** 2 +
              Math.cos(toRad(waanLat)) * Math.cos(toRad(lat)) * Math.sin(dLng / 2) ** 2;
    return 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function selectBarangayByKeyword(keyword) {
    document.querySelectorAll('.brgy-select').forEach(select => {
        for (let i = 0; i < select.options.length; i++) {
            if (select.options[i].value.toLowerCase().includes(keyword)) {
                select.selectedIndex = i;
                break;
            }
        }
    });
}

function autoMatchBarangayFee(addressText, lat, lng) {
    const lower = addressText.toLowerCase();

    const zoneMap = [
        { key: 'waan', terms: ['waan'] },
        { key: 'calinan', terms: ['calinan', 'lacson', 'wangan', 'subasta', 'sirib', 'tamayong', 'baguio district', 'malagos', 'marilog', 'buda'] },
        { key: 'toril', terms: ['toril', 'daliao', 'lubogan', 'lizada', 'sirawan', 'binugao', 'marapangi', 'mulig', 'catigan', 'eden', 'bayabas', 'bato'] },
        { key: 'tugbok', terms: ['tugbok', 'mintal', 'catalunan', 'tacunan', 'ulos', 'biao', 'manambulan', 'los amigos', 'matina pangi'] },
        { key: 'talomo', terms: ['talomo', 'matina', 'ecoland', 'maa', 'ma-a', 'bangkal', 'bago aplaya', 'bago gallera', 'dumoy', 'puan', 'ulasan', 'langub', 'magtuod'] },
        { key: 'buhangin', terms: ['buhangin', 'cabantian', 'communal', 'indangan', 'mandug', 'tigatto', 'acacia', 'sasa', 'panacan', 'ilang', 'tibungco', 'bunawan', 'lasang', 'pampanga', 'lanang', 'damosa', 'bajad', 'mamay'] },
        { key: 'agdao', terms: ['agdao', 'lapu-lapu', 'ubalde', 'leon garcia', 'cabaguio', 'r. castillo'] },
        { key: 'poblacion', terms: ['poblacion', 'san pedro', 'claveria', 'rojas', 'roxas', 'obrero', 'bankerohan', 'bucana', 'bolton', 'jacinto', 'quirino', 'torres'] }
    ];

    const matchedZone = zoneMap.find(z => z.terms.some(t => lower.includes(t)));

    if (matchedZone) {
        selectBarangayByKeyword(matchedZone.key);
    } else if (typeof lat === 'number' && typeof lng === 'number') {
        // Fallback by straight-line distance from Waan HQ so outer pins never default to ₱0
        const km = getDistanceKmFromWaan(lat, lng);
        if (km > 22) selectBarangayByKeyword('calinan');
        else if (km > 13) selectBarangayByKeyword('toril');
        else selectBarangayByKeyword('buhangin');
    }

    calcSupply();
    calcHauling();
    calcRental();
}

function panMapToBarangay(brgyName) {
    if (!map || !marker || state.location.address) return;
    const lower = brgyName.toLowerCase();
    const coords = {
        waan: [7.1365, 125.6050],
        poblacion: [7.0644, 125.6078],
        agdao: [7.0864, 125.6267],
        buhangin: [7.1156, 125.6164],
        talomo: [7.0544, 125.5683],
        toril: [7.0186, 125.4956],
        tugbok: [7.0833, 125.5000],
        calinan: [7.1869, 125.4542]
    };
    const key = Object.keys(coords).find(k => lower.includes(k));
    if (key) {
        map.setView(coords[key], 14);
        marker.setLatLng(coords[key]);
    }
}
function compressImage(file, maxDimension = 800, quality = 0.65) {
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

    // Material Per-Card Steppers
    document.getElementById('material-list').addEventListener('click', (e) => {
        const minusBtn = e.target.closest('.mat-step-minus');
        const plusBtn = e.target.closest('.mat-step-plus');
        if (!minusBtn && !plusBtn) return;

        const id = (minusBtn || plusBtn).dataset.id;
        const current = state.materialQtys[id] || 0;
        state.materialQtys[id] = minusBtn ? Math.max(0, current - 1) : current + 1;

        renderMaterialCards();
        calcSupply();
    });

    // Steppers (Hauling & Rental)
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
    bindStepper('hauling-minus', 'hauling-plus', 'hauling-qty', calcHauling);
    bindStepper('rental-minus', 'rental-plus', 'rental-qty', () => {
    calcRental();
    validateTabDate('rental');
});
    bindStepper('rental-haul-minus', 'rental-haul-plus', 'rental-haul-qty', calcRental);

    // Date change validation
    document.getElementById('supply-date').addEventListener('change', () => validateTabDate('supply'));
    document.getElementById('hauling-date').addEventListener('change', () => validateTabDate('hauling'));
    document.getElementById('rental-date').addEventListener('change', () => validateTabDate('rental'));

    // Dynamic Selects & Checkboxes
    document.getElementById('supply-brgy').addEventListener('change', (e) => {
        panMapToBarangay(e.target.value);
        calcSupply();
    });

    document.getElementById('hauling-brgy').addEventListener('change', (e) => {
        panMapToBarangay(e.target.value);
        calcHauling();
    });
    document.getElementById('hauling-backhoe').addEventListener('change', (e) => {
        document.getElementById('hauling-backhoe-row').style.display = e.target.checked ? 'flex' : 'none';
        calcHauling();
        validateTabDate('hauling');
    });

    document.getElementById('rental-brgy').addEventListener('change', (e) => {
        panMapToBarangay(e.target.value);
        calcRental();
    });
document.getElementById('rental-hauling').addEventListener('change', (e) => {
    document.getElementById('rental-hauling-options').style.display = e.target.checked ? 'flex' : 'none';
    document.getElementById('rental-haul-row').style.display = e.target.checked ? 'flex' : 'none';
    calcRental();
    validateTabDate('rental');
});
    // Multi-Section Volume Calculator
    addCalcSectionRow();

    document.getElementById('btn-add-section').addEventListener('click', () => {
        addCalcSectionRow();
    });

    const calcSectionsEl = document.getElementById('calc-sections');
    calcSectionsEl.addEventListener('input', runVolumeCalc);
    calcSectionsEl.addEventListener('change', runVolumeCalc);
    calcSectionsEl.addEventListener('click', (e) => {
        const removeBtn = e.target.closest('.btn-remove-section');
        if (!removeBtn) return;
        removeBtn.closest('.calc-section-card').remove();
        [...calcSectionsEl.children].forEach((card, i) => {
            card.querySelector('.calc-section-header span').textContent = `Section #${i + 1}`;
        });
        runVolumeCalc();
    });

    document.getElementById('calc-purpose').addEventListener('change', () => {
        const isConcrete = document.getElementById('calc-purpose').value === 'concrete';
        document.getElementById('calc-wastage-wrap').style.display = isConcrete ? 'inline-flex' : 'none';
        runVolumeCalc();
    });

    document.getElementById('calc-wastage').addEventListener('change', runVolumeCalc);

    document.getElementById('btn-apply-calc').addEventListener('click', () => {
        const result = runVolumeCalc();
        if (!result || result.totalVol <= 0) {
            alert("Please enter valid dimensions in at least one section first.");
            return;
        }

        Object.keys(state.materialQtys).forEach(k => { state.materialQtys[k] = 0; });

        if (result.purpose === 'concrete') {
            if ('sand' in state.materialQtys) state.materialQtys.sand = result.sandLoads;
            if ('gravel' in state.materialQtys) state.materialQtys.gravel = result.gravelLoads;
        } else if (result.purpose === 'filling') {
            if ('escombro' in state.materialQtys) state.materialQtys.escombro = result.loads;
        } else {
            if ('gravel' in state.materialQtys) state.materialQtys.gravel = result.loads;
            else if ('sand' in state.materialQtys) state.materialQtys.sand = result.loads;
        }

        renderMaterialCards();
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

function renderMaterialCards() {
    const matGrid = document.getElementById('material-list');
    const availableMaterials = appData.materials.filter(m => m.inStock);

    matGrid.innerHTML = availableMaterials.map(m => {
        const qty = state.materialQtys[m.id] || 0;
        return `
            <div class="mat-card ${qty > 0 ? 'selected' : ''}" data-id="${m.id}">
                <div class="mat-card-top">
                    <h4>${m.name}</h4>
                    <p>₱${m.price.toLocaleString()}/load</p>
                </div>
                <div class="mat-card-stepper">
                    <button type="button" class="mat-step-minus" data-id="${m.id}" aria-label="Decrease ${m.name}">−</button>
                    <span>${qty} load${qty === 1 ? '' : 's'}</span>
                    <button type="button" class="mat-step-plus" data-id="${m.id}" aria-label="Increase ${m.name}">+</button>
                </div>
            </div>
        `;
    }).join('');
}

function addCalcSectionRow() {
    const container = document.getElementById('calc-sections');
    const index = container.children.length + 1;
    const row = document.createElement('div');
    row.className = 'calc-section-card';
    row.innerHTML = `
        <div class="calc-section-header">
            <span>Section #${index}</span>
            ${index > 1 ? '<button type="button" class="btn-remove-section">Remove ×</button>' : ''}
        </div>
        <div class="calc-section-grid">
            <div>
                <span class="calc-field-label">Qty (Units)</span>
                <input type="number" class="calc-qty-input calc-sec-qty" value="1" min="1" step="1">
            </div>
            <div>
                <span class="calc-field-label">Length</span>
                <div class="calc-dim-pair">
                    <input type="number" class="calc-sec-l" placeholder="0" step="0.01" min="0">
                    <select class="calc-sec-l-unit">
                        <option value="m" selected>m</option>
                        <option value="ft">ft</option>
                        <option value="in">in</option>
                        <option value="cm">cm</option>
                    </select>
                </div>
            </div>
            <div>
                <span class="calc-field-label">Width</span>
                <div class="calc-dim-pair">
                    <input type="number" class="calc-sec-w" placeholder="0" step="0.01" min="0">
                    <select class="calc-sec-w-unit">
                        <option value="m" selected>m</option>
                        <option value="ft">ft</option>
                        <option value="in">in</option>
                        <option value="cm">cm</option>
                    </select>
                </div>
            </div>
            <div>
                <span class="calc-field-label">Depth / Thick.</span>
                <div class="calc-dim-pair">
                    <input type="number" class="calc-sec-d" placeholder="0" step="0.01" min="0">
                    <select class="calc-sec-d-unit">
                        <option value="in" selected>in</option>
                        <option value="m">m</option>
                        <option value="ft">ft</option>
                        <option value="cm">cm</option>
                    </select>
                </div>
            </div>
        </div>
    `;
    container.appendChild(row);
}

function runVolumeCalc() {
    const purpose = document.getElementById('calc-purpose').value;
    const breakdown = document.getElementById('calc-breakdown');
    const rows = document.querySelectorAll('#calc-sections .calc-section-card');

    let rawVol = 0;
    rows.forEach(row => {
        const qty = Math.max(1, parseFloat(row.querySelector('.calc-sec-qty').value || 1));
        const l = toMeters(parseFloat(row.querySelector('.calc-sec-l').value || 0), row.querySelector('.calc-sec-l-unit').value);
        const w = toMeters(parseFloat(row.querySelector('.calc-sec-w').value || 0), row.querySelector('.calc-sec-w-unit').value);
        const d = toMeters(parseFloat(row.querySelector('.calc-sec-d').value || 0), row.querySelector('.calc-sec-d-unit').value);
        if (l > 0 && w > 0 && d > 0) {
            rawVol += qty * l * w * d;
        }
    });

    if (rawVol <= 0) {
        breakdown.innerHTML = 'Enter dimensions above to estimate loads.';
        return null;
    }

    if (purpose === 'concrete') {
        const addWastage = document.getElementById('calc-wastage').checked;
        const adjVol = addWastage ? rawVol * 1.05 : rawVol;
        const sandVol = adjVol * 0.50;
        const gravelVol = adjVol * 1.00;
        const sandLoads = Math.max(1, Math.ceil(sandVol / 2.8));
        const gravelLoads = Math.max(1, Math.ceil(gravelVol / 2.8));
        const cementBags = Math.ceil(adjVol * 9);

        breakdown.innerHTML = `
            Total Concrete${addWastage ? ' (+5% wastage)' : ''}: <strong>${adjVol.toFixed(2)} cu.m.</strong><br>
            • Washed Sand: <strong>${sandVol.toFixed(2)} cu.m.</strong> (<strong>${sandLoads} load${sandLoads > 1 ? 's' : ''}</strong>)<br>
            • Crushed Gravel: <strong>${gravelVol.toFixed(2)} cu.m.</strong> (<strong>${gravelLoads} load${gravelLoads > 1 ? 's' : ''}</strong>)<br>
            <span style="display:inline-block; margin-top:4px; color:var(--text-muted); font-size:0.78rem;">
                Hardware ref: ~<strong>${cementBags} bags</strong> of 40kg cement (at 9 bags/cu.m.)
            </span>
        `;
        return { purpose, totalVol: adjVol, sandLoads, gravelLoads };
    }

    const factor = purpose === 'filling' ? 1.25 : 1.10;
    const label = purpose === 'filling' ? 'incl. 25% compaction' : 'incl. 10% leveling';
    const targetName = purpose === 'filling' ? 'Filling (Escombro)' : 'Crushed Gravel';
    const reqVol = rawVol * factor;
    const loads = Math.max(1, Math.ceil(reqVol / 2.8));

    breakdown.innerHTML = `
        Required (${label}): <strong>${reqVol.toFixed(2)} cu.m.</strong><br>
        • ${targetName}: <strong>${loads} load${loads > 1 ? 's' : ''}</strong>
    `;
    return { purpose, totalVol: reqVol, loads };
}

function getFee(selectId) {
    const sel = document.getElementById(selectId);
    return parseFloat(sel.options[sel.selectedIndex]?.dataset.fee || 0);
}

function getSelectedMaterials() {
    return appData.materials
        .filter(m => m.inStock && (state.materialQtys[m.id] || 0) > 0)
        .map(m => ({ ...m, qty: state.materialQtys[m.id] }));
}

function calcSupply() {
    const selected = getSelectedMaterials();
    const totalLoads = selected.reduce((sum, item) => sum + item.qty, 0);
    const matCost = selected.reduce((sum, item) => sum + (item.price * item.qty), 0);
    const unitDelFee = getFee('supply-brgy');
    const delFee = totalLoads > 0 ? unitDelFee * totalLoads : 0;
    const total = matCost + delFee;

    document.getElementById('supply-mat-cost').innerText = `₱${matCost.toLocaleString()}`;
    document.getElementById('supply-del-fee').innerText = unitDelFee > 0 && totalLoads > 1
        ? `₱${delFee.toLocaleString()} (₱${unitDelFee.toLocaleString()} × ${totalLoads})`
        : `₱${delFee.toLocaleString()}`;
    document.getElementById('supply-total').innerText = `₱${total.toLocaleString()}`;
    document.getElementById('supply-vol-estimate').innerText = totalLoads > 0
        ? `${totalLoads} Load${totalLoads > 1 ? 's' : ''} (~${(totalLoads * 2.8).toFixed(1)} – ${(totalLoads * 3.0).toFixed(1)} cu.m.)`
        : '0 Loads selected';
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
    if (tab === 'supply' && getSelectedMaterials().length === 0) {
        alert("Please select at least 1 load of material.");
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
            const selected = getSelectedMaterials();
            const totalLoads = selected.reduce((sum, item) => sum + item.qty, 0);
            const itemSummary = selected.map(item => `${item.name} (${item.qty} load${item.qty > 1 ? 's' : ''})`).join(', ');
            const brgy = document.getElementById('supply-brgy').value;
            const date = document.getElementById('supply-date').value;
            const total = document.getElementById('supply-total').innerText;
            orderData.details = { material: itemSummary, qty: totalLoads, brgy, date, total };
            summaryText += `Service: Supply Delivery\nItems: ${itemSummary}\nTotal Loads: ${totalLoads}\nBarangay: ${brgy}\nDate: ${date}\n*Total Est: ${total}*`;
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